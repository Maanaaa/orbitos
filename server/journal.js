// Journal d'intervention : chaque action qui modifie un serveur est consignée (JSONL).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './ssh.js';

const FILE = path.join(DATA_DIR, 'journal.jsonl');

export function log(entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  fs.appendFileSync(FILE, line + '\n');
}

export function read(limit = 300) {
  let text = '';
  try {
    text = fs.readFileSync(FILE, 'utf8');
  } catch {
    return [];
  }
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(-limit)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
}

/** Enveloppe une action : journalise succès ou échec. */
export async function action(server, kind, target, fn) {
  try {
    const result = await fn();
    log({ server, kind, target, ok: true });
    return result;
  } catch (e) {
    log({ server, kind, target, ok: false, error: String(e.message || e).slice(0, 500) });
    throw e;
  }
}
