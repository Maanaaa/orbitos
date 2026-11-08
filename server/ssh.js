// Couche SSH : registre des serveurs (~/.ssh/config + ajouts OrbitOS), pool de connexions
// ssh2, vérification stricte des clés d'hôte, exec / flux / PTY / SFTP.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ssh2 from 'ssh2';
import SSHConfig from 'ssh-config';
import { HttpError, bad, q } from './util.js';

const { Client } = ssh2;

export const SSH_DIR = process.env.ORBIT_SSH_DIR || path.join(process.env.HOME || '/root', '.ssh');
export const DATA_DIR = path.resolve(process.env.ORBIT_DATA || '/data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');
const TOFU_FILE = path.join(DATA_DIR, 'known_hosts.json');

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (file, value) => {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(file + '.tmp', file);
};

// ───────────────────────── Registre des serveurs ─────────────────────────

const GIT_HOSTS = /(^|\.)(github|gitlab|bitbucket)\.(com|org)$/i;

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/.ssh/')) return path.join(SSH_DIR, p.slice(7));
  if (p.startsWith('~/')) return path.join(SSH_DIR, '..', p.slice(2));
  return p;
}

function readSshConfig() {
  try {
    return SSHConfig.parse(fs.readFileSync(path.join(SSH_DIR, 'config'), 'utf8'));
  } catch {
    return null;
  }
}

/** Liste des serveurs : alias de ~/.ssh/config (hors forges git) + serveurs ajoutés dans OrbitOS. */
export function listServers() {
  const store = readJson(SERVERS_FILE, { custom: [], overrides: {} });
  const out = [];
  const cfg = readSshConfig();
  if (cfg) {
    for (const section of cfg) {
      if (section.param !== 'Host') continue;
      const aliases = [].concat(section.value).flatMap((v) => (typeof v === 'string' ? v.split(/\s+/) : [v.val]));
      for (const alias of aliases) {
        if (!alias || /[*?!]/.test(alias)) continue;
        const c = cfg.compute(alias);
        const user = c.User || 'root';
        if (user === 'git' || GIT_HOSTS.test(c.HostName || alias)) continue;
        out.push({
          id: alias,
          name: alias,
          host: c.HostName || alias,
          port: Number(c.Port || 22),
          user,
          identityFiles: [].concat(c.IdentityFile || []).map(expandHome),
          source: 'ssh-config',
        });
      }
    }
  }
  for (const s of store.custom || []) {
    out.push({ ...s, identityFiles: (s.identityFiles || []).map(expandHome), source: 'orbitos' });
  }
  return out
    .map((s) => ({ ...s, ...(store.overrides?.[s.id] || {}) }))
    .filter((s, i, all) => all.findIndex((x) => x.id === s.id) === i);
}

export function getServer(id) {
  const s = listServers().find((x) => x.id === id);
  if (!s) throw new HttpError(404, `Serveur inconnu : ${id}`);
  return s;
}

export function addServer({ id, name, host, port, user, identityFile }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,40}$/.test(id || '')) throw bad('Identifiant invalide (lettres, chiffres, . _ -)');
  if (!/^[a-zA-Z0-9.:-]{1,253}$/.test(host || '')) throw bad('Hôte invalide');
  if (!/^[a-z_][a-z0-9_.-]{0,31}$/i.test(user || '')) throw bad('Utilisateur invalide');
  if (listServers().some((s) => s.id === id)) throw bad('Ce serveur existe déjà');
  const key = identityFile ? path.basename(identityFile) : null;
  if (key && !listKeys().includes(key)) throw bad('Clé introuvable dans ~/.ssh');
  const store = readJson(SERVERS_FILE, { custom: [], overrides: {} });
  store.custom = store.custom || [];
  store.custom.push({
    id,
    name: name || id,
    host,
    port: Number(port) || 22,
    user,
    identityFiles: key ? [`~/.ssh/${key}`] : [],
  });
  writeJson(SERVERS_FILE, store);
}

export function removeServer(id) {
  const store = readJson(SERVERS_FILE, { custom: [], overrides: {} });
  const before = (store.custom || []).length;
  store.custom = (store.custom || []).filter((s) => s.id !== id);
  if (store.custom.length === before) throw bad('Seuls les serveurs ajoutés dans OrbitOS peuvent être retirés (les autres viennent de ~/.ssh/config)');
  writeJson(SERVERS_FILE, store);
  pool.get(id)?.close();
}

export function setOverride(id, patch) {
  const store = readJson(SERVERS_FILE, { custom: [], overrides: {} });
  store.overrides = store.overrides || {};
  const allowed = {};
  if (typeof patch.name === 'string') allowed.name = patch.name.slice(0, 40);
  if (typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)) allowed.color = patch.color;
  if (typeof patch.hidden === 'boolean') allowed.hidden = patch.hidden;
  store.overrides[id] = { ...(store.overrides[id] || {}), ...allowed };
  writeJson(SERVERS_FILE, store);
}

/** Clés privées présentes dans ~/.ssh (noms de fichiers uniquement). */
export function listKeys() {
  try {
    return fs
      .readdirSync(SSH_DIR)
      .filter((f) => !f.endsWith('.pub') && !/^(config|known_hosts|authorized_keys)/.test(f))
      .filter((f) => {
        try {
          const head = fs.readFileSync(path.join(SSH_DIR, f), 'utf8').slice(0, 64);
          return head.includes('PRIVATE KEY');
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

// ───────────────────────── Vérification des clés d'hôte ─────────────────────────

/** Entrées known_hosts : [{ patterns|hashed, type, key }] */
function readKnownHosts() {
  const entries = [];
  for (const file of ['known_hosts']) {
    let text = '';
    try {
      text = fs.readFileSync(path.join(SSH_DIR, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('@')) continue;
      const [hosts, type, key] = t.split(/\s+/);
      if (!key) continue;
      entries.push({ hosts, type, key });
    }
  }
  return entries;
}

function hostMatches(field, names) {
  if (field.startsWith('|1|')) {
    const [, , salt, hash] = field.split('|');
    return names.some((n) => crypto.createHmac('sha1', Buffer.from(salt, 'base64')).update(n).digest('base64') === hash);
  }
  const pats = field.split(',');
  return names.some((n) => pats.includes(n));
}

function knownKeysFor(server) {
  const names = server.port === 22 ? [server.host, server.id] : [`[${server.host}]:${server.port}`, `[${server.id}]:${server.port}`];
  const fromFile = readKnownHosts()
    .filter((e) => hostMatches(e.hosts, names))
    .map((e) => ({ ...e, source: 'known_hosts' }));
  const tofu = (readJson(TOFU_FILE, {})[`${server.host}:${server.port}`] || []).map((e) => ({ ...e, source: 'orbitos' }));
  return [...fromFile, ...tofu];
}

/** Oublie une clé d'hôte mémorisée par OrbitOS (jamais celles de ~/.ssh/known_hosts). */
export function forgetHostKey(id) {
  const s = getServer(id);
  const store = readJson(TOFU_FILE, {});
  const k = `${s.host}:${s.port}`;
  if (!store[k]) throw bad('Aucune clé mémorisée par OrbitOS pour ce serveur : la clé connue vient de ~/.ssh/known_hosts, mets-le à jour sur le Mac.');
  delete store[k];
  writeJson(TOFU_FILE, store);
  pool.get(id)?.close();
}

const TYPE_TO_ALGOS = {
  'ssh-ed25519': ['ssh-ed25519'],
  'ecdsa-sha2-nistp256': ['ecdsa-sha2-nistp256'],
  'ecdsa-sha2-nistp384': ['ecdsa-sha2-nistp384'],
  'ecdsa-sha2-nistp521': ['ecdsa-sha2-nistp521'],
  'ssh-rsa': ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'],
};

// ───────────────────────── Connexions ─────────────────────────

class Semaphore {
  constructor(n) {
    this.n = n;
    this.queue = [];
  }
  async take() {
    if (this.n > 0) {
      this.n--;
      return;
    }
    await new Promise((r) => this.queue.push(r));
  }
  give() {
    const next = this.queue.shift();
    if (next) next();
    else this.n++;
  }
}

class Conn {
  constructor(server) {
    this.server = server;
    this.client = null;
    this.ready = null;
    this.sftpP = null;
    this.sem = new Semaphore(7); // OpenSSH MaxSessions = 10 par défaut ; on garde de la marge pour les PTY
    this.caps = null;
    this.lastError = null;
  }

  connect() {
    if (this.ready) return this.ready;
    const s = this.server;
    const known = knownKeysFor(s);
    const knownTypes = [...new Set(known.map((k) => k.type))];
    const algos = knownTypes.flatMap((t) => TYPE_TO_ALGOS[t] || []);

    const keyFiles = s.identityFiles?.length
      ? s.identityFiles
      : ['id_ed25519', 'id_ecdsa', 'id_rsa'].map((f) => path.join(SSH_DIR, f));
    const auth = [];
    for (const f of keyFiles) {
      try {
        auth.push({ type: 'publickey', username: s.user, key: fs.readFileSync(f) });
      } catch {
        /* clé absente */
      }
    }
    const agent = process.env.SSH_AUTH_SOCK;
    if (agent && fs.existsSync(agent)) auth.push({ type: 'agent', username: s.user, agent });
    if (!auth.length) {
      this.ready = Promise.reject(new HttpError(502, `Aucune clé SSH utilisable pour ${s.id}`));
      this.ready.catch(() => {});
      setTimeout(() => (this.ready = null), 2000);
      return this.ready;
    }

    let hostKeyError = null;
    this.ready = new Promise((resolve, reject) => {
      const c = new Client();
      c.on('ready', () => {
        this.client = c;
        this.lastError = null;
        resolve(c);
      });
      c.on('error', (err) => {
        const e = hostKeyError || err;
        this.lastError = e.message;
        this.reset();
        reject(new HttpError(502, `SSH ${s.id} : ${e.message}`));
      });
      c.on('close', () => this.reset());
      c.connect({
        host: s.host,
        port: s.port,
        username: s.user,
        readyTimeout: 12000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        authHandler: auth,
        ...(algos.length ? { algorithms: { serverHostKey: algos } } : {}),
        hostVerifier: (keyBuf) => {
          const b64 = keyBuf.toString('base64');
          if (known.length) {
            if (known.some((k) => k.key === b64)) return true;
            const fromKnownHosts = known.some((k) => k.source === 'known_hosts');
            hostKeyError = new Error(
              fromKnownHosts
                ? `La clé d'hôte a changé (attaque MITM possible ou serveur réinstallé). Connexion refusée. Vérifie puis mets à jour ~/.ssh/known_hosts sur le Mac (ssh-keygen -R ${s.host}).`
                : `La clé d'hôte a changé depuis le premier contact (attaque MITM possible ou serveur réinstallé). Connexion refusée. Si c'est voulu, utilise « Oublier la clé d'hôte » dans Serveurs.`,
            );
            return false;
          }
          // Premier contact : on accepte et on mémorise (équivalent StrictHostKeyChecking=accept-new).
          const type = keyBuf.readUInt32BE(0) > 0 ? keyBuf.subarray(4, 4 + keyBuf.readUInt32BE(0)).toString() : 'unknown';
          const store = readJson(TOFU_FILE, {});
          store[`${s.host}:${s.port}`] = [{ hosts: s.host, type, key: b64, addedAt: new Date().toISOString() }];
          writeJson(TOFU_FILE, store);
          return true;
        },
      });
    });
    this.ready.catch(() => {});
    return this.ready;
  }

  reset() {
    this.client = null;
    this.ready = null;
    this.sftpP = null;
  }

  close() {
    try {
      this.client?.end();
    } catch {
      /* ignore */
    }
    this.reset();
  }

  async exec(cmd, { timeout = 30000, input } = {}) {
    const c = await this.connect();
    await this.sem.take();
    try {
      return await new Promise((resolve, reject) => {
        c.exec(cmd, (err, stream) => {
          if (err) return reject(new HttpError(502, `SSH exec : ${err.message}`));
          let stdout = '';
          let stderr = '';
          let done = false;
          const timer = setTimeout(() => {
            if (done) return;
            done = true;
            try {
              stream.close();
            } catch {
              /* ignore */
            }
            reject(new HttpError(504, `Délai dépassé (${timeout / 1000}s) : ${cmd.slice(0, 80)}`));
          }, timeout);
          stream.on('data', (d) => (stdout += d));
          stream.stderr.on('data', (d) => (stderr += d));
          stream.on('close', (code) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve({ code: code ?? 0, stdout, stderr });
          });
          if (input !== undefined) stream.end(input);
        });
      });
    } finally {
      this.sem.give();
    }
  }

  /** Canal long (logs -f, PTY). Ne prend pas de jeton du sémaphore : à fermer par l'appelant. */
  async channel(cmd, pty) {
    const c = await this.connect();
    return new Promise((resolve, reject) => {
      const cb = (err, stream) => (err ? reject(new HttpError(502, err.message)) : resolve(stream));
      if (cmd === null) c.shell(pty || false, cb);
      else c.exec(cmd, pty ? { pty } : {}, cb);
    });
  }

  async sftp() {
    if (this.sftpP) return this.sftpP;
    const c = await this.connect();
    this.sftpP = new Promise((resolve, reject) => {
      c.sftp((err, sftp) => {
        if (err) {
          this.sftpP = null;
          return reject(new HttpError(502, `SFTP : ${err.message}`));
        }
        sftp.on('close', () => (this.sftpP = null));
        resolve(sftp);
      });
    });
    return this.sftpP;
  }

  /** Capacités : root ? sudo sans mot de passe ? docker accessible ? */
  async capabilities() {
    if (this.caps) return this.caps;
    const r = await this.exec(
      `id -u; (sudo -n true 2>/dev/null && echo SUDO) || echo NOSUDO; (docker info >/dev/null 2>&1 && echo DOCKER) || echo NODOCKER; hostname; command -v docker >/dev/null 2>&1 && echo HASDOCKER || echo NOHASDOCKER`,
      { timeout: 15000 },
    );
    const [uid, sudo, docker, hostname, has] = r.stdout.trim().split('\n');
    const root = uid === '0';
    this.caps = { root, sudo: sudo === 'SUDO', docker: docker === 'DOCKER', hostname, hasDocker: has === 'HASDOCKER' };
    return this.caps;
  }
}

const pool = new Map();

export function conn(id) {
  const server = getServer(id);
  let c = pool.get(id);
  if (!c || c.server.host !== server.host || c.server.user !== server.user) {
    c?.close();
    c = new Conn(server);
    pool.set(id, c);
  }
  return c;
}

/** Préfixe une commande nécessitant les droits root (sudo -n si l'utilisateur n'est pas root). */
export async function privPrefix(id) {
  const caps = await conn(id).capabilities();
  if (caps.root) return '';
  if (caps.sudo) return 'sudo -n ';
  return '';
}

/** Préfixe pour docker : direct si l'utilisateur est dans le groupe docker, sinon sudo. */
export async function dockerPrefix(id) {
  const caps = await conn(id).capabilities();
  if (caps.root || caps.docker) return '';
  if (caps.sudo) return 'sudo -n ';
  return '';
}

/** Exécute et échoue si le code de sortie est non nul. */
export async function run(id, cmd, opts) {
  const r = await conn(id).exec(cmd, opts);
  if (r.code !== 0) throw new HttpError(502, (r.stderr || r.stdout || `code ${r.code}`).trim().slice(0, 2000), { cmd });
  return r.stdout;
}

/** Exécute une commande privilégiée (root ou sudo -n). */
export async function runPriv(id, cmd, opts) {
  const p = await privPrefix(id);
  return run(id, p ? `${p}sh -c ${q(cmd)}` : cmd, opts);
}

export function poolStatus() {
  return [...pool.values()].map((c) => ({ id: c.server.id, connected: !!c.client, lastError: c.lastError }));
}

/** Lance un script (privilégié) et diffuse sa sortie ; stdin optionnel (flux). */
export async function stream(sid, script, { stdin, onData, timeout = 1800000 } = {}) {
  const pre = await privPrefix(sid);
  const ch = await conn(sid).channel(`${pre}sh -c ${q(script)}`);
  return new Promise((resolve, reject) => {
    let code = null;
    const timer = setTimeout(() => {
      try {
        ch.close();
      } catch {
        /* ignore */
      }
      reject(new Error(`Délai dépassé (${timeout / 60000} min)`));
    }, timeout);
    ch.on('exit', (c) => (code = c));
    ch.on('data', (d) => onData?.(d.toString()));
    ch.stderr.on('data', (d) => onData?.(d.toString()));
    ch.on('close', () => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
    if (stdin) {
      stdin.on('error', (e) => {
        onData?.(`\n✖ ${e.message}\n`);
        try {
          ch.close();
        } catch {
          /* ignore */
        }
      });
      stdin.pipe(ch);
    } else ch.end();
  });
}
