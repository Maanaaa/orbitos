// GitHub : dépôts, branches, détection du type de projet, téléchargement d'archive.
// Le token (fine-grained, Contents en lecture) reste dans OrbitOS : les archives sont
// téléchargées ici puis envoyées au serveur par SSH, le token n'y transite jamais.
import * as secrets from '../secrets.js';
import { HttpError, bad } from '../util.js';

const API = 'https://api.github.com';
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const REF = /^[A-Za-z0-9_./-]{1,200}$/;

export const validRepo = (r) => {
  if (!REPO.test(r || '')) throw bad(`Dépôt invalide : ${r}`);
  return r;
};
export const validRef = (r) => {
  if (!REF.test(r || '') || r.includes('..')) throw bad(`Branche invalide : ${r}`);
  return r;
};

async function gh(pathname, { raw = false } = {}) {
  const token = secrets.get('githubToken');
  const r = await fetch(API + pathname, {
    headers: {
      Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'OrbitOS',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({}))).message || r.statusText;
    if (r.status === 404) throw new HttpError(404, `GitHub : introuvable (${pathname.split('?')[0]}). Dépôt privé ? Vérifie que le token y a accès.`);
    if (r.status === 401) throw new HttpError(401, 'GitHub : token invalide ou expiré');
    throw new HttpError(502, `GitHub ${r.status} : ${msg}`);
  }
  return raw ? r.text() : r.json();
}

export async function status() {
  const token = secrets.get('githubToken');
  if (!token) return { configured: false };
  try {
    const me = await gh('/user');
    return { configured: true, login: me.login, token: secrets.mask(token) };
  } catch (e) {
    return { configured: true, error: e.message, token: secrets.mask(token) };
  }
}

export async function setToken(token) {
  if (token && !/^(github_pat_|ghp_|gho_)[A-Za-z0-9_]{20,}$/.test(token)) throw bad('Format de token GitHub inattendu (github_pat_… ou ghp_…)');
  secrets.set('githubToken', token || null);
  return status();
}

export async function repos() {
  if (!secrets.get('githubToken')) return [];
  const list = await gh('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member');
  return list.map((r) => ({
    fullName: r.full_name,
    private: r.private,
    defaultBranch: r.default_branch,
    description: r.description,
    language: r.language,
    pushedAt: r.pushed_at,
  }));
}

export async function repo(fullName) {
  validRepo(fullName);
  const r = await gh(`/repos/${fullName}`);
  return { fullName: r.full_name, private: r.private, defaultBranch: r.default_branch, description: r.description };
}

export async function branches(fullName) {
  validRepo(fullName);
  return (await gh(`/repos/${fullName}/branches?per_page=100`)).map((b) => ({ name: b.name, sha: b.commit.sha }));
}

export async function commit(fullName, ref) {
  validRepo(fullName);
  validRef(ref);
  const c = await gh(`/repos/${fullName}/commits/${encodeURIComponent(ref)}`);
  return { sha: c.sha, message: c.commit.message.split('\n')[0].slice(0, 200), author: c.commit.author?.name, date: c.commit.author?.date };
}

/** Détecte le type de projet et propose les réglages de build. */
export async function detect(fullName, ref, rootDir = '') {
  validRepo(fullName);
  validRef(ref);
  const dir = rootDir.replace(/^\/+|\/+$/g, '');
  if (dir && !/^[A-Za-z0-9_./-]+$/.test(dir)) throw bad('Dossier racine invalide');
  const list = await gh(`/repos/${fullName}/contents/${dir}?ref=${encodeURIComponent(ref)}`);
  if (!Array.isArray(list)) throw bad('Le dossier racine doit être un dossier');
  const names = new Set(list.map((f) => f.name));
  const out = { files: [...names].slice(0, 60), type: 'static', build: null, packageManager: null, outputDir: '.', port: null, framework: null, warnings: [] };

  if (names.has('Dockerfile')) {
    out.type = 'docker';
    try {
      const df = await gh(`/repos/${fullName}/contents/${dir ? dir + '/' : ''}Dockerfile?ref=${encodeURIComponent(ref)}`, { raw: true });
      const m = df.match(/^\s*EXPOSE\s+(\d+)/im);
      out.port = m ? Number(m[1]) : 3000;
      if (!m) out.warnings.push('Aucun EXPOSE dans le Dockerfile : port 3000 supposé, à ajuster.');
    } catch {
      out.port = 3000;
    }
    return out;
  }
  if (names.has('docker-compose.yml') || names.has('compose.yaml') || names.has('docker-compose.yaml')) {
    out.warnings.push('Projet docker-compose sans Dockerfile racine : non pris en charge par Sites pour l’instant (utilise project-autodeploy).');
  }
  if (names.has('package.json')) {
    let pkg = {};
    try {
      pkg = JSON.parse(await gh(`/repos/${fullName}/contents/${dir ? dir + '/' : ''}package.json?ref=${encodeURIComponent(ref)}`, { raw: true }));
    } catch {
      /* package.json illisible */
    }
    out.packageManager = names.has('pnpm-lock.yaml') ? 'pnpm' : names.has('yarn.lock') ? 'yarn' : names.has('bun.lockb') || names.has('bun.lock') ? 'bun' : 'npm';
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (pkg.scripts?.build) {
      out.build = `${out.packageManager === 'npm' ? 'npm run' : out.packageManager} build`;
      out.framework = deps.astro ? 'Astro' : deps.next ? 'Next.js' : deps.vite ? 'Vite' : deps['@sveltejs/kit'] ? 'SvelteKit' : deps.gatsby ? 'Gatsby' : deps['react-scripts'] ? 'Create React App' : 'Node';
      out.outputDir = deps.next ? 'out' : deps['react-scripts'] ? 'build' : deps.gatsby ? 'public' : 'dist';
      if (deps.next) out.warnings.push('Next.js : seul l’export statique (output: "export") est servi en statique. Pour du SSR, ajoute un Dockerfile.');
      if (deps['@sveltejs/kit']) out.warnings.push('SvelteKit : nécessite adapter-static pour un site statique.');
    } else {
      out.warnings.push('package.json sans script build : les fichiers sont servis tels quels.');
    }
  }
  if (!out.build && names.has('public') && !names.has('index.html')) out.outputDir = 'public';
  return out;
}

/** Archive tar.gz d'un ref (flux). */
export async function tarball(fullName, sha) {
  validRepo(fullName);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw bad('SHA invalide');
  const token = secrets.get('githubToken');
  const r = await fetch(`${API}/repos/${fullName}/tarball/${sha}`, {
    headers: { 'User-Agent': 'OrbitOS', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    redirect: 'follow',
    signal: AbortSignal.timeout(300000),
  });
  if (!r.ok) throw new HttpError(502, `Téléchargement de l’archive GitHub impossible (${r.status})`);
  return r.body;
}
