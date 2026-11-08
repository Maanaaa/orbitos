// OrbitOS — serveur : API REST + WebSockets (terminal, logs) au-dessus de SSH.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fstatic from '@fastify/static';

import * as ssh from './ssh.js';
import * as journal from './journal.js';
import * as system from './modules/system.js';
import * as docker from './modules/docker.js';
import * as files from './modules/files.js';
import * as nginx from './modules/nginx.js';
import * as doctor from './modules/doctor.js';
import * as github from './modules/github.js';
import * as portainer from './modules/portainer.js';
import * as sites from './modules/sites.js';
import * as apps from './modules/apps.js';
import * as backrest from './modules/backrest.js';
import { publicCatalog } from './modules/catalog.js';
import { HttpError, q, dockerName, unit, absPath, int, bad } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const HOSTS = (process.env.ORBIT_HOSTS || 'orbitos.mana,localhost,127.0.0.1').split(',').map((h) => h.trim().toLowerCase());
const READONLY = process.env.ORBIT_READONLY === '1';
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')).version;
const COMMIT = (process.env.ORBIT_COMMIT || 'dev').slice(0, 12);

// ───────── Secrets ─────────
const SECRET_FILE = path.join(ssh.DATA_DIR, 'secret.json');
let secret;
try {
  secret = JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8'));
} catch {
  secret = { sessionKey: crypto.randomBytes(32).toString('hex') };
}
if (!process.env.ORBIT_PASSWORD && !secret.password) {
  secret.password = crypto.randomBytes(9).toString('base64url');
  console.log(`\n  🔑 Mot de passe OrbitOS généré : ${secret.password}\n     (définis ORBIT_PASSWORD pour le choisir)\n`);
}
fs.writeFileSync(SECRET_FILE, JSON.stringify(secret, null, 2), { mode: 0o600 });
const PASSWORD = process.env.ORBIT_PASSWORD || secret.password;

const sign = (v) => crypto.createHmac('sha256', secret.sessionKey).update(v).digest('base64url');
const makeToken = () => {
  const payload = `${Date.now()}.${crypto.randomBytes(8).toString('hex')}`;
  return `${payload}.${sign(payload)}`;
};
const validToken = (t) => {
  if (!t || typeof t !== 'string') return false;
  const i = t.lastIndexOf('.');
  const payload = t.slice(0, i);
  const sig = t.slice(i + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const issued = Number(payload.split('.')[0]);
  return Date.now() - issued < 30 * 86400000;
};

// ───────── App ─────────
const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'warn' }, bodyLimit: 8 * 1024 * 1024, trustProxy: true });
await app.register(cookie);
await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
// JSON tolérant : un corps vide vaut {}
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  if (!body) return done(null, {});
  try {
    done(null, JSON.parse(body));
  } catch {
    done(Object.assign(new Error('JSON invalide'), { statusCode: 400 }));
  }
});
app.addContentTypeParser('application/octet-stream', { bodyLimit: 4 * 1024 * 1024 * 1024 }, (req, payload, done) => done(null, payload));

const hostOk = (h) => HOSTS.includes(String(h || '').split(':')[0].toLowerCase());

app.addHook('onRequest', async (req, reply) => {
  if (!hostOk(req.headers.host)) return reply.code(421).send({ error: 'Hôte non autorisé' });
  const url = req.url.split('?')[0];
  const isApi = url.startsWith('/api/') || url.startsWith('/ws/');
  if (!isApi || url === '/api/login' || url === '/api/session') return;
  if (!validToken(req.cookies.orbit_session)) return reply.code(401).send({ error: 'Non authentifié' });
  if (url.startsWith('/ws/')) {
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (!hostOk(new URL(origin).host)) return reply.code(403).send({ error: 'Origine refusée' });
      } catch {
        return reply.code(403).send({ error: 'Origine refusée' });
      }
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.headers['x-orbit'] !== '1') return reply.code(403).send({ error: 'En-tête CSRF manquant' });
    if (READONLY && !url.endsWith('/preview') && url !== '/api/logout') return reply.code(403).send({ error: 'OrbitOS est en lecture seule (ORBIT_READONLY=1)' });
  }
});

app.setErrorHandler((err, req, reply) => {
  const status = err instanceof HttpError ? err.status : err.statusCode || 500;
  if (status >= 500) req.log.error(err);
  reply.code(status).send({ error: err.message, details: err.details });
});

// ───────── Session ─────────
const attempts = new Map();
app.post('/api/login', async (req, reply) => {
  const ipKey = req.ip;
  const a = attempts.get(ipKey) || { n: 0, at: Date.now() };
  if (Date.now() - a.at > 60000) Object.assign(a, { n: 0, at: Date.now() });
  if (a.n >= 6) return reply.code(429).send({ error: 'Trop de tentatives, réessaie dans une minute' });
  const given = Buffer.from(String(req.body?.password || ''));
  const expected = Buffer.from(PASSWORD);
  const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
  if (!ok) {
    a.n++;
    attempts.set(ipKey, a);
    await new Promise((r) => setTimeout(r, 400));
    return reply.code(401).send({ error: 'Mot de passe incorrect' });
  }
  attempts.delete(ipKey);
  reply.setCookie('orbit_session', makeToken(), { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 30 * 86400, secure: req.protocol === 'https' });
  return { ok: true };
});
app.get('/api/session', async (req) => ({ authenticated: validToken(req.cookies.orbit_session), readonly: READONLY, version: VERSION, commit: COMMIT }));
app.post('/api/logout', async (req, reply) => {
  reply.clearCookie('orbit_session', { path: '/' });
  return { ok: true };
});

// ───────── Serveurs ─────────
app.get('/api/servers', async () => {
  const st = Object.fromEntries(ssh.poolStatus().map((s) => [s.id, s]));
  return ssh.listServers().map((s) => ({
    id: s.id,
    name: s.name,
    host: s.host,
    port: s.port,
    user: s.user,
    source: s.source,
    color: s.color,
    hidden: !!s.hidden,
    connected: !!st[s.id]?.connected,
    lastError: st[s.id]?.lastError || null,
  }));
});
app.get('/api/keys', async () => ssh.listKeys());
app.post('/api/servers', async (req) => {
  ssh.addServer(req.body || {});
  journal.log({ server: req.body.id, kind: 'server.add', target: `${req.body.user}@${req.body.host}`, ok: true });
  return { ok: true };
});
app.delete('/api/servers/:sid', async (req) => {
  ssh.removeServer(req.params.sid);
  journal.log({ server: req.params.sid, kind: 'server.remove', target: req.params.sid, ok: true });
  return { ok: true };
});
app.patch('/api/servers/:sid', async (req) => {
  ssh.getServer(req.params.sid);
  ssh.setOverride(req.params.sid, req.body || {});
  return { ok: true };
});
app.post('/api/servers/:sid/forget-hostkey', async (req) => {
  ssh.forgetHostKey(req.params.sid);
  journal.log({ server: req.params.sid, kind: 'server.forget-hostkey', target: req.params.sid, ok: true });
  return { ok: true };
});
app.get('/api/s/:sid/ping', async (req) => {
  const t0 = Date.now();
  const c = ssh.conn(req.params.sid);
  const caps = await c.capabilities();
  await c.exec('true');
  return { ok: true, latency: Date.now() - t0, caps };
});

// ───────── Système ─────────
const S = (r) => r.params.sid;
app.get('/api/s/:sid/metrics', (r) => system.metrics(S(r)));
app.get('/api/s/:sid/processes', (r) => system.processes(S(r)));
app.post('/api/s/:sid/processes/:pid/kill', async (r) => {
  const pid = int(r.params.pid, 2, 4194304, null);
  if (!pid) throw bad('PID invalide');
  const sig = r.body?.signal === 'KILL' ? 'KILL' : 'TERM';
  return journal.action(S(r), `process.${sig.toLowerCase()}`, String(pid), () => ssh.runPriv(S(r), `kill -${sig} ${pid}`));
});
app.get('/api/s/:sid/services', (r) => system.services(S(r)));
app.post('/api/s/:sid/services/:name/:action', (r) => system.serviceAction(S(r), r.params.name, r.params.action));
app.get('/api/s/:sid/timers', (r) => system.timers(S(r)));
app.get('/api/s/:sid/cron', (r) => system.crontabs(S(r)));
app.get('/api/s/:sid/security', (r) => system.security(S(r)));
app.post('/api/s/:sid/security/unban', (r) => system.unban(S(r), r.body || {}));
app.get('/api/s/:sid/doctor', (r) => doctor.run(S(r), { force: r.query.force === '1' }));

// ───────── Docker ─────────
app.get('/api/s/:sid/docker/containers', (r) => docker.containers(S(r)));
app.get('/api/s/:sid/docker/stats', (r) => docker.stats(S(r)));
app.get('/api/s/:sid/docker/containers/:name', (r) => docker.inspect(S(r), r.params.name));
app.post('/api/s/:sid/docker/containers/:name/:action', (r) => docker.containerAction(S(r), r.params.name, r.params.action));
app.get('/api/s/:sid/docker/stacks', (r) => docker.stacks(S(r)));
app.post('/api/s/:sid/docker/stacks/:name/:action', (r) => docker.stackAction(S(r), r.params.name, r.params.action));
app.get('/api/s/:sid/docker/images', (r) => docker.images(S(r)));
app.post('/api/s/:sid/docker/images', (r) => docker.imageAction(S(r), r.body?.action, r.body?.ref));
app.get('/api/s/:sid/docker/volumes', (r) => docker.volumes(S(r)));
app.get('/api/s/:sid/docker/volumes/:name/size', async (r) => ({ size: await docker.volumeSize(S(r), r.params.name) }));
app.get('/api/s/:sid/docker/df', (r) => docker.diskUsage(S(r)));
app.get('/api/s/:sid/docker/containers/:name/root', async (r) => {
  const info = await docker.inspect(S(r), r.params.name);
  if (!info.pid) throw bad('Le conteneur doit tourner pour parcourir son système de fichiers');
  return { path: `/proc/${info.pid}/root${info.workdir || '/'}`.replace(/\/$/, '') || '/', root: `/proc/${info.pid}/root` };
});

// ───────── Fichiers ─────────
app.get('/api/s/:sid/files/places', (r) => files.places(S(r)));
app.get('/api/s/:sid/files/list', (r) => files.list(S(r), r.query.path || '/'));
app.get('/api/s/:sid/files/read', (r) => files.read(S(r), r.query.path));
app.get('/api/s/:sid/files/stat', (r) => files.stat(S(r), r.query.path));
app.post('/api/s/:sid/files/write', (r) => {
  const p = absPath(r.body?.path);
  if (p.startsWith('/etc/nginx/')) return nginx.saveConfig(S(r), p, String(r.body?.content ?? ''));
  return files.write(S(r), p, String(r.body?.content ?? ''));
});
app.post('/api/s/:sid/files/mkdir', (r) => files.mkdir(S(r), r.body?.path));
app.post('/api/s/:sid/files/rename', (r) => files.rename(S(r), r.body?.from, r.body?.to));
app.post('/api/s/:sid/files/trash', (r) => files.trash(S(r), r.body?.path));
app.get('/api/s/:sid/files/download', async (req, reply) => {
  const { stream, name, size } = await files.readStream(S(req), req.query.path);
  reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  reply.header('Content-Type', 'application/octet-stream');
  if (size != null) reply.header('Content-Length', size);
  return reply.send(stream);
});
app.get('/api/s/:sid/files/raw', async (req, reply) => {
  // Aperçu inline (images, pdf) — limité aux types sûrs
  const p = absPath(req.query.path);
  const ext = p.split('.').pop().toLowerCase();
  const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', pdf: 'application/pdf', mp4: 'video/mp4', mp3: 'audio/mpeg' };
  if (!types[ext]) throw bad('Aperçu non disponible pour ce type');
  const { stream, size } = await files.readStream(S(req), p);
  reply.header('Content-Type', types[ext]);
  reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
  reply.header('X-Content-Type-Options', 'nosniff');
  if (size != null) reply.header('Content-Length', size);
  return reply.send(stream);
});
app.put('/api/s/:sid/files/upload', (r) => files.uploadStream(S(r), r.query.path, r.body));

// ───────── Nginx / domaines ─────────
app.get('/api/s/:sid/nginx', (r) => nginx.scan(S(r)));
app.get('/api/s/:sid/nginx/check', (r) => nginx.check(S(r), r.query.name));
app.post('/api/s/:sid/nginx/preview', (r) => nginx.preview(S(r), r.body || {}));
app.post('/api/s/:sid/nginx/create', (r) => nginx.create(S(r), r.body || {}));
app.post('/api/s/:sid/nginx/test', (r) => nginx.testAndReload(S(r), !!r.body?.reload));
app.post('/api/s/:sid/nginx/vhosts/:name/:action', async (r) => {
  const { name, action } = r.params;
  if (action === 'enable') return nginx.setEnabled(S(r), name, true);
  if (action === 'disable') return nginx.setEnabled(S(r), name, false);
  if (action === 'remove') return nginx.remove(S(r), name);
  if (action === 'ssl') return nginx.enableSsl(S(r), r.body?.domain || name);
  throw bad('Action invalide');
});
app.post('/api/s/:sid/nginx/certs/:name/renew', (r) => nginx.renewCert(S(r), r.params.name));

// ───────── Intégrations & Sites ─────────
app.get('/api/integrations', async () => ({ github: await github.status(), portainer: portainer.status() }));
app.post('/api/integrations/github', async (r) => {
  const st = await github.setToken(String(r.body?.token || '').trim());
  journal.log({ server: '-', kind: 'integration.github', target: st.login || (st.configured ? 'token' : 'retiré'), ok: !st.error });
  return st;
});
app.post('/api/integrations/portainer', async (r) => {
  const st = await portainer.configure(r.body || {});
  journal.log({ server: st.server || '-', kind: 'integration.portainer', target: st.url || 'retiré', ok: !st.error });
  return st;
});
app.get('/api/github/repos', () => github.repos());
app.get('/api/github/repo', (r) => github.repo(r.query.repo));
app.get('/api/github/branches', (r) => github.branches(r.query.repo));
app.get('/api/github/detect', (r) => github.detect(r.query.repo, r.query.ref, r.query.root || ''));
app.get('/api/sites', () => sites.list());
app.post('/api/sites', (r) => sites.create(r.body || {}));
app.get('/api/sites/:id', (r) => sites.get(r.params.id));
app.patch('/api/sites/:id', (r) => sites.update(r.params.id, r.body || {}));
app.delete('/api/sites/:id', (r) => sites.remove(r.params.id));
app.post('/api/sites/:id/deploy', (r) => sites.deploy(r.params.id));
app.post('/api/sites/:id/rollback', (r) => sites.rollback(r.params.id, String(r.body?.rel || '')));
app.get('/api/sites/:id/releases/:rel/log', (r) => sites.deployLog(r.params.id, r.params.rel, int(r.query.offset, 0, 1e9, 0)));

// ───────── Hébergement : applications ─────────
app.get('/api/hosting/catalog', () => publicCatalog());
app.get('/api/apps', () => apps.list());
app.post('/api/apps', (r) => apps.create(r.body || {}));
app.get('/api/apps/:id', (r) => apps.get(r.params.id));
app.patch('/api/apps/:id', (r) => apps.update(r.params.id, r.body || {}));
app.delete('/api/apps/:id', (r) => apps.remove(r.params.id, { deleteData: r.query.data === '1' }));
app.post('/api/apps/:id/deploy', (r) => apps.deploy(r.params.id));
app.post('/api/apps/:id/control/:action', (r) => apps.control(r.params.id, r.params.action));
app.post('/api/apps/:id/command', (r) => apps.command(r.params.id, r.body?.command));
app.post('/api/apps/:id/credentials', (r) => apps.credentials(r.params.id));
app.post('/api/apps/:id/reveal', (r) => apps.secretEnv(r.params.id, String(r.body?.key || '')));
app.get('/api/apps/:id/jobs/:job/log', (r) => apps.jobLog(r.params.id, r.params.job, int(r.query.offset, 0, 1e9, 0)));
app.get('/api/apps/:id/backups', (r) => apps.backups(r.params.id));
app.post('/api/apps/:id/backups', (r) => apps.backup(r.params.id));
app.post('/api/apps/:id/backups/:name/restore', (r) => apps.restore(r.params.id, r.params.name));
app.delete('/api/apps/:id/backups/:name', (r) => apps.removeBackup(r.params.id, r.params.name));

// ───────── Sauvegarde (Backrest / restic) ─────────
app.get('/api/s/:sid/backrest', (r) => backrest.status(S(r)));
app.get('/api/s/:sid/backrest/sources', (r) => backrest.sources(S(r)));
app.post('/api/s/:sid/backrest/credentials', (r) => backrest.setCredentials(S(r), r.body || {}));
app.post('/api/s/:sid/backrest/plans', (r) => backrest.createPlan(S(r), r.body || {}));
app.patch('/api/s/:sid/backrest/plans/:id', (r) => backrest.updatePlan(S(r), r.params.id, r.body || {}));
app.delete('/api/s/:sid/backrest/plans/:id', (r) => backrest.deletePlan(S(r), r.params.id));
app.post('/api/s/:sid/backrest/plans/:id/run', (r) => backrest.runPlan(S(r), r.params.id));
app.get('/api/s/:sid/backrest/plans/:id/operations', (r) => backrest.operations(S(r), r.params.id));
app.get('/api/s/:sid/backrest/plans/:id/snapshots', (r) => backrest.snapshots(S(r), r.params.id));
app.post('/api/s/:sid/backrest/repos/:id/:task', (r) => backrest.repoTask(S(r), r.params.id, r.params.task));
app.post('/api/s/:sid/backrest/plans/:id/restore', (r) => backrest.restore(S(r), r.params.id, r.body || {}));

// ───────── Journal ─────────
app.get('/api/journal', (r) => journal.read(int(r.query.limit, 1, 2000, 300)));

// ───────── WebSockets ─────────
function wsGuard(socket, fn) {
  fn().catch((e) => {
    try {
      socket.send(`\r\n\x1b[31m✖ ${e.message}\x1b[0m\r\n`);
      socket.close();
    } catch {
      /* ignore */
    }
  });
}

app.get('/ws/terminal', { websocket: true }, (socket, req) =>
  wsGuard(socket, async () => {
    const { sid, mode = 'shell', target = '', cols = '120', rows = '32' } = req.query;
    const pty = { term: 'xterm-256color', cols: int(cols, 10, 500, 120), rows: int(rows, 5, 200, 32) };
    const c = ssh.conn(sid);
    let stream;
    if (mode === 'container') {
      dockerName(target);
      const p = await ssh.dockerPrefix(sid);
      stream = await c.channel(`${p}docker exec -it -e TERM=xterm-256color ${q(target)} sh -c 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'`, pty);
    } else {
      stream = await c.channel(null, pty);
    }
    journal.log({ server: sid, kind: 'terminal.open', target: mode === 'container' ? target : 'shell', ok: true });
    stream.on('data', (d) => socket.readyState === 1 && socket.send(d.toString('utf8')));
    stream.stderr?.on('data', (d) => socket.readyState === 1 && socket.send(d.toString('utf8')));
    stream.on('close', () => socket.close());
    socket.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.type === 'data' && typeof m.data === 'string') stream.write(m.data);
      else if (m.type === 'resize') stream.setWindow(int(m.rows, 5, 200, 32), int(m.cols, 10, 500, 120), 0, 0);
    });
    socket.on('close', () => {
      try {
        stream.close();
      } catch {
        /* ignore */
      }
    });
  }),
);

app.get('/ws/logs', { websocket: true }, (socket, req) =>
  wsGuard(socket, async () => {
    const { sid, kind, target = '', tail = '300' } = req.query;
    const n = int(tail, 10, 5000, 300);
    let cmd;
    if (kind === 'container') {
      dockerName(target);
      cmd = `${await ssh.dockerPrefix(sid)}docker logs -f --tail ${n} --timestamps ${q(target)} 2>&1`;
    } else if (kind === 'unit') {
      unit(target);
      cmd = `${await ssh.privPrefix(sid)}journalctl -f -n ${n} -u ${q(target)} --no-pager -o short-iso 2>&1`;
    } else if (kind === 'journal') {
      cmd = `${await ssh.privPrefix(sid)}journalctl -f -n ${n} --no-pager -o short-iso 2>&1`;
    } else if (kind === 'file') {
      const p = absPath(target);
      if (!p.startsWith('/var/log/')) throw bad('Seuls les fichiers de /var/log sont suivis');
      cmd = `${await ssh.privPrefix(sid)}tail -n ${n} -F ${q(p)} 2>&1`;
    } else throw bad('Type de log inconnu');
    const stream = await ssh.conn(sid).channel(cmd);
    stream.on('data', (d) => socket.readyState === 1 && socket.send(d.toString('utf8')));
    stream.stderr?.on('data', (d) => socket.readyState === 1 && socket.send(d.toString('utf8')));
    stream.on('close', () => socket.close());
    socket.on('close', () => {
      try {
        stream.signal?.('INT');
        stream.close();
      } catch {
        /* ignore */
      }
    });
  }),
);

// ───────── Frontend ─────────
const DIST = path.resolve(__dirname, '../web/dist');
if (fs.existsSync(DIST)) {
  await app.register(fstatic, { root: DIST, wildcard: false, maxAge: '1h' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) return reply.code(404).send({ error: 'Route inconnue' });
    return reply.type('text/html').sendFile('index.html', { maxAge: 0 });
  });
}

app.addHook('onSend', async (req, reply, payload) => {
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'same-origin');
  reply.header('X-Content-Type-Options', 'nosniff');
  return payload;
});

await app.listen({ port: PORT, host: process.env.HOST || '0.0.0.0' });
console.log(`OrbitOS en écoute sur :${PORT} (hôtes autorisés : ${HOSTS.join(', ')})${READONLY ? ' — LECTURE SEULE' : ''}`);
