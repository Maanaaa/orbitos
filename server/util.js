// Petits utilitaires partagés : échappement shell, validations, erreurs HTTP.

/** Échappe une valeur pour un shell POSIX (toujours entre apostrophes). */
export function q(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const bad = (msg, details) => new HttpError(400, msg, details);

// Noms Docker : conteneurs, projets compose, volumes, images.
const DOCKER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const DOCKER_REF = /^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,255}$/;
const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const UNIT = /^[a-zA-Z0-9@_.:-]{1,200}$/;
const IP = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[0-9a-fA-F:]+(\/\d{1,3})?$/;

export function dockerName(v) {
  if (typeof v !== 'string' || !DOCKER_NAME.test(v)) throw bad(`Nom Docker invalide : ${v}`);
  return v;
}
export function dockerRef(v) {
  if (typeof v !== 'string' || !DOCKER_REF.test(v)) throw bad(`Référence Docker invalide : ${v}`);
  return v;
}
export function domain(v) {
  const d = String(v || '').trim().toLowerCase();
  if (!DOMAIN.test(d)) throw bad(`Nom de domaine invalide : ${v}`);
  return d;
}
export function unit(v) {
  if (typeof v !== 'string' || !UNIT.test(v)) throw bad(`Nom d'unité invalide : ${v}`);
  return v;
}
export function ip(v) {
  if (typeof v !== 'string' || !IP.test(v)) throw bad(`Adresse IP invalide : ${v}`);
  return v;
}
/** Chemin absolu, sans octet nul ni retour ligne. */
export function absPath(v) {
  if (typeof v !== 'string' || !v.startsWith('/') || /[\0\n\r]/.test(v)) throw bad(`Chemin invalide : ${v}`);
  // normalisation simple
  const parts = [];
  for (const p of v.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') parts.pop();
    else parts.push(p);
  }
  return '/' + parts.join('/');
}

export function int(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Parse une sortie « une ligne JSON par élément » (docker --format '{{json .}}'). */
export function jsonLines(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}
