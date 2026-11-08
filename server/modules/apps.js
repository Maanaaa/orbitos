// Hébergement — applications : serveurs de jeu, vocal, bots, images Docker quelconques.
//
// Chaque application = un projet compose « app-<id> » (un service, conteneur « app-<id> »),
// des volumes Docker nommés « app-<id>-<clé> », des ports publics attribués automatiquement.
// Fichiers sur le serveur : /opt/orbitos-apps/<id>/{compose.yml,.env,app/}
// Sauvegardes : /var/backups/orbitos/apps/<id>/<horodatage>.tar.gz
// Les opérations longues (installation, mise à jour, sauvegarde, restauration) sont des « jobs »
// exécutés en arrière-plan dont le navigateur suit le log.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { conn, getServer, privPrefix, dockerPrefix, stream, DATA_DIR } from '../ssh.js';
import { q, bad, HttpError, dockerRef, stamp } from '../util.js';
import * as journal from '../journal.js';
import * as github from './github.js';
import * as portainer from './portainer.js';
import { trash } from './files.js';
import { getTemplate, fieldValue, RUNTIMES } from './catalog.js';

const APPS_FILE = path.join(DATA_DIR, 'apps.json');
const LOG_DIR = path.join(DATA_DIR, 'app-jobs');
const BASE = '/opt/orbitos-apps';
const BACKUPS = '/var/backups/orbitos/apps';
const MASK = '••••••';
fs.mkdirSync(LOG_DIR, { recursive: true });

// ───────── Registre ─────────
function loadAll() {
  try {
    return JSON.parse(fs.readFileSync(APPS_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function saveAll(list) {
  fs.writeFileSync(APPS_FILE + '.tmp', JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(APPS_FILE + '.tmp', APPS_FILE);
}
function getApp(id) {
  const a = loadAll().find((x) => x.id === id);
  if (!a) throw new HttpError(404, 'Application introuvable');
  return a;
}
function patchApp(id, patch) {
  const all = loadAll();
  const i = all.findIndex((x) => x.id === id);
  if (i < 0) throw new HttpError(404, 'Application introuvable');
  all[i] = typeof patch === 'function' ? patch(all[i]) : { ...all[i], ...patch };
  saveAll(all);
  return all[i];
}

const SECRETISH = /(pass|secret|token|key|auth|credential|private)/i;
function isSecret(a, k) {
  const t = getTemplate(a.template);
  const f = t?.fields.find((x) => x.key === k);
  return f ? !!f.secret || f.type === 'password' : SECRETISH.test(k);
}
const cname = (a) => `app-${a.id}`;

function publicApp(a) {
  const env = Object.fromEntries(Object.entries(a.env || {}).map(([k, v]) => [k, isSecret(a, k) && v ? MASK : v]));
  return { ...a, env, credentials: undefined, hasCredentials: !!Object.keys(a.credentials || {}).length, job: running.get(a.id) ? { id: running.get(a.id).id, kind: running.get(a.id).kind } : null };
}

// ───────── État en direct ─────────
const ipCache = new Map();
async function publicAddress(sid) {
  const c = ipCache.get(sid);
  if (c && Date.now() - c.at < 3600000) return c.ip;
  const host = getServer(sid).host;
  let ip = host;
  try {
    const r = await conn(sid).exec(`ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \\([0-9.]*\\).*/\\1/p'`);
    const found = r.stdout.trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(found) && !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(found)) ip = found;
  } catch {
    /* hôte SSH par défaut */
  }
  ipCache.set(sid, { ip, at: Date.now() });
  return ip;
}

async function liveStatus(sid) {
  const dp = await dockerPrefix(sid);
  const r = await conn(sid).exec(`${dp}docker ps -a --filter label=orbitos.app --format '{{.Names}}\t{{.State}}\t{{.Status}}'`);
  const map = {};
  for (const line of r.stdout.split('\n')) {
    const [name, state, status] = line.split('\t');
    if (name) map[name] = { state, status };
  }
  return map;
}

export async function list() {
  const all = loadAll();
  const servers = [...new Set(all.map((a) => a.server))];
  const live = {};
  const addr = {};
  await Promise.all(
    servers.map(async (sid) => {
      try {
        [live[sid], addr[sid]] = await Promise.all([liveStatus(sid), publicAddress(sid)]);
      } catch (e) {
        live[sid] = { error: e.message };
      }
    }),
  );
  return all.map((a) => {
    const st = live[a.server]?.[cname(a)];
    let host = addr[a.server];
    try {
      host ||= getServer(a.server).host;
    } catch {
      host ||= '?';
    }
    return { ...publicApp(a), address: host, state: st?.state || (live[a.server]?.error ? 'unknown' : 'absent'), status: st?.status || live[a.server]?.error || null };
  });
}

export function get(id) {
  return publicApp(getApp(id));
}

// ───────── Validation ─────────
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,100}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CONTAINER_PATH = /^\/[A-Za-z0-9_.\/-]{0,200}$/;

function slug(name) {
  return (
    String(name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'app'
  );
}

function checkCommand(c, label) {
  if (c && (/[\n\r\0]/.test(c) || c.length > 500)) throw bad(`${label} invalide`);
  return c || '';
}

/** Valeurs des réglages du modèle + variables libres → env final (sans les variables figées du modèle). */
function buildEnv(t, body, existing) {
  const prev = existing?.env || {};
  const env = {};
  for (const f of t.fields) {
    let v = body.fields?.[f.key];
    if (v === undefined) v = prev[f.key] ?? f.default;
    if (v === MASK && prev[f.key] !== undefined) v = prev[f.key];
    v = fieldValue(f, v);
    if (f.required && !v) throw bad(`« ${f.label} » est requis`);
    if (f.minLength && v && v.length < f.minLength) throw bad(`« ${f.label} » : ${f.minLength} caractères minimum`);
    if (f.type === 'number' && v !== '') {
      const n = Number(v);
      if (!Number.isFinite(n) || (f.min != null && n < f.min) || (f.max != null && n > f.max)) throw bad(`« ${f.label} » doit être entre ${f.min} et ${f.max}`);
    }
    if (f.type === 'select' && v && !f.options.includes(v)) throw bad(`« ${f.label} » : valeur inconnue`);
    if (/[\n\r\0]/.test(v)) throw bad(`« ${f.label} » : retour à la ligne interdit`);
    if (v !== '') env[f.key] = v;
  }
  const extra = body.extraEnv !== undefined ? body.extraEnv || {} : Object.fromEntries(Object.entries(prev).filter(([k]) => !t.fields.some((f) => f.key === k)));
  for (const [k, raw] of Object.entries(extra)) {
    if (!ENV_KEY.test(k)) throw bad(`Variable invalide : ${k}`);
    const v = raw === MASK && prev[k] !== undefined ? prev[k] : String(raw);
    if (/[\n\r\0]/.test(v)) throw bad(`Variable ${k} : retour à la ligne interdit`);
    env[k] = v;
  }
  return env;
}

function parseCustomPorts(list) {
  if (!Array.isArray(list) || list.length > 20) throw bad('Ports invalides');
  return list.map((p, i) => {
    const port = Number(p.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad(`Port invalide : ${p.port}`);
    if (!['tcp', 'udp', 'both'].includes(p.proto)) throw bad('Protocole invalide');
    return { key: `p${i + 1}`, port, proto: p.proto, label: String(p.label || `Port ${port}`).slice(0, 40), private: !!p.private };
  });
}

function parseCustomVolumes(list) {
  if (!Array.isArray(list) || list.length > 10) throw bad('Volumes invalides');
  return list.map((v, i) => {
    if (!CONTAINER_PATH.test(v.path || '') || v.path.includes('..')) throw bad(`Chemin de volume invalide : ${v.path}`);
    return { key: `v${i + 1}`, path: v.path.replace(/\/+$/, '') || '/' };
  });
}

// ───────── Ports ─────────
async function usedPorts(sid, exceptId) {
  const used = { tcp: new Set(), udp: new Set() };
  const r = await conn(sid).exec(`ss -tulnH 2>/dev/null | awk '{print $1" "$5}'`);
  for (const line of r.stdout.split('\n')) {
    const [proto, addr] = line.split(' ');
    const p = Number(addr?.slice(addr.lastIndexOf(':') + 1));
    if (p && used[proto]) used[proto].add(p);
  }
  // Ports réservés par les autres applications (même arrêtées)
  for (const a of loadAll()) {
    if (a.server !== sid || a.id === exceptId) continue;
    for (const p of a.ports || []) for (let i = 0; i < (p.range || 1); i++) for (const pr of protos(p.proto)) used[pr].add(p.host + i);
  }
  return used;
}
const protos = (proto) => (proto === 'both' ? ['tcp', 'udp'] : [proto]);

function isFree(used, proto, start, range = 1) {
  for (let i = 0; i < range; i++) for (const pr of protos(proto)) if (used[pr].has(start + i) || start + i > 65535) return false;
  return true;
}

/** Attribue les ports publics : le port par défaut du jeu si libre, sinon le suivant. */
async function allocatePorts(sid, specs, wanted = {}, exceptId, current = []) {
  const used = await usedPorts(sid, exceptId);
  // Les ports déjà tenus par cette app (conteneur en marche) restent valides pour elle.
  for (const c of current) for (let i = 0; i < (c.range || 1); i++) for (const pr of protos(c.proto)) used[pr].delete(c.host + i);
  const out = [];
  for (const s of specs) {
    const range = s.range || 1;
    const step = Math.max(range, 1);
    let host;
    const asked = wanted[s.key] != null && wanted[s.key] !== '' ? Number(wanted[s.key]) : null;
    if (asked != null) {
      if (!Number.isInteger(asked) || asked < 1024 || asked > 65535) throw bad(`Port ${s.label} invalide (1024–65535)`);
      if (!isFree(used, s.proto, asked, range)) throw bad(`Le port ${asked}/${s.proto} est déjà utilisé sur ce serveur`);
      host = asked;
    } else {
      const cur = current.find((c) => c.key === s.key);
      host = cur && isFree(used, s.proto, cur.host, range) ? cur.host : null;
      for (let p = s.port; host == null && p < s.port + 400 * step; p += step) if (isFree(used, s.proto, p, range)) host = p;
      if (host == null) throw bad(`Aucun port libre pour ${s.label}`);
    }
    for (let i = 0; i < range; i++) for (const pr of protos(s.proto)) used[pr].add(host + i);
    out.push({ key: s.key, label: s.label, proto: s.proto, range: s.range || undefined, private: !!s.private, host, container: s.env ? host : s.port, env: s.env || undefined });
  }
  return out;
}

// ───────── Création / modification ─────────
export async function create(body) {
  const t = getTemplate(body.template);
  if (!t) throw bad('Modèle inconnu');
  const sid = getServer(body.server).id;
  const name = String(body.name || '').trim();
  if (!name || name.length > 40) throw bad('Nom requis (40 caractères max)');
  let id = slug(body.id || name);
  const all = loadAll();
  for (let n = 2; all.some((x) => x.id === id); n++) id = `${slug(name).slice(0, 28)}-${n}`;
  if (!ID.test(id)) throw bad('Identifiant invalide');

  const dp = await dockerPrefix(sid);
  const dv = await conn(sid).exec(`${dp}docker compose version --short 2>/dev/null`);
  if (dv.code !== 0) throw bad('Docker (avec le plugin compose) n’est pas disponible sur ce serveur');

  const a = { id, name, template: t.id, server: sid, createdAt: new Date().toISOString(), jobs: [], firewall: [] };
  if (t.custom) {
    a.image = dockerRef(String(body.image || '').trim());
    a.command = checkCommand(String(body.command || '').trim(), 'Commande');
    a.customPorts = parseCustomPorts(body.ports || []);
    a.customVolumes = parseCustomVolumes(body.volumes || []);
    a.stdin = !!body.stdin;
  }
  if (t.fromRepo) {
    a.repo = github.validRepo(body.repo);
    a.branch = github.validRef(body.branch || 'main');
    if (!RUNTIMES[body.runtime]) throw bad('Environnement d’exécution inconnu');
    a.runtime = body.runtime;
    a.start = checkCommand(String(body.start ?? RUNTIMES[body.runtime].start).trim(), 'Commande de démarrage');
    if (a.runtime !== 'dockerfile' && !a.start) throw bad('Commande de démarrage requise');
  }
  a.memory = memoryOf(t, body.memory);
  a.env = buildEnv(t, body);
  a.ports = await allocatePorts(sid, specsOf(a), body.portsWanted || {});
  a.volumes = volumesOf(a).map((v) => ({ ...v, name: `app-${id}-${v.key}` }));
  a.firewall = [];
  a.openFirewall = body.openFirewall !== false;

  saveAll([...loadAll(), a]);
  journal.log({ server: sid, kind: 'app.create', target: `${name} (${t.name})`, ok: true });
  const job = startJob(a.id, 'install', (log, step) => runDeploy(a.id, log, step));
  return { ...publicApp(getApp(id)), job };
}

function memoryOf(t, v) {
  const n = v == null || v === '' ? t.memory.default : Number(v);
  if (!Number.isInteger(n) || n < t.memory.min || n > 262144) throw bad(`Mémoire : ${t.memory.min} Mo minimum`);
  return n;
}
const specsOf = (a) => (a.customPorts ? a.customPorts : getTemplate(a.template).ports);
const volumesOf = (a) => (a.customVolumes ? a.customVolumes : getTemplate(a.template).volumes);

export async function update(id, body) {
  const a = getApp(id);
  if (running.has(id)) throw bad('Une opération est en cours sur cette application');
  const t = getTemplate(a.template);
  const next = { ...a };
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n || n.length > 40) throw bad('Nom invalide');
    next.name = n;
  }
  if (body.memory !== undefined) next.memory = memoryOf(t, body.memory);
  if (body.fields !== undefined || body.extraEnv !== undefined) next.env = buildEnv(t, body, a);
  if (t.custom) {
    if (body.image !== undefined) next.image = dockerRef(String(body.image).trim());
    if (body.command !== undefined) next.command = checkCommand(String(body.command).trim(), 'Commande');
    if (body.ports !== undefined) next.customPorts = parseCustomPorts(body.ports);
    if (body.volumes !== undefined) {
      next.customVolumes = parseCustomVolumes(body.volumes);
      next.volumes = next.customVolumes.map((v) => ({ ...v, name: `app-${id}-${v.key}` }));
    }
    if (body.stdin !== undefined) next.stdin = !!body.stdin;
  }
  if (t.fromRepo) {
    if (body.branch !== undefined) next.branch = github.validRef(body.branch);
    if (body.start !== undefined) next.start = checkCommand(String(body.start).trim(), 'Commande de démarrage');
  }
  if (body.portsWanted !== undefined || body.ports !== undefined) next.ports = await allocatePorts(a.server, specsOf(next), body.portsWanted || {}, id, a.ports);
  patchApp(id, next);
  journal.log({ server: a.server, kind: 'app.update', target: a.name, ok: true });
  return publicApp(next);
}

// ───────── Jobs ─────────
const running = new Map(); // appId -> { id, kind, log: [] }
const JOB_ID = /^[0-9]{8}-[0-9]{6}-[a-z]+$/;
const jobLogPath = (appId, job) => path.join(LOG_DIR, `${appId}--${job}.log`);

function startJob(appId, kind, fn) {
  if (running.has(appId)) throw bad('Une opération est déjà en cours sur cette application');
  const id = `${stamp()}-${kind}`;
  const state = { id, kind, log: [] };
  running.set(appId, state);
  const t0 = Date.now();
  patchApp(appId, (x) => ({ ...x, jobs: [{ id, kind, at: new Date().toISOString(), status: 'running' }, ...(x.jobs || [])].slice(0, 30) }));
  const log = (l) => state.log.push(l);
  const step = (l) => log(`\n▸ ${l}\n`);
  (async () => {
    let status = 'success';
    try {
      await fn(log, step);
      log(`\n✓ Terminé (${Math.round((Date.now() - t0) / 1000)} s)\n`);
    } catch (e) {
      status = 'failed';
      log(`\n✖ Échec : ${e.message}\n`);
    }
    try {
      fs.writeFileSync(jobLogPath(appId, id), state.log.join(''));
    } catch {
      /* ignore */
    }
    running.delete(appId);
    try {
      const a = patchApp(appId, (x) => ({ ...x, jobs: (x.jobs || []).map((j) => (j.id === id ? { ...j, status, duration: Math.round((Date.now() - t0) / 1000) } : j)) }));
      journal.log({ server: a.server, kind: `app.${kind}`, target: a.name, ok: status === 'success', error: status === 'success' ? undefined : 'voir le log' });
    } catch {
      /* app supprimée entre-temps */
    }
  })();
  return id;
}

export function jobLog(id, job, offset = 0) {
  if (!JOB_ID.test(job)) throw bad('Opération invalide');
  const a = getApp(id);
  const live = running.get(id);
  let text = '';
  if (live && live.id === job) text = live.log.join('');
  else {
    try {
      text = fs.readFileSync(jobLogPath(id, job), 'utf8');
    } catch {
      text = '';
    }
  }
  const j = (a.jobs || []).find((x) => x.id === job);
  return { text: text.slice(offset), size: text.length, done: !(live && live.id === job), status: j?.status || 'unknown' };
}

// ───────── Compose ─────────
const yq = (v) => JSON.stringify(String(v)).replace(/\$/g, '$$$$');
const appDir = (a) => `${BASE}/${a.id}`;

function runtimeCommand(a) {
  const start = a.start;
  if (a.runtime === 'node') return `cd /app && (npm ci --no-audit --no-fund || npm install --no-audit --no-fund) && exec ${start}`;
  if (a.runtime === 'bun') return `cd /app && bun install && exec ${start}`;
  if (a.runtime === 'python') return `cd /app && { [ -x /app/.venv/bin/python ] || python -m venv /app/.venv; } && . /app/.venv/bin/activate && if [ -f requirements.txt ]; then pip install -q --no-cache-dir -r requirements.txt; fi && exec ${start}`;
  return null;
}

/** Variables finales : figées du modèle, mémoire, ports annoncés, puis réglages de l'utilisateur. */
function finalEnv(a) {
  const t = getTemplate(a.template);
  const env = { ...t.env };
  if (t.memoryEnv) env[t.memoryEnv] = `${Math.max(512, Math.floor(a.memory * 0.75))}M`;
  for (const p of a.ports || []) if (p.env) env[p.env] = String(p.host);
  return { ...env, ...a.env };
}

export function composeFor(a, image) {
  const t = getTemplate(a.template);
  const env = finalEnv(a);
  const ports = [];
  for (const p of a.ports || []) {
    const bind = p.private ? '127.0.0.1:' : '';
    const h = p.range ? `${p.host}-${p.host + p.range - 1}` : `${p.host}`;
    const c = p.range ? `${p.container}-${p.container + p.range - 1}` : `${p.container}`;
    for (const pr of protos(p.proto)) ports.push(`      - "${bind}${h}:${c}/${pr}"`);
  }
  const vols = (a.volumes || []).map((v) => `      - ${v.name}:${v.path}`);
  const cmd = a.custom || t.custom ? a.command : t.fromRepo ? runtimeCommand(a) : null;
  if (t.fromRepo && a.runtime !== 'dockerfile') vols.push(`      - ${appDir(a)}/app:/app`);
  const stdin = t.console?.kind === 'stdin' && (!t.custom || a.stdin);
  const lines = [
    `# ${a.name} — application gérée par OrbitOS (modèle ${t.name})`,
    'services:',
    '  app:',
    `    image: ${yq(image)}`,
    `    container_name: app-${a.id}`,
    '    restart: unless-stopped',
    '    labels:',
    `      orbitos.app: ${yq(a.id)}`,
    `      orbitos.template: ${yq(t.id)}`,
  ];
  if (ports.length) lines.push('    ports:', ...ports);
  if (Object.keys(env).length) lines.push('    environment:', ...Object.keys(env).map((k) => `      ${k}: \${${k}}`));
  if (vols.length) lines.push('    volumes:', ...vols);
  if (t.fromRepo && a.runtime !== 'dockerfile') lines.push('    working_dir: /app');
  if (cmd) lines.push(`    command: ["sh", "-c", ${yq(cmd)}]`);
  if (stdin) lines.push('    stdin_open: true');
  lines.push(`    mem_limit: ${a.memory}m`);
  if (t.stopGrace) lines.push(`    stop_grace_period: ${t.stopGrace}s`);
  lines.push('    logging:', '      driver: json-file', '      options:', '        max-size: "20m"', '        max-file: "5"');
  if (a.volumes?.length) {
    lines.push('volumes:');
    for (const v of a.volumes) lines.push(`  ${v.name}:`, `    name: ${v.name}`);
  }
  return { compose: lines.join('\n') + '\n', env };
}

/** Fichier .env pour docker compose : valeurs littérales (pas d'interpolation). */
function dotenv(env) {
  return Object.entries(env)
    .map(([k, v]) => (String(v).includes("'") ? `${k}="${String(v).replace(/(["\\$])/g, '\\$1')}"` : `${k}='${v}'`))
    .join('\n');
}

async function up(a, image, log) {
  const dp = await dockerPrefix(a.server);
  const { compose, env } = composeFor(a, image);
  if (portainer.managesServer(a.server)) {
    log('Mise à jour de la stack Portainer…\n');
    const stackId = await portainer.upsertStack({ id: a.stackId, name: `app-${a.id}`, compose, env });
    if (stackId !== a.stackId) patchApp(a.id, { stackId });
    return;
  }
  const dir = appDir(a);
  const code = await stream(
    a.server,
    `set -e
mkdir -p ${q(dir)}
umask 077
cat > ${q(dir + '/compose.yml')} <<'ORBIT_EOF'
${compose}ORBIT_EOF
cat > ${q(dir + '/.env')} <<'ORBIT_EOF'
${dotenv(env)}
ORBIT_EOF
cd ${q(dir)} && ${dp}docker compose -p ${q('app-' + a.id)} up -d --remove-orphans 2>&1`,
    { onData: log },
  );
  if (code !== 0) throw new Error('docker compose up a échoué');
}

// ───────── Installation / mise à jour ─────────
async function fetchRepo(a, log, step) {
  const c = await github.commit(a.repo, a.branch);
  log(`Commit ${c.sha.slice(0, 7)} « ${c.message} » (${c.author || '?'})\n`);
  step(`Récupération de ${a.repo}@${a.branch}`);
  const dir = appDir(a);
  const body = await github.tarball(a.repo, c.sha);
  // Nouveau code dans app.new, on garde les dépendances déjà installées, puis échange atomique.
  const code = await stream(
    a.server,
    `set -e
mkdir -p ${q(dir)}
rm -rf ${q(dir + '/app.new')}
mkdir -p ${q(dir + '/app.new')}
tar -xzf - --strip-components=1 -C ${q(dir + '/app.new')}
for d in node_modules .venv; do [ -d ${q(dir + '/app')}/$d ] && [ ! -e ${q(dir + '/app.new')}/$d ] && mv ${q(dir + '/app')}/$d ${q(dir + '/app.new')}/ ; done
rm -rf ${q(dir + '/app.old')}
[ -d ${q(dir + '/app')} ] && mv ${q(dir + '/app')} ${q(dir + '/app.old')}
mv ${q(dir + '/app.new')} ${q(dir + '/app')}
rm -rf ${q(dir + '/app.old')}
echo "$(find ${q(dir + '/app')} -path '*/node_modules' -prune -o -path '*/.venv' -prune -o -type f -print | wc -l) fichiers"`,
    { stdin: Readable.fromWeb(body), onData: log, timeout: 600000 },
  );
  if (code !== 0) throw new Error('Récupération du code échouée');
  patchApp(a.id, { commit: { sha: c.sha, message: c.message, at: new Date().toISOString() } });
  return c;
}

async function runDeploy(id, log, step) {
  let a = getApp(id);
  const t = getTemplate(a.template);
  const dp = await dockerPrefix(a.server);
  log(`${a.name} — ${t.name} sur ${a.server}\n`);
  let image = t.custom ? a.image : t.image;

  if (t.fromRepo) {
    const c = await fetchRepo(a, log, step);
    if (a.runtime === 'dockerfile') {
      image = `orbitos-app-${a.id}:${c.sha.slice(0, 12)}`;
      step(`docker build → ${image}`);
      const code = await stream(a.server, `cd ${q(appDir(a) + '/app')} && DOCKER_BUILDKIT=1 ${dp}docker build --progress=plain -t ${q(image)} . 2>&1`, { onData: log, timeout: 1800000 });
      if (code !== 0) throw new Error(`docker build a échoué (code ${code})`);
    } else image = RUNTIMES[a.runtime].image;
  }
  if (!(t.fromRepo && a.runtime === 'dockerfile')) {
    step(`Téléchargement de l’image ${image}`);
    const code = await stream(a.server, `${dp}docker pull ${q(image)} 2>&1 | grep -v -E '(Waiting|Downloading|Extracting|Verifying Checksum|Pulling fs layer)' || true; ${dp}docker image inspect ${q(image)} >/dev/null`, { onData: log, timeout: 1800000 });
    if (code !== 0) throw new Error('Image introuvable ou téléchargement échoué');
  }

  step('Démarrage');
  a = getApp(id);
  const pub = (a.ports || []).filter((p) => !p.private);
  if (pub.length) log(`Ports publics : ${pub.map((p) => `${p.host}${p.range ? `-${p.host + p.range - 1}` : ''}/${p.proto === 'both' ? 'tcp+udp' : p.proto} (${p.label})`).join(', ')}\n`);
  await up(a, image, log);
  patchApp(id, { image: t.custom ? a.image : image, deployedAt: new Date().toISOString() });

  if (a.openFirewall && pub.length) {
    step('Pare-feu');
    await syncFirewall(getApp(id), log);
  }

  step('Vérification');
  const ok = await waitStable(a, log);
  if (!ok) throw new Error('Le conteneur ne reste pas démarré : consulte ses logs');
  if (t.secretsFromLogs) {
    await new Promise((r) => setTimeout(r, 4000));
    const cr = await scanCredentials(id);
    if (Object.keys(cr).length) log(`🔑 Identifiants trouvés dans les logs : ${Object.keys(cr).join(', ')} (onglet Infos)\n`);
  }
  if (t.notes) log(`ℹ ${t.notes}\n`);
}

async function waitStable(a, log) {
  const dp = await dockerPrefix(a.server);
  let lastRestarts = null;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const r = await conn(a.server).exec(`${dp}docker inspect -f '{{.State.Status}} {{.RestartCount}}' app-${a.id} 2>/dev/null`);
    const [state, restarts] = r.stdout.trim().split(' ');
    if (state === 'running' && i >= 3 && restarts === lastRestarts) {
      log('Le conteneur tourne\n');
      const tail = await conn(a.server).exec(`${dp}docker logs --tail 15 app-${a.id} 2>&1`);
      if (tail.stdout.trim()) log(`--- derniers logs ---\n${tail.stdout}\n`);
      return true;
    }
    if (state === 'exited' || state === 'dead') break;
    lastRestarts = restarts;
  }
  const logs = await conn(a.server).exec(`${dp}docker logs --tail 40 app-${a.id} 2>&1`);
  log(`--- docker logs ---\n${logs.stdout}\n`);
  return false;
}

export function deploy(id) {
  getApp(id);
  return { job: startJob(id, 'update', (log, step) => runDeploy(id, log, step)) };
}

// ───────── Pare-feu (ufw) ─────────
// Docker publie ses ports en contournant ufw ; on ajoute quand même les règles pour que le
// Bouclier reflète l'exposition réelle et pour les configurations « ufw-docker ».
function fwRules(a) {
  const out = [];
  for (const p of a.ports || []) {
    if (p.private) continue;
    const port = p.range ? `${p.host}:${p.host + p.range - 1}` : `${p.host}`;
    for (const pr of protos(p.proto)) out.push(`${port}/${pr}`);
  }
  return out;
}

async function syncFirewall(a, log) {
  const pre = await privPrefix(a.server);
  const st = await conn(a.server).exec(`${pre}ufw status 2>/dev/null | head -1`);
  if (!/Status: active/.test(st.stdout)) {
    log('ufw inactif : rien à ouvrir (vérifie le pare-feu de ton hébergeur si besoin)\n');
    return;
  }
  const want = fwRules(a);
  const have = a.firewall || [];
  for (const r of have.filter((x) => !want.includes(x))) {
    await conn(a.server).exec(`${pre}ufw delete allow ${q(r)} 2>&1`);
    log(`ufw : ${r} refermé\n`);
  }
  for (const r of want.filter((x) => !have.includes(x))) {
    const res = await conn(a.server).exec(`${pre}ufw allow ${q(r)} comment ${q(`orbitos app-${a.id}`)} 2>&1`);
    log(`ufw : ${r} ${res.code === 0 ? 'ouvert' : `échec (${res.stdout.trim()})`}\n`);
  }
  patchApp(a.id, { firewall: want });
}

// ───────── Contrôle ─────────
export async function control(id, act) {
  const a = getApp(id);
  if (!['start', 'stop', 'restart', 'kill'].includes(act)) throw bad('Action invalide');
  if (running.has(id)) throw bad('Une opération est en cours sur cette application');
  const t = getTemplate(a.template);
  const dp = await dockerPrefix(a.server);
  const grace = t.stopGrace ? ` -t ${t.stopGrace}` : '';
  const cmd = act === 'kill' ? `kill app-${a.id}` : `${act}${act === 'start' ? '' : grace} app-${a.id}`;
  return journal.action(a.server, `app.${act}`, a.name, async () => {
    const r = await conn(a.server).exec(`${dp}docker ${cmd} 2>&1`, { timeout: 180000 });
    if (r.code !== 0) throw new HttpError(502, r.stdout.trim() || `docker ${act} a échoué`);
    return { ok: true };
  });
}

export async function command(id, text) {
  const a = getApp(id);
  const t = getTemplate(a.template);
  const c = String(text || '').trim();
  if (!c || c.length > 500 || /[\n\r\0]/.test(c)) throw bad('Commande invalide');
  const kind = t.custom ? (a.stdin ? 'stdin' : null) : t.console?.kind;
  if (!kind) throw bad('Cette application n’a pas de console');
  const dp = await dockerPrefix(a.server);
  journal.log({ server: a.server, kind: 'app.command', target: `${a.name} : ${c.slice(0, 80)}`, ok: true });
  if (kind === 'exec') {
    const r = await conn(a.server).exec(`${dp}docker exec app-${a.id} ${t.console.cmd.map(q).join(' ')} ${q(c)} 2>&1`, { timeout: 30000 });
    if (r.code !== 0 && !r.stdout.trim()) throw new HttpError(502, `La commande a échoué (code ${r.code})`);
    return { output: t.console.outputInLogs ? '' : r.stdout.replace(/\x1b\[[0-9;]*m/g, '').trimEnd(), inLogs: !!t.console.outputInLogs };
  }
  // stdin : on s'attache sans TTY, on écrit la ligne puis on se détache (fermeture de l'entrée).
  await conn(a.server).exec(`printf '%s\\n' ${q(c)} | timeout 4 ${dp}docker attach --sig-proxy=false --no-stdout app-${a.id} >/dev/null 2>&1; true`, { timeout: 15000 });
  return { output: '', inLogs: true };
}

async function scanCredentials(id) {
  const a = getApp(id);
  const t = getTemplate(a.template);
  if (!t.secretsFromLogs) return {};
  const dp = await dockerPrefix(a.server);
  const r = await conn(a.server).exec(`${dp}docker logs app-${a.id} 2>&1 | head -c 2000000`);
  const found = { ...(a.credentials || {}) };
  for (const s of t.secretsFromLogs) {
    const m = new RegExp(s.regex).exec(r.stdout);
    if (m && !found[s.label]) found[s.label] = m[1];
  }
  patchApp(id, { credentials: found });
  return found;
}

export async function credentials(id) {
  const a = getApp(id);
  journal.log({ server: a.server, kind: 'app.credentials', target: a.name, ok: true });
  return scanCredentials(id);
}

export async function secretEnv(id, key) {
  const a = getApp(id);
  if (!(key in (a.env || {}))) throw bad('Variable inconnue');
  journal.log({ server: a.server, kind: 'app.reveal', target: `${a.name} ${key}`, ok: true });
  return { value: a.env[key] };
}

// ───────── Sauvegardes ─────────
const BACKUP_NAME = /^[0-9]{8}-[0-9]{6}(-[a-z]+)?\.tar\.gz$/;

export async function backups(id) {
  const a = getApp(id);
  const pre = await privPrefix(a.server);
  const r = await conn(a.server).exec(`${pre}sh -c ${q(`cd ${q(`${BACKUPS}/${a.id}`)} 2>/dev/null && for f in *.tar.gz; do [ -f "$f" ] && stat -c '%n\t%s\t%Y' "$f"; done`)}`);
  return r.stdout
    .split('\n')
    .map((l) => l.split('\t'))
    .filter(([n]) => n && BACKUP_NAME.test(n))
    .map(([name, size, mtime]) => ({ name, size: Number(size), at: Number(mtime) * 1000, path: `${BACKUPS}/${a.id}/${name}` }))
    .sort((x, y) => y.at - x.at);
}

async function isRunning(a) {
  const dp = await dockerPrefix(a.server);
  const r = await conn(a.server).exec(`${dp}docker inspect -f '{{.State.Running}}' app-${a.id} 2>/dev/null`);
  return r.stdout.trim() === 'true';
}

async function doBackup(a, log, suffix = '') {
  if (!a.volumes?.length) throw new Error('Cette application n’a pas de volume à sauvegarder');
  const dp = await dockerPrefix(a.server);
  const pre = await privPrefix(a.server);
  const file = `${BACKUPS}/${a.id}/${stamp()}${suffix}.tar.gz`;
  const mounts = a.volumes.map((v) => `-v ${q(`${v.name}:/backup/${v.key}:ro`)}`).join(' ');
  log(`Archive : ${file}\n`);
  const code = await stream(
    a.server,
    `set -e
mkdir -p ${q(`${BACKUPS}/${a.id}`)}
chmod 700 ${q(BACKUPS)} ${q(`${BACKUPS}/${a.id}`)} 2>/dev/null || true
${dp}docker run --rm ${mounts} alpine:3 tar -czf - -C /backup . > ${q(file + '.part')}
mv ${q(file + '.part')} ${q(file)}
echo "$(du -h ${q(file)} | cut -f1) sauvegardés"`,
    { onData: log, timeout: 3600000 },
  );
  if (code !== 0) {
    await conn(a.server).exec(`${pre}rm -f ${q(file + '.part')}`);
    throw new Error('La sauvegarde a échoué');
  }
  return file;
}

/** Arrête le serveur le temps de l'opération (cohérence des fichiers), puis le relance s'il tournait. */
async function withStopped(a, log, step, fn) {
  const wasRunning = await isRunning(a);
  const t = getTemplate(a.template);
  const dp = await dockerPrefix(a.server);
  if (wasRunning) {
    step('Arrêt du serveur');
    await conn(a.server).exec(`${dp}docker stop${t.stopGrace ? ` -t ${t.stopGrace}` : ''} app-${a.id} 2>&1`, { timeout: 200000 });
  }
  try {
    await fn();
  } finally {
    if (wasRunning) {
      step('Redémarrage');
      await conn(a.server).exec(`${dp}docker start app-${a.id} 2>&1`);
    }
  }
}

export function backup(id) {
  const a = getApp(id);
  return { job: startJob(id, 'backup', (log, step) => withStopped(a, log, step, async () => (step('Sauvegarde des volumes'), doBackup(a, log)))) };
}

export function restore(id, name) {
  const a = getApp(id);
  if (!BACKUP_NAME.test(name || '')) throw bad('Sauvegarde invalide');
  return {
    job: startJob(id, 'restore', (log, step) =>
      withStopped(a, log, step, async () => {
        const dp = await dockerPrefix(a.server);
        const src = `${BACKUPS}/${a.id}/${name}`;
        step('Sauvegarde de sécurité de l’état actuel');
        await doBackup(a, log, '-avant');
        step(`Restauration de ${name}`);
        const mounts = a.volumes.map((v) => `-v ${q(`${v.name}:/restore/${v.key}`)}`).join(' ');
        const keys = a.volumes.map((v) => q(`/restore/${v.key}`)).join(' ');
        const code = await stream(
          a.server,
          `set -e
[ -f ${q(src)} ]
${dp}docker run --rm -i ${mounts} alpine:3 sh -c ${q(`set -e; for d in ${keys}; do find "$d" -mindepth 1 -delete; done; tar -xzf - -C /restore`)} < ${q(src)}
echo "Volumes restaurés"`,
          { onData: log, timeout: 3600000 },
        );
        if (code !== 0) throw new Error('La restauration a échoué (la sauvegarde « -avant » contient l’état précédent)');
      }),
    ),
  };
}

export async function removeBackup(id, name) {
  const a = getApp(id);
  if (!BACKUP_NAME.test(name || '')) throw bad('Sauvegarde invalide');
  const pre = await privPrefix(a.server);
  return journal.action(a.server, 'app.backup.remove', `${a.name} ${name}`, async () => {
    const r = await conn(a.server).exec(`${pre}rm -f ${q(`${BACKUPS}/${a.id}/${name}`)}`);
    if (r.code !== 0) throw new HttpError(502, 'Suppression impossible');
    return { ok: true };
  });
}

// ───────── Suppression ─────────
export async function remove(id, { deleteData = false } = {}) {
  const a = getApp(id);
  if (running.has(id)) throw bad('Une opération est en cours sur cette application');
  return journal.action(a.server, 'app.remove', `${a.name}${deleteData ? ' (+ données)' : ''}`, async () => {
    const out = [];
    const dp = await dockerPrefix(a.server);
    const pre = await privPrefix(a.server);
    if (a.stackId && portainer.managesServer(a.server)) {
      try {
        await portainer.deleteStack(a.stackId);
        out.push('stack Portainer supprimée');
      } catch (e) {
        out.push(`Portainer : ${e.message}`);
      }
    }
    // compose down (sans -v : les volumes ne partent que sur demande explicite)
    await conn(a.server).exec(`cd ${q(appDir(a))} 2>/dev/null && ${dp}docker compose -p ${q('app-' + a.id)} down 2>&1; ${dp}docker rm -f app-${a.id} >/dev/null 2>&1 || true`, { timeout: 200000 });
    out.push('conteneur supprimé');
    if (a.firewall?.length) {
      for (const r of a.firewall) await conn(a.server).exec(`${pre}ufw delete allow ${q(r)} 2>&1`);
      out.push(`ufw : ${a.firewall.join(', ')} refermés`);
    }
    if (deleteData) {
      for (const v of a.volumes || []) {
        const r = await conn(a.server).exec(`${dp}docker volume rm ${q(v.name)} 2>&1`);
        out.push(r.code === 0 ? `volume ${v.name} supprimé` : `volume ${v.name} : ${r.stdout.trim()}`);
      }
      const imgs = await conn(a.server).exec(`${dp}docker images --format '{{.Repository}}:{{.Tag}}' ${q(`orbitos-app-${a.id}`)}`);
      const tags = imgs.stdout.split('\n').filter((x) => x.startsWith(`orbitos-app-${a.id}:`));
      if (tags.length) await conn(a.server).exec(`${dp}docker rmi ${tags.map(q).join(' ')} 2>&1 || true`);
    } else if (a.volumes?.length) out.push(`volumes conservés : ${a.volumes.map((v) => v.name).join(', ')}`);
    const exists = await conn(a.server).exec(`[ -e ${q(appDir(a))} ]`);
    if (exists.code === 0) {
      const t = await trash(a.server, appDir(a));
      out.push(`fichiers → ${t.trashedTo}`);
    }
    saveAll(loadAll().filter((x) => x.id !== id));
    return { steps: out };
  });
}
