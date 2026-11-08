import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Trash2, WrapText, Box, Cog, FileText, BookOpen, ArrowDownToLine } from 'lucide-react';
import { sapi, useApi, wsUrl } from '../lib/api';
import { useOS, useServer } from '../os/store';
import { SearchField, Empty } from '../os/ui';
import type { AppProps } from './registry';

type Source = { kind: 'container' | 'unit' | 'journal' | 'file'; target: string };
const MAX_LINES = 5000;
const ERR = /\b(error|err|fatal|panic|exception|critical|crit|failed|failure|denied|refused|emerg|traceback)\b/i;
const WARN = /\b(warn|warning|deprecated|timeout|retry)\b/i;

export default function Console({ win }: AppProps) {
  const sid = useServer();
  const { update } = useOS();
  const [src, setSrc] = useState<Source | null>(win.props.source || null);
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [qv, setQ] = useState('');
  const [onlyErr, setOnlyErr] = useState(false);
  const [follow, setFollow] = useState(true);
  const [status, setStatus] = useState<'idle' | 'live' | 'closed'>('idle');
  const box = useRef<HTMLDivElement>(null);
  const buffer = useRef<string[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const containers = useApi(() => sapi(sid, 'docker/containers'), [sid]);
  const services = useApi(() => sapi(sid, 'services'), [sid]);
  const logs = useApi(() => sapi(sid, 'files/list?path=/var/log/nginx').then((r) => r.items.filter((i: any) => i.type === 'file' && /\.log$/.test(i.name))).catch(() => []), [sid]);

  useEffect(() => {
    if (win.props.source) setSrc(win.props.source);
  }, [win.props.nonce, win.props.source]);

  useEffect(() => {
    if (!src) return;
    update(win.id, { title: `${src.target || 'journal'} — Console` });
    setLines([]);
    buffer.current = [];
    setStatus('live');
    const ws = new WebSocket(wsUrl('/ws/logs', { sid, kind: src.kind, target: src.target, tail: 400 }));
    let partial = '';
    ws.onmessage = (e) => {
      const chunk = partial + String(e.data);
      const parts = chunk.split('\n');
      partial = parts.pop() || '';
      buffer.current.push(...parts.map((l) => l.replace(/\x1b\[[0-9;]*m/g, '')));
    };
    ws.onclose = () => setStatus('closed');
    const flush = setInterval(() => {
      if (pausedRef.current || !buffer.current.length) return;
      const add = buffer.current;
      buffer.current = [];
      setLines((l) => {
        const next = l.concat(add);
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    }, 200);
    return () => {
      clearInterval(flush);
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src?.kind, src?.target, sid]);

  const shown = useMemo(() => {
    let l = lines;
    if (onlyErr) l = l.filter((x) => ERR.test(x));
    if (qv) {
      const needle = qv.toLowerCase();
      l = l.filter((x) => x.toLowerCase().includes(needle));
    }
    return l;
  }, [lines, qv, onlyErr]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown, follow]);

  const render = (l: string, i: number) => {
    const cls = ERR.test(l) ? 'err' : WARN.test(l) ? 'warn' : '';
    const m = l.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)\s(.*)$/);
    const ts = m ? m[1].replace(/\.\d+/, '').replace('T', ' ').replace(/Z|[+-]\d{2}:?\d{2}$/, '') : null;
    let body: React.ReactNode = m ? m[2] : l;
    if (qv && typeof body === 'string') {
      const idx = body.toLowerCase().indexOf(qv.toLowerCase());
      if (idx >= 0) body = (
        <>
          {body.slice(0, idx)}
          <mark>{body.slice(idx, idx + qv.length)}</mark>
          {body.slice(idx + qv.length)}
        </>
      );
    }
    return (
      <div key={i} className={`l ${cls}`}>
        {ts && <span className="ts">{ts} </span>}
        {body}
      </div>
    );
  };

  const isOn = (k: string, t: string) => src?.kind === k && src.target === t;
  const running = (containers.data || []).filter((c: any) => c.state === 'running');
  const stopped = (containers.data || []).filter((c: any) => c.state !== 'running');
  const activeServices = (services.data || []).filter((s: any) => s.active === 'active' || s.active === 'failed');

  return (
    <div className="app">
      <div className="sidebar" style={{ width: 220 }}>
        <div className="sb-title">Système</div>
        <button className={`sb-item ${isOn('journal', '') ? 'on' : ''}`} onClick={() => setSrc({ kind: 'journal', target: '' })}>
          <BookOpen size={14} /> Journal systemd
        </button>
        {(logs.data || []).map((f: any) => (
          <button key={f.path} className={`sb-item ${isOn('file', f.path) ? 'on' : ''}`} onClick={() => setSrc({ kind: 'file', target: f.path })}>
            <FileText size={14} /> <span className="ellipsis">nginx/{f.name}</span>
          </button>
        ))}
        {running.length > 0 && <div className="sb-title">Conteneurs actifs</div>}
        {running.map((c: any) => (
          <button key={c.name} className={`sb-item ${isOn('container', c.name) ? 'on' : ''}`} onClick={() => setSrc({ kind: 'container', target: c.name })}>
            <Box size={14} /> <span className="ellipsis">{c.name}</span>
          </button>
        ))}
        {stopped.length > 0 && <div className="sb-title">Conteneurs arrêtés</div>}
        {stopped.map((c: any) => (
          <button key={c.name} className={`sb-item ${isOn('container', c.name) ? 'on' : ''}`} onClick={() => setSrc({ kind: 'container', target: c.name })}>
            <Box size={14} style={{ color: 'var(--text-3)' }} /> <span className="ellipsis faint">{c.name}</span>
          </button>
        ))}
        {activeServices.length > 0 && <div className="sb-title">Services</div>}
        {activeServices.map((s: any) => (
          <button key={s.name} className={`sb-item ${isOn('unit', s.name) ? 'on' : ''}`} onClick={() => setSrc({ kind: 'unit', target: s.name })}>
            <Cog size={14} style={{ color: s.active === 'failed' ? 'var(--red)' : undefined }} /> <span className="ellipsis">{s.name.replace('.service', '')}</span>
          </button>
        ))}
      </div>
      <div className="app-col">
        <div className="toolbar">
          <span className={`status-dot ${status === 'live' && !paused ? 'green pulse' : status === 'closed' ? 'red' : ''}`} />
          <b className="ellipsis" style={{ maxWidth: 260 }}>{src ? src.target || 'journal systemd' : 'Choisis une source'}</b>
          <span className="faint" style={{ fontSize: 11.5 }}>{lines.length} lignes</span>
          <div className="grow" />
          <SearchField value={qv} onChange={setQ} placeholder="Filtrer" width={170} />
          <button className={`btn sm ${onlyErr ? 'danger' : 'ghost'}`} onClick={() => setOnlyErr(!onlyErr)}>
            Erreurs
          </button>
          <button className="btn ghost icon" title={paused ? 'Reprendre' : 'Pause'} onClick={() => setPaused(!paused)}>
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button className={`btn icon ${follow ? '' : 'ghost'}`} title="Suivre la fin" onClick={() => setFollow(!follow)}>
            <ArrowDownToLine size={14} />
          </button>
          <button className={`btn icon ${wrap ? '' : 'ghost'}`} title="Retour à la ligne" onClick={() => setWrap(!wrap)}>
            <WrapText size={14} />
          </button>
          <button className="btn ghost icon" title="Effacer" onClick={() => setLines([])}>
            <Trash2 size={14} />
          </button>
        </div>
        {src ? (
          <div
            className="logbox"
            ref={box}
            style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}
            onScroll={(e) => {
              const el = e.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
              if (atBottom !== follow) setFollow(atBottom);
            }}
          >
            {shown.map(render)}
          </div>
        ) : (
          <Empty title="Sélectionne une source de logs">Conteneur, service systemd ou fichier nginx</Empty>
        )}
      </div>
    </div>
  );
}
