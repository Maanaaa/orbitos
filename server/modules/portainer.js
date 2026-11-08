// Portainer : les sites Docker et les applications deviennent des stacks Portainer (si configuré).
import * as secrets from '../secrets.js';
import { HttpError, bad } from '../util.js';

function cfg() {
  const c = secrets.get('portainer');
  if (!c?.url || !c?.apiKey) return null;
  return c;
}

async function call(method, pathname, body) {
  const c = cfg();
  if (!c) throw new HttpError(400, 'Portainer n’est pas configuré');
  const r = await fetch(c.url.replace(/\/$/, '') + pathname, {
    method,
    headers: { 'X-API-Key': c.apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!r.ok) throw new HttpError(502, `Portainer ${r.status} : ${data?.message || data?.details || text.slice(0, 200)}`);
  return data;
}

export function status() {
  const c = secrets.get('portainer');
  return c ? { configured: !!(c.url && c.apiKey), url: c.url, endpointId: c.endpointId, server: c.server, apiKey: secrets.mask(c.apiKey) } : { configured: false };
}

export async function configure({ url, apiKey, endpointId, server }) {
  if (!url && !apiKey) {
    secrets.set('portainer', null);
    return status();
  }
  if (!/^https?:\/\/[a-zA-Z0-9.:-]+\/?$/.test(url || '')) throw bad('URL Portainer invalide (ex. https://portainer.example.com)');
  const prev = secrets.get('portainer') || {};
  const next = { url: url.replace(/\/$/, ''), apiKey: apiKey || prev.apiKey, endpointId: Number(endpointId) || 1, server: server || prev.server || null };
  if (!next.apiKey) throw bad('Clé API Portainer requise');
  if (/^(github_pat_|ghp_|gho_)/.test(next.apiKey)) throw bad('Ceci est un token GitHub : colle-le dans la section GitHub. La clé Portainer commence par « ptr_ ».');
  if (!/^ptr_[A-Za-z0-9+/=_-]{10,}$/.test(next.apiKey)) throw bad('Clé API Portainer inattendue : elle commence par « ptr_ » (Portainer → My account → Access tokens).');
  secrets.set('portainer', next);
  try {
    await call('GET', `/api/endpoints/${next.endpointId}`);
  } catch (e) {
    return { ...status(), error: e.message };
  }
  return status();
}

/** Portainer gère-t-il les stacks de ce serveur ? */
export const managesServer = (sid) => {
  const c = cfg();
  return !!c && (!c.server || c.server === sid);
};

export async function upsertStack({ id, name, compose, env }) {
  const c = cfg();
  const envList = Object.entries(env || {}).map(([k, v]) => ({ name: k, value: String(v) }));
  if (id) {
    await call('PUT', `/api/stacks/${id}?endpointId=${c.endpointId}`, { stackFileContent: compose, env: envList, prune: true, pullImage: false });
    return id;
  }
  const s = await call('POST', `/api/stacks/create/standalone/string?endpointId=${c.endpointId}`, { name, stackFileContent: compose, env: envList });
  return s.Id;
}

export async function deleteStack(id) {
  const c = cfg();
  await call('DELETE', `/api/stacks/${id}?endpointId=${c.endpointId}`);
}
