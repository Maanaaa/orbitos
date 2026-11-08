import { useEffect, useRef, useState } from 'react';
import { Plus, X, Box, Server } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { wsUrl, sapi } from '../lib/api';
import { useOS } from '../os/store';
import { useMenu } from '../os/ui';
import type { AppProps } from './registry';

type Tab = { id: string; server: string; mode: 'shell' | 'container'; target?: string; cwd?: string; title: string; dead?: boolean };
let n = 0;

const THEME = {
  background: '#0d0f15',
  foreground: '#e6e9f2',
  cursor: '#64d2ff',
  cursorAccent: '#0d0f15',
  selectionBackground: 'rgba(10,132,255,.4)',
  black: '#1c1f27',
  red: '#ff6b61',
  green: '#4ade80',
  yellow: '#ffd60a',
  blue: '#5eb0ff',
  magenta: '#d08bf7',
  cyan: '#64d2ff',
  white: '#e6e9f2',
  brightBlack: '#5c6370',
  brightRed: '#ff8a80',
  brightGreen: '#86efac',
  brightYellow: '#ffe566',
  brightBlue: '#8cc8ff',
  brightMagenta: '#e2b4fa',
  brightCyan: '#a5e8ff',
  brightWhite: '#ffffff',
};

function Session({ tab, active, onExit }: { tab: Tab; active: boolean; onExit: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const term = new XTerm({
      fontFamily: '"SF Mono", ui-monospace, "JetBrains Mono", Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      theme: THEME,
      scrollback: 8000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    termRef.current = term;
    fitRef.current = fit;
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* fenêtre cachée */
      }
    });

    const ws = new WebSocket(
      wsUrl('/ws/terminal', { sid: tab.server, mode: tab.mode, target: tab.target || '', cols: term.cols || 120, rows: term.rows || 32 }),
    );
    ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : '');
    ws.onclose = () => {
      term.write('\r\n\x1b[90m— session terminée —\x1b[0m\r\n');
      onExit();
    };
    const d1 = term.onData((data) => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'data', data })));
    const d2 = term.onResize(({ cols, rows }) => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'resize', cols, rows })));
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      if (tab.cwd) {
        const dir = `'${tab.cwd.replace(/'/g, `'\\''`)}'`;
        setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'data', data: ` cd ${dir} && clear\r` })), 400);
      }
    };

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    });
    ro.observe(host.current!);
    return () => {
      ro.disconnect();
      d1.dispose();
      d2.dispose();
      ws.close();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit();
        } catch {
          /* ignore */
        }
        termRef.current?.focus();
      });
    }
  }, [active]);

  return <div className="term-host" ref={host} style={{ display: active ? 'block' : 'none' }} />;
}

export default function Terminal({ win }: AppProps) {
  const servers = useOS((s) => s.servers);
  const serverId = useOS((s) => s.serverId);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState('');
  const menu = useMenu();
  const handled = useRef<number | null>(null);

  const add = (t: Omit<Tab, 'id' | 'title'>) => {
    const sname = servers.find((s) => s.id === t.server)?.name || t.server;
    const tab: Tab = { ...t, id: `t${++n}`, title: t.mode === 'container' ? `${t.target} · ${sname}` : t.cwd ? `${sname}:${t.cwd.split('/').pop() || '/'}` : sname };
    setTabs((x) => [...x, tab]);
    setActive(tab.id);
  };

  useEffect(() => {
    const req = win.props.newTab;
    const nonce = win.props.nonce || 0;
    if (req && handled.current !== nonce) {
      handled.current = nonce;
      add({ server: req.server || serverId, mode: req.mode || 'shell', target: req.target, cwd: req.cwd });
    } else if (!req && tabs.length === 0 && serverId && handled.current === null) {
      handled.current = 0;
      add({ server: serverId, mode: 'shell' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.props.nonce, serverId]);

  const closeTab = (id: string) => {
    setTabs((x) => {
      const rest = x.filter((t) => t.id !== id);
      if (active === id) setActive(rest.at(-1)?.id || '');
      return rest;
    });
  };

  const newMenu = async (el: HTMLElement) => {
    let containers: any[] = [];
    try {
      containers = (await sapi(serverId, 'docker/containers')).filter((c: any) => c.state === 'running');
    } catch {
      /* docker indisponible */
    }
    menu.openBelow(el, [
      { header: 'Shell SSH' },
      ...servers
        .filter((s) => !s.hidden)
        .map((s) => ({ label: s.name, icon: <Server size={14} />, onClick: () => add({ server: s.id, mode: 'shell' }) })),
      ...(containers.length ? (['sep', { header: `Conteneurs (${servers.find((s) => s.id === serverId)?.name})` }] as const) : []),
      ...containers.slice(0, 40).map((c: any) => ({ label: c.name, icon: <Box size={14} />, onClick: () => add({ server: serverId, mode: 'container', target: c.name }) })),
    ]);
  };

  return (
    <div className="app-col" style={{ background: '#0d0f15' }}>
      <div className="term-tabs">
        {tabs.map((t) => (
          <div key={t.id} className={`term-tab ${t.id === active ? 'on' : ''}`} onClick={() => setActive(t.id)}>
            {t.mode === 'container' ? <Box size={12} color="var(--cyan)" /> : <Server size={12} color="var(--green)" />}
            <span className="ellipsis" style={{ opacity: t.dead ? 0.5 : 1 }}>{t.title}</span>
            <button
              className="x"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <button className="btn ghost sm icon" style={{ alignSelf: 'center', marginLeft: 4, flex: 'none', minWidth: 24 }} onClick={(e) => newMenu(e.currentTarget)} title="Nouvel onglet">
          <Plus size={14} />
        </button>
      </div>
      {tabs.map((t) => (
        <Session key={t.id} tab={t} active={t.id === active} onExit={() => setTabs((x) => x.map((y) => (y.id === t.id ? { ...y, dead: true } : y)))} />
      ))}
      {!tabs.length && (
        <div className="empty">
          <div>Aucune session</div>
          <button className="btn primary" onClick={() => add({ server: serverId, mode: 'shell' })}>
            Ouvrir un shell
          </button>
        </div>
      )}
      {menu.node}
    </div>
  );
}
