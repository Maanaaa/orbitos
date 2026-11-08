export function bytes(n?: number | null, digits = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  if (n < 1024) return `${n} o`;
  const u = ['Ko', 'Mo', 'Go', 'To'];
  let i = -1;
  let v = n;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < u.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : digits)} ${u[i]}`;
}

export function rate(n?: number | null) {
  if (n == null) return '—';
  return `${bytes(n)}/s`;
}

export function pct(n?: number | null, digits = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(digits)} %`;
}

export function duration(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} j ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

export function ago(ts: number | string) {
  const t = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

export function dateTime(ts: number | string) {
  return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const levelColor = (p: number | null | undefined) => (p == null ? 'var(--text-3)' : p > 90 ? 'var(--red)' : p > 75 ? 'var(--orange)' : 'var(--green)');

/** Tous les mots de la recherche doivent apparaître (ordre libre). */
export function fuzzy(hay: string, needle: string) {
  if (!needle) return true;
  const h = hay.toLowerCase();
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => h.includes(w));
}

export function parentPath(p: string) {
  if (p === '/') return '/';
  const parts = p.split('/').filter(Boolean);
  parts.pop();
  return '/' + parts.join('/');
}

export function joinPath(a: string, b: string) {
  return (a.endsWith('/') ? a : a + '/') + b;
}
