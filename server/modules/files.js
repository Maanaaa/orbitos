// Fichiers via SFTP : navigation, lecture/écriture avec sauvegarde, upload/download,
// corbeille serveur (aucune suppression définitive depuis l'interface).
import path from 'node:path';
import { conn, run, privPrefix } from '../ssh.js';
import { q, absPath, bad, stamp, HttpError } from '../util.js';
import { action } from '../journal.js';

const MAX_READ = 3 * 1024 * 1024;
const PROTECTED = new Set([
  '/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib64', '/opt', '/proc', '/root', '/run', '/sbin', '/srv', '/sys',
  '/usr', '/var', '/var/lib', '/var/lib/docker', '/var/lib/docker/volumes', '/etc/nginx', '/etc/letsencrypt', '/var/www', '/var/log',
]);

const sftpCall = (sftp, fn, ...args) =>
  new Promise((resolve, reject) => sftp[fn](...args, (err, res) => (err ? reject(err) : resolve(res))));

function modeString(mode, type) {
  const t = { dir: 'd', link: 'l', file: '-' }[type] || '-';
  const bits = ['r', 'w', 'x'];
  let s = t;
  for (let i = 8; i >= 0; i--) s += mode & (1 << i) ? bits[(8 - i) % 3] : '-';
  return s;
}

function typeOf(attrs) {
  const m = attrs.mode & 0o170000;
  if (m === 0o040000) return 'dir';
  if (m === 0o120000) return 'link';
  return 'file';
}

function sftpError(e, p) {
  if (e.code === 2) return new HttpError(404, `Introuvable : ${p}`);
  if (e.code === 3) return new HttpError(403, `Permission refusée : ${p}`);
  return new HttpError(502, e.message || String(e));
}

export async function list(id, rawPath) {
  const p = absPath(rawPath);
  const sftp = await conn(id).sftp();
  let entries;
  try {
    entries = await sftpCall(sftp, 'readdir', p);
  } catch (e) {
    throw sftpError(e, p);
  }
  const items = await Promise.all(
    entries.map(async (e) => {
      let type = typeOf(e.attrs);
      let target = null;
      if (type === 'link') {
        try {
          target = await sftpCall(sftp, 'readlink', path.posix.join(p, e.filename));
          const st = await sftpCall(sftp, 'stat', path.posix.join(p, e.filename));
          type = typeOf(st) === 'dir' ? 'dir' : 'file';
        } catch {
          type = 'file';
        }
      }
      return {
        name: e.filename,
        path: path.posix.join(p, e.filename),
        type,
        link: target,
        size: e.attrs.size,
        mtime: e.attrs.mtime * 1000,
        mode: modeString(e.attrs.mode, typeOf(e.attrs)),
        uid: e.attrs.uid,
        gid: e.attrs.gid,
      };
    }),
  );
  items.sort((a, b) => (a.type === 'dir') === (b.type === 'dir') ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1);
  return { path: p, items };
}

export async function read(id, rawPath) {
  const p = absPath(rawPath);
  const sftp = await conn(id).sftp();
  let st;
  try {
    st = await sftpCall(sftp, 'stat', p);
  } catch (e) {
    if (e.code === 3) return readPriv(id, p);
    throw sftpError(e, p);
  }
  if (typeOf(st) === 'dir') throw bad('C’est un dossier');
  if (st.size > MAX_READ) throw new HttpError(413, `Fichier trop gros pour l’éditeur (${Math.round(st.size / 1e6)} Mo) : télécharge-le.`);
  try {
    const buf = await new Promise((resolve, reject) => {
      const chunks = [];
      const s = sftp.createReadStream(p);
      s.on('data', (c) => chunks.push(c));
      s.on('end', () => resolve(Buffer.concat(chunks)));
      s.on('error', reject);
    });
    return { path: p, size: st.size, mtime: st.mtime * 1000, ...encode(buf) };
  } catch (e) {
    if (e.code === 3) return readPriv(id, p);
    throw sftpError(e, p);
  }
}

async function readPriv(id, p) {
  const pre = await privPrefix(id);
  if (!pre) throw new HttpError(403, `Permission refusée : ${p}`);
  const out = await run(id, `${pre}sh -c ${q(`head -c ${MAX_READ} ${q(p)} | base64 -w0`)}`);
  return { path: p, privileged: true, ...encode(Buffer.from(out.trim(), 'base64')) };
}

function encode(buf) {
  // Binaire si octet nul dans les 8 premiers Ko
  const binary = buf.subarray(0, 8192).includes(0);
  return binary ? { binary: true, base64: buf.toString('base64') } : { binary: false, content: buf.toString('utf8') };
}

async function backupDir(id) {
  const pre = await privPrefix(id);
  const caps = await conn(id).capabilities();
  return caps.root || pre ? '/var/backups/orbitos' : '~/.orbitos/backups';
}

/** Copie de sauvegarde horodatée d'un fichier, retourne le chemin de la copie. */
export async function backup(id, p) {
  const pre = await privPrefix(id);
  const dir = await backupDir(id);
  const dest = `${dir}${p}.${stamp()}`;
  await run(id, `${pre}sh -c ${q(`[ -e ${q(p)} ] || exit 0; mkdir -p ${q(path.posix.dirname(dest))} && cp -a ${q(p)} ${q(dest)} && echo ${q(dest)}`)}`);
  return dest;
}

export async function write(id, rawPath, content, { makeBackup = true } = {}) {
  const p = absPath(rawPath);
  return action(id, 'file.write', p, async () => {
    const bak = makeBackup ? await backup(id, p) : null;
    await writeRaw(id, p, Buffer.from(content, 'utf8'));
    return { path: p, backup: bak || null };
  });
}

/** Écriture brute : SFTP direct, ou via fichier temporaire + sudo si permission refusée. */
export async function writeRaw(id, p, buf) {
  const sftp = await conn(id).sftp();
  try {
    await new Promise((resolve, reject) => {
      const s = sftp.createWriteStream(p);
      s.on('close', resolve);
      s.on('error', reject);
      s.end(buf);
    });
  } catch (e) {
    if (e.code !== 3) throw sftpError(e, p);
    const pre = await privPrefix(id);
    if (!pre) throw new HttpError(403, `Permission refusée : ${p}`);
    const tmp = `/tmp/orbitos-${process.pid}-${Date.now()}`;
    await new Promise((resolve, reject) => {
      const s = sftp.createWriteStream(tmp, { mode: 0o600 });
      s.on('close', resolve);
      s.on('error', reject);
      s.end(buf);
    });
    await run(id, `${pre}sh -c ${q(`cat ${q(tmp)} > ${q(p)}`)}; rm -f ${q(tmp)}`);
  }
}

export async function mkdir(id, rawPath) {
  const p = absPath(rawPath);
  return action(id, 'file.mkdir', p, async () => {
    const pre = await privPrefix(id);
    const r = await conn(id).exec(`mkdir -p ${q(p)}`);
    if (r.code !== 0) await run(id, `${pre}mkdir -p ${q(p)}`);
    return { path: p };
  });
}

export async function rename(id, from, to) {
  const a = absPath(from);
  const b = absPath(to);
  if (PROTECTED.has(a)) throw bad('Chemin système protégé');
  return action(id, 'file.rename', `${a} → ${b}`, async () => {
    const r = await conn(id).exec(`[ ! -e ${q(b)} ] && mv ${q(a)} ${q(b)}`);
    if (r.code !== 0) {
      const pre = await privPrefix(id);
      await run(id, `${pre}sh -c ${q(`[ ! -e ${q(b)} ] || { echo "La destination existe déjà" >&2; exit 1; }; mv ${q(a)} ${q(b)}`)}`);
    }
    return { path: b };
  });
}

/** Déplace vers la corbeille serveur (/var/backups/orbitos/trash/<horodatage>/...). */
export async function trash(id, rawPath) {
  const p = absPath(rawPath);
  if (PROTECTED.has(p) || p.split('/').length < 3) throw bad('Chemin système protégé : suppression refusée');
  return action(id, 'file.trash', p, async () => {
    const pre = await privPrefix(id);
    const dir = await backupDir(id);
    const dest = `${dir}/trash/${stamp()}${p}`;
    await run(id, `${pre}sh -c ${q(`mkdir -p ${q(path.posix.dirname(dest))} && mv ${q(p)} ${q(dest)}`)}`);
    return { trashedTo: dest };
  });
}

export async function stat(id, rawPath) {
  const p = absPath(rawPath);
  const sftp = await conn(id).sftp();
  try {
    const st = await sftpCall(sftp, 'stat', p);
    return { path: p, type: typeOf(st), size: st.size, mtime: st.mtime * 1000 };
  } catch (e) {
    throw sftpError(e, p);
  }
}

export async function readStream(id, rawPath) {
  const p = absPath(rawPath);
  const sftp = await conn(id).sftp();
  const st = await sftpCall(sftp, 'stat', p).catch((e) => {
    throw sftpError(e, p);
  });
  if (typeOf(st) === 'dir') {
    // Dossier : archive tar.gz à la volée
    const pre = await privPrefix(id);
    const stream = await conn(id).channel(`${pre}tar -czf - -C ${q(path.posix.dirname(p))} ${q(path.posix.basename(p))}`);
    return { stream, name: `${path.posix.basename(p)}.tar.gz`, size: null };
  }
  return { stream: sftp.createReadStream(p), name: path.posix.basename(p), size: st.size };
}

export async function uploadStream(id, rawPath, source) {
  const p = absPath(rawPath);
  const sftp = await conn(id).sftp();
  await action(id, 'file.upload', p, async () => {
    const exists = await sftpCall(sftp, 'stat', p).then(() => true, () => false);
    if (exists) await backup(id, p);
    await new Promise((resolve, reject) => {
      const dest = sftp.createWriteStream(p);
      dest.on('close', resolve);
      dest.on('error', (e) => reject(sftpError(e, p)));
      source.on('error', reject);
      source.pipe(dest);
    });
  });
  return { path: p };
}

/** Raccourcis du Finder pour ce serveur. */
export async function places(id) {
  const caps = await conn(id).capabilities();
  const home = (await run(id, 'echo $HOME')).trim();
  const pre = await privPrefix(id);
  const r = await conn(id).exec(`for d in /etc/nginx /var/www /opt /srv /var/log /var/lib/docker/volumes /etc/letsencrypt/live /var/backups/orbitos; do ${pre}test -d $d && echo $d; done`);
  return { home, root: caps.root, dirs: r.stdout.split('\n').filter(Boolean) };
}
