// Sauvegarde : pilote Backrest (et donc restic) sur chaque serveur via son API Connect-JSON.
//
// Backrest écoute en local sur le serveur (ex. 127.0.0.1:9898) : OrbitOS l'appelle par SSH avec
// curl, le corps et l'éventuel jeton passant par stdin (jamais en argument visible dans `ps`).
// La configuration (dépôts, mots de passe restic, clés B2) ne quitte jamais le backend.
//
// Chemins : l'utilisateur raisonne en chemins de l'hôte ; ils sont traduits en chemins du
// conteneur Backrest d'après ses montages (ex. /var/lib/docker/volumes → /data/docker-volumes).
import path from 'node:path';
import { conn, dockerPrefix, stream } from '../ssh.js';
import * as settings from '../settings.js';
import crypto from 'node:crypto';
import { q, bad, HttpError, stamp } from '../util.js';
import * as journal from '../journal.js';
import * as secrets from '../secrets.js';

const PLAN_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,48}$/;
const SNAP_ID = /^[0-9a-f]{8,64}$/;
const CRON = /^[0-9*\/,-]+( [0-9*\/,-]+){4}$/;

// ───────── Découverte ─────────
const cache = new Map();

/** Trouve le conteneur Backrest du serveur, son port local et ses montages. */
export async function discover(sid, { force = false } = {}) {
  const c = cache.get(sid);
  if (c && !force && Date.now() - c.at < 60000) return c.info;
  const dp = await dockerPrefix(sid);
  const ps = await conn(sid).exec(`${dp}docker ps --format '{{.Names}}\t{{.Image}}' 2>/dev/null`);
  const line = ps.stdout.split('\n').find((l) => /(^|\/)garethgeorge\/backrest(:|$|@)/.test(l.split('\t')[1] || ''));
  let info = { found: false };
  if (line) {
    const name = line.split('\t')[0];
    const r = await conn(sid).exec(`${dp}docker inspect ${q(name)} --format '{{json .HostConfig.PortBindings}}|{{json .Mounts}}|{{.Config.Image}}'`);
    const [pb, mounts, image] = r.stdout.trim().split('|');
    const bind = JSON.parse(pb || '{}')['9898/tcp']?.[0];
    info = {
      found: true,
      container: name,
      image,
      port: bind ? Number(bind.HostPort) : null,
      host: bind?.HostIp && bind.HostIp !== '0.0.0.0' ? bind.HostIp : '127.0.0.1',
      mounts: JSON.parse(mounts || '[]')
        .map((m) => ({ source: m.Source, dest: m.Destination, rw: !!m.RW, type: m.Type, name: m.Name || null }))
        .sort((a, b) => b.source.length - a.source.length),
    };
  }
  cache.set(sid, { at: Date.now(), info });
  return info;
}

async function need(sid) {
  const info = await discover(sid);
  if (!info.found) throw new HttpError(404, 'Backrest n’est pas installé sur ce serveur (conteneur garethgeorge/backrest introuvable)');
  if (!info.port) throw new HttpError(400, `Le port 9898 de ${info.container} n’est pas publié sur l’hôte : OrbitOS ne peut pas joindre son API`);
  return info;
}

/** Chemin hôte → chemin vu par Backrest (montage le plus spécifique). */
export function toContainer(info, hostPath) {
  const p = path.posix.normalize(hostPath).replace(/\/$/, '') || '/';
  for (const m of info.mounts) {
    if (m.dest === '/config') continue;
    if (p === m.source || p.startsWith(m.source + '/')) return m.dest + p.slice(m.source.length);
  }
  return null;
}
/** Chemin Backrest → chemin hôte (pour l'affichage). */
export function toHost(info, cPath) {
  const sorted = [...info.mounts].sort((a, b) => b.dest.length - a.dest.length);
  for (const m of sorted) if (cPath === m.dest || cPath.startsWith(m.dest + '/')) return m.source + cPath.slice(m.dest.length);
  return null;
}

// ───────── Appels API ─────────
const curlStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

async function token(sid, info) {
  const cred = secrets.get('backrest')?.[sid];
  if (!cred?.username) return null;
  const cached = tokens.get(sid);
  if (cached && Date.now() - cached.at < 3600000) return cached.token;
  const r = await raw(sid, info, 'v1.Authentication/Login', { username: cred.username, password: cred.password }, null);
  tokens.set(sid, { token: r.token, at: Date.now() });
  return r.token;
}
const tokens = new Map();

async function raw(sid, info, method, body, bearer, { timeout = 60000, background = false } = {}) {
  const cfg = [`header = "Content-Type: application/json"`, bearer ? `header = ${curlStr(`Authorization: Bearer ${bearer}`)}` : null, `data-binary = ${curlStr(JSON.stringify(body ?? {}))}`].filter(Boolean).join('\n');
  const url = `http://${info.host}:${info.port}/${method}`;
  if (background) {
    // Backup attend la fin de la sauvegarde : on laisse curl tourner sur le serveur.
    await conn(sid).exec(`cfg=$(cat); command -v curl >/dev/null || { echo 'curl absent' >&2; exit 127; }; (printf '%s' "$cfg" | nohup curl -s -m 86400 -K - -X POST ${q(url)} >/dev/null 2>&1 &) ; true`, { input: cfg, timeout: 15000 });
    return {};
  }
  const r = await conn(sid).exec(`command -v curl >/dev/null || { echo 'curl absent sur le serveur' >&2; exit 127; }; curl -s -m ${Math.ceil(timeout / 1000)} -K - -X POST -w '\\n%{http_code}' ${q(url)}`, { input: cfg, timeout: timeout + 5000 });
  if (r.code === 127) throw new HttpError(502, 'curl est requis sur le serveur pour joindre Backrest');
  if (r.code !== 0) throw new HttpError(502, `Backrest injoignable (curl ${r.code})`);
  const i = r.stdout.lastIndexOf('\n');
  const status = Number(r.stdout.slice(i + 1));
  const text = r.stdout.slice(0, i);
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text.slice(0, 200) };
  }
  if (status === 401 || status === 403 || data?.code === 'unauthenticated') {
    tokens.delete(sid);
    throw new HttpError(401, 'Backrest demande une authentification : renseigne ses identifiants dans l’app Sauvegarde');
  }
  if (status >= 400) throw new HttpError(502, `Backrest : ${data?.message || data?.code || status}`);
  return data;
}

async function rpc(sid, method, body, opts) {
  const info = await need(sid);
  const bearer = await token(sid, info);
  return raw(sid, info, `v1.Backrest/${method}`, body, bearer, opts);
}

// ───────── Lecture ─────────
const maskUri = (u) => String(u || '').replace(/\/\/[^@/]*@/, '//•••@');

function publicPlan(info, p) {
  return {
    id: p.id,
    repo: p.repo,
    paths: (p.paths || []).map((c) => ({ path: c, host: toHost(info, c) })),
    excludes: p.excludes || [],
    schedule: p.schedule || {},
    retention: p.retention || {},
    hooks: (p.hooks || []).length,
    skipIfUnchanged: !!p.skipIfUnchanged,
  };
}

const num = (v) => (v == null ? null : Number(v));
function publicOp(o) {
  const kind = Object.keys(o).find((k) => k.startsWith('operation')) || null;
  const body = kind ? o[kind] : {};
  const summary = body?.lastStatus?.summary || body?.summary || null;
  return {
    id: String(o.id),
    planId: o.planId || null,
    repoId: o.repoId || null,
    snapshotId: o.snapshotId || null,
    status: (o.status || 'STATUS_UNKNOWN').replace('STATUS_', '').toLowerCase(),
    kind: kind ? kind.replace('operation', '').replace(/^./, (c) => c.toLowerCase()) : null,
    start: num(o.unixTimeStartMs),
    end: num(o.unixTimeEndMs),
    message: o.displayMessage || '',
    bytesAdded: num(summary?.dataAdded),
    bytesProcessed: num(summary?.totalBytesProcessed),
    filesProcessed: num(summary?.totalFilesProcessed),
    percent: body?.lastStatus?.status?.percentDone ?? null,
  };
}

export async function status(sid) {
  const info = await discover(sid, { force: true });
  if (!info.found) return { found: false };
  if (!info.port) return { found: true, container: info.container, error: 'Port 9898 non publié sur l’hôte' };
  const hasCred = !!secrets.get('backrest')?.[sid]?.username;
  let cfg;
  try {
    cfg = await rpc(sid, 'GetConfig', {});
  } catch (e) {
    return { found: true, container: info.container, image: info.image, port: info.port, error: e.message, needsAuth: e.status === 401, hasCred };
  }
  let ops = [];
  try {
    ops = ((await rpc(sid, 'GetOperations', { selector: {}, lastN: '500' }, { timeout: 60000 })).operations || []).map(publicOp);
  } catch {
    /* historique indisponible : la config suffit */
  }
  // « pending » = prochaine exécution planifiée ; « inprogress » = en cours.
  const last = {};
  const next = {};
  const running = {};
  const forget = {};
  const newer = (m, o) => !m[o.planId] || o.start > m[o.planId].start;
  for (const o of ops) {
    if (!o.planId) continue;
    if (o.kind === 'backup' && o.status === 'pending' && newer(next, o)) next[o.planId] = o;
    else if (o.kind === 'backup' && o.status !== 'inprogress' && newer(last, o)) last[o.planId] = o;
    if (o.status === 'inprogress') running[o.planId] = o;
    if (o.kind === 'forget' && o.status !== 'pending' && newer(forget, o)) forget[o.planId] = o;
  }
  const locked = Object.values(forget).filter((o) => o.status === 'error' && /locked/i.test(o.message));
  return {
    found: true,
    container: info.container,
    image: info.image,
    port: info.port,
    hasCred,
    instance: cfg.instance,
    authDisabled: !!cfg.auth?.disabled,
    mounts: info.mounts.filter((m) => m.dest !== '/config').map(({ source, dest, rw }) => ({ source, dest, rw })),
    repos: (cfg.repos || []).map((r) => ({ id: r.id, uri: maskUri(r.uri), guid: r.guid, kind: String(r.uri || '').split(':')[0] })),
    plans: (cfg.plans || []).map((p) => ({ ...publicPlan(info, p), last: last[p.id] || null, next: next[p.id] || null, running: running[p.id] || null, forget: forget[p.id] ? { status: forget[p.id].status, start: forget[p.id].start, message: forget[p.id].message.slice(0, 400) } : null })),
    lockedRepos: [...new Set(locked.map((o) => o.repoId).filter(Boolean))],
  };
}

export async function operations(sid, planId) {
  if (!PLAN_ID.test(planId || '')) throw bad('Plan invalide');
  const r = await rpc(sid, 'GetOperations', { selector: { planId }, lastN: '60' });
  return (r.operations || []).map(publicOp).sort((a, b) => (b.start || 0) - (a.start || 0));
}

export async function snapshots(sid, planId) {
  if (!PLAN_ID.test(planId || '')) throw bad('Plan invalide');
  const cfg = await rpc(sid, 'GetConfig', {});
  const plan = (cfg.plans || []).find((p) => p.id === planId);
  if (!plan) throw new HttpError(404, 'Plan introuvable');
  const r = await rpc(sid, 'ListSnapshots', { repoId: plan.repo, planId }, { timeout: 120000 });
  return (r.snapshots || [])
    .map((s) => ({
      id: s.id,
      time: num(s.unixTimeMs),
      hostname: s.hostname,
      paths: s.paths || [],
      tags: s.tags || [],
      bytesAdded: num(s.summary?.dataAdded),
      bytesProcessed: num(s.summary?.totalBytesProcessed),
      files: num(s.summary?.totalFilesProcessed),
      duration: s.summary?.totalDuration ?? null,
    }))
    .sort((a, b) => (b.time || 0) - (a.time || 0));
}

/** Sources proposées pour un nouveau plan : volumes Docker et dossiers courants. */
export async function sources(sid) {
  const info = await need(sid);
  const dp = await dockerPrefix(sid);
  const vols = await conn(sid).exec(`${dp}docker volume ls --format '{{.Name}}' 2>/dev/null`);
  const cfg = await rpc(sid, 'GetConfig', {});
  const covered = new Set((cfg.plans || []).flatMap((p) => p.paths || []));
  const volumes = vols.stdout
    .split('\n')
    .filter(Boolean)
    .filter((v) => !/^[0-9a-f]{64}$/.test(v)) // volumes anonymes
    .map((v) => {
      const host = `/var/lib/docker/volumes/${v}`;
      const c = toContainer(info, host);
      return { name: v, host, container: c, covered: !!c && [...covered].some((x) => x === c || x.startsWith(c + '/') || c.startsWith(x + '/')) };
    });
  return { volumes, mounts: info.mounts.filter((m) => m.dest !== '/config').map(({ source, dest, rw }) => ({ source, dest, rw })) };
}

// ───────── Écriture ─────────

/** Copie de sécurité de config.json dans le volume de Backrest (.bak avant toute modification). */
async function backupConfig(sid, info) {
  const dp = await dockerPrefix(sid);
  const bak = `/config/config.json.bak_orbitos_${stamp()}`;
  const r = await conn(sid).exec(
    `${dp}docker exec ${q(info.container)} sh -c ${q(`cp /config/config.json ${bak} && ls -1t /config/config.json.bak_orbitos_* | tail -n +11 | xargs -r rm -f`)}`,
  );
  if (r.code !== 0) throw new HttpError(502, `Copie de sécurité de config.json impossible : ${(r.stderr || r.stdout).trim()}`);
  return bak;
}

async function mutate(sid, label, fn) {
  const info = await need(sid);
  const cfg = await rpc(sid, 'GetConfig', {});
  const next = structuredClone(cfg);
  const result = fn(next, info);
  const bak = await backupConfig(sid, info);
  await rpc(sid, 'SetConfig', next);
  journal.log({ server: sid, kind: 'backrest.config', target: `${label} (copie : ${bak})`, ok: true });
  return { ...(result || {}), backup: bak };
}

function buildPlan(info, body, repos, existing) {
  const id = existing?.id || String(body.id || '').trim();
  if (!PLAN_ID.test(id)) throw bad('Identifiant de plan invalide (lettres, chiffres, - et _)');
  const repo = body.repo ?? existing?.repo;
  if (!repos.some((r) => r.id === repo)) throw bad('Dépôt restic inconnu');
  const hostPaths = body.paths ?? (existing?.paths || []).map((c) => toHost(info, c) || c);
  if (!Array.isArray(hostPaths) || !hostPaths.length || hostPaths.length > 50) throw bad('Ajoute au moins un dossier à sauvegarder');
  const paths = hostPaths.map((h) => {
    if (typeof h !== 'string' || !h.startsWith('/') || /[\0\n\r]/.test(h) || h.includes('/../')) throw bad(`Chemin invalide : ${h}`);
    const c = toContainer(info, h);
    if (!c) throw bad(`${h} n’est pas visible par Backrest (aucun montage ne le couvre). Montages : ${info.mounts.filter((m) => m.dest !== '/config').map((m) => m.source).join(', ')}`);
    return c;
  });
  const excludes = (body.excludes ?? existing?.excludes ?? ['*node_modules*', '*.log']).map(String).filter(Boolean);
  if (excludes.some((e) => /[\n\r\0]/.test(e) || e.length > 300)) throw bad('Exclusion invalide');
  let schedule = existing?.schedule || { cron: '30 4 * * *', clock: 'CLOCK_LOCAL' };
  if (body.schedule !== undefined) {
    if (body.schedule.disabled) schedule = { disabled: true, clock: 'CLOCK_LOCAL' };
    else if (body.schedule.maxFrequencyDays) schedule = { maxFrequencyDays: Math.max(1, Number(body.schedule.maxFrequencyDays) | 0), clock: 'CLOCK_LAST_RUN_TIME' };
    else {
      const cron = String(body.schedule.cron || '').trim();
      if (!CRON.test(cron)) throw bad('Planification cron invalide (5 champs, ex. « 30 4 * * * »)');
      schedule = { cron, clock: 'CLOCK_LOCAL' };
    }
  }
  let retention = existing?.retention || { policyTimeBucketed: { daily: 7, weekly: 4, monthly: 6 } };
  if (body.retention !== undefined) {
    const r = body.retention;
    const n = (v, max) => Math.min(max, Math.max(0, Number(v) | 0));
    if (r.keepLastN) retention = { policyKeepLastN: n(r.keepLastN, 1000) || 1 };
    else retention = { policyTimeBucketed: { hourly: n(r.hourly, 1000), daily: n(r.daily, 1000), weekly: n(r.weekly, 1000), monthly: n(r.monthly, 1000), yearly: n(r.yearly, 100) } };
    for (const k of Object.keys(retention.policyTimeBucketed || {})) if (!retention.policyTimeBucketed[k]) delete retention.policyTimeBucketed[k];
    if (retention.policyTimeBucketed && !Object.keys(retention.policyTimeBucketed).length) throw bad('La rétention ne garde aucune sauvegarde');
  }
  return { ...(existing || {}), id, repo, paths, excludes, schedule, retention };
}

export async function createPlan(sid, body) {
  const r = await mutate(sid, `plan ${body.id} créé`, (cfg, info) => {
    cfg.plans ||= [];
    if (cfg.plans.some((p) => p.id === body.id)) throw bad(`Un plan « ${body.id} » existe déjà`);
    cfg.plans.push(buildPlan(info, body, cfg.repos || []));
    return { id: body.id };
  });
  if (body.runNow) await runPlan(sid, body.id);
  return r;
}

export async function updatePlan(sid, id, body) {
  return mutate(sid, `plan ${id} modifié`, (cfg, info) => {
    const i = (cfg.plans || []).findIndex((p) => p.id === id);
    if (i < 0) throw new HttpError(404, 'Plan introuvable');
    cfg.plans[i] = buildPlan(info, body, cfg.repos || [], cfg.plans[i]);
  });
}

export async function deletePlan(sid, id) {
  return mutate(sid, `plan ${id} supprimé`, (cfg) => {
    const before = (cfg.plans || []).length;
    cfg.plans = (cfg.plans || []).filter((p) => p.id !== id);
    if (cfg.plans.length === before) throw new HttpError(404, 'Plan introuvable');
  });
}

export async function runPlan(sid, id) {
  if (!PLAN_ID.test(id || '')) throw bad('Plan invalide');
  return journal.action(sid, 'backrest.backup', id, async () => {
    await rpc(sid, 'Backup', { value: id }, { background: true });
    return { started: true };
  });
}

export async function restore(sid, planId, body) {
  if (!PLAN_ID.test(planId || '')) throw bad('Plan invalide');
  if (!SNAP_ID.test(body.snapshotId || '')) throw bad('Instantané invalide');
  const info = await need(sid);
  const cfg = await rpc(sid, 'GetConfig', {});
  const plan = (cfg.plans || []).find((p) => p.id === planId);
  if (!plan) throw new HttpError(404, 'Plan introuvable');
  // Restauration toujours dans un dossier neuf d'un montage inscriptible (jamais par-dessus les données en place).
  const rw = info.mounts.find((m) => m.rw && m.dest === '/data/tmp') || info.mounts.find((m) => m.rw && !['/config', '/repos'].includes(m.dest));
  if (!rw) throw bad('Aucun montage inscriptible dans Backrest pour restaurer (ex. /tmp → /data/tmp)');
  const target = `${rw.dest}/orbitos-restore/${planId}-${body.snapshotId.slice(0, 8)}-${stamp()}`;
  const sub = body.path ? String(body.path) : '';
  if (sub && (!sub.startsWith('/') || sub.includes('..') || /[\0\n\r]/.test(sub))) throw bad('Chemin à restaurer invalide');
  return journal.action(sid, 'backrest.restore', `${planId} ${body.snapshotId.slice(0, 8)} → ${toHost(info, target)}`, async () => {
    const r = await rpc(sid, 'Restore', { planId, repoId: plan.repo, snapshotId: body.snapshotId, path: sub, target });
    return { operationId: r.operationId ?? null, target: toHost(info, target), containerTarget: target };
  });
}

/** Tâches de dépôt : déverrouillage (verrous orphelins seulement), index, vérification. */
export async function repoTask(sid, repoId, task) {
  const TASKS = { unlock: 'TASK_UNLOCK', index: 'TASK_INDEX_SNAPSHOTS', check: 'TASK_CHECK', stats: 'TASK_STATS' };
  if (!TASKS[task]) throw bad('Tâche inconnue');
  if (!PLAN_ID.test(repoId || '')) throw bad('Dépôt invalide');
  return journal.action(sid, `backrest.repo.${task}`, repoId, async () => {
    const r = await rpc(sid, 'DoRepoTask', { repoId, task: TASKS[task] }, { timeout: task === 'unlock' ? 120000 : 60000 });
    return { operationId: r.operationId ?? null };
  });
}

export async function setCredentials(sid, { username, password }) {
  const all = { ...(secrets.get('backrest') || {}) };
  if (!username) delete all[sid];
  else all[sid] = { username: String(username), password: String(password || '') };
  secrets.set('backrest', all);
  tokens.delete(sid);
  journal.log({ server: sid, kind: 'integration.backrest', target: username || 'retiré', ok: true });
  return { ok: true };
}

// ───────── Installation de Backrest ─────────
// Pour un serveur qui n'en a pas : conteneur garethgeorge/backrest lié à 127.0.0.1:9898, dossiers
// courants de l'hôte montés en lecture seule sous /data/…, un dossier inscriptible pour les dépôts
// locaux (/srv/restic → /repos) et /tmp pour les restaurations.
const INSTALL_DIR = '/opt/orbitos-backrest';
const MOUNTS = [
  ['/var/lib/docker/volumes', '/data/docker-volumes', 'ro'],
  ['/opt', '/data/opt', 'ro'],
  ['/srv', '/data/srv', 'ro'],
  ['/home', '/data/home', 'ro'],
  ['/root', '/data/root', 'ro'],
  ['/etc', '/data/etc', 'ro'],
  ['/var/www', '/data/var/www', 'ro'],
  ['/var/backups', '/data/backups', 'ro'],
  ['/srv/restic', '/repos', 'rw'],
  ['/tmp', '/data/tmp', 'rw'],
];

export async function install(sid, body = {}) {
  const info = await discover(sid, { force: true });
  if (info.found) throw bad(`Backrest est déjà installé (${info.container})`);
  const port = Number(body.port || 9898);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw bad('Port invalide');
  const dp = await dockerPrefix(sid);
  const dv = await conn(sid).exec(`${dp}docker compose version --short 2>/dev/null`);
  if (dv.code !== 0) throw bad('Docker (avec le plugin compose) est requis');
  const tz = settings.get().timezone;
  const compose = `# Backrest installé par OrbitOS — interface et API sur 127.0.0.1:${port} (via SSH / OrbitOS)
services:
  backrest:
    image: garethgeorge/backrest:latest
    container_name: backrest
    hostname: ${sid.replace(/[^a-zA-Z0-9-]/g, '-')}-backrest
    restart: unless-stopped
    ports:
      - "127.0.0.1:${port}:9898"
    environment:
      BACKREST_PORT: "0.0.0.0:9898"
      BACKREST_DATA: /backrest-data
      BACKREST_CONFIG: /config/config.json
      XDG_CACHE_HOME: /cache
      TMPDIR: /tmp
      TZ: "${tz}"
    volumes:
      - backrest-config:/config
      - backrest-data:/backrest-data
      - backrest-cache:/cache
${MOUNTS.map(([h, c, m]) => `      - ${h}:${c}:${m}`).join('\n')}
    mem_limit: 1g
volumes:
  backrest-config:
  backrest-data:
  backrest-cache:
`;
  return journal.action(sid, 'backrest.install', `127.0.0.1:${port}`, async () => {
    const log = [];
    const code = await stream(
      sid,
      `set -e
mkdir -p ${INSTALL_DIR} /srv/restic
chmod 700 /srv/restic
for d in /var/lib/docker/volumes /opt /srv /home /root /etc /var/www /var/backups; do mkdir -p "$d"; done
cat > ${INSTALL_DIR}/compose.yml <<'ORBIT_EOF'
${compose}ORBIT_EOF
cd ${INSTALL_DIR} && ${dp}docker compose -p backrest up -d 2>&1`,
      { onData: (d) => log.push(d), timeout: 600000 },
    );
    if (code !== 0) throw new HttpError(502, `Installation échouée : ${log.join('').slice(-800)}`);
    cache.delete(sid);
    // Attend l'API puis donne un identifiant d'instance ; l'accès reste limité à 127.0.0.1.
    let cfg = null;
    for (let i = 0; i < 20 && !cfg; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        cfg = await rpc(sid, 'GetConfig', {});
      } catch {
        /* démarrage */
      }
    }
    if (!cfg) throw new HttpError(502, 'Backrest a démarré mais son API ne répond pas');
    if (!cfg.instance) {
      const next = { ...cfg, instance: `${sid}-backrest`.replace(/[^a-zA-Z0-9_-]/g, '-'), auth: { ...(cfg.auth || {}), disabled: true } };
      await rpc(sid, 'SetConfig', next);
    }
    return { ok: true, dir: INSTALL_DIR, port };
  });
}

// ───────── Dépôts restic ─────────
const REPO_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,40}$/;
const SAFE = /^[^\s'"\\]{1,300}$/;

/** Construit un dépôt Backrest depuis un formulaire simple (B2, S3, local, rest-server). */
function repoFrom(info, b) {
  if (!REPO_ID.test(b.id || '')) throw bad('Identifiant de dépôt invalide');
  const need = (k, label) => {
    const v = String(b[k] || '').trim();
    if (!v || !SAFE.test(v)) throw bad(`${label} requis (sans espace ni guillemet)`);
    return v;
  };
  let uri;
  const env = [];
  if (b.type === 'b2') {
    uri = `b2:${need('bucket', 'Bucket')}:${String(b.path || '').replace(/^\/+/, '')}`;
    env.push(`B2_ACCOUNT_ID=${need('keyId', 'keyID')}`, `B2_ACCOUNT_KEY=${need('secret', 'applicationKey')}`);
  } else if (b.type === 's3') {
    const endpoint = need('endpoint', 'Endpoint').replace(/\/+$/, '');
    if (!/^https?:\/\//.test(endpoint)) throw bad('Endpoint S3 : https://…');
    uri = `s3:${endpoint}/${need('bucket', 'Bucket')}${b.path ? '/' + String(b.path).replace(/^\/+/, '') : ''}`;
    env.push(`AWS_ACCESS_KEY_ID=${need('keyId', 'Access key')}`, `AWS_SECRET_ACCESS_KEY=${need('secret', 'Secret key')}`);
    if (b.region) env.push(`AWS_DEFAULT_REGION=${need('region', 'Région')}`);
  } else if (b.type === 'local') {
    const host = need('path', 'Dossier');
    if (!host.startsWith('/')) throw bad('Chemin absolu requis');
    const c = toContainer(info, host);
    const m = c && info.mounts.find((x) => x.rw && (c === x.dest || c.startsWith(x.dest + '/')));
    if (!m || m.dest === '/data/tmp') throw bad('Ce dossier n’est pas inscriptible par Backrest (installé par OrbitOS : /srv/restic/<nom>)');
    uri = c;
  } else if (b.type === 'rest') {
    const url = need('url', 'URL');
    if (!/^https?:\/\//.test(url)) throw bad('URL rest-server : https://…');
    uri = `rest:${url}`;
  } else throw bad('Type de dépôt inconnu');
  const password = b.password ? String(b.password) : crypto.randomBytes(24).toString('base64url');
  if (password.length < 12) throw bad('Mot de passe restic : 12 caractères minimum');
  return {
    repo: {
      id: b.id,
      uri,
      password,
      env,
      prunePolicy: { schedule: { cron: '0 3 1 * *', clock: 'CLOCK_LOCAL' }, maxUnusedPercent: 10 },
      checkPolicy: { schedule: { cron: '0 3 15 * *', clock: 'CLOCK_LOCAL' }, structureOnly: true },
    },
    password,
    generated: !b.password,
  };
}

export async function addRepo(sid, body) {
  const info = await need(sid);
  const { repo, password, generated } = repoFrom(info, body || {});
  const cfg = await rpc(sid, 'GetConfig', {});
  if ((cfg.repos || []).some((r) => r.id === repo.id)) throw bad(`Un dépôt « ${repo.id} » existe déjà`);
  await backupConfig(sid, info);
  return journal.action(sid, 'backrest.repo.add', `${repo.id} (${repo.uri.split(':')[0]})`, async () => {
    // AddRepo initialise le dépôt (restic init) s'il n'existe pas encore.
    await rpc(sid, 'AddRepo', { repo }, { timeout: 180000 });
    // Le mot de passe n'est renvoyé qu'une fois : sans lui, les sauvegardes sont illisibles.
    return { ok: true, id: repo.id, uri: maskUri(repo.uri), password: generated ? password : null };
  });
}
