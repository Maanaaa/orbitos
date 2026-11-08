// Docker : conteneurs, stacks compose (toutes sources), images, volumes, stats.
import { conn, run, dockerPrefix, privPrefix } from '../ssh.js';
import { q, dockerName, dockerRef, jsonLines, bad } from '../util.js';
import { action } from '../journal.js';

const PORTAINER_DATA = '/var/lib/docker/volumes/portainer_data/_data';

async function d(id, args, opts) {
  const p = await dockerPrefix(id);
  return run(id, `${p}docker ${args}`, opts);
}

function parsePorts(s) {
  if (!s) return [];
  return s
    .split(', ')
    .map((p) => {
      const m = p.match(/^(?:(\[?[\d.:a-f]*\]?):(\d+(?:-\d+)?)->)?(\d+(?:-\d+)?)\/(\w+)$/);
      if (!m) return null;
      return { host: m[1] || null, hostPort: m[2] || null, port: m[3], proto: m[4], public: !!m[1] && !/^(127\.|\[::1\])/.test(m[1]) };
    })
    .filter(Boolean)
    .filter((p, i, a) => a.findIndex((x) => x.hostPort === p.hostPort && x.port === p.port && x.public === p.public) === i);
}

function parseLabels(s) {
  const out = {};
  for (const kv of (s || '').split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return out;
}

export async function containers(id) {
  const out = await d(id, `ps -a --no-trunc --format '{{json .}}'`);
  const list = jsonLines(out).map((c) => {
    const labels = parseLabels(c.Labels);
    const state = c.State;
    const health = /\((healthy|unhealthy|health: starting)\)/.exec(c.Status)?.[1]?.replace('health: ', '') || null;
    return {
      id: c.ID.slice(0, 12),
      name: c.Names,
      image: c.Image,
      state,
      status: c.Status,
      health,
      created: c.CreatedAt,
      ports: parsePorts(c.Ports),
      project: labels['com.docker.compose.project'] || null,
      service: labels['com.docker.compose.service'] || null,
      networks: c.Networks,
      mounts: c.Mounts,
      size: c.Size,
    };
  });
  return list.sort((a, b) => (a.project || '~').localeCompare(b.project || '~') || a.name.localeCompare(b.name));
}

let statsCache = new Map();
export async function stats(id) {
  const cached = statsCache.get(id);
  if (cached && Date.now() - cached.at < 4000) return cached.data;
  const out = await d(id, `stats --no-stream --format '{{json .}}'`, { timeout: 30000 });
  const data = jsonLines(out).map((s) => ({
    name: s.Name,
    cpu: parseFloat(s.CPUPerc) || 0,
    memPct: parseFloat(s.MemPerc) || 0,
    mem: s.MemUsage,
    net: s.NetIO,
    block: s.BlockIO,
    pids: Number(s.PIDs) || 0,
  }));
  statsCache.set(id, { at: Date.now(), data });
  return data;
}

export async function inspect(id, name) {
  dockerName(name);
  const out = await d(id, `inspect ${q(name)}`);
  const [c] = JSON.parse(out);
  // Masque les valeurs d'environnement sensibles
  const env = (c.Config?.Env || []).map((e) => {
    const i = e.indexOf('=');
    const k = e.slice(0, i);
    const v = e.slice(i + 1);
    return { key: k, value: v, secret: /(pass|secret|token|key|salt|private|credential|dsn|auth)/i.test(k) };
  });
  return {
    id: c.Id,
    name: c.Name.replace(/^\//, ''),
    image: c.Config?.Image,
    created: c.Created,
    pid: c.State?.Pid,
    state: c.State,
    restartCount: c.RestartCount,
    restartPolicy: c.HostConfig?.RestartPolicy,
    cmd: [].concat(c.Path || [], c.Args || []).join(' '),
    workdir: c.Config?.WorkingDir,
    env,
    labels: c.Config?.Labels || {},
    mounts: (c.Mounts || []).map((m) => ({ type: m.Type, name: m.Name, source: m.Source, destination: m.Destination, rw: m.RW })),
    networks: Object.entries(c.NetworkSettings?.Networks || {}).map(([n, v]) => ({ name: n, ip: v.IPAddress, aliases: v.Aliases })),
    ports: c.NetworkSettings?.Ports || {},
    memoryLimit: c.HostConfig?.Memory || 0,
  };
}

export async function containerAction(id, name, act) {
  dockerName(name);
  if (!['start', 'stop', 'restart', 'pause', 'unpause', 'kill', 'rm'].includes(act)) throw bad('Action invalide');
  const args = act === 'rm' ? `rm ${q(name)}` : `${act} ${q(name)}`;
  return action(id, `container.${act}`, name, () => d(id, args, { timeout: 90000 }));
}

// ───────── Stacks ─────────

/** Traduit un chemin vu par Portainer (/data/compose/...) en chemin réel sur l'hôte. */
function hostPath(file) {
  if (file.startsWith('/data/compose/')) return PORTAINER_DATA + file.slice(5);
  return file;
}

export async function stacks(id) {
  const [lsOut, cs] = await Promise.all([d(id, `compose ls -a --format json`), containers(id)]);
  let ls = [];
  try {
    ls = JSON.parse(lsOut || '[]');
  } catch {
    ls = [];
  }
  const files = [...new Set(ls.flatMap((s) => s.ConfigFiles.split(',').map(hostPath)))];
  // Quels fichiers existent vraiment sur l'hôte ?
  let existing = new Set();
  if (files.length) {
    const r = await conn(id).exec(files.map((f) => `[ -f ${q(f)} ] && echo ${q(f)}`).join('; ') + '; true');
    existing = new Set(r.stdout.split('\n').filter(Boolean));
  }
  return ls
    .map((s) => {
      const configFiles = s.ConfigFiles.split(',').map(hostPath);
      const members = cs.filter((c) => c.project === s.Name);
      const portainer = s.ConfigFiles.includes('/data/compose/') || s.ConfigFiles.includes('portainer_data');
      return {
        name: s.Name,
        status: s.Status,
        configFiles,
        filesFound: configFiles.filter((f) => existing.has(f)),
        workdir: configFiles[0]?.replace(/\/[^/]+$/, '') || null,
        managedBy: portainer ? 'portainer' : 'compose',
        containers: members.map((c) => ({ name: c.name, state: c.state, health: c.health, image: c.image, service: c.service })),
        running: members.filter((c) => c.state === 'running').length,
        total: members.length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function stackAction(id, name, act) {
  dockerName(name);
  const p = await dockerPrefix(id);
  const label = `--filter label=com.docker.compose.project=${q(name)}`;
  if (['start', 'stop', 'restart'].includes(act)) {
    const sel = act === 'start' ? `ps -aq ${label}` : `ps -q ${label}`;
    return action(id, `stack.${act}`, name, () =>
      run(id, `ids=$(${p}docker ${sel}); [ -n "$ids" ] && ${p}docker ${act} $ids || echo "rien à faire"`, { timeout: 180000 }),
    );
  }
  if (['up', 'pull', 'down'].includes(act)) {
    const all = await stacks(id);
    const s = all.find((x) => x.name === name);
    if (!s) throw bad('Stack introuvable');
    if (s.filesFound.length !== s.configFiles.length) throw bad('Fichiers compose introuvables sur l’hôte');
    const f = s.configFiles.map((x) => `-f ${q(x)}`).join(' ');
    const envFile = s.managedBy === 'portainer' ? `$( [ -f ${q(s.workdir + '/stack.env')} ] && echo --env-file ${q(s.workdir + '/stack.env')} )` : '';
    const cmd = {
      up: `cd ${q(s.workdir)} && ${p}docker compose -p ${q(name)} ${f} ${envFile} up -d --remove-orphans 2>&1`,
      pull: `cd ${q(s.workdir)} && ${p}docker compose -p ${q(name)} ${f} ${envFile} pull 2>&1`,
      down: `cd ${q(s.workdir)} && ${p}docker compose -p ${q(name)} ${f} ${envFile} down 2>&1`,
    }[act];
    return action(id, `stack.${act}`, name, () => run(id, cmd, { timeout: 600000 }));
  }
  throw bad('Action invalide');
}

// ───────── Images & volumes ─────────

export async function images(id) {
  const [imgs, cs] = await Promise.all([d(id, `images --format '{{json .}}'`), d(id, `ps -a --format '{{.Image}}'`)]);
  const used = new Set(cs.split('\n').filter(Boolean));
  return jsonLines(imgs).map((i) => {
    const ref = i.Tag === '<none>' ? i.ID : `${i.Repository}:${i.Tag}`;
    return {
      id: i.ID,
      repository: i.Repository,
      tag: i.Tag,
      size: i.Size,
      created: i.CreatedSince,
      dangling: i.Tag === '<none>' && i.Repository === '<none>',
      inUse: used.has(ref) || used.has(i.ID) || used.has(i.Repository) || (i.Tag === 'latest' && used.has(i.Repository)),
    };
  });
}

export async function imageAction(id, act, ref) {
  if (act === 'prune-dangling') return action(id, 'image.prune', 'dangling', () => d(id, 'image prune -f', { timeout: 300000 }));
  if (act === 'pull') {
    dockerRef(ref);
    return action(id, 'image.pull', ref, () => d(id, `pull ${q(ref)}`, { timeout: 600000 }));
  }
  if (act === 'rm') {
    dockerRef(ref);
    return action(id, 'image.rm', ref, () => d(id, `rmi ${q(ref)}`, { timeout: 120000 }));
  }
  throw bad('Action invalide');
}

export async function volumes(id) {
  const [vols, dangling, cs] = await Promise.all([
    d(id, `volume ls --format '{{json .}}'`),
    d(id, `volume ls -q -f dangling=true`),
    d(id, `ps -a --format '{{.Names}}|{{.Mounts}}'`),
  ]);
  const orphan = new Set(dangling.split('\n').filter(Boolean));
  const usage = {};
  for (const line of cs.split('\n').filter(Boolean)) {
    const [n, mounts] = line.split('|');
    for (const m of (mounts || '').split(',')) if (m) (usage[m] ||= []).push(n);
  }
  return jsonLines(vols).map((v) => ({
    name: v.Name,
    driver: v.Driver,
    mountpoint: `/var/lib/docker/volumes/${v.Name}/_data`,
    orphan: orphan.has(v.Name),
    usedBy: usage[v.Name] || usage[v.Name.slice(0, 20) + '…'] || [],
    project: (v.Labels || '').match(/com\.docker\.compose\.project=([^,]+)/)?.[1] || null,
  }));
}

export async function volumeSize(id, name) {
  dockerName(name);
  const p = await privPrefix(id);
  const out = await run(id, `${p}du -sb ${q(`/var/lib/docker/volumes/${name}/_data`)} 2>/dev/null | cut -f1`, { timeout: 60000 });
  return Number(out.trim()) || 0;
}

export async function diskUsage(id) {
  const out = await d(id, `system df --format '{{json .}}'`, { timeout: 60000 });
  return jsonLines(out);
}
