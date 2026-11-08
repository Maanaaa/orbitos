import { useMemo, useState } from 'react';
import { Play, Square, RotateCw, ScrollText, Clock, CalendarClock } from 'lucide-react';
import { sapi, useApi } from '../lib/api';
import { useOS, useServer, confirm, run } from '../os/store';
import { ErrorBox, Loading, SearchField, Segmented } from '../os/ui';
import { appById, type AppProps } from './registry';

export default function Services(_: AppProps) {
  const sid = useServer();
  const [tab, setTab] = useState<'services' | 'timers' | 'cron'>('services');
  return (
    <div className="app-col">
      <div className="toolbar">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'services', label: 'Services' },
            { value: 'timers', label: <><Clock size={12} /> Timers</> },
            { value: 'cron', label: <><CalendarClock size={12} /> Cron</> },
          ]}
        />
      </div>
      {tab === 'services' && <ServiceList sid={sid} />}
      {tab === 'timers' && <Timers sid={sid} />}
      {tab === 'cron' && <Cron sid={sid} />}
    </div>
  );
}

function ServiceList({ sid }: { sid: string }) {
  const s = useApi(() => sapi(sid, 'services'), [sid], { interval: 15000 });
  const { open } = useOS();
  const [qv, setQ] = useState('');
  const [filter, setFilter] = useState<'running' | 'failed' | 'all'>('running');
  const rows = useMemo(() => {
    let r = s.data || [];
    if (filter === 'running') r = r.filter((x: any) => x.sub === 'running');
    if (filter === 'failed') r = r.filter((x: any) => x.active === 'failed');
    if (qv) r = r.filter((x: any) => `${x.name} ${x.description}`.toLowerCase().includes(qv.toLowerCase()));
    return r;
  }, [s.data, filter, qv]);

  const act = async (name: string, action: string) => {
    const label = { start: 'Démarrer', stop: 'Arrêter', restart: 'Redémarrer' }[action]!;
    if (action !== 'start' && !(await confirm({ title: `${label} ${name} ?`, message: /^(ssh|docker|containerd|networking|systemd-)/.test(name) ? '⚠︎ Service système critique : tu peux perdre l’accès au serveur.' : undefined, confirm: label, danger: true }))) return;
    await run(`${label} ${name}`, () => sapi(sid, `services/${encodeURIComponent(name)}/${action}`, { method: 'POST' }));
    s.reload(true);
  };

  const failed = (s.data || []).filter((x: any) => x.active === 'failed').length;
  return (
    <>
      <div className="toolbar">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'running', label: 'En cours' },
            { value: 'failed', label: <>En échec {failed > 0 && <span className="badge red" style={{ height: 15, padding: '0 5px' }}>{failed}</span>}</> },
            { value: 'all', label: 'Tous' },
          ]}
        />
        <div className="grow" />
        <SearchField value={qv} onChange={setQ} />
      </div>
      <ErrorBox error={s.error} />
      <div className="content">
        {!s.data && !s.error ? (
          <Loading />
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>Service</th>
                <th>État</th>
                <th>Description</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((x: any) => (
                <tr key={x.name}>
                  <td style={{ fontWeight: 550 }}>{x.name.replace(/\.service$/, '')}</td>
                  <td>
                    <span className={`badge ${x.active === 'active' ? (x.sub === 'running' ? 'green' : 'blue') : x.active === 'failed' ? 'red' : ''}`}>{x.sub}</span>
                  </td>
                  <td className="muted ellipsis" style={{ maxWidth: 380 }}>{x.description}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn sm ghost icon" title="Logs" onClick={() => open('console', { source: { kind: 'unit', target: x.name } }, { size: appById('console')!.size })}>
                        <ScrollText size={12} />
                      </button>
                      {x.active === 'active' ? (
                        <>
                          <button className="btn sm ghost icon" title="Redémarrer" onClick={() => act(x.name, 'restart')}>
                            <RotateCw size={12} />
                          </button>
                          <button className="btn sm ghost icon" title="Arrêter" onClick={() => act(x.name, 'stop')}>
                            <Square size={11} />
                          </button>
                        </>
                      ) : (
                        <button className="btn sm ghost icon" title="Démarrer" onClick={() => act(x.name, 'start')}>
                          <Play size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Timers({ sid }: { sid: string }) {
  const t = useApi(() => sapi(sid, 'timers'), [sid]);
  return (
    <div className="content">
      <ErrorBox error={t.error} />
      {!t.data && !t.error ? (
        <Loading />
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>Timer</th>
              <th>Déclenche</th>
              <th>Prochaine exécution</th>
            </tr>
          </thead>
          <tbody>
            {(t.data || []).map((x: any) => (
              <tr key={x.unit}>
                <td style={{ fontWeight: 550 }}>{x.unit}</td>
                <td className="mono muted" style={{ fontSize: 11.5 }}>{x.activates}</td>
                <td className="muted">{x.next || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function humanCron(expr: string) {
  const [m, h, dom, mon, dow] = expr.split(/\s+/);
  if (expr.startsWith('@')) return expr;
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === '*' && mon === '*' && dow === '*') return `tous les jours à ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === '*' && mon === '*' && /^\d$/.test(dow)) return `chaque ${['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][Number(dow) % 7]} à ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && /^\d+$/.test(dom) && mon === '*') return `le ${dom} du mois à ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  if (m.startsWith('*/') && h === '*') return `toutes les ${m.slice(2)} min`;
  if (m === '*' && h === '*') return 'chaque minute';
  if (/^\d+$/.test(m) && h === '*') return `chaque heure à :${m.padStart(2, '0')}`;
  return '';
}

function Cron({ sid }: { sid: string }) {
  const c = useApi(() => sapi(sid, 'cron'), [sid]);
  return (
    <div className="content pad">
      <ErrorBox error={c.error} />
      {!c.data && !c.error && <Loading />}
      {(c.data || [])
        .filter((b: any) => b.entries.length)
        .map((b: any) => (
          <div key={b.source}>
            <div className="section-title mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{b.source}</div>
            <div className="group-box">
              {b.entries.map((e: string, i: number) => {
                const isVar = /^[A-Z_]+=/.test(e);
                const parts = e.trim().split(/\s+/);
                const expr = parts[0].startsWith('@') ? parts[0] : parts.slice(0, 5).join(' ');
                const rest = parts[0].startsWith('@') ? parts.slice(1).join(' ') : parts.slice(5).join(' ');
                return (
                  <div className="gb-row" key={i}>
                    {isVar ? (
                      <span className="mono faint" style={{ fontSize: 11.5 }}>{e}</span>
                    ) : (
                      <>
                        <span className="mono" style={{ fontSize: 11.5, color: 'var(--cyan)', flex: 'none', width: 120 }}>{expr}</span>
                        <span className="label">
                          <span className="mono selectable" style={{ fontSize: 11.5 }}>{rest}</span>
                          <small>{humanCron(expr)}</small>
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}
