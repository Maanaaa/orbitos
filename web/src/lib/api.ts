import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  status: number;
  details?: any;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = any>(path: string, opts: { method?: string; body?: any; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const method = opts.method || (opts.body !== undefined || opts.raw ? 'POST' : 'GET');
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (method !== 'GET') headers['X-Orbit'] = '1';
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (res.status === 401 && !path.endsWith('/login')) onUnauthorized();
    throw new ApiError(res.status, data?.error || `Erreur ${res.status}`, data?.details);
  }
  return data as T;
}

/** API scoped sur un serveur */
export const sapi = <T = any>(sid: string, path: string, opts?: Parameters<typeof api>[1]) => api<T>(`/api/s/${encodeURIComponent(sid)}/${path}`, opts);

/** Hook de chargement avec rafraîchissement optionnel. */
export function useApi<T>(fn: (() => Promise<T>) | null, deps: any[], { interval }: { interval?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async (quiet = false) => {
    const f = fnRef.current;
    if (!f) return;
    const my = ++seq.current;
    if (!quiet) setLoading(true);
    try {
      const d = await f();
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e: any) {
      if (my === seq.current) setError(e);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
    load();
    if (!interval) return;
    const t = setInterval(() => document.visibilityState === 'visible' && load(true), interval);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload: load, setData };
}

export function wsUrl(path: string, params: Record<string, string | number>) {
  const u = new URL(path, location.href);
  u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}
