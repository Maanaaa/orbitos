import { useEffect, useMemo, useState } from 'react';
import { AlertOctagon, AlertTriangle, Info, RefreshCw, ArrowUpRight, EyeOff, Sparkles, CheckCircle2 } from 'lucide-react';
import { sapi, useApi } from '../lib/api';
import { ago } from '../lib/format';
import { useOS, useServer, run, confirm } from '../os/store';
import { ErrorBox, Loading, Spinner, Segmented } from '../os/ui';
import { appById, type AppProps } from './registry';

const IGN_KEY = 'orbitos.doctor.ignored';
const loadIgnored = (): Record<string, string[]> => {
  try {
    return JSON.parse(localStorage.getItem(IGN_KEY) || '{}');
  } catch {
    return {};
  }
};

export default function Doctor(_: AppProps) {
  const sid = useServer();
  const { open, set } = useOS();
  const [force, setForce] = useState(0);
  const d = useApi(() => sapi(sid, `doctor${force ? '?force=1' : ''}`), [sid, force]);
  const [ignored, setIgnored] = useState<Record<string, string[]>>(loadIgnored);
  const [view, setView] = useState<'active' | 'ignored'>('active');

  const ign = ignored[sid] || [];
  const all = d.data?.findings || [];
  const active = all.filter((f: any) => !ign.includes(f.id));
  const shown = view === 'active' ? active : all.filter((f: any) => ign.includes(f.id));

  useEffect(() => {
    if (d.data) {
      set({
        doctor: {
          crit: active.filter((f: any) => f.severity === 'crit').length,
          warn: active.filter((f: any) => f.severity === 'warn').length,
          info: active.filter((f: any) => f.severity === 'info').length,
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.data, ignored]);

  const toggleIgnore = (id: string) => {
    const next = { ...ignored, [sid]: ign.includes(id) ? ign.filter((x) => x !== id) : [...ign, id] };
    setIgnored(next);
    try {
      localStorage.setItem(IGN_KEY, JSON.stringify(next));
    } catch {
      /* stockage indisponible */
    }
  };

  const score = useMemo(() => {
    const c = active.filter((f: any) => f.severity === 'crit').length;
    const w = active.filter((f: any) => f.severity === 'warn').length;
    const i = active.filter((f: any) => f.severity === 'info').length;
    return Math.max(0, Math.round(100 - c * 18 - w * 4 - i * 0.8));
  }, [active]);

  const groups = useMemo(() => {
    const g = new Map<string, any[]>();
    for (const f of shown) {
      if (!g.has(f.category)) g.set(f.category, []);
      g.get(f.category)!.push(f);
    }
    return [...g.entries()];
  }, [shown]);

  const fix = async (f: any) => {
    if (f.fix === 'prune-dangling') {
      if (!(await confirm({ title: 'Supprimer les images orphelines ?', message: 'docker image prune -f', confirm: 'Nettoyer', danger: true }))) return;
      await run('Images orphelines supprimées', () => sapi(sid, 'docker/images', { body: { action: 'prune-dangling' } }));
      setForce((x) => x + 1);
    }
  };

  const color = score > 85 ? 'var(--green)' : score > 60 ? 'var(--orange)' : 'var(--red)';
  const r = 52;
  const c = 2 * Math.PI * r;

  return (
    <div className="app-col">
      <div className="toolbar">
        <h2>Diagnostic</h2>
        {d.data && <span className="faint" style={{ fontSize: 12 }}>analysé {ago(d.data.at)}</span>}
        <div className="grow" />
        <Segmented value={view} onChange={setView} options={[{ value: 'active', label: `À traiter (${active.length})` }, { value: 'ignored', label: `Ignorés (${all.length - active.length})` }]} />
        <button className="btn" onClick={() => setForce((x) => x + 1)} disabled={d.loading}>
          {d.loading ? <Spinner size={12} /> : <RefreshCw size={13} />} Relancer
        </button>
      </div>
      <ErrorBox error={d.error} onRetry={() => d.reload()} />
      <div className="content">
        {!d.data && !d.error ? (
          <Loading label="Inspection du serveur : conteneurs, vhosts, certificats, pare-feu…" />
        ) : d.data ? (
          <div className="pad">
            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 16 }}>
              <div className="score">
                <svg width="120" height="120">
                  <circle cx="60" cy="60" r={r} stroke="rgba(255,255,255,.08)" strokeWidth="10" fill="none" />
                  <circle cx="60" cy="60" r={r} stroke={color} strokeWidth="10" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (score / 100) * c} style={{ transition: 'stroke-dashoffset .8s', filter: `drop-shadow(0 0 6px ${color})` }} />
                </svg>
                <div className="n">{score}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{score > 85 ? 'Serveur en bonne santé' : score > 60 ? 'Quelques points à surveiller' : 'Le serveur a besoin d’attention'}</div>
                <div className="muted" style={{ marginBottom: 12 }}>Score indicatif : chaque critique, alerte ou info réduit la note. Ignore ce qui est voulu (un port VPN public, par exemple).</div>
                <div style={{ display: 'flex', gap: 22 }}>
                  {[
                    ['crit', 'Critiques', 'var(--red)'],
                    ['warn', 'Alertes', 'var(--orange)'],
                    ['info', 'Infos', 'var(--cyan)'],
                  ].map(([k, l, col]) => {
                    const n = active.filter((f: any) => f.severity === k).length;
                    return (
                      <div key={k}>
                        <div className="metric-big" style={{ color: n ? col : 'var(--text-3)' }}>{n}</div>
                        <div className="metric-label">{l}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {d.data.errors?.length > 0 && <ErrorBox error={{ message: `Certaines vérifications ont échoué :\n${d.data.errors.join('\n')}` }} />}

            {groups.length === 0 && (
              <div className="empty">
                <CheckCircle2 size={36} color="var(--green)" />
                <div style={{ fontSize: 14, color: 'var(--text-2)' }}>{view === 'active' ? 'Rien à signaler' : 'Aucun constat ignoré'}</div>
              </div>
            )}

            {groups.map(([cat, list]) => (
              <div key={cat}>
                <div className="section-title">{cat}</div>
                <div className="group-box">
                  {list.map((f: any) => (
                    <div className="finding" key={f.id}>
                      <div className={`sev ${f.severity}`}>{f.severity === 'crit' ? <AlertOctagon size={15} /> : f.severity === 'warn' ? <AlertTriangle size={15} /> : <Info size={15} />}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 550 }}>{f.title}</div>
                        {f.detail && <div className="muted selectable" style={{ fontSize: 12, marginTop: 2 }}>{f.detail}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                        {f.fix && (
                          <button className="btn sm primary" onClick={() => fix(f)}>
                            <Sparkles size={11} /> Corriger
                          </button>
                        )}
                        {f.app && appById(f.app) && (
                          <button className="btn sm" onClick={() => open(f.app, { ...(f.target || {}) }, { singleton: appById(f.app)!.singleton, size: appById(f.app)!.size })}>
                            {appById(f.app)!.name} <ArrowUpRight size={11} />
                          </button>
                        )}
                        <button className="btn sm ghost icon" title={ign.includes(f.id) ? 'Ne plus ignorer' : 'Ignorer'} onClick={() => toggleIgnore(f.id)}>
                          <EyeOff size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
