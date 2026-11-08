import { Suspense, useRef, useState, type ReactNode } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { useOS, type Win } from './store';
import { appById } from '../apps/registry';
import { Loading } from './ui';

const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;

export function WindowFrame({ win }: { win: Win }) {
  const { focus, close, minimize, toggleMax, update, focused } = useOS();
  const app = appById(win.app)!;
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ mx: number; my: number; x: number; y: number; w: number; h: number } | null>(null);

  const onDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, .tb-right')) return;
    focus(win.id);
    if (win.max) return;
    start.current = { mx: e.clientX, my: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const s = start.current!;
      const x = Math.min(Math.max(s.x + ev.clientX - s.mx, -win.w + 120), window.innerWidth - 120);
      const y = Math.min(Math.max(s.y + ev.clientY - s.my, 30), window.innerHeight - 60);
      update(win.id, { x, y });
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onResize = (dir: (typeof DIRS)[number]) => (e: React.PointerEvent) => {
    e.stopPropagation();
    focus(win.id);
    if (win.max) return;
    start.current = { mx: e.clientX, my: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const s = start.current!;
      const dx = ev.clientX - s.mx;
      const dy = ev.clientY - s.my;
      let { x, y, w, h } = s;
      if (dir.includes('e')) w = Math.max(380, s.w + dx);
      if (dir.includes('s')) h = Math.max(240, s.h + dy);
      if (dir.includes('w')) {
        w = Math.max(380, s.w - dx);
        x = s.x + (s.w - w);
      }
      if (dir.includes('n')) {
        h = Math.max(240, s.h - dy);
        y = Math.max(30, s.y + (s.h - h));
        if (y === 30) h = s.y + s.h - 30;
      }
      update(win.id, { x, y, w, h });
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const Comp = app.component;
  const style: React.CSSProperties = win.max
    ? { left: 0, top: 30, width: '100vw', height: 'calc(100vh - 30px - 78px)', zIndex: win.z }
    : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z };

  return (
    <div
      className={`window ${focused === win.id ? '' : 'inactive'} ${win.max ? 'max' : ''} ${win.closing ? 'closing' : ''}`}
      style={{ ...style, display: win.min ? 'none' : undefined }}
      onPointerDownCapture={() => focus(win.id)}
    >
      <div className="titlebar" onPointerDown={onDrag} onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && toggleMax(win.id)}>
        <div className="traffic">
          <button className="close" onClick={() => close(win.id)} aria-label="Fermer">
            <X size={8} strokeWidth={3.5} />
          </button>
          <button className="min" onClick={() => minimize(win.id)} aria-label="Réduire">
            <Minus size={8} strokeWidth={3.5} />
          </button>
          <button className="max" onClick={() => toggleMax(win.id)} aria-label="Agrandir">
            <Plus size={8} strokeWidth={3.5} />
          </button>
        </div>
        <div className="title">
          {win.title || app.name}
        </div>
        <div className="tb-right" id={`tb-${win.id}`} />
      </div>
      <div className="win-body">
        <Suspense fallback={<Loading />}>
          <Comp win={win} />
        </Suspense>
      </div>
      {!win.max && DIRS.map((d) => <div key={d} className={`resize ${d}`} onPointerDown={onResize(d)} />)}
      {dragging && <div className="drag-shield" />}
    </div>
  );
}

export function TitleSlot({ children }: { win: Win; children: ReactNode }) {
  return <>{children}</>;
}
