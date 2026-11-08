import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Rocket,
  Plus,
  FolderGit2 as Github,
  Box,
  FolderTree,
  ExternalLink,
  RotateCcw,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings2,
  Lock,
  Search,
  GitBranch,
  GitCommit,
  KeyRound,
  EyeOff,
  Plug,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { api, sapi, useApi } from '../lib/api';
import { ago } from '../lib/format';
import { useOS, confirm, run, toast } from '../os/store';
import { ErrorBox, Loading, Sheet, Spinner, Switch, Empty, Segmented } from '../os/ui';
import type { AppProps } from './registry';

type Site = any;

const statusDot = (st?: string) => (st === 'success' ? 'green' : st === 'failed' ? 'red' : st === 'running' ? 'orange pulse' : '');

export default function Sites({ switcher }: AppProps & { switcher?: ReactNode }) {
  const sites = useApi(() => api<Site[]>('/api/sites'), [], { interval: 5000 });
  const integ = useApi(() => api('/api/integrations'), []);
  const [sel, setSel] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [settings, setSettings] = useState(false);
  const selected = (sites.data || []).find((s: Site) => s.id === sel);

  const deploy = async (s: Site) => {
    try {
      await api(`/api/sites/${s.id}/deploy`, { method: 'POST' });
      toast(`Déploiement de ${s.domain} lancé`, 'info');
      setSel(s.id);
      sites.reload(true);
    } catch (e: any) {
      toast('Déploiement impossible', 'error', e.message);
    }
  };

  const gh = integ.data?.github;
  return (
    <div className="app-col">
      <div className="toolbar">
        {switcher || <h2>Sites</h2>}
        <span className="faint" style={{ fontSize: 12 }}>Héberge un dépôt GitHub en quelques clics</span>
        <div className="grow" />
        {integ.data && (
          <button className="btn ghost" onClick={() => setSettings(true)} title="Intégrations">
            <Github size={14} />
            {gh?.login ? <span className="muted">{gh.login}</span> : <span className="faint">non connecté</span>}
            <span className={`status-dot ${gh?.login ? 'green' : gh?.error ? 'red' : ''}`} style={{ width: 6, height: 6 }} />
            <Plug size={13} style={{ marginLeft: 4 }} />
            <span className={`status-dot ${integ.data.portainer?.configured && !integ.data.portainer?.error ? 'green' : ''}`} style={{ width: 6, height: 6 }} />
          </button>
        )}
        <button className="btn primary" onClick={() => setWizard(true)}>
          <Plus size={14} /> Nouveau site
        </button>
      </div>
      <ErrorBox error={sites.error} />
      <div className="split">
        <div className="content pad">
          {!sites.data && !sites.error ? (
            <Loading />
          ) : sites.data!.length === 0 ? (
            <Empty icon={<Rocket size={38} strokeWidth={1.3} />} title="Aucun site pour l’instant">
              <div style={{ maxWidth: 360 }}>Choisis un dépôt GitHub : OrbitOS le construit, crée le vhost et le certificat, puis le met en ligne.</div>
              <button className="btn primary" style={{ marginTop: 8 }} onClick={() => setWizard(true)}>
                <Plus size={13} /> Nouveau site
              </button>
            </Empty>
          ) : (
            <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))' }}>
              {sites.data!.map((s: Site) => {
                const last = s.releases[0];
                const cur = s.releases.find((r: any) => r.id === s.current);
                return (
                  <div key={s.id} className="card" onClick={() => setSel(s.id)} style={{ display: 'flex', flexDirection: 'column', gap: 8, cursor: 'default', boxShadow: sel === s.id ? '0 0 0 1.5px var(--accent) inset' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`status-dot ${s.deploying ? 'orange pulse' : statusDot(cur ? 'success' : last?.status)}`} />
                      <b className="ellipsis" style={{ flex: 1, fontSize: 13.5 }}>{s.domain}</b>
                      <span className={`badge ${s.type === 'docker' ? 'blue' : 'purple'}`}>{s.type === 'docker' ? <><Box size={10} /> Docker</> : <><FolderTree size={10} /> Statique</>}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Github size={12} /> <span className="ellipsis">{s.repo}</span>
                      <GitBranch size={11} style={{ marginLeft: 4 }} /> {s.branch}
                    </div>
                    {last ? (
                      <div className="faint ellipsis" style={{ fontSize: 11.5 }} title={last.message}>
                        <GitCommit size={11} style={{ verticalAlign: -2 }} /> <span className="mono">{last.sha.slice(0, 7)}</span> {last.message} · {ago(last.at)}
                      </div>
                    ) : (
                      <div className="faint" style={{ fontSize: 11.5 }}>Jamais déployé</div>
                    )}
                    <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn sm primary" disabled={s.deploying} onClick={() => deploy(s)}>
                        {s.deploying ? <Spinner size={11} /> : <Rocket size={11} />} {s.deploying ? 'En cours…' : 'Déployer'}
                      </button>
                      {s.current && (
                        <a className="btn sm" href={`${s.ssl ? 'https' : 'http'}://${s.domain}`} target="_blank" rel="noreferrer noopener" style={{ textDecoration: 'none' }}>
                          <ExternalLink size={11} /> Ouvrir
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {selected && <SiteDetail key={selected.id} site={selected} onClose={() => setSel(null)} onDeploy={() => deploy(selected)} reload={() => sites.reload(true)} />}
      </div>
      {wizard && (
        <Wizard
          integ={integ.data}
          onIntegrations={() => setSettings(true)}
          onClose={() => setWizard(false)}
          onCreated={async (s: Site) => {
            setWizard(false);
            await sites.reload(true);
            deploy(s);
          }}
        />
      )}
      {settings && <Integrations onClose={() => (setSettings(false), integ.reload(true))} />}
    </div>
  );
}

// ───────────────────────── Détail ─────────────────────────

function SiteDetail({ site, onClose, onDeploy, reload }: { site: Site; onClose: () => void; onDeploy: () => void; reload: () => void }) {
  const [tab, setTab] = useState<'deploys' | 'settings'>('deploys');
  const [rel, setRel] = useState<string | null>(site.releases[0]?.id || null);
  useEffect(() => {
    if (site.releases[0] && (site.deploying || !rel)) setRel(site.releases[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.releases[0]?.id]);

  const rollback = async (r: any) => {
    if (!(await confirm({ title: `Revenir à ${r.sha.slice(0, 7)} ?`, message: `« ${r.message} »\nLa version en ligne est remplacée immédiatement.`, confirm: 'Revenir' }))) return;
    await run('Retour arrière effectué', () => api(`/api/sites/${site.id}/rollback`, { body: { rel: r.id } }));
    reload();
  };
  const remove = async () => {
    if (!(await confirm({ title: `Supprimer ${site.domain} ?`, message: 'Le vhost est retiré (corbeille), la stack/le conteneur supprimé, les fichiers déplacés dans la corbeille serveur. Le certificat est conservé.', confirm: 'Supprimer', danger: true }))) return;
    const r: any = await run('Site supprimé', () => api(`/api/sites/${site.id}`, { method: 'DELETE' }));
    if (r) {
      toast('Nettoyage', 'info', r.steps.join('\n'));
      onClose();
      reload();
    }
  };

  return (
    <div className="detail" style={{ width: 520, display: 'flex', flexDirection: 'column' }}>
      <div className="toolbar" style={{ background: 'rgba(24,26,34,.96)' }}>
        <Rocket size={16} color="var(--orange)" />
        <b className="ellipsis" style={{ flex: 1 }}>{site.domain}</b>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'deploys', label: 'Déploiements' }, { value: 'settings', label: <Settings2 size={12} /> }]} />
        <button className="btn ghost sm" onClick={onClose}>
          Fermer
        </button>
      </div>
      {tab === 'deploys' ? (
        <>
          <div className="pad" style={{ paddingBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <button className="btn primary" disabled={site.deploying} onClick={onDeploy}>
                {site.deploying ? <Spinner size={12} /> : <Rocket size={13} />} {site.deploying ? 'Déploiement…' : `Déployer ${site.branch}`}
              </button>
              {site.current && (
                <a className="btn" href={`${site.ssl ? 'https' : 'http'}://${site.domain}`} target="_blank" rel="noreferrer noopener" style={{ textDecoration: 'none' }}>
                  <ExternalLink size={12} /> Ouvrir
                </a>
              )}
            </div>
            <div className="group-box" style={{ maxHeight: 210, overflow: 'auto' }}>
              {site.releases.length === 0 && <div className="gb-row faint">Aucun déploiement</div>}
              {site.releases.map((r: any) => (
                <div key={r.id} className="gb-row" style={{ cursor: 'default', background: rel === r.id ? 'rgba(10,132,255,.14)' : undefined, padding: '7px 12px' }} onClick={() => setRel(r.id)}>
                  {r.status === 'success' ? <CheckCircle2 size={15} color="var(--green)" /> : r.status === 'failed' ? <XCircle size={15} color="var(--red)" /> : <Loader2 size={15} color="var(--orange)" className="spin" />}
                  <div className="label">
                    <div className="ellipsis" style={{ fontSize: 12.5 }}>
                      <span className="mono">{r.sha.slice(0, 7)}</span> {r.message}
                    </div>
                    <small>
                      {ago(r.at)}
                      {r.duration != null ? ` · ${r.duration} s` : ''}
                      {r.author ? ` · ${r.author}` : ''}
                    </small>
                  </div>
                  {r.id === site.current && <span className="badge green">en ligne</span>}
                  {r.status === 'success' && r.id !== site.current && !r.pruned && (
                    <button className="btn sm ghost" onClick={(e) => (e.stopPropagation(), rollback(r))} title="Revenir à cette version">
                      <RotateCcw size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          {rel && <DeployLog siteId={site.id} rel={rel} />}
        </>
      ) : (
        <SiteSettings site={site} reload={reload} onRemove={remove} />
      )}
    </div>
  );
}

function DeployLog({ siteId, rel }: { siteId: string; rel: string }) {
  const [text, setText] = useState('');
  const [done, setDone] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    let offset = 0;
    setText('');
    setDone(false);
    const tick = async () => {
      try {
        const r = await api(`/api/sites/${siteId}/releases/${rel}/log?offset=${offset}`);
        if (!alive) return;
        if (r.text) {
          offset += r.text.length;
          setText((t) => t + r.text);
        }
        if (r.done) {
          setDone(true);
          return;
        }
      } catch {
        /* réessaie */
      }
      if (alive) setTimeout(tick, 1000);
    };
    tick();
    return () => {
      alive = false;
    };
  }, [siteId, rel]);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);
  return (
    <div className="logbox" ref={box} style={{ flex: 1, minHeight: 160, borderTop: '0.5px solid var(--line)' }}>
      {text
        .replace(/\x1b\[[0-9;]*m/g, '')
        .split('\n')
        .map((l, i) => (
          <div key={i} className={`l ${l.startsWith('✖') || /\berror\b/i.test(l) ? 'err' : /\bwarn/i.test(l) || l.startsWith('⚠') ? 'warn' : ''}`} style={l.startsWith('▸') ? { color: 'var(--cyan)', fontWeight: 600, marginTop: 6 } : l.startsWith('✓') ? { color: '#4ade80' } : undefined}>
            {l || ' '}
          </div>
        ))}
      {!done && (
        <div className="faint" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <Spinner size={11} /> en cours…
        </div>
      )}
    </div>
  );
}

function EnvEditor({ env, onChange }: { env: [string, string][]; onChange: (e: [string, string][]) => void }) {
  return (
    <div>
      {env.map(([k, v], i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input className="input mono" style={{ flex: '0 0 40%' }} value={k} placeholder="NOM" onChange={(e) => onChange(env.map((x, j) => (j === i ? [e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'), x[1]] : x)))} />
          <input className="input mono" style={{ flex: 1 }} value={v} placeholder="valeur" type={v === '••••••' ? 'password' : 'text'} onChange={(e) => onChange(env.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} />
          <button className="btn ghost icon" onClick={() => onChange(env.filter((_, j) => j !== i))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button className="btn sm" onClick={() => onChange([...env, ['', '']])}>
        <Plus size={11} /> Variable
      </button>
    </div>
  );
}

function SiteSettings({ site, reload, onRemove }: { site: Site; reload: () => void; onRemove: () => void }) {
  const [f, setF] = useState<any>({ branch: site.branch, build: site.build || '', outputDir: site.outputDir, port: site.port, packageManager: site.packageManager || '' });
  const [env, setEnv] = useState<[string, string][]>(Object.entries(site.env || {}) as any);
  const branches = useApi(() => api(`/api/github/branches?repo=${encodeURIComponent(site.repo)}`), [site.repo]);
  const save = async () => {
    await run('Réglages enregistrés', () => api(`/api/sites/${site.id}`, { method: 'PATCH', body: { ...f, env: Object.fromEntries(env.filter(([k]) => k)) } }), 'Réglages enregistrés : effectifs au prochain déploiement');
    reload();
  };
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  return (
    <div className="content pad">
      <dl className="kv" style={{ marginBottom: 14 }}>
        <dt>Dépôt</dt>
        <dd>
          <a href={`https://github.com/${site.repo}`} target="_blank" rel="noreferrer noopener">{site.repo}</a>
        </dd>
        <dt>Serveur</dt>
        <dd>{site.server}</dd>
        {site.type === 'docker' && (
          <>
            <dt>Conteneur</dt>
            <dd className="mono">site-{site.id} · 127.0.0.1:{site.hostPort || '—'}</dd>
            <dt>Portainer</dt>
            <dd>{site.stackId ? `stack #${site.stackId}` : 'compose local'}</dd>
          </>
        )}
        <dt>Dossier</dt>
        <dd className="mono" style={{ fontSize: 11.5 }}>/opt/orbitos-sites/{site.id}</dd>
      </dl>
      <label className="field">
        <span>Branche déployée</span>
        <select className="select" value={f.branch} onChange={(e) => set('branch', e.target.value)}>
          {(branches.data || [{ name: f.branch }]).map((b: any) => (
            <option key={b.name}>{b.name}</option>
          ))}
        </select>
      </label>
      {site.type === 'static' ? (
        <div className="field-row">
          <label className="field">
            <span>Commande de build</span>
            <input className="input mono" value={f.build} onChange={(e) => set('build', e.target.value)} placeholder="aucune (fichiers servis tels quels)" />
          </label>
          <label className="field" style={{ flex: '0 0 120px' }}>
            <span>Sortie</span>
            <input className="input mono" value={f.outputDir} onChange={(e) => set('outputDir', e.target.value)} />
          </label>
        </div>
      ) : (
        <label className="field">
          <span>Port exposé par le conteneur</span>
          <input className="input mono" value={f.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} />
        </label>
      )}
      <div className="section-title">{site.type === 'docker' ? 'Variables d’environnement' : 'Variables de build'}</div>
      <EnvEditor env={env} onChange={setEnv} />
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button className="btn primary" onClick={save}>
          Enregistrer
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn danger" onClick={onRemove}>
          <Trash2 size={12} /> Supprimer le site
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── Assistant ─────────────────────────

function Wizard({ integ, onClose, onCreated, onIntegrations }: { integ: any; onClose: () => void; onCreated: (s: Site) => void; onIntegrations: () => void }) {
  const { servers, serverId } = useOS();
  const [step, setStep] = useState<1 | 2>(1);
  const [qv, setQ] = useState('');
  const [repo, setRepo] = useState('');
  const [manual, setManual] = useState('');
  const repos = useApi(() => api('/api/github/repos'), []);
  const [branches, setBranches] = useState<any[]>([]);
  const [branch, setBranch] = useState('');
  const [rootDir, setRootDir] = useState('');
  const [det, setDet] = useState<any>(null);
  const [detecting, setDetecting] = useState(false);
  const [f, setF] = useState<any>({ server: serverId, domain: '', ssl: true, noindex: false, authentik: false });
  const [env, setEnv] = useState<[string, string][]>([]);
  const [dns, setDns] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));

  const pick = async (full: string) => {
    setRepo(full);
    setBranches([]);
    try {
      const [info, br] = await Promise.all([api(`/api/github/repo?repo=${encodeURIComponent(full)}`), api(`/api/github/branches?repo=${encodeURIComponent(full)}`)]);
      setBranches(br);
      setBranch(info.defaultBranch);
      const base = (f.domain && f.domain.split('.').slice(1).join('.')) || useOS.getState().settings?.defaultDomain || 'example.com';
      set('domain', `${full.split('/')[1].toLowerCase().replace(/[^a-z0-9-]/g, '-')}.${base}`);
    } catch (e: any) {
      toast('Dépôt inaccessible', 'error', e.message);
      setRepo('');
    }
  };

  const analyze = async () => {
    setDetecting(true);
    try {
      const d = await api(`/api/github/detect?repo=${encodeURIComponent(repo)}&ref=${encodeURIComponent(branch)}&root=${encodeURIComponent(rootDir)}`);
      setDet(d);
      setF((x: any) => ({ ...x, type: d.type, build: d.build || '', outputDir: d.outputDir, port: d.port || 3000, packageManager: d.packageManager || '' }));
      setStep(2);
    } catch (e: any) {
      toast('Analyse impossible', 'error', e.message);
    }
    setDetecting(false);
  };

  useEffect(() => {
    setDns(null);
    if (step !== 2 || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(f.domain) || !f.server) return;
    const t = setTimeout(() => sapi(f.server, `nginx/check?name=${encodeURIComponent(f.domain)}`).then(setDns, () => setDns(null)), 500);
    return () => clearTimeout(t);
  }, [f.domain, f.server, step]);

  const submit = async () => {
    setBusy(true);
    try {
      const s = await api('/api/sites', { body: { ...f, repo, branch, rootDir, env: Object.fromEntries(env.filter(([k]) => k)) } });
      onCreated(s);
    } catch (e: any) {
      toast('Création impossible', 'error', e.message);
    }
    setBusy(false);
  };

  const list = useMemo(() => (repos.data || []).filter((r: any) => !qv || r.fullName.toLowerCase().includes(qv.toLowerCase())), [repos.data, qv]);

  return (
    <Sheet
      wide
      title="Nouveau site"
      subtitle={step === 1 ? 'Choisis le dépôt GitHub à héberger.' : `${repo} @ ${branch}${det?.framework ? ` · ${det.framework} détecté` : ''}`}
      onClose={onClose}
      footer={
        step === 1 ? (
          <>
            <button className="btn" onClick={onClose}>
              Annuler
            </button>
            <button className="btn primary" disabled={!repo || !branch || detecting} onClick={analyze}>
              {detecting ? <Spinner size={12} /> : <Search size={13} />} Analyser le projet
            </button>
          </>
        ) : (
          <>
            <button className="btn" style={{ marginRight: 'auto' }} onClick={() => setStep(1)}>
              Retour
            </button>
            <button className="btn" onClick={onClose}>
              Annuler
            </button>
            <button className="btn primary" disabled={busy || !f.domain} onClick={submit}>
              {busy ? <Spinner size={12} /> : <Rocket size={13} />} Créer et déployer
            </button>
          </>
        )
      }
    >
      {step === 1 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 20 }}>
          <div>
            {!integ?.github?.login && (
              <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
                <Github size={18} />
                <div style={{ flex: 1, fontSize: 12.5 }}>Connecte GitHub pour lister tes dépôts (privés compris). Sans token, saisis un dépôt public à droite.</div>
                <button className="btn sm primary" onClick={onIntegrations}>
                  Connecter
                </button>
              </div>
            )}
            <label className="search" style={{ width: '100%', marginBottom: 8 }}>
              <Search size={13} />
              <input className="input" style={{ width: '100%' }} value={qv} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer les dépôts" />
            </label>
            <div className="group-box" style={{ maxHeight: 340, overflow: 'auto' }}>
              {repos.loading && <div className="gb-row"><Spinner size={13} /> Chargement…</div>}
              {list.map((r: any) => (
                <div key={r.fullName} className="gb-row" style={{ cursor: 'default', background: repo === r.fullName ? 'rgba(10,132,255,.16)' : undefined }} onClick={() => pick(r.fullName)}>
                  {r.private ? <Lock size={13} className="faint" /> : <Github size={13} className="faint" />}
                  <div className="label">
                    <div className="ellipsis">{r.fullName}</div>
                    <small className="ellipsis">{[r.language, r.description].filter(Boolean).join(' · ') || '—'}</small>
                  </div>
                  <span className="faint" style={{ fontSize: 11 }}>{ago(r.pushedAt)}</span>
                </div>
              ))}
              {repos.data && !list.length && <div className="gb-row faint">Aucun dépôt</div>}
            </div>
          </div>
          <div>
            <label className="field">
              <span>Ou un dépôt par son nom</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input mono" style={{ flex: 1 }} value={manual} onChange={(e) => setManual(e.target.value.trim())} placeholder="owner/repo" onKeyDown={(e) => e.key === 'Enter' && manual && pick(manual)} />
                <button className="btn" disabled={!manual} onClick={() => pick(manual)}>
                  OK
                </button>
              </div>
            </label>
            {repo && (
              <>
                <label className="field">
                  <span>Branche</span>
                  <select className="select" value={branch} onChange={(e) => setBranch(e.target.value)}>
                    {branches.map((b) => (
                      <option key={b.name}>{b.name}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Dossier racine (monorepo)</span>
                  <input className="input mono" value={rootDir} onChange={(e) => setRootDir(e.target.value)} placeholder="racine du dépôt" />
                </label>
              </>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20 }}>
          <div>
            {det?.warnings?.map((w: string) => (
              <div key={w} className="error-box" style={{ margin: '0 0 10px', background: 'rgba(255,159,10,.1)', color: '#ffc56b', boxShadow: '0 0 0 .5px rgba(255,159,10,.3) inset' }}>
                <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
                {w}
              </div>
            ))}
            <div className="type-cards" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {[
                ['static', FolderTree, 'Site statique', 'Build optionnel, servi par nginx'],
                ['docker', Box, 'Conteneur', 'Dockerfile → stack Portainer'],
              ].map(([id, Ic, t, d]: any) => (
                <button key={id} className={`type-card ${f.type === id ? 'on' : ''}`} onClick={() => set('type', id)} disabled={id === 'docker' && !det?.files?.includes('Dockerfile')} style={id === 'docker' && !det?.files?.includes('Dockerfile') ? { opacity: 0.4 } : undefined}>
                  <Ic size={18} color="var(--cyan)" />
                  <b>{t}</b>
                  <small>{d}</small>
                </button>
              ))}
            </div>
            {f.type === 'static' ? (
              <>
                <div className="field-row">
                  <label className="field" style={{ flex: '0 0 110px' }}>
                    <span>Paquets</span>
                    <select className="select" value={f.packageManager} onChange={(e) => set('packageManager', e.target.value)}>
                      <option value="">—</option>
                      <option>npm</option>
                      <option>yarn</option>
                      <option>pnpm</option>
                      <option>bun</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Commande de build</span>
                    <input className="input mono" value={f.build} onChange={(e) => set('build', e.target.value)} placeholder="aucune" />
                  </label>
                </div>
                <label className="field">
                  <span>Dossier publié</span>
                  <input className="input mono" value={f.outputDir} onChange={(e) => set('outputDir', e.target.value)} />
                  <small>Le build tourne dans un conteneur jetable node:22 sur le serveur (1,5 Go de RAM max).</small>
                </label>
              </>
            ) : (
              <label className="field">
                <span>Port exposé par le conteneur</span>
                <input className="input mono" value={f.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} />
                <small>{integ?.portainer?.configured ? 'Le conteneur sera une stack Portainer.' : 'Portainer non configuré : docker compose local (configure-le dans Intégrations).'}</small>
              </label>
            )}
            <div className="section-title">{f.type === 'docker' ? 'Variables d’environnement' : 'Variables de build (ex. VITE_API_URL)'}</div>
            <EnvEditor env={env} onChange={setEnv} />
          </div>
          <div>
            <div className="field-row">
              <label className="field" style={{ flex: '0 0 130px' }}>
                <span>Serveur</span>
                <select className="select" value={f.server} onChange={(e) => set('server', e.target.value)}>
                  {servers.filter((s) => !s.hidden).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Domaine</span>
                <input className="input mono" value={f.domain} onChange={(e) => set('domain', e.target.value.trim().toLowerCase())} />
              </label>
            </div>
            <div className="faint" style={{ fontSize: 11.5, marginTop: -6, marginBottom: 12 }}>
              {dns ? (dns.pointsHere ? <span style={{ color: 'var(--green)' }}>✓ DNS OK : {dns.dns.a.join(', ')}</span> : <span style={{ color: 'var(--orange)' }}>DNS : {dns.dns.a.join(', ') || 'aucun A'} · attendu {dns.expected.join(', ')} (requis pour le SSL)</span>) : 'Vérification DNS…'}
            </div>
            <div className="group-box">
              <div className="gb-row">
                <Lock size={15} color="var(--green)" />
                <span className="label">HTTPS Let’s Encrypt</span>
                <Switch on={f.ssl} onChange={(v) => set('ssl', v)} />
              </div>
              <div className="gb-row">
                <EyeOff size={15} color="var(--text-2)" />
                <span className="label">Ne pas indexer</span>
                <Switch on={f.noindex} onChange={(v) => set('noindex', v)} />
              </div>
              <div className="gb-row">
                <KeyRound size={15} color="var(--purple)" />
                <span className="label">
                  Protéger par Authentik
                  <small>Nécessite un provider Forward Auth pour ce domaine</small>
                </span>
                <Switch on={f.authentik} onChange={(v) => set('authentik', v)} />
              </div>
            </div>
            <div className="card" style={{ marginTop: 14, fontSize: 12, lineHeight: 1.6 }}>
              <b>Au clic sur « Créer et déployer »</b>
              <div className="muted">
                1. Récupère {repo}@{branch} (le token reste dans OrbitOS)
                <br />
                2. {f.type === 'docker' ? 'docker build, puis stack + contrôle de santé' : f.build ? `${f.packageManager || 'npm'} install + ${f.build} dans un conteneur jetable` : 'Copie des fichiers'}
                <br />
                3. Vhost nginx {f.ssl ? '+ certificat SSL ' : ''}(nginx -t, rollback si erreur)
                <br />
                Ensuite : bouton « Déployer » après chaque push, retour arrière en un clic.
              </div>
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ───────────────────────── Intégrations ─────────────────────────

export function Integrations({ onClose }: { onClose: () => void }) {
  const servers = useOS((s) => s.servers);
  const integ = useApi(() => api('/api/integrations'), []);
  const [token, setToken] = useState('');
  const [p, setP] = useState<any>({ url: '', apiKey: '', endpointId: 1, server: '' });
  useEffect(() => {
    const pt = integ.data?.portainer;
    if (pt?.configured) setP({ url: pt.url, apiKey: '', endpointId: pt.endpointId, server: pt.server || '' });
  }, [integ.data]);

  const saveGh = async (value: string) => {
    const r: any = await run(value ? 'GitHub connecté' : 'Token retiré', () => api('/api/integrations/github', { body: { token: value } }));
    if (r?.error) toast('Token refusé par GitHub', 'error', r.error);
    setToken('');
    integ.reload(true);
  };
  const savePt = async () => {
    const r: any = await run('Portainer enregistré', () => api('/api/integrations/portainer', { body: p }));
    if (r?.error) toast('Portainer injoignable', 'error', r.error);
    integ.reload(true);
  };
  const gh = integ.data?.github;
  const pt = integ.data?.portainer;
  return (
    <Sheet title="Intégrations" subtitle="Les secrets restent dans le volume de données d’OrbitOS (fichier 0600) et ne sont jamais renvoyés au navigateur." onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Terminé</button>}>
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Github size={12} /> GitHub
      </div>
      <div className="group-box" style={{ marginBottom: 8 }}>
        <div className="gb-row">
          <span className={`status-dot ${gh?.login ? 'green' : gh?.error ? 'red' : ''}`} />
          <span className="label">
            {gh?.login ? <>Connecté en tant que <b>{gh.login}</b></> : gh?.error ? gh.error : 'Non connecté'}
            {gh?.token && <small className="mono">{gh.token}</small>}
          </span>
          {gh?.configured && (
            <button className="btn sm ghost" onClick={() => saveGh('')}>
              Retirer
            </button>
          )}
        </div>
        <div className="gb-row">
          <input className="input mono" style={{ flex: 1 }} type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="github_pat_…" />
          <button className="btn primary" disabled={!token} onClick={() => saveGh(token)}>
            Enregistrer
          </button>
        </div>
      </div>
      <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.6, marginBottom: 6 }}>
        Crée un token <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer noopener">fine-grained</a> : accès aux dépôts choisis, permissions <b>Contents : Read-only</b> (Metadata est ajouté d’office). Aucune autre permission n’est nécessaire.
      </div>

      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Plug size={12} /> Portainer
        {pt?.configured && <span className={`badge ${pt.error ? 'red' : 'green'}`} style={{ textTransform: 'none', letterSpacing: 0 }}>{pt.error ? 'erreur' : 'connecté'}</span>}
      </div>
      <div className="field-row">
        <label className="field">
          <span>URL</span>
          <input className="input mono" value={p.url} onChange={(e) => setP({ ...p, url: e.target.value.trim() })} placeholder="https://portainer.example.com" />
        </label>
        <label className="field" style={{ flex: '0 0 90px' }}>
          <span>Endpoint</span>
          <input className="input mono" value={p.endpointId} onChange={(e) => setP({ ...p, endpointId: e.target.value.replace(/\D/g, '') })} />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Clé API {pt?.apiKey && <span className="faint mono">({pt.apiKey})</span>}</span>
          <input className="input mono" type="password" value={p.apiKey} onChange={(e) => setP({ ...p, apiKey: e.target.value.trim() })} placeholder={pt?.apiKey ? 'inchangée' : 'ptr_…'} />
        </label>
        <label className="field" style={{ flex: '0 0 130px' }}>
          <span>Serveur géré</span>
          <select className="select" value={p.server} onChange={(e) => setP({ ...p, server: e.target.value })}>
            <option value="">—</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      </div>
      {pt?.error && <div className="error-box" style={{ margin: '0 0 10px' }}>{pt.error}</div>}
      <button className="btn" disabled={!p.url} onClick={savePt}>
        <RefreshCw size={12} /> Enregistrer et tester
      </button>
    </Sheet>
  );
}
