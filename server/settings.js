// Réglages de l'instance : nom, modules activés, domaine et fuseau par défaut, premier lancement.
// Stockés dans <data>/settings.json. Les secrets (jetons, mots de passe) restent dans secrets.js.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './ssh.js';
import { bad, domain as vDomain } from './util.js';

const FILE = path.join(DATA_DIR, 'settings.json');

/**
 * Modules désactivables. `api` : préfixes de routes bloqués quand le module est coupé
 * (les autres modules ne sont que retirés de l'interface, car leurs routes servent ailleurs :
 * Docker pour l'Hébergement, fichiers pour l'Éditeur…).
 */
export const MODULES = [
  { id: 'finder', name: 'Finder', group: 'Essentiels', description: 'Fichiers des serveurs, volumes et conteneurs' },
  { id: 'terminal', name: 'Terminal', group: 'Essentiels', description: 'Shell SSH et shell dans les conteneurs' },
  { id: 'monitor', name: 'Moniteur', group: 'Essentiels', description: 'CPU, mémoire, disques, processus' },
  { id: 'console', name: 'Console', group: 'Essentiels', description: 'Logs en direct' },
  { id: 'docker', name: 'Docker', group: 'Conteneurs', description: 'Conteneurs, stacks, images, volumes' },
  { id: 'hosting', name: 'Hébergement', group: 'Conteneurs', description: 'Serveurs de jeu, vocal, bots et sites web', api: ['/api/apps', '/api/sites', '/api/hosting'] },
  { id: 'domains', name: 'Domaines', group: 'Web', description: 'Vhosts nginx, SSL Let’s Encrypt, SSO' },
  { id: 'backup', name: 'Sauvegarde', group: 'Données', description: 'Backrest / restic : plans, instantanés, restauration', api: ['/backrest'] },
  { id: 'doctor', name: 'Doctor', group: 'Santé', description: 'Diagnostic et score de santé', api: ['/doctor'] },
  { id: 'shield', name: 'Bouclier', group: 'Santé', description: 'Pare-feu, exposition, CrowdSec, fail2ban', api: ['/security'] },
  { id: 'services', name: 'Services', group: 'Santé', description: 'systemd, timers, cron', api: ['/services', '/timers', '/cron'] },
];
const IDS = new Set(MODULES.map((m) => m.id));

const DEFAULTS = {
  instanceName: 'OrbitOS',
  modules: Object.fromEntries(MODULES.map((m) => [m.id, true])),
  defaultDomain: '',
  timezone: process.env.TZ || 'Etc/UTC',
  onboarded: false,
};

let cache = null;
export function get() {
  if (cache) return cache;
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    /* premier lancement */
  }
  if (!saved) {
    // Une instance déjà utilisée (journal présent) ne repasse pas par l'accueil.
    const used = fs.existsSync(path.join(DATA_DIR, 'journal.jsonl'));
    saved = { onboarded: used };
  }
  cache = { ...DEFAULTS, ...saved, modules: { ...DEFAULTS.modules, ...(saved.modules || {}) } };
  return cache;
}

function save(s) {
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(s, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);
  cache = s;
  return s;
}

const TZ = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/;

export function update(body) {
  const s = { ...get(), modules: { ...get().modules } };
  if (body.instanceName !== undefined) {
    const n = String(body.instanceName).trim();
    if (!n || n.length > 40) throw bad('Nom d’instance invalide (40 caractères max)');
    s.instanceName = n;
  }
  if (body.modules !== undefined) {
    for (const [k, v] of Object.entries(body.modules || {})) {
      if (!IDS.has(k)) throw bad(`Module inconnu : ${k}`);
      s.modules[k] = !!v;
    }
  }
  if (body.defaultDomain !== undefined) s.defaultDomain = body.defaultDomain ? vDomain(body.defaultDomain) : '';
  if (body.timezone !== undefined) {
    const tz = String(body.timezone).trim();
    if (!TZ.test(tz)) throw bad('Fuseau horaire invalide (ex. Europe/Paris)');
    try {
      new Intl.DateTimeFormat('fr', { timeZone: tz });
    } catch {
      throw bad(`Fuseau horaire inconnu : ${tz}`);
    }
    s.timezone = tz;
  }
  if (body.onboarded !== undefined) s.onboarded = !!body.onboarded;
  return save(s);
}

/** Module coupé pour cette URL d'API ? Renvoie son nom, sinon null. */
export function blockedModule(url) {
  const s = get();
  for (const m of MODULES) {
    if (!m.api || s.modules[m.id] !== false) continue;
    if (m.api.some((p) => (p.startsWith('/api/') ? url.startsWith(p) : /^\/api\/s\/[^/]+\//.test(url) && url.replace(/^\/api\/s\/[^/]+/, '').startsWith(p)))) return m.name;
  }
  return null;
}

export const publicSettings = () => ({ ...get(), catalog: MODULES.map(({ api, ...m }) => ({ ...m, apiGuarded: !!api })) });
