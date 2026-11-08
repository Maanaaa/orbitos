import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bell, Check, ChevronDown, Info, Lock, Search, Server as ServerIcon, X, Box, Globe, AppWindow, Zap } from 'lucide-react';
import { useOS, toast, type Server } from './store';
import { WindowFrame } from './Window';
import { APPS, appById, AppIcon } from '../apps/registry';
import { api, sapi, useApi } from '../lib/api';
import { bytes, fuzzy, duration } from '../lib/format';
import { Menu, Ring, Kbd, type MenuEntry } from './ui';

export function Wallpaper() {
  return (
    <div className="wallpaper">
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <g className="orbit-g">
          <ellipse className="orbit-ring" cx="800" cy="500" rx="620" ry="240" transform="rotate(-18 800 500)" />
          <circle className="orbit-sat" cx="1380" cy="330" r="3.5" />
        </g>
        <g className="orbit-g slow">
          <ellipse className="orbit-ring" cx="800" cy="500" rx="430" ry="430" strokeDasharray="2 7" />
          <circle className="orbit-sat" cx="800" cy="70" r="2.5" style={{ fill: '#bf5af2', filter: 'drop-shadow(0 0 6px #bf5af2)' }} />
        </g>
        <ellipse className="orbit-ring" cx="800" cy="500" rx="860" ry="330" transform="rotate(12 800 500)" />
      </svg>
    </div>
  );
}

// ───────────────────────── Barre de menus ─────────────────────────

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useMetrics(sid: string) {
  return useApi(sid ? () => sapi(sid, 'metrics') : null, [sid], { interval: 5000 });
}

export function MenuBar({ metrics }: { metrics: any }) {
  const { servers, serverId, setServer, open, wins, focused, doctor, readonly } = useOS();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[]; key: string } | null>(null);
  const now = useClock();
  const active = wins.find((w) => w.id === focused);
  const activeApp = active ? appById(active.app) : null;
  const server = servers.find((s) => s.id === serverId);

  const show = (key: string, items: MenuEntry[]) => (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu(menu?.key === key ? null : { x: r.left, y: r.bottom + 4, items, key });
  };

  const logout = async () => {
    await api('/api/logout', { method: 'POST' });
    location.reload();
  };

  const memPct = metrics ? (metrics.mem.used / metrics.mem.total) * 100 : null;
  const total = doctor ? doctor.crit + doctor.warn : 0;

  return (
    <div className="menubar">
      <button
        className={`mb-item ${menu?.key === 'orbit' ? 'open' : ''}`}
        onClick={show('orbit', [
          { label: 'À propos d’OrbitOS', icon: <Info size={14} />, onClick: () => open('about', {}, { singleton: true, size: { w: 460, h: 400 } }) },
          'sep',
          { label: 'Rechercher…', icon: <Search size={14} />, kbd: '⌘K', onClick: () => useOS.getState().set({ spotlight: true }) },
          'sep',
          { label: 'Verrouiller la session', icon: <Lock size={14} />, onClick: logout },
        ])}
      >
        <img src="/orbit.svg" width={16} height={16} alt="" style={{ borderRadius: 4 }} />
      </button>
      <button className="mb-item mb-app">{activeApp?.name || 'OrbitOS'}</button>
      <button
        className={`mb-item ${menu?.key === 'apps' ? 'open' : ''}`}
        onClick={show('apps', [
          { header: 'Applications' },
          ...APPS.filter((a) => a.dock).map((a) => ({ label: a.name, icon: <a.icon size={14} />, onClick: () => open(a.id, {}, { singleton: a.singleton, size: a.size }) })),
        ])}
      >
        Aller
      </button>
      <button
        className={`mb-item ${menu?.key === 'win' ? 'open' : ''}`}
        onClick={show('win', [
          { header: 'Fenêtres ouvertes' },
          ...(wins.length
            ? wins.map((w) => ({ label: w.title || appById(w.app)?.name, icon: <AppWindow size={14} />, onClick: () => useOS.getState().focus(w.id) }))
            : [{ label: 'Aucune', disabled: true }]),
          'sep',
          { label: 'Tout réduire', onClick: () => wins.forEach((w) => useOS.getState().minimize(w.id)) },
          { label: 'Tout fermer', onClick: () => wins.forEach((w) => useOS.getState().close(w.id)) },
        ])}
      >
        Fenêtre
      </button>
      {readonly && <span className="badge orange" style={{ marginLeft: 6 }}>Lecture seule</span>}

      <div className="spacer" />

      {metrics && (
        <>
          <span className="mb-item mb-stat" title={`CPU ${metrics.cpu ?? '—'} % · charge ${metrics.load.join(' ')}`} onClick={() => open('monitor', {}, { singleton: true, size: appById('monitor')!.size })}>
            CPU
            <span className="mb-meter">
              <i style={{ width: `${metrics.cpu ?? 0}%`, background: (metrics.cpu ?? 0) > 85 ? 'var(--red)' : 'var(--green)' }} />
            </span>
            <b>{metrics.cpu == null ? '—' : `${Math.round(metrics.cpu)}%`}</b>
          </span>
          <span className="mb-item mb-stat" title={`${bytes(metrics.mem.used)} / ${bytes(metrics.mem.total)}`} onClick={() => open('monitor', {}, { singleton: true, size: appById('monitor')!.size })}>
            RAM
            <span className="mb-meter">
              <i style={{ width: `${memPct}%`, background: (memPct ?? 0) > 85 ? 'var(--orange)' : 'var(--cyan)' }} />
            </span>
            <b>{Math.round(memPct!)}%</b>
          </span>
        </>
      )}

      <button
        className={`mb-item ${menu?.key === 'srv' ? 'open' : ''}`}
        onClick={show('srv', [
          { header: 'Serveur actif' },
          ...servers
            .filter((s) => !s.hidden)
            .map((s) => ({
              label: (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {s.name}
                  <span className="faint mono" style={{ fontSize: 11 }}>
                    {s.user}@{s.host}
                  </span>
                </span>
              ),
              icon: s.id === serverId ? <Check size={14} /> : <span style={{ width: 14 }} />,
              onClick: () => setServer(s.id),
            })),
          'sep',
          { label: 'Gérer les serveurs…', icon: <ServerIcon size={14} />, onClick: () => open('servers', {}, { singleton: true, size: appById('servers')!.size }) },
        ])}
      >
        <span className={`status-dot ${server?.lastError ? 'red' : metrics ? 'green' : 'orange pulse'}`} />
        <span style={{ fontWeight: 500 }}>{server?.name || 'Aucun serveur'}</span>
        <ChevronDown size={12} className="faint" />
      </button>

      <button className="mb-item" onClick={() => open('doctor', {}, { singleton: true, size: appById('doctor')!.size })} title="Doctor">
        <Bell size={14} />
        {total > 0 && <span className="badge red" style={{ height: 16, padding: '0 5px', fontSize: 10 }}>{total}</span>}
      </button>
      <button className="mb-item" onClick={() => useOS.getState().set({ spotlight: true })} title="Rechercher (⌘K)">
        <Search size={14} />
      </button>
      <span className="mb-item" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {now.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}&nbsp;&nbsp;{now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
      </span>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

// ───────────────────────── Dock ─────────────────────────

export function Dock() {
  const { wins, open, focus, doctor } = useOS();
  const dockApps = APPS.filter((a) => a.dock);
  const extra = [...new Set(wins.filter((w) => !appById(w.app)?.dock).map((w) => w.app))];

  const click = (appId: string) => {
    const app = appById(appId)!;
    const mine = wins.filter((w) => w.app === appId && !w.closing);
    if (!mine.length) return open(appId, {}, { singleton: app.singleton, size: app.size });
    const top = [...mine].sort((a, b) => b.z - a.z)[0];
    const st = useOS.getState();
    if (st.focused === top.id && !top.min && mine.length === 1 && !app.singleton) return open(appId, {}, { size: app.size });
    focus(top.id);
  };

  const item = (id: string) => {
    const app = appById(id)!;
    const running = wins.some((w) => w.app === id && !w.closing);
    const badge = id === 'doctor' && doctor ? doctor.crit + doctor.warn : 0;
    return (
      <button key={id} className="dock-item" onClick={() => click(id)}>
        <AppIcon app={app} />
        <span className="tip">{app.name}</span>
        {running && <span className="dot" />}
        {badge > 0 && <span className="badge">{badge}</span>}
      </button>
    );
  };

  return (
    <div className="dock-wrap">
      <div className="dock">
        {dockApps.map((a) => item(a.id))}
        {extra.length > 0 && <div className="dock-sep" />}
        {extra.map(item)}
      </div>
    </div>
  );
}

// ───────────────────────── Widgets ─────────────────────────

export function Widgets({ metrics }: { metrics: any }) {
  const { servers, serverId, doctor, open } = useOS();
  const server = servers.find((s) => s.id === serverId);
  const now = useClock();
  const disk = metrics?.disks?.[0];
  return (
    <div className="widgets">
      <div className="widget">
        <div className="desk-clock">{now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
        <div className="muted" style={{ marginTop: 6, textTransform: 'capitalize' }}>
          {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
      </div>
      <div className="widget" onDoubleClick={() => open('monitor', {}, { singleton: true, size: appById('monitor')!.size })}>
        <h4>
          <span className={`status-dot ${metrics ? 'green' : server?.lastError ? 'red' : 'orange pulse'}`} />
          {server?.name || '—'}
          <span className="faint mono" style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
            {metrics?.info?.hostname}
          </span>
        </h4>
        <div className="rings">
          <Ring value={metrics?.cpu ?? null} label="CPU" sub={metrics ? `${metrics.info.cores} cœurs` : ''} color="var(--cyan)" />
          <Ring value={metrics ? (metrics.mem.used / metrics.mem.total) * 100 : null} label="Mémoire" sub={metrics ? bytes(metrics.mem.total, 0) : ''} color="var(--purple)" />
          <Ring value={disk ? (disk.used / disk.size) * 100 : null} label="Disque" sub={disk ? bytes(disk.size, 0) : ''} color="var(--mint)" />
        </div>
        {metrics && (
          <div className="faint mono" style={{ fontSize: 11, marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
            <span>load {metrics.load[0].toFixed(2)}</span>
            <span>swap {bytes(metrics.mem.swapUsed, 1)}</span>
            <span>up {duration(metrics.uptime)}</span>
          </div>
        )}
      </div>
      {doctor && (
        <div className="widget" onClick={() => open('doctor', {}, { singleton: true, size: appById('doctor')!.size })} style={{ cursor: 'default' }}>
          <h4>
            <Zap size={12} /> Santé
          </h4>
          <div style={{ display: 'flex', gap: 16 }}>
            {[
              ['crit', 'Critiques', 'var(--red)'],
              ['warn', 'Alertes', 'var(--orange)'],
              ['info', 'Infos', 'var(--cyan)'],
            ].map(([k, l, c]) => (
              <div key={k}>
                <div className="metric-big" style={{ color: (doctor as any)[k] ? c : 'var(--text-3)' }}>
                  {(doctor as any)[k]}
                </div>
                <div className="metric-label">{l}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Spotlight ─────────────────────────

type SpItem = { group: string; label: string; sub?: string; icon: React.ReactNode; run: () => void; keywords?: string };

export function Spotlight() {
  const { spotlight, serverId, servers, open, setServer, set } = useOS();
  const [qv, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [containers, setContainers] = useState<any[]>([]);
  const [vhosts, setVhosts] = useState<any[]>([]);

  useEffect(() => {
    if (!spotlight) return;
    setQ('');
    setIdx(0);
    setTimeout(() => inputRef.current?.focus(), 10);
    if (serverId) {
      sapi(serverId, 'docker/containers').then(setContainers, () => setContainers([]));
      sapi(serverId, 'nginx').then((d) => setVhosts(d.vhosts), () => setVhosts([]));
    }
  }, [spotlight, serverId]);

  const items = useMemo<SpItem[]>(() => {
    const close = () => set({ spotlight: false });
    const list: SpItem[] = [];
    for (const a of APPS.filter((a) => a.dock || a.id === 'about'))
      list.push({ group: 'Applications', label: a.name, sub: a.description, icon: <AppIcon app={a} size={26} />, run: () => (close(), open(a.id, {}, { singleton: a.singleton, size: a.size })) });
    for (const s of servers.filter((s) => !s.hidden))
      list.push({ group: 'Serveurs', label: s.name, sub: `${s.user}@${s.host}`, icon: <ServerIcon size={18} />, run: () => (close(), setServer(s.id), toast(`Serveur actif : ${s.name}`)) });
    for (const c of containers)
      list.push({
        group: 'Conteneurs',
        label: c.name,
        sub: `${c.state} · ${c.image}`,
        keywords: c.project || '',
        icon: <Box size={18} color={c.state === 'running' ? 'var(--green)' : 'var(--text-3)'} />,
        run: () => (close(), open('docker', { tab: 'containers', select: c.name }, { singleton: true, size: appById('docker')!.size })),
      });
    for (const c of containers.filter((c) => c.state === 'running'))
      list.push({ group: 'Actions', label: `Shell dans ${c.name}`, icon: <AppIcon app={appById('terminal')!} size={26} />, run: () => (close(), open('terminal', { newTab: { mode: 'container', target: c.name, server: serverId } }, { singleton: true, size: appById('terminal')!.size })) });
    for (const c of containers)
      list.push({ group: 'Actions', label: `Logs de ${c.name}`, icon: <AppIcon app={appById('console')!} size={26} />, run: () => (close(), open('console', { source: { kind: 'container', target: c.name } }, { size: appById('console')!.size })) });
    for (const v of vhosts.filter((v) => v.enabled))
      for (const n of v.serverNames)
        list.push({ group: 'Domaines', label: n, sub: v.kind, icon: <Globe size={18} color={v.health === 'down' ? 'var(--red)' : 'var(--mint)'} />, run: () => (close(), open('domains', { select: v.name }, { singleton: true, size: appById('domains')!.size })) });
    list.push({ group: 'Actions', label: 'Nouveau sous-domaine…', icon: <AppIcon app={appById('domains')!} size={26} />, run: () => (close(), open('domains', { wizard: Date.now() }, { singleton: true, size: appById('domains')!.size })) });
    list.push({ group: 'Actions', label: `Terminal sur ${servers.find((s) => s.id === serverId)?.name || 'le serveur'}`, icon: <AppIcon app={appById('terminal')!} size={26} />, run: () => (close(), open('terminal', { newTab: { mode: 'shell', server: serverId } }, { singleton: true, size: appById('terminal')!.size })) });
    return list;
  }, [containers, vhosts, servers, serverId, open, setServer, set]);

  const results = useMemo(() => {
    if (!qv.trim()) return items.filter((i) => i.group === 'Applications');
    const r = items.filter((i) => fuzzy(`${i.label} ${i.group === 'Applications' ? '' : i.sub || ''} ${i.keywords || ''}`, qv));
    const order = ['Applications', 'Conteneurs', 'Domaines', 'Serveurs', 'Actions'];
    return r.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group)).slice(0, 40);
  }, [items, qv]);

  useEffect(() => setIdx(0), [qv]);

  if (!spotlight) return null;
  let lastGroup = '';
  return (
    <div className="spotlight-wrap" onMouseDown={(e) => e.target === e.currentTarget && set({ spotlight: false })}>
      <div className="spotlight">
        <div className="spotlight-input">
          <Search size={22} className="faint" />
          <input
            ref={inputRef}
            value={qv}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher apps, conteneurs, domaines, actions…"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Escape') set({ spotlight: false });
              if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(results.length - 1, i + 1)));
              if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)));
              if (e.key === 'Enter') results[idx]?.run();
            }}
          />
          <Kbd keys={['esc']} />
        </div>
        {results.length > 0 && (
          <div className="spotlight-results">
            {results.map((r, i) => {
              const header = r.group !== lastGroup ? <div className="sp-group">{r.group}</div> : null;
              lastGroup = r.group;
              return (
                <div key={`${r.group}-${r.label}-${i}`}>
                  {header}
                  <div className={`sp-item ${i === idx ? 'on' : ''}`} onMouseMove={() => setIdx(i)} onClick={r.run} ref={(el) => { if (i === idx) el?.scrollIntoView({ block: "nearest" }); }}>
                    <div className="sp-ic" style={{ display: 'grid', placeItems: 'center' }}>
                      {r.icon}
                    </div>
                    <span className="ellipsis">{r.label}</span>
                    {r.sub && <small className="ellipsis" style={{ maxWidth: '50%' }}>{r.sub}</small>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Dialogues & toasts ─────────────────────────

export function Dialogs() {
  const dialogs = useOS((s) => s.dialogs);
  const d = dialogs[0];
  const [val, setVal] = useState('');
  useEffect(() => {
    if (d?.type === 'prompt') setVal(d.value || '');
  }, [d]);
  if (!d) return null;
  const cancel = () => (d.type === 'confirm' ? d.resolve(false) : d.resolve(null));
  const ok = () => (d.type === 'confirm' ? d.resolve(true) : d.resolve(val));
  return (
    <div className="sheet-backdrop global" onMouseDown={(e) => e.target === e.currentTarget && cancel()} onKeyDown={(e) => e.key === 'Escape' && cancel()}>
      <div className="sheet" style={{ width: 380 }}>
        <div className="sheet-body" style={{ textAlign: 'center', paddingTop: 22 }}>
          <div className="alert-icon" style={{ background: d.type === 'confirm' && d.danger ? 'rgba(255,69,58,.16)' : 'rgba(10,132,255,.16)' }}>
            {d.type === 'confirm' && d.danger ? <AlertTriangle size={26} color="var(--red)" /> : <Info size={26} color="var(--blue)" />}
          </div>
          <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>{d.title}</h3>
          {d.message && <div className="muted" style={{ fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{d.message}</div>}
          {d.type === 'prompt' && (
            <input
              className="input"
              autoFocus
              style={{ width: '100%', marginTop: 12 }}
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') ok();
                if (e.key === 'Escape') cancel();
              }}
              placeholder={d.label}
              spellCheck={false}
            />
          )}
        </div>
        <div className="sheet-foot" style={{ justifyContent: 'stretch' }}>
          <button className="btn" style={{ flex: 1 }} onClick={cancel}>
            Annuler
          </button>
          <button className={`btn ${d.type === 'confirm' && d.danger ? 'danger solid' : 'primary'}`} style={{ flex: 1 }} onClick={ok} autoFocus={d.type === 'confirm'}>
            {d.confirm || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useOS((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const c = { ok: 'var(--green)', error: 'var(--red)', info: 'var(--blue)', warn: 'var(--orange)' }[t.kind];
        const Icon = { ok: Check, error: X, info: Info, warn: AlertTriangle }[t.kind];
        return (
          <div className="toast" key={t.id}>
            <div className="t-icon" style={{ background: c }}>
              <Icon size={15} color="white" strokeWidth={2.6} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <b>{t.title}</b>
              {t.message && <div className="muted selectable" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 160, overflow: 'auto' }}>{t.message}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────── Bureau ─────────────────────────

export function Desktop() {
  const { wins, serverId, set } = useOS();
  const { data: metrics, error } = useMetrics(serverId);

  // Liste des serveurs (statut de connexion) toutes les 30 s
  useEffect(() => {
    const load = () => api<Server[]>('/api/servers').then((s) => useOS.getState().setServers(s)).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (error) useOS.setState((s) => ({ servers: s.servers.map((x) => (x.id === serverId ? { ...x, lastError: error.message } : x)) }));
  }, [error, serverId]);

  // Doctor en tâche de fond : badge du dock et widget santé
  useEffect(() => {
    if (!serverId) return;
    let alive = true;
    const load = () => sapi(serverId, 'doctor').then((d) => alive && set({ doctor: d.summary })).catch(() => {});
    const t0 = setTimeout(load, 2500);
    const t = setInterval(load, 5 * 60000);
    return () => {
      alive = false;
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [serverId, set]);

  // ⌘K / Ctrl+K
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        set({ spotlight: !useOS.getState().spotlight });
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [set]);

  return (
    <>
      <Wallpaper />
      <MenuBar metrics={metrics} />
      <Widgets metrics={metrics} />
      {wins.map((w) => (
        <WindowFrame key={w.id} win={w} />
      ))}
      <Dock />
      <Spotlight />
      <Dialogs />
      <Toasts />
    </>
  );
}
