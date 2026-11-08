import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Search, X, Inbox } from 'lucide-react';

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button className={`switch ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} role="switch" aria-checked={on} />;
}

export const Spinner = ({ size = 16 }: { size?: number }) => <div className="spinner" style={{ width: size, height: size }} />;

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon || <Inbox size={34} strokeWidth={1.4} />}
      <div style={{ fontSize: 14, color: 'var(--text-2)', fontWeight: 500 }}>{title}</div>
      {children}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: any; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="error-box">
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <AlertTriangle size={15} style={{ flex: 'none', marginTop: 1 }} />
        <div style={{ flex: 1 }}>
          {error.message || String(error)}
          {error.details?.output && <pre className="code" style={{ marginTop: 8 }}>{error.details.output}</pre>}
        </div>
        {onRetry && (
          <button className="btn sm" onClick={onRetry}>
            Réessayer
          </button>
        )}
      </div>
    </div>
  );
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="empty">
      <Spinner size={22} />
      <div>{label}</div>
    </div>
  );
}

export function SearchField({ value, onChange, placeholder = 'Rechercher', width }: { value: string; onChange: (v: string) => void; placeholder?: string; width?: number }) {
  return (
    <label className="search">
      <Search size={13} />
      <input className="input" style={width ? { width } : undefined} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
    </label>
  );
}

/** Feuille modale attachée à la fenêtre (comme les sheets macOS). */
export function Sheet({ title, subtitle, children, footer, onClose, wide, global }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean; global?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const el = (
    <div className={`sheet-backdrop ${global ? 'global' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${wide ? 'wide' : ''}`}>
        <div className="sheet-head" style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="btn ghost sm icon" onClick={onClose} aria-label="Fermer">
            <X size={14} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
  return global ? createPortal(el, document.body) : el;
}

export type MenuEntry = { label: ReactNode; icon?: ReactNode; onClick?: () => void; danger?: boolean; kbd?: string; disabled?: boolean } | 'sep' | { header: string };

/** Menu contextuel/déroulant positionné en coordonnées écran. */
export function Menu({ x, y, items, onClose, minWidth }: { x: number; y: number; items: MenuEntry[]; onClose: () => void; minWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    setTimeout(() => window.addEventListener('mousedown', down), 0);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return createPortal(
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y, minWidth }}>
      {items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="menu-sep" />
        ) : 'header' in it ? (
          <div key={i} className="menu-label">
            {it.header}
          </div>
        ) : (
          <div
            key={i}
            className={`menu-item ${it.danger ? 'danger' : ''}`}
            style={it.disabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            {it.icon}
            <span>{it.label}</span>
            {it.kbd && <span className="kbd">{it.kbd}</span>}
          </div>
        ),
      )}
    </div>,
    document.body,
  );
}

export function useMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const node = menu ? <Menu {...menu} onClose={() => setMenu(null)} /> : null;
  const openAt = (e: React.MouseEvent, items: MenuEntry[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const openBelow = (el: HTMLElement, items: MenuEntry[]) => {
    const r = el.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, items });
  };
  return { node, openAt, openBelow };
}

/** Courbe temps réel en SVG. */
export function Sparkline({ values, max, color = 'var(--cyan)', height = 60, fill = true }: { values: (number | null)[]; max?: number; color?: string; height?: number; fill?: boolean }) {
  const w = 300;
  const pts = values.map((v) => v ?? 0);
  const m = max ?? Math.max(1, ...pts);
  const n = Math.max(2, pts.length);
  const coords = pts.map((v, i) => [(i / (n - 1)) * w, height - (Math.min(v, m) / m) * (height - 4) - 2]);
  const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const area = coords.length ? `${line} L${coords.at(-1)![0]},${height} L${coords[0][0]},${height} Z` : '';
  const gid = useMemo(() => `g${Math.random().toString(36).slice(2)}`, []);
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.9" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={w} y1={height * f} y2={height * f} stroke="rgba(255,255,255,0.05)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      {fill && coords.length > 1 && <path className="area" d={area} fill={`url(#${gid})`} />}
      {coords.length > 1 && <path className="line" d={line} stroke={color} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

export function Ring({ value, size = 64, stroke = 7, color, label, sub }: { value: number | null; size?: number; stroke?: number; color?: string; label?: string; sub?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value ?? 0));
  const col = color || (v > 90 ? 'var(--red)' : v > 75 ? 'var(--orange)' : 'var(--green)');
  return (
    <div className="ring">
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.09)" strokeWidth={stroke} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={col}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c - (v / 100) * c}
            style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.3,.7,.4,1)', filter: `drop-shadow(0 0 4px ${col})` }}
          />
        </svg>
        <div className="val" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          {value == null ? '—' : `${Math.round(v)}%`}
        </div>
      </div>
      {label && <span>{label}</span>}
      {sub && <span className="faint mono" style={{ fontSize: 10 }}>{sub}</span>}
    </div>
  );
}

/** Tri de tableau simple. */
export function useSort<T>(rows: T[] | null | undefined, initial: { key: keyof T | string; dir: 1 | -1 }) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => {
    if (!rows) return [];
    const k = sort.key as keyof T;
    return [...rows].sort((a: any, b: any) => {
      const x = a[k];
      const y = b[k];
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir;
      return String(x ?? '').localeCompare(String(y ?? ''), 'fr', { numeric: true }) * sort.dir;
    });
  }, [rows, sort]);
  const th = (key: keyof T | string, label: ReactNode, cls = '') => (
    <th className={`sortable ${cls}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
      {label}
      {sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  );
  return { sorted, th };
}

export function StateBadge({ state, health }: { state: string; health?: string | null }) {
  if (state === 'running') {
    if (health === 'unhealthy') return <span className="badge red">unhealthy</span>;
    if (health === 'starting') return <span className="badge orange">démarrage</span>;
    return <span className="badge green">{health === 'healthy' ? 'healthy' : 'actif'}</span>;
  }
  if (state === 'exited') return <span className="badge">arrêté</span>;
  if (state === 'created') return <span className="badge orange">créé</span>;
  if (state === 'restarting') return <span className="badge red">redémarre</span>;
  if (state === 'paused') return <span className="badge blue">en pause</span>;
  return <span className="badge">{state}</span>;
}

export function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="kbd-hint">
      {keys.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
    </span>
  );
}
