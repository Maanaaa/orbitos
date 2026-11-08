// Sites : hébergement de sites depuis GitHub (statique buildé ou Dockerfile), déploiement manuel,
// releases horodatées, rollback. Les sites Docker deviennent des stacks Portainer.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { conn, getServer, dockerPrefix, stream, DATA_DIR } from '../ssh.js';
import { q, bad, domain as vDomain, HttpError } from '../util.js';
import * as journal from '../journal.js';
import * as github from './github.js';
import * as portainer from './portainer.js';
import * as nginx from './nginx.js';
import { trash } from './files.js';

const SITES_FILE = path.join(DATA_DIR, 'sites.json');
const LOG_DIR = path.join(DATA_DIR, 'deploys');
const BASE = '/opt/orbitos-sites';
const KEEP_RELEASES = 5;
fs.mkdirSync(LOG_DIR, { recursive: true });

// ───────── Registre ─────────
function loadAll() {
  try {
    return JSON.parse(fs.readFileSync(SITES_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function saveAll(list) {
  fs.writeFileSync(SITES_FILE + '.tmp', JSON.stringify(list, null, 2));
  fs.renameSync(SITES_FILE + '.tmp', SITES_FILE);
}
function getSite(id) {
  const s = loadAll().find((x) => x.id === id);
  if (!s) throw new HttpError(404, 'Site introuvable');
  return s;
}
function patchSite(id, patch) {
  const all = loadAll();
  const i = all.findIndex((x) => x.id === id);
  if (i < 0) throw new HttpError(404, 'Site introuvable');
  all[i] = typeof patch === 'function' ? patch(all[i]) : { ...all[i], ...patch };
  saveAll(all);
  return all[i];
}

const publicSite = (s) => ({ ...s, env: Object.fromEntries(Object.keys(s.env || {}).map((k) => [k, '••••••'])), envKeys: Object.keys(s.env || {}), deploying: running.has(s.id) });

export function list() {
  return loadAll().map(publicSite);
}
export function get(id) {
  return publicSite(getSite(id));
}

// ───────── Validation ─────────
const REL_PATH = /^(?!.*\.\.)[A-Za-z0-9_.\/-]{0,200}$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,100}$/;

function normalize(body, existing) {
  const s = { ...(existing || {}) };
  if (!existing) {
    s.domain = vDomain(body.domain);
    s.id = s.domain.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    s.server = getServer(body.server).id;
    s.repo = github.validRepo(body.repo);
    s.createdAt = new Date().toISOString();
    s.releases = [];
    s.current = null;
  }
  if (body.branch !== undefined) s.branch = github.validRef(body.branch);
  if (body.rootDir !== undefined) {
    if (!REL_PATH.test(body.rootDir)) throw bad('Dossier racine invalide');
    s.rootDir = body.rootDir.replace(/^\/+|\/+$/g, '');
  }
  if (body.type !== undefined) {
    if (!['static', 'docker'].includes(body.type)) throw bad('Type invalide');
    if (existing && existing.type !== body.type) throw bad('Le type d’un site ne peut pas changer : crée un nouveau site');
    s.type = body.type;
  }
  if (body.packageManager !== undefined) {
    if (body.packageManager && !['npm', 'yarn', 'pnpm', 'bun'].includes(body.packageManager)) throw bad('Gestionnaire de paquets invalide');
    s.packageManager = body.packageManager || null;
  }
  if (body.build !== undefined) {
    if (body.build && (/[\n\r]/.test(body.build) || body.build.length > 300)) throw bad('Commande de build invalide');
    s.build = body.build || null;
  }
  if (body.outputDir !== undefined) {
    if (!REL_PATH.test(body.outputDir || '.')) throw bad('Dossier de sortie invalide');
    s.outputDir = (body.outputDir || '.').replace(/^\/+|\/+$/g, '') || '.';
  }
  if (body.port !== undefined && s.type === 'docker') {
    const p = Number(body.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw bad('Port du conteneur invalide');
    s.port = p;
  }
  if (body.env !== undefined) {
    const env = {};
    for (const [k, v] of Object.entries(body.env || {})) {
      if (!ENV_KEY.test(k)) throw bad(`Variable invalide : ${k}`);
      // « •••••• » = valeur inchangée
      env[k] = v === '••••••' && existing?.env?.[k] !== undefined ? existing.env[k] : String(v);
    }
    s.env = env;
  }
  for (const k of ['ssl', 'noindex', 'authentik']) if (body[k] !== undefined) s[k] = !!body[k];
  s.ssl ??= true;
  s.env ??= {};
  s.outputDir ??= '.';
  s.rootDir ??= '';
  return s;
}

export async function create(body) {
  const s = normalize(body);
  if (loadAll().some((x) => x.id === s.id || x.domain === s.domain)) throw bad('Un site existe déjà pour ce domaine');
  const scan = await nginx.scan(s.server);
  if (scan.vhosts.some((v) => v.enabled && v.serverNames.includes(s.domain))) throw bad(`${s.domain} est déjà servi par un vhost nginx`);
  if (s.authentik && !scan.authentikOutpost) throw bad('Aucun outpost Authentik détecté sur ce serveur');
  if (s.type === 'docker') {
    const p = await dockerPrefix(s.server);
    const r = await conn(s.server).exec(`${p}docker version --format '{{.Server.Version}}'`);
    if (r.code !== 0) throw bad('Docker n’est pas disponible sur ce serveur');
  }
  saveAll([...loadAll(), s]);
  journal.log({ server: s.server, kind: 'site.create', target: `${s.domain} ← ${s.repo}@${s.branch}`, ok: true });
  return publicSite(s);
}

export function update(id, body) {
  const s = getSite(id);
  const next = normalize(body, s);
  patchSite(id, next);
  journal.log({ server: s.server, kind: 'site.update', target: s.domain, ok: true });
  return publicSite(next);
}

// ───────── Déploiement ─────────

const running = new Map(); // siteId -> { rel, log: string[] }

function logPath(siteId, rel) {
  return path.join(LOG_DIR, `${siteId}--${rel}.log`);
}

export function deployLog(id, rel, offset = 0) {
  if (!/^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}$/.test(rel)) throw bad('Release invalide');
  const s = getSite(id);
  const live = running.get(id);
  let text = '';
  if (live && live.rel === rel) text = live.log.join('');
  else {
    try {
      text = fs.readFileSync(logPath(id, rel), 'utf8');
    } catch {
      text = '';
    }
  }
  const r = s.releases.find((x) => x.id === rel);
  return { text: text.slice(offset), size: text.length, done: !(live && live.rel === rel), status: r?.status || 'unknown' };
}

const INSTALL = {
  npm: 'npm ci --no-audit --no-fund || npm install --no-audit --no-fund',
  yarn: 'corepack enable 2>/dev/null; yarn install --frozen-lockfile || yarn install',
  pnpm: 'corepack enable && pnpm install --frozen-lockfile || pnpm install',
  bun: 'bun install',
};

export async function deploy(id) {
  const s = getSite(id);
  if (running.has(id)) throw bad('Un déploiement est déjà en cours pour ce site');
  const c = await github.commit(s.repo, s.branch);
  const now = new Date();
  const rel = `${now.toISOString().slice(0, 10).replace(/-/g, '')}-${now.toISOString().slice(11, 19).replace(/:/g, '')}-${c.sha.slice(0, 7)}`;
  const state = { rel, log: [] };
  running.set(id, state);
  patchSite(id, (x) => ({ ...x, releases: [{ id: rel, sha: c.sha, message: c.message, author: c.author, at: now.toISOString(), status: 'running' }, ...x.releases] }));

  // Exécution en arrière-plan : le client suit le log.
  runDeploy(s, rel, c, state).finally(() => {
    try {
      fs.writeFileSync(logPath(id, rel), state.log.join(''));
    } catch {
      /* ignore */
    }
    running.delete(id);
  });
  return { rel };
}

async function runDeploy(s, rel, commit, state) {
  const t0 = Date.now();
  const log = (line) => state.log.push(line);
  const step = (label) => log(`\n▸ ${label}\n`);
  const dir = `${BASE}/${s.id}`;
  const relDir = `${dir}/releases/${rel}`;
  const src = `${relDir}/src${s.rootDir ? '/' + s.rootDir : ''}`;
  const finish = (status, extra = {}) => {
    patchSite(s.id, (x) => ({
      ...x,
      ...(status === 'success' ? { current: rel, ...extra } : extra),
      releases: x.releases.map((r) =>
        r.id === rel ? { ...r, status, duration: Math.round((Date.now() - t0) / 1000), ...(s.type === 'docker' ? { port: x.port } : {}) } : r,
      ),
    }));
    journal.log({ server: s.server, kind: 'site.deploy', target: `${s.domain} ${rel}`, ok: status === 'success', error: status === 'success' ? undefined : status });
  };

  try {
    log(`Déploiement de ${s.repo}@${s.branch} → ${s.domain}\nCommit ${commit.sha.slice(0, 7)} « ${commit.message} » (${commit.author || '?'})\n`);

    step('Récupération du code depuis GitHub');
    const body = await github.tarball(s.repo, commit.sha);
    const code = await stream(s.server, `set -e; mkdir -p ${q(relDir + '/src')}; tar -xzf - --strip-components=1 -C ${q(relDir + '/src')}; [ -d ${q(src)} ] || { echo "Dossier racine introuvable : ${s.rootDir}" >&2; exit 1; }; echo "$(find ${q(relDir + '/src')} -type f | wc -l) fichiers"`, {
      stdin: Readable.fromWeb(body),
      onData: log,
      timeout: 600000,
    });
    if (code !== 0) throw new Error('Extraction de l’archive échouée');

    const dp = await dockerPrefix(s.server);
    let extra = {};
    if (s.type === 'static') extra = await deployStatic(s, rel, relDir, src, dp, log, step);
    else extra = await deployDocker(s, rel, relDir, src, dp, log, step);

    // Premier déploiement : vhost + SSL
    if (!s.vhost) {
      step('Création du vhost nginx');
      const fresh = getSite(s.id);
      const res = await nginx.create(s.server, {
        domain: s.domain,
        type: s.type === 'static' ? 'static' : 'proxy',
        root: `${dir}/current`,
        host: '127.0.0.1',
        port: fresh.hostPort || extra.hostPort,
        ssl: s.ssl,
        noindex: s.noindex,
        authentik: s.authentik,
        spa: true,
        maxBody: 50,
      });
      for (const st of res.steps) log(`${st.ok ? '✓' : '✖'} ${st.label}${st.detail ? `\n${st.detail}` : ''}\n`);
      if (!res.ok) throw new Error('La création du vhost a échoué');
      extra.vhost = s.domain;
    }

    step('Nettoyage des anciennes releases');
    await prune(s, rel, dp, log);

    log(`\n✓ En ligne : ${s.ssl ? 'https' : 'http'}://${s.domain}  (${Math.round((Date.now() - t0) / 1000)} s)\n`);
    finish('success', extra);
  } catch (e) {
    log(`\n✖ Échec : ${e.message}\n`);
    finish('failed');
  }
}

async function deployStatic(s, rel, relDir, src, dp, log, step) {
  const www = `${relDir}/www`;
  const out = s.outputDir === '.' ? '.' : s.outputDir;
  if (s.build) {
    step(`Build : ${s.build} (conteneur jetable, gestionnaire ${s.packageManager || 'npm'})`);
    const image = s.packageManager === 'bun' ? 'oven/bun:1-alpine' : 'node:22-alpine';
    const inner = [
      'set -e',
      'mkdir -p /app && cd /app && tar -xf -',
      `{ ${INSTALL[s.packageManager || 'npm']} ; } 1>&2`,
      `{ ${s.build} ; } 1>&2`,
      `test -d ${q(out)} || { echo "Dossier de sortie « ${out} » introuvable après le build" >&2; exit 3; }`,
      `tar -C ${q(out)} -cf - .`,
    ].join('\n');
    const envFile = `${relDir}/.build.env`;
    const envLines = Object.entries(s.env || {})
      .map(([k, v]) => `${k}=${String(v).replace(/\n/g, ' ')}`)
      .join('\n');
    const script = `set -e
mkdir -p ${q(www)}
( umask 077; cat > ${q(envFile)} <<'ORBIT_EOF'
${envLines}
ORBIT_EOF
)
trap 'rm -f ${envFile.replace(/'/g, '')}' EXIT
tar -C ${q(src)} -cf - . | ${dp}docker run --rm -i --memory 1536m --cpus 2 --env-file ${q(envFile)} -e CI=1 ${q(image)} sh -c ${q(inner)} > ${q(relDir + '/out.tar')}
tar -xf ${q(relDir + '/out.tar')} -C ${q(www)}
rm -f ${q(relDir + '/out.tar')}`;
    if (Object.keys(s.env || {}).length) log(`Variables de build : ${Object.keys(s.env).join(', ')}\n`);
    const code = await stream(s.server, script, { onData: log, timeout: 1800000 });
    if (code !== 0) throw new Error(`Le build a échoué (code ${code})`);
  } else {
    step(`Copie des fichiers (${out === '.' ? 'racine du dépôt' : out})`);
    const code = await stream(s.server, `set -e; mkdir -p ${q(www)}; cp -a ${q(src + '/' + out)}/. ${q(www)}/; rm -rf ${q(www + '/.github')}`, { onData: log });
    if (code !== 0) throw new Error('Copie des fichiers échouée');
  }
  step('Publication');
  const pub = await stream(
    s.server,
    `set -e
[ -f ${q(www + '/index.html')} ] || echo "⚠ Pas d’index.html à la racine du site"
chmod -R a+rX ${q(www)}
chmod a+rx ${q(BASE)} ${q(`${BASE}/${s.id}`)} ${q(`${BASE}/${s.id}/releases`)} ${q(relDir)}
ln -sfn ${q(`releases/${rel}/www`)} ${q(`${BASE}/${s.id}/current`)}
echo "$(du -sh ${q(www)} | cut -f1) publiés"`,
    { onData: log },
  );
  if (pub !== 0) throw new Error('Publication échouée');
  return {};
}

function composeFor(s, image, hostPort) {
  const envLines = Object.keys(s.env || {})
    .map((k) => `      ${k}: \${${k}}`)
    .join('\n');
  return `# Site ${s.domain} — géré par OrbitOS (${s.repo}@${s.branch})
services:
  app:
    image: ${image}
    container_name: site-${s.id}
    restart: unless-stopped
    ports:
      - "127.0.0.1:${hostPort}:${s.port}"
${envLines ? `    environment:\n${envLines}\n` : ''}    mem_limit: 512m
`;
}

async function startContainer(s, image, hostPort, dp, log) {
  const compose = composeFor(s, image, hostPort);
  if (portainer.managesServer(s.server)) {
    log('Mise à jour de la stack Portainer…\n');
    const id = await portainer.upsertStack({ id: s.stackId, name: `site-${s.id}`, compose, env: s.env });
    return { stackId: id };
  }
  log('Portainer non configuré pour ce serveur : docker compose local.\n');
  const dir = `${BASE}/${s.id}`;
  const envFile = Object.entries(s.env || {})
    .map(([k, v]) => `${k}=${String(v).replace(/\n/g, '\\n')}`)
    .join('\n');
  const code = await stream(
    s.server,
    `set -e
umask 077
cat > ${q(dir + '/compose.yml')} <<'ORBIT_EOF'
${compose}ORBIT_EOF
cat > ${q(dir + '/.env')} <<'ORBIT_EOF'
${envFile}
ORBIT_EOF
cd ${q(dir)} && ${dp}docker compose -p ${q('site-' + s.id)} up -d --remove-orphans 2>&1`,
    { onData: log },
  );
  if (code !== 0) throw new Error('docker compose up a échoué');
  return {};
}

async function waitHealthy(s, hostPort, log) {
  for (let i = 0; i < 30; i++) {
    const r = await conn(s.server).exec(`curl -s -o /dev/null -m 3 -w '%{http_code}' http://127.0.0.1:${hostPort}/ || true`);
    const codeHttp = r.stdout.trim();
    if (codeHttp && codeHttp !== '000') {
      log(`Le conteneur répond (HTTP ${codeHttp})\n`);
      return true;
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  return false;
}

async function allocatePort(s) {
  const used = new Set(loadAll().map((x) => x.hostPort).filter(Boolean));
  const r = await conn(s.server).exec(`(ss -tlnH 2>/dev/null || netstat -tln 2>/dev/null) | awk '{print $4}'`);
  for (const a of r.stdout.split('\n')) {
    const p = Number(a.slice(a.lastIndexOf(':') + 1));
    if (p) used.add(p);
  }
  for (let p = 10100; p < 11000; p++) if (!used.has(p)) return p;
  throw new Error('Aucun port libre entre 10100 et 10999');
}

async function deployDocker(s, rel, relDir, src, dp, log, step) {
  const image = `orbitos-site-${s.id}:${rel}`;
  step(`docker build → ${image}`);
  const code = await stream(s.server, `cd ${q(src)} && DOCKER_BUILDKIT=1 ${dp}docker build --progress=plain -t ${q(image)} . 2>&1`, { onData: log, timeout: 1800000 });
  if (code !== 0) throw new Error(`docker build a échoué (code ${code})`);

  const fresh = getSite(s.id);
  const hostPort = fresh.hostPort || (await allocatePort(s));
  if (!fresh.hostPort) patchSite(s.id, { hostPort });

  step(`Démarrage (127.0.0.1:${hostPort} → ${s.port})`);
  const meta = await startContainer({ ...fresh, hostPort }, image, hostPort, dp, log);
  if (meta.stackId) patchSite(s.id, { stackId: meta.stackId });

  step('Vérification de santé');
  if (!(await waitHealthy(s, hostPort, log))) {
    const prev = fresh.releases.find((r) => r.id === fresh.current);
    log(`✖ Aucune réponse HTTP sur 127.0.0.1:${hostPort} après 60 s\n`);
    const logs = await conn(s.server).exec(`${dp}docker logs --tail 40 site-${s.id} 2>&1`);
    log(`--- docker logs ---\n${logs.stdout}\n`);
    if (prev) {
      log(`↩ Retour automatique à la release ${prev.id}\n`);
      await startContainer({ ...getSite(s.id), port: prev.port ?? fresh.port }, `orbitos-site-${s.id}:${prev.id}`, hostPort, dp, log);
      log(`Release ${prev.id} rétablie (port ${prev.port ?? fresh.port}). Corrige la config puis redéploie.\n`);
    }
    throw new Error('Le conteneur ne répond pas');
  }
  return { hostPort, image };
}

async function prune(s, rel, dp, log) {
  const site = getSite(s.id);
  const keep = new Set([rel, site.current, ...site.releases.filter((r) => r.status === 'success').slice(0, KEEP_RELEASES).map((r) => r.id)].filter(Boolean));
  const r = await conn(s.server).exec(`ls -1 ${q(`${BASE}/${s.id}/releases`)} 2>/dev/null`);
  const old = r.stdout.split('\n').filter((x) => /^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}$/.test(x) && !keep.has(x));
  if (s.type === 'docker') {
    // Pour Docker, les sources ne servent plus après le build
    const srcOld = r.stdout.split('\n').filter((x) => /^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}$/.test(x) && x !== rel);
    if (srcOld.length) await stream(s.server, srcOld.map((x) => `rm -rf ${q(`${BASE}/${s.id}/releases/${x}/src`)}`).join('; '), { onData: () => {} });
    const imgs = await conn(s.server).exec(`${dp}docker images --format '{{.Tag}}' ${q(`orbitos-site-${s.id}`)}`);
    const oldTags = imgs.stdout.split('\n').filter((t) => /^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}$/.test(t) && !keep.has(t));
    if (oldTags.length) await conn(s.server).exec(`${dp}docker rmi ${oldTags.map((t) => q(`orbitos-site-${s.id}:${t}`)).join(' ')} 2>&1 || true`);
    if (oldTags.length) log(`${oldTags.length} ancienne(s) image(s) supprimée(s)\n`);
  }
  if (old.length) {
    await stream(s.server, old.map((x) => `rm -rf ${q(`${BASE}/${s.id}/releases/${x}`)}`).join('; '), { onData: () => {} });
    log(`${old.length} ancienne(s) release(s) supprimée(s)\n`);
  } else log('Rien à nettoyer\n');
  // Les releases supprimées disparaissent de l'historique « restaurable »
  patchSite(s.id, (x) => ({ ...x, releases: x.releases.map((r) => (old.includes(r.id) ? { ...r, pruned: true } : r)).slice(0, 30) }));
}

export async function rollback(id, rel) {
  const s = getSite(id);
  const r = s.releases.find((x) => x.id === rel);
  if (!r || r.status !== 'success' || r.pruned) throw bad('Cette release n’est plus disponible');
  if (running.has(id)) throw bad('Un déploiement est en cours');
  return journal.action(s.server, 'site.rollback', `${s.domain} → ${rel}`, async () => {
    const dp = await dockerPrefix(s.server);
    if (s.type === 'static') {
      const code = await stream(s.server, `set -e; [ -d ${q(`${BASE}/${s.id}/releases/${rel}/www`)} ]; ln -sfn ${q(`releases/${rel}/www`)} ${q(`${BASE}/${s.id}/current`)}`);
      if (code !== 0) throw new HttpError(502, 'Release introuvable sur le serveur');
    } else {
      const log = [];
      await startContainer({ ...s, port: r.port ?? s.port }, `orbitos-site-${s.id}:${rel}`, s.hostPort, dp, (l) => log.push(l));
      if (!(await waitHealthy(s, s.hostPort, () => {}))) throw new HttpError(502, 'Le conteneur restauré ne répond pas');
    }
    patchSite(id, { current: rel });
    return { current: rel };
  });
}

export async function remove(id) {
  const s = getSite(id);
  if (running.has(id)) throw bad('Un déploiement est en cours');
  return journal.action(s.server, 'site.remove', s.domain, async () => {
    const out = [];
    if (s.vhost) {
      try {
        await nginx.remove(s.server, s.domain);
        out.push('vhost supprimé (corbeille)');
      } catch (e) {
        out.push(`vhost : ${e.message}`);
      }
    }
    const dp = await dockerPrefix(s.server);
    if (s.type === 'docker') {
      if (s.stackId && portainer.managesServer(s.server)) {
        try {
          await portainer.deleteStack(s.stackId);
          out.push('stack Portainer supprimée');
        } catch (e) {
          out.push(`Portainer : ${e.message}`);
        }
      } else {
        await conn(s.server).exec(`cd ${q(`${BASE}/${s.id}`)} 2>/dev/null && ${dp}docker compose -p ${q('site-' + s.id)} down 2>&1 || true`);
      }
      const tags = await conn(s.server).exec(`${dp}docker images --format '{{.Repository}}:{{.Tag}}' ${q(`orbitos-site-${s.id}`)}`);
      const list = tags.stdout.split('\n').filter((t) => t.startsWith(`orbitos-site-${s.id}:`));
      if (list.length) {
        await conn(s.server).exec(`${dp}docker rmi ${list.map(q).join(' ')} 2>&1 || true`);
        out.push(`${list.length} image(s) supprimée(s)`);
      }
    }
    const exists = await conn(s.server).exec(`[ -e ${q(`${BASE}/${s.id}`)} ]`);
    if (exists.code === 0) {
      const t = await trash(s.server, `${BASE}/${s.id}`);
      out.push(`fichiers → ${t.trashedTo}`);
    }
    saveAll(loadAll().filter((x) => x.id !== id));
    return { steps: out };
  });
}
