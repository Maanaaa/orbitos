// Coffre des secrets d'intégration (token GitHub, clé Portainer) : fichier 0600 dans le volume de données.
// Les valeurs ne sont jamais renvoyées au navigateur, seulement un aperçu masqué.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './ssh.js';

const FILE = path.join(DATA_DIR, 'integrations.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function get(key) {
  return load()[key];
}

export function set(key, value) {
  const all = load();
  if (value === null || value === undefined || value === '') delete all[key];
  else all[key] = value;
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(all, null, 2), { mode: 0o600 });
  fs.renameSync(FILE + '.tmp', FILE);
}

export const mask = (v) => (v ? `${String(v).slice(0, 7)}…${String(v).slice(-4)}` : null);
