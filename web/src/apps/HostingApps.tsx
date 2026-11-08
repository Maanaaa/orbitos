import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pickaxe,
  Blocks,
  Headphones,
  Wrench,
  Car,
  Axe,
  PawPrint,
  Factory,
  Construction,
  Bot,
  Container,
  Plus,
  Play,
  Square,
  RotateCw,
  Trash2,
  Copy,
  Eye,
  KeyRound,
  DatabaseBackup,
  ArchiveRestore,
  Settings2,
  ScrollText,
  Info,
  FolderOpen,
  SquareTerminal,
  Search,
  Lock,
  FolderGit2 as Github,
  Send,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowDownToLine,
  RefreshCw,
  Gamepad2,
  Server,
  Cloud,
  type LucideIcon,
} from 'lucide-react';
import { api, sapi, useApi, wsUrl } from '../lib/api';
import { ago, bytes, dateTime } from '../lib/format';
import { useOS, confirm, run, toast } from '../os/store';
import { ErrorBox, Loading, Sheet, Spinner, Switch, Empty, Segmented } from '../os/ui';

type App = any;
type Tpl = any;

const ICONS: Record<string, LucideIcon> = { pickaxe: Pickaxe, blocks: Blocks, headphones: Headphones, wrench: Wrench, car: Car, axe: Axe, paw: PawPrint, factory: Factory, construction: Construction, bot: Bot, container: Container };
const CATEGORIES: [string, string][] = [
  ['game', 'Jeux'],
  ['voice', 'Vocal'],
  ['bot', 'Bots'],
  ['custom', 'Autre'],
];
const MASK = '••••••';

function TplIcon({ tpl, size = 40 }: { tpl?: Tpl; size?: number }) {
  const Ic = ICONS[tpl?.icon] || Container;
  return (
    <div className="app-icon" style={{ background: tpl?.gradient || 'var(--fill)', width: size, height: size, flex: 'none' }}>
      <Ic size={size * 0.5} strokeWidth={1.9} />
    </div>
  );
}

const stateInfo = (a: App) => {
  if (a.job) return { dot: 'orange pulse', label: a.job.kind === 'install' ? 'installation…' : a.job.kind === 'backup' ? 'sauvegarde…' : a.job.kind === 'restore' ? 'restauration…' : 'mise à jour…', badge: 'orange' };
  if (a.state === 'running') return { dot: 'green', label: 'en ligne', badge: 'green' };
  if (a.state === 'restarting') return { dot: 'red pulse', label: 'redémarre en boucle', badge: 'red' };
  if (a.state === 'exited' || a.state === 'created') return { dot: '', label: 'arrêté', badge: '' };
  if (a.state === 'absent') return { dot: 'red', label: a.jobs?.[0]?.status === 'failed' ? 'installation échouée' : 'non installé', badge: 'red' };
  return { dot: '', label: a.state || '?', badge: '' };
};

const portLabel = (p: any) => `${p.host}${p.range ? `-${p.host + p.range - 1}` : ''}/${p.proto === 'both' ? 'tcp+udp' : p.proto}`;
const mainPort = (a: App) => (a.ports || []).find((p: any) => !p.private);
const address = (a: App) => (mainPort(a) ? `${a.address}:${mainPort(a).host}` : null);

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast('Copié', 'ok', text),
    () => toast('Copie impossible', 'error'),
  );
}

export default function HostingApps({ switcher }: { switcher: ReactNode }) {
  const apps = useApi(() => api<App[]>('/api/apps'), [], { interval: 4000 });
  const catalog = useApi(() => api<Tpl[]>('/api/hosting/catalog'), []);
  const [sel, setSel] = useState<string | null>(null);
  const [wizard, setWizard] = useState<string | boolean>(false);
  const tpls = useMemo(() => Object.fromEntries((catalog.data || []).map((t) => [t.id, t])), [catalog.data]);
  const selected = (apps.data || []).find((a) => a.id === sel);

  const control = async (a: App, act: string) => {
    await run(act === 'start' ? `${a.name} démarré` : act === 'stop' ? `${a.name} arrêté` : `${a.name} redémarré`, () => api(`/api/apps/${a.id}/control/${act}`, { method: 'POST' }));
    apps.reload(true);
  };

  return (
    <div className="app-col">
      <div className="toolbar">
        {switcher}
        <span className="faint" style={{ fontSize: 12 }}>Serveurs de jeu, vocal, bots et conteneurs</span>
        <div className="grow" />
        <button className="btn primary" onClick={() => setWizard(true)}>
          <Plus size={14} /> Installer
        </button>
      </div>
      <ErrorBox error={apps.error} />
      <div className="split">
        <div className="content pad">
          {!apps.data && !apps.error ? (
            <Loading />
          ) : apps.data!.length === 0 ? (
            <div>
              <Empty icon={<Gamepad2 size={38} strokeWidth={1.3} />} title="Aucune application hébergée">
                <div style={{ maxWidth: 380 }}>Choisis un modèle : OrbitOS télécharge l’image, attribue les ports, ouvre le pare-feu et lance le serveur.</div>
              </Empty>
              <Catalog catalog={catalog.data || []} onPick={(id) => setWizard(id)} />
            </div>
          ) : (
            <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {apps.data!.map((a) => {
                const st = stateInfo(a);
                const t = tpls[a.template];
                const addr = address(a);
                return (
                  <div key={a.id} className="card" onClick={() => setSel(a.id)} style={{ display: 'flex', flexDirection: 'column', gap: 10, cursor: 'default', boxShadow: sel === a.id ? '0 0 0 1.5px var(--accent) inset' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <TplIcon tpl={t} size={36} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b className="ellipsis" style={{ display: 'block', fontSize: 13.5 }}>{a.name}</b>
                        <small className="faint ellipsis" style={{ display: 'block' }}>
                          {t?.name || a.template} · {a.server}
                        </small>
                      </div>
                      <span className={`status-dot ${st.dot}`} title={st.label} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <span className={`badge ${st.badge}`}>{st.label}</span>
                      {addr && (
                        <button className="btn sm ghost mono" style={{ marginLeft: 'auto', fontSize: 11.5 }} onClick={(e) => (e.stopPropagation(), copy(addr))} title="Copier l’adresse de connexion">
                          {addr} <Copy size={10} />
                        </button>
                      )}
                      {!addr && a.repo && <span className="faint ellipsis mono" style={{ marginLeft: 'auto', fontSize: 11 }}>{a.repo}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }} onClick={(e) => e.stopPropagation()}>
                      {a.state === 'running' ? (
                        <>
                          <button className="btn sm" disabled={!!a.job} onClick={() => control(a, 'stop')}>
                            <Square size={10} /> Arrêter
                          </button>
                          <button className="btn sm" disabled={!!a.job} onClick={() => control(a, 'restart')}>
                            <RotateCw size={11} /> Redémarrer
                          </button>
                        </>
                      ) : (
                        <button className="btn sm primary" disabled={!!a.job || a.state === 'absent'} onClick={() => control(a, 'start')}>
                          <Play size={11} /> Démarrer
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {selected && <AppDetail key={selected.id} app={selected} tpl={tpls[selected.template]} onClose={() => setSel(null)} reload={() => apps.reload(true)} control={(act) => control(selected, act)} />}
      </div>
      {wizard && (
        <Wizard
          catalog={catalog.data || []}
          initial={typeof wizard === 'string' ? wizard : null}
          onClose={() => setWizard(false)}
          onCreated={async (a: App) => {
            setWizard(false);
            await apps.reload(true);
            setSel(a.id);
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────── Catalogue ─────────────────────────

function Catalog({ catalog, onPick, selected }: { catalog: Tpl[]; onPick: (id: string) => void; selected?: string | null }) {
  return (
    <div>
      {CATEGORIES.map(([cat, label]) => {
        const items = catalog.filter((t) => t.category === cat);
        if (!items.length) return null;
        return (
          <div key={cat}>
            <div className="section-title">{label}</div>
            <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
              {items.map((t) => (
                <button key={t.id} className={`type-card ${selected === t.id ? 'on' : ''}`} onClick={() => onPick(t.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <TplIcon tpl={t} size={34} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <b>{t.name}</b>
                    <small>{t.description}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────── Détail ─────────────────────────

type DetailTab = 'console' | 'info' | 'backups' | 'settings';

function AppDetail({ app, tpl, onClose, reload, control }: { app: App; tpl?: Tpl; onClose: () => void; reload: () => void; control: (act: string) => void }) {
  const [tab, setTab] = useState<DetailTab>(app.job ? 'info' : 'console');
  const [job, setJob] = useState<string | null>(app.job?.id || app.jobs?.[0]?.id || null);
  const open = useOS((s) => s.open);
  const st = stateInfo(app);
  useEffect(() => {
    if (app.job) {
      setJob(app.job.id);
      setTab((t) => (t === 'console' ? 'info' : t));
    }
  }, [app.job?.id]);

  const update = async () => {
    const r: any = await run('Mise à jour lancée', () => api(`/api/apps/${app.id}/deploy`, { method: 'POST' }));
    if (r) {
      setJob(r.job);
      setTab('info');
      reload();
    }
  };
  const remove = async () => {
    let deleteData = false;
    const ok = await confirm({
      title: `Supprimer ${app.name} ?`,
      message: (
        <div>
          Le conteneur est supprimé et les règles de pare-feu refermées.
          {app.volumes?.length > 0 && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
              <input type="checkbox" onChange={(e) => (deleteData = e.target.checked)} />
              <span>
                Supprimer aussi les données ({app.volumes.map((v: any) => v.name).join(', ')}) — <b>irréversible</b>, les sauvegardes restent.
              </span>
            </label>
          )}
        </div>
      ),
      confirm: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const r: any = await run('Application supprimée', () => api(`/api/apps/${app.id}${deleteData ? '?data=1' : ''}`, { method: 'DELETE' }));
    if (r) {
      toast('Nettoyage', 'info', r.steps.join('\n'));
      onClose();
      reload();
    }
  };

  return (
    <div className="detail" style={{ width: 560, display: 'flex', flexDirection: 'column' }}>
      <div className="toolbar" style={{ background: 'rgba(24,26,34,.96)' }}>
        <TplIcon tpl={tpl} size={22} />
        <b className="ellipsis" style={{ flex: 1 }}>{app.name}</b>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'console', label: <ScrollText size={12} /> },
            { value: 'info', label: <Info size={12} /> },
            { value: 'backups', label: <DatabaseBackup size={12} /> },
            { value: 'settings', label: <Settings2 size={12} /> },
          ]}
        />
        <button className="btn ghost sm" onClick={onClose}>
          Fermer
        </button>
      </div>
      <div className="pad" style={{ paddingBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className={`badge ${st.badge}`}>{st.label}</span>
        <div style={{ flex: 1 }} />
        {app.state === 'running' ? (
          <>
            <button className="btn sm" disabled={!!app.job} onClick={() => control('stop')}>
              <Square size={10} /> Arrêter
            </button>
            <button className="btn sm" disabled={!!app.job} onClick={() => control('restart')}>
              <RotateCw size={11} /> Redémarrer
            </button>
          </>
        ) : (
          <button className="btn sm primary" disabled={!!app.job || app.state === 'absent'} onClick={() => control('start')}>
            <Play size={11} /> Démarrer
          </button>
        )}
        <button className="btn sm" disabled={!!app.job} onClick={update} title={app.repo ? 'Récupérer le dernier commit et redémarrer' : 'Télécharger la dernière image et redémarrer'}>
          {app.repo ? <Github size={11} /> : <ArrowDownToLine size={11} />} {app.state === 'absent' ? 'Réinstaller' : 'Mettre à jour'}
        </button>
        {app.volumes?.[0] && (
          <button className="btn sm ghost" title="Ouvrir le volume dans le Finder" onClick={() => open('finder', { path: `/var/lib/docker/volumes/${app.volumes[0].name}/_data` }, { size: { w: 1000, h: 620 } })}>
            <FolderOpen size={12} />
          </button>
        )}
        {app.state === 'running' && (
          <button className="btn sm ghost" title="Shell dans le conteneur" onClick={() => open('terminal', { newTab: { server: app.server, mode: 'container', target: `app-${app.id}` } }, { singleton: true, size: { w: 860, h: 520 } })}>
            <SquareTerminal size={12} />
          </button>
        )}
      </div>
      {tab === 'console' && <AppConsole app={app} tpl={tpl} />}
      {tab === 'info' && <AppInfo app={app} tpl={tpl} job={job} setJob={setJob} />}
      {tab === 'backups' && <Backups app={app} onJob={(j) => (setJob(j), setTab('info'), reload())} />}
      {tab === 'settings' && <AppSettings app={app} tpl={tpl} reload={reload} onRemove={remove} onJob={(j) => (setJob(j), setTab('info'))} />}
    </div>
  );
}

const ERR = /\b(error|fatal|panic|exception|severe|failed|denied)\b/i;
const WARN = /\b(warn|warning)\b/i;

function AppConsole({ app, tpl }: { app: App; tpl?: Tpl }) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<'live' | 'closed'>('live');
  const [cmd, setCmd] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const [sending, setSending] = useState(false);
  const [nonce, setNonce] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const hasConsole = tpl?.custom ? app.stdin : !!tpl?.console;

  useEffect(() => {
    setLines([]);
    setStatus('live');
    const ws = new WebSocket(wsUrl('/ws/logs', { sid: app.server, kind: 'container', target: `app-${app.id}`, tail: 300 }));
    let partial = '';
    let buf: string[] = [];
    ws.onmessage = (e) => {
      const parts = (partial + String(e.data)).split('\n');
      partial = parts.pop() || '';
      // retire l'horodatage docker (--timestamps) pour une console lisible
      buf.push(...parts.map((l) => l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, '')));
    };
    ws.onclose = () => setStatus('closed');
    const flush = setInterval(() => {
      if (!buf.length) return;
      const add = buf;
      buf = [];
      setLines((l) => {
        const n = l.concat(add);
        return n.length > 3000 ? n.slice(-3000) : n;
      });
    }, 200);
    return () => {
      clearInterval(flush);
      ws.close();
    };
  }, [app.id, app.server, nonce, app.state === 'running']);

  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);

  const send = async () => {
    const c = cmd.trim();
    if (!c) return;
    setSending(true);
    setHistory((h) => [c, ...h.filter((x) => x !== c)].slice(0, 50));
    setHi(-1);
    setCmd('');
    setLines((l) => [...l, `> ${c}`]);
    try {
      const r = await api(`/api/apps/${app.id}/command`, { body: { command: c } });
      if (r.output) setLines((l) => [...l, ...r.output.split('\n').map((x: string) => `  ${x}`)]);
    } catch (e: any) {
      setLines((l) => [...l, `✖ ${e.message}`]);
    }
    setSending(false);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '0.5px solid var(--line)' }}>
      <div
        className="logbox"
        ref={box}
        style={{ flex: 1, minHeight: 160 }}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {lines.length === 0 && <div className="faint">{app.state === 'running' ? 'En attente de logs…' : 'Le serveur est arrêté.'}</div>}
        {lines.map((l, i) => (
          <div key={i} className={`l ${l.startsWith('✖') || ERR.test(l) ? 'err' : WARN.test(l) ? 'warn' : ''}`} style={l.startsWith('> ') ? { color: 'var(--cyan)' } : undefined}>
            {l || ' '}
          </div>
        ))}
        {status === 'closed' && (
          <div className="faint" style={{ marginTop: 6 }}>
            — flux terminé —{' '}
            <button className="btn sm ghost" onClick={() => setNonce((n) => n + 1)}>
              <RefreshCw size={10} /> Reconnecter
            </button>
          </div>
        )}
      </div>
      {hasConsole ? (
        <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '0.5px solid var(--line)' }}>
          <input
            className="input mono"
            style={{ flex: 1 }}
            value={cmd}
            disabled={app.state !== 'running'}
            placeholder={app.state === 'running' ? (tpl?.id === 'minecraft-java' ? 'say Bonjour · op Pseudo · whitelist add Pseudo' : 'Commande serveur') : 'Démarre le serveur pour envoyer des commandes'}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
              else if (e.key === 'ArrowUp' && history.length) {
                const n = Math.min(hi + 1, history.length - 1);
                setHi(n);
                setCmd(history[n]);
                e.preventDefault();
              } else if (e.key === 'ArrowDown') {
                const n = hi - 1;
                setHi(n);
                setCmd(n >= 0 ? history[n] : '');
                e.preventDefault();
              }
            }}
          />
          <button className="btn primary" disabled={sending || !cmd.trim() || app.state !== 'running'} onClick={send}>
            {sending ? <Spinner size={12} /> : <Send size={12} />}
          </button>
        </div>
      ) : (
        <div className="faint" style={{ fontSize: 11.5, padding: '8px 12px', borderTop: '0.5px solid var(--line)' }}>
          Pas de console de commandes pour ce serveur : utilise le shell du conteneur ou l’administration en jeu.
        </div>
      )}
    </div>
  );
}

function AppInfo({ app, tpl, job, setJob }: { app: App; tpl?: Tpl; job: string | null; setJob: (j: string) => void }) {
  const stats = useApi(() => (app.state === 'running' ? sapi(app.server, 'docker/stats').then((l: any[]) => l.find((s) => s.name === `app-${app.id}`) || null) : Promise.resolve(null)), [app.state, app.server], { interval: 8000 });
  const [creds, setCreds] = useState<Record<string, string> | null>(null);
  const loadCreds = async () => {
    try {
      setCreds(await api(`/api/apps/${app.id}/credentials`, { method: 'POST' }));
    } catch (e: any) {
      toast('Lecture impossible', 'error', e.message);
    }
  };
  return (
    <div className="content" style={{ display: 'flex', flexDirection: 'column', borderTop: '0.5px solid var(--line)' }}>
      <div className="pad" style={{ paddingBottom: 6 }}>
        <dl className="kv" style={{ marginBottom: 10 }}>
          <dt>Modèle</dt>
          <dd>{tpl?.name || app.template}</dd>
          <dt>Serveur</dt>
          <dd>
            {app.server} · <span className="mono">{app.address}</span>
          </dd>
          {(app.ports || []).map((p: any) => (
            <FragmentRow key={p.key} label={p.label}>
              <span className="mono">{p.private ? `127.0.0.1:${portLabel(p)}` : `${app.address}:${portLabel(p)}`}</span>{' '}
              {!p.private && (
                <button className="btn sm ghost icon" onClick={() => copy(`${app.address}:${p.host}`)} title="Copier">
                  <Copy size={10} />
                </button>
              )}
              {p.private && <span className="badge">local</span>}
            </FragmentRow>
          ))}
          <dt>Image</dt>
          <dd className="mono ellipsis" style={{ fontSize: 11.5 }}>{app.image || '—'}</dd>
          {app.repo && (
            <>
              <dt>Dépôt</dt>
              <dd>
                <a href={`https://github.com/${app.repo}`} target="_blank" rel="noreferrer noopener">{app.repo}</a> @ {app.branch}
                {app.commit && <small className="faint mono" style={{ display: 'block' }}>{app.commit.sha.slice(0, 7)} {app.commit.message}</small>}
              </dd>
            </>
          )}
          <dt>Mémoire</dt>
          <dd>
            {stats.data ? `${stats.data.mem} · CPU ${stats.data.cpu.toFixed(1)} %` : `limite ${app.memory} Mo`}
          </dd>
          {app.volumes?.length > 0 && (
            <>
              <dt>Volumes</dt>
              <dd className="mono" style={{ fontSize: 11.5 }}>
                {app.volumes.map((v: any) => (
                  <div key={v.key}>
                    {v.name} → {v.path}
                  </div>
                ))}
              </dd>
            </>
          )}
          {app.firewall?.length > 0 && (
            <>
              <dt>Pare-feu</dt>
              <dd className="mono" style={{ fontSize: 11.5 }}>ufw : {app.firewall.join(', ')}</dd>
            </>
          )}
        </dl>
        {tpl?.hasSecrets && (
          <div className="card" style={{ marginBottom: 10, padding: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <KeyRound size={14} color="var(--orange)" />
              <b style={{ fontSize: 12.5, flex: 1 }}>Identifiants générés</b>
              <button className="btn sm" onClick={loadCreds}>
                <Eye size={11} /> Afficher
              </button>
            </div>
            {creds && (
              <div style={{ marginTop: 8 }}>
                {Object.keys(creds).length === 0 && <div className="faint" style={{ fontSize: 12 }}>Rien trouvé dans les logs pour l’instant.</div>}
                {Object.entries(creds).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 4 }}>
                    <span className="muted" style={{ flex: '0 0 46%' }}>{k}</span>
                    <span className="mono ellipsis" style={{ flex: 1 }}>{v}</span>
                    <button className="btn sm ghost icon" onClick={() => copy(v)}>
                      <Copy size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {tpl?.notes && <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.5, marginBottom: 10 }}>ℹ {tpl.notes}</div>}
        <div className="section-title">Opérations</div>
        <div className="group-box" style={{ maxHeight: 150, overflow: 'auto' }}>
          {(app.jobs || []).length === 0 && <div className="gb-row faint">Aucune</div>}
          {(app.jobs || []).map((j: any) => (
            <div key={j.id} className="gb-row" style={{ cursor: 'default', padding: '6px 12px', background: job === j.id ? 'rgba(10,132,255,.14)' : undefined }} onClick={() => setJob(j.id)}>
              {j.status === 'success' ? <CheckCircle2 size={14} color="var(--green)" /> : j.status === 'failed' ? <XCircle size={14} color="var(--red)" /> : <Loader2 size={14} color="var(--orange)" className="spin" />}
              <span className="label" style={{ fontSize: 12.5 }}>
                {{ install: 'Installation', update: 'Mise à jour', backup: 'Sauvegarde', restore: 'Restauration' }[j.kind as string] || j.kind}
                <small>
                  {ago(j.at)}
                  {j.duration != null ? ` · ${j.duration} s` : ''}
                </small>
              </span>
            </div>
          ))}
        </div>
      </div>
      {job && <JobLog appId={app.id} job={job} />}
    </div>
  );
}

const FragmentRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </>
);

function JobLog({ appId, job }: { appId: string; job: string }) {
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
        const r = await api(`/api/apps/${appId}/jobs/${job}/log?offset=${offset}`);
        if (!alive) return;
        if (r.text) {
          offset += r.text.length;
          setText((t) => t + r.text);
        }
        if (r.done) return setDone(true);
      } catch {
        /* réessaie */
      }
      if (alive) setTimeout(tick, 1000);
    };
    tick();
    return () => {
      alive = false;
    };
  }, [appId, job]);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);
  return (
    <div className="logbox" ref={box} style={{ flex: 1, minHeight: 180, borderTop: '0.5px solid var(--line)' }}>
      {text
        .replace(/\x1b\[[0-9;]*m/g, '')
        .split('\n')
        .map((l, i) => (
          <div key={i} className={`l ${l.startsWith('✖') ? 'err' : l.startsWith('⚠') ? 'warn' : ''}`} style={l.startsWith('▸') ? { color: 'var(--cyan)', fontWeight: 600, marginTop: 6 } : l.startsWith('✓') ? { color: '#4ade80' } : undefined}>
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

function Backups({ app, onJob }: { app: App; onJob: (job: string) => void }) {
  const open = useOS((s) => s.open);
  const list = useApi(() => api(`/api/apps/${app.id}/backups`), [app.id, app.job?.id]);
  const backup = async () => {
    if (app.state === 'running' && !(await confirm({ title: 'Sauvegarder maintenant ?', message: 'Le serveur est arrêté pendant la sauvegarde (fichiers cohérents) puis relancé automatiquement.', confirm: 'Sauvegarder' }))) return;
    const r: any = await run('Sauvegarde lancée', () => api(`/api/apps/${app.id}/backups`, { method: 'POST' }));
    if (r) onJob(r.job);
  };
  const restore = async (b: any) => {
    if (!(await confirm({ title: `Restaurer ${b.name} ?`, message: 'Le serveur est arrêté, l’état actuel est d’abord sauvegardé (« -avant »), puis les volumes sont remplacés par cette sauvegarde.', confirm: 'Restaurer', danger: true }))) return;
    const r: any = await run('Restauration lancée', () => api(`/api/apps/${app.id}/backups/${b.name}/restore`, { method: 'POST' }));
    if (r) onJob(r.job);
  };
  const remove = async (b: any) => {
    if (!(await confirm({ title: `Supprimer ${b.name} ?`, message: 'Cette sauvegarde est effacée définitivement du serveur.', confirm: 'Supprimer', danger: true }))) return;
    await run('Sauvegarde supprimée', () => api(`/api/apps/${app.id}/backups/${b.name}`, { method: 'DELETE' }));
    list.reload(true);
  };
  if (!app.volumes?.length) return <div className="pad faint">Cette application n’a pas de volume persistant.</div>;
  return (
    <div className="content pad" style={{ borderTop: '0.5px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div className="faint" style={{ fontSize: 12, flex: 1 }}>
          Archives locales de {app.volumes.map((v: any) => v.name).join(', ')} dans <span className="mono">/var/backups/orbitos/apps/{app.id}</span>
        </div>
        <button className="btn sm" title="Créer un plan Backrest (restic, hors serveur) pour ces volumes" onClick={() => open('backup', { prefill: { id: app.id, paths: app.volumes.map((v: any) => `/var/lib/docker/volumes/${v.name}`) } }, { singleton: true, size: { w: 1120, h: 680 } })}>
          <Cloud size={12} /> Backrest
        </button>
        <button className="btn primary sm" disabled={!!app.job} onClick={backup}>
          <DatabaseBackup size={12} /> Sauvegarder
        </button>
      </div>
      <ErrorBox error={list.error} />
      <div className="group-box">
        {list.loading && !list.data && (
          <div className="gb-row">
            <Spinner size={12} /> Chargement…
          </div>
        )}
        {list.data?.length === 0 && <div className="gb-row faint">Aucune sauvegarde</div>}
        {list.data?.map((b: any) => (
          <div key={b.name} className="gb-row" style={{ padding: '7px 12px' }}>
            <DatabaseBackup size={14} className="faint" />
            <span className="label">
              <span className="mono" style={{ fontSize: 12 }}>{b.name}</span>
              <small>
                {dateTime(b.at)} · {bytes(b.size)}
              </small>
            </span>
            <a className="btn sm ghost icon" href={`/api/s/${encodeURIComponent(app.server)}/files/download?path=${encodeURIComponent(b.path)}`} title="Télécharger">
              <ArrowDownToLine size={11} />
            </a>
            <button className="btn sm ghost" disabled={!!app.job} onClick={() => restore(b)} title="Restaurer">
              <ArchiveRestore size={11} />
            </button>
            <button className="btn sm ghost icon" onClick={() => remove(b)} title="Supprimer">
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── Formulaires ─────────────────────────

function FieldInput({ f, value, onChange, revealKey }: { f: any; value: any; onChange: (v: any) => void; revealKey?: () => Promise<string> }) {
  if (f.type === 'bool')
    return (
      <div className="gb-row">
        <span className="label">
          {f.label}
          {f.help && <small>{f.help}</small>}
        </span>
        <Switch on={value === true || value === 'true'} onChange={onChange} />
      </div>
    );
  return (
    <label className="field">
      <span>
        {f.label}
        {f.required && <span style={{ color: 'var(--orange)' }}> *</span>}
      </span>
      {f.type === 'select' ? (
        <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
          {f.options.map((o: string) => (
            <option key={o} value={o}>
              {o.replace(/^\/levels\/(.+)\/info\.json$/, '$1')}
            </option>
          ))}
        </select>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="input mono" style={{ flex: 1 }} type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'} min={f.min} max={f.max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
          {revealKey && value === MASK && (
            <button className="btn ghost icon" title="Afficher" onClick={async () => onChange(await revealKey())}>
              <Eye size={12} />
            </button>
          )}
        </div>
      )}
      {f.help && <small>{f.help}</small>}
    </label>
  );
}

function Fields({ tpl, values, set, reveal }: { tpl: Tpl; values: any; set: (k: string, v: any) => void; reveal?: (k: string) => Promise<string> }) {
  const bools = tpl.fields.filter((f: any) => f.type === 'bool');
  const others = tpl.fields.filter((f: any) => f.type !== 'bool');
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: 12 }}>
        {others.map((f: any) => (
          <FieldInput key={f.key} f={f} value={values[f.key]} onChange={(v) => set(f.key, v)} revealKey={reveal ? () => reveal(f.key) : undefined} />
        ))}
      </div>
      {bools.length > 0 && (
        <div className="group-box" style={{ marginBottom: 12 }}>
          {bools.map((f: any) => (
            <FieldInput key={f.key} f={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
          ))}
        </div>
      )}
    </>
  );
}

function EnvEditor({ env, onChange }: { env: [string, string][]; onChange: (e: [string, string][]) => void }) {
  return (
    <div>
      {env.map(([k, v], i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input className="input mono" style={{ flex: '0 0 40%' }} value={k} placeholder="NOM" onChange={(e) => onChange(env.map((x, j) => (j === i ? [e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'), x[1]] : x)))} />
          <input className="input mono" style={{ flex: 1 }} value={v} placeholder="valeur" type={v === MASK ? 'password' : 'text'} onChange={(e) => onChange(env.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} />
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

type PortRow = { port: string; proto: 'tcp' | 'udp' | 'both'; label: string; private?: boolean };
function PortsEditor({ ports, onChange }: { ports: PortRow[]; onChange: (p: PortRow[]) => void }) {
  return (
    <div>
      {ports.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input className="input mono" style={{ flex: '0 0 90px' }} value={p.port} placeholder="port" onChange={(e) => onChange(ports.map((x, j) => (j === i ? { ...x, port: e.target.value.replace(/\D/g, '') } : x)))} />
          <select className="select" style={{ flex: '0 0 96px' }} value={p.proto} onChange={(e) => onChange(ports.map((x, j) => (j === i ? { ...x, proto: e.target.value as any } : x)))}>
            <option value="tcp">tcp</option>
            <option value="udp">udp</option>
            <option value="both">tcp+udp</option>
          </select>
          <input className="input" style={{ flex: 1 }} value={p.label} placeholder="libellé" onChange={(e) => onChange(ports.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <button className="btn ghost icon" onClick={() => onChange(ports.filter((_, j) => j !== i))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button className="btn sm" onClick={() => onChange([...ports, { port: '', proto: 'tcp', label: '' }])}>
        <Plus size={11} /> Port
      </button>
    </div>
  );
}

function AppSettings({ app, tpl, reload, onRemove, onJob }: { app: App; tpl?: Tpl; reload: () => void; onRemove: () => void; onJob: (j: string) => void }) {
  const fieldKeys = new Set((tpl?.fields || []).map((f: any) => f.key));
  const [name, setName] = useState(app.name);
  const [memory, setMemory] = useState(String(app.memory));
  const [values, setValues] = useState<any>(() => Object.fromEntries((tpl?.fields || []).map((f: any) => [f.key, f.type === 'bool' ? app.env[f.key] === 'true' : app.env[f.key] ?? ''])));
  const [env, setEnv] = useState<[string, string][]>(Object.entries(app.env || {}).filter(([k]) => !fieldKeys.has(k)) as any);
  const [wanted, setWanted] = useState<Record<string, string>>(Object.fromEntries((app.ports || []).map((p: any) => [p.key, String(p.host)])));
  const [image, setImage] = useState(app.image || '');
  const [command, setCommand] = useState(app.command || '');
  const [start, setStart] = useState(app.start || '');
  const [branch, setBranch] = useState(app.branch || '');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setValues((x: any) => ({ ...x, [k]: v }));
  const reveal = async (k: string) => (await api(`/api/apps/${app.id}/reveal`, { body: { key: k } })).value;

  const save = async () => {
    setBusy(true);
    try {
      const portsChanged = (app.ports || []).some((p: any) => String(p.host) !== wanted[p.key]);
      const body: any = { name, memory: Number(memory), fields: values, extraEnv: Object.fromEntries(env.filter(([k]) => k)) };
      if (portsChanged) body.portsWanted = Object.fromEntries((app.ports || []).map((p: any) => [p.key, String(p.host) === wanted[p.key] ? '' : wanted[p.key]]));
      if (tpl?.custom) Object.assign(body, { image, command });
      if (tpl?.fromRepo) Object.assign(body, { start, branch });
      await api(`/api/apps/${app.id}`, { method: 'PATCH', body });
      const r: any = await api(`/api/apps/${app.id}/deploy`, { method: 'POST' });
      toast('Réglages appliqués', 'ok', 'Le serveur est recréé avec la nouvelle configuration (les données sont conservées).');
      onJob(r.job);
      reload();
    } catch (e: any) {
      toast('Enregistrement impossible', 'error', e.message);
    }
    setBusy(false);
  };

  return (
    <div className="content pad" style={{ borderTop: '0.5px solid var(--line)' }}>
      <div className="field-row">
        <label className="field">
          <span>Nom</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field" style={{ flex: '0 0 140px' }}>
          <span>Mémoire max (Mo)</span>
          <input className="input mono" value={memory} onChange={(e) => setMemory(e.target.value.replace(/\D/g, ''))} />
        </label>
      </div>
      {tpl?.custom && (
        <>
          <label className="field">
            <span>Image</span>
            <input className="input mono" value={image} onChange={(e) => setImage(e.target.value.trim())} />
          </label>
          <label className="field">
            <span>Commande (optionnelle)</span>
            <input className="input mono" value={command} onChange={(e) => setCommand(e.target.value)} />
          </label>
        </>
      )}
      {tpl?.fromRepo && (
        <div className="field-row">
          <label className="field" style={{ flex: '0 0 140px' }}>
            <span>Branche</span>
            <input className="input mono" value={branch} onChange={(e) => setBranch(e.target.value.trim())} />
          </label>
          {app.runtime !== 'dockerfile' && (
            <label className="field">
              <span>Commande de démarrage</span>
              <input className="input mono" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
          )}
        </div>
      )}
      {tpl && tpl.fields.length > 0 && (
        <>
          <div className="section-title">Réglages du serveur</div>
          <Fields tpl={tpl} values={values} set={set} reveal={reveal} />
        </>
      )}
      {(app.ports || []).length > 0 && (
        <>
          <div className="section-title">Ports publics</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {app.ports.map((p: any) => (
              <label key={p.key} className="field">
                <span>
                  {p.label} <span className="faint">({p.proto === 'both' ? 'tcp+udp' : p.proto})</span>
                </span>
                <input className="input mono" value={wanted[p.key] || ''} onChange={(e) => setWanted((w) => ({ ...w, [p.key]: e.target.value.replace(/\D/g, '') }))} />
              </label>
            ))}
          </div>
        </>
      )}
      <div className="section-title">Variables supplémentaires</div>
      <EnvEditor env={env} onChange={setEnv} />
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button className="btn primary" disabled={busy || !!app.job} onClick={save}>
          {busy ? <Spinner size={12} /> : null} Appliquer et redémarrer
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn danger" onClick={onRemove}>
          <Trash2 size={12} /> Supprimer
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── Assistant d'installation ─────────────────────────

function Wizard({ catalog, initial, onClose, onCreated }: { catalog: Tpl[]; initial: string | null; onClose: () => void; onCreated: (a: App) => void }) {
  const { servers, serverId } = useOS();
  const [tplId, setTplId] = useState<string | null>(initial);
  const [step, setStep] = useState<1 | 2>(initial ? 2 : 1);
  const tpl = catalog.find((t) => t.id === tplId);
  const [server, setServer] = useState(serverId);
  const [name, setName] = useState('');
  const [memory, setMemory] = useState('');
  const [values, setValues] = useState<any>({});
  const [env, setEnv] = useState<[string, string][]>([]);
  const [openFirewall, setOpenFirewall] = useState(true);
  const [busy, setBusy] = useState(false);
  // image personnalisée
  const [image, setImage] = useState('');
  const [command, setCommand] = useState('');
  const [ports, setPorts] = useState<PortRow[]>([]);
  const [volumes, setVolumes] = useState<string[]>(['/data']);
  const [stdin, setStdin] = useState(false);
  // bot depuis GitHub
  const repos = useApi(() => (tpl?.fromRepo ? api('/api/github/repos') : Promise.resolve([])), [tpl?.fromRepo]);
  const [repo, setRepo] = useState('');
  const [qv, setQ] = useState('');
  const [branch, setBranch] = useState('main');
  const [runtime, setRuntime] = useState('node');
  const [start, setStart] = useState('npm start');
  const metrics = useApi(() => (server ? sapi(server, 'metrics') : Promise.resolve(null)), [server]);

  useEffect(() => {
    if (!tpl) return;
    setName(tpl.custom ? '' : tpl.name);
    setMemory(String(tpl.memory.default));
    setValues(Object.fromEntries(tpl.fields.map((f: any) => [f.key, f.default])));
  }, [tplId]);

  const pickRepo = async (full: string) => {
    setRepo(full);
    try {
      const info = await api(`/api/github/repo?repo=${encodeURIComponent(full)}`);
      setBranch(info.defaultBranch);
      if (!name || name === tpl?.name) setName(full.split('/')[1]);
      const det = await api(`/api/github/detect?repo=${encodeURIComponent(full)}&ref=${encodeURIComponent(info.defaultBranch)}`).catch(() => null);
      if (det?.files?.includes('Dockerfile')) setRuntime('dockerfile');
      else if (det?.files?.includes('requirements.txt') || det?.files?.includes('pyproject.toml')) {
        setRuntime('python');
        setStart(det.files.includes('bot.py') ? 'python bot.py' : 'python main.py');
      } else if (det?.files?.includes('bun.lockb') || det?.files?.includes('bun.lock')) {
        setRuntime('bun');
        setStart('bun run start');
      } else {
        setRuntime('node');
        setStart('npm start');
      }
    } catch (e: any) {
      toast('Dépôt inaccessible', 'error', e.message);
      setRepo('');
    }
  };

  const submit = async () => {
    if (!tpl) return;
    setBusy(true);
    try {
      const body: any = { template: tpl.id, server, name, memory: Number(memory), fields: values, extraEnv: Object.fromEntries(env.filter(([k]) => k)), openFirewall };
      if (tpl.custom) Object.assign(body, { image, command, ports: ports.filter((p) => p.port).map((p) => ({ ...p, port: Number(p.port) })), volumes: volumes.filter(Boolean).map((path) => ({ path })), stdin });
      if (tpl.fromRepo) Object.assign(body, { repo, branch, runtime, start });
      const a = await api('/api/apps', { body });
      toast(`Installation de ${a.name} lancée`, 'info');
      onCreated(a);
    } catch (e: any) {
      toast('Installation impossible', 'error', e.message);
    }
    setBusy(false);
  };

  const mem = metrics.data?.mem;
  const memNum = Number(memory) || 0;
  const memWarn = mem && memNum * 1024 * 1024 > mem.available;
  const disk = metrics.data?.disks?.find((d: any) => d.mount === '/') || metrics.data?.disks?.[0];
  const repoList = (repos.data || []).filter((r: any) => !qv || r.fullName.toLowerCase().includes(qv.toLowerCase()));
  const canSubmit = tpl && name.trim() && server && (!tpl.custom || image) && (!tpl.fromRepo || repo) && tpl.fields.every((f: any) => !f.required || values[f.key]);

  return (
    <Sheet
      wide
      title={step === 1 ? 'Installer une application' : `Installer ${tpl?.name}`}
      subtitle={step === 1 ? 'Choisis un modèle : tout est préconfiguré, tu ajustes ensuite.' : tpl?.description}
      onClose={onClose}
      footer={
        step === 1 ? (
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
        ) : (
          <>
            <button className="btn" style={{ marginRight: 'auto' }} onClick={() => setStep(1)}>
              Retour
            </button>
            <button className="btn" onClick={onClose}>
              Annuler
            </button>
            <button className="btn primary" disabled={busy || !canSubmit} onClick={submit}>
              {busy ? <Spinner size={12} /> : <Play size={12} />} Installer et démarrer
            </button>
          </>
        )
      }
    >
      {step === 1 ? (
        <Catalog catalog={catalog} selected={tplId} onPick={(id) => (setTplId(id), setStep(2))} />
      ) : tpl ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)', gap: 20 }}>
          <div>
            <div className="field-row">
              <label className="field">
                <span>Nom</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={tpl.custom ? 'mon-service' : ''} />
              </label>
              <label className="field" style={{ flex: '0 0 130px' }}>
                <span>Serveur</span>
                <select className="select" value={server} onChange={(e) => setServer(e.target.value)}>
                  {servers.filter((s) => !s.hidden).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
            </div>

            {tpl.fromRepo && (
              <>
                <div className="section-title">Code du bot</div>
                <label className="search" style={{ width: '100%', marginBottom: 8 }}>
                  <Search size={13} />
                  <input className="input" style={{ width: '100%' }} value={qv} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer les dépôts, ou owner/repo puis Entrée" onKeyDown={(e) => e.key === 'Enter' && /^[\w.-]+\/[\w.-]+$/.test(qv) && pickRepo(qv)} />
                </label>
                <div className="group-box" style={{ maxHeight: 160, overflow: 'auto', marginBottom: 12 }}>
                  {repos.loading && (
                    <div className="gb-row">
                      <Spinner size={12} /> Chargement…
                    </div>
                  )}
                  {repos.data && !repos.data.length && <div className="gb-row faint">GitHub non connecté (Sites web → Intégrations) : tape owner/repo pour un dépôt public.</div>}
                  {repoList.slice(0, 50).map((r: any) => (
                    <div key={r.fullName} className="gb-row" style={{ cursor: 'default', padding: '6px 12px', background: repo === r.fullName ? 'rgba(10,132,255,.16)' : undefined }} onClick={() => pickRepo(r.fullName)}>
                      {r.private ? <Lock size={12} className="faint" /> : <Github size={12} className="faint" />}
                      <span className="label ellipsis">{r.fullName}</span>
                      <span className="faint" style={{ fontSize: 11 }}>{r.language}</span>
                    </div>
                  ))}
                </div>
                {repo && (
                  <div className="field-row">
                    <label className="field" style={{ flex: '0 0 110px' }}>
                      <span>Branche</span>
                      <input className="input mono" value={branch} onChange={(e) => setBranch(e.target.value.trim())} />
                    </label>
                    <label className="field" style={{ flex: '0 0 150px' }}>
                      <span>Environnement</span>
                      <select
                        className="select"
                        value={runtime}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRuntime(v);
                          setStart({ node: 'npm start', bun: 'bun run start', python: 'python main.py', dockerfile: '' }[v] || '');
                        }}
                      >
                        <option value="node">Node.js 22</option>
                        <option value="bun">Bun</option>
                        <option value="python">Python 3.12</option>
                        <option value="dockerfile">Dockerfile</option>
                      </select>
                    </label>
                    {runtime !== 'dockerfile' && (
                      <label className="field">
                        <span>Démarrage</span>
                        <input className="input mono" value={start} onChange={(e) => setStart(e.target.value)} />
                      </label>
                    )}
                  </div>
                )}
              </>
            )}

            {tpl.custom && (
              <>
                <label className="field">
                  <span>Image Docker</span>
                  <input className="input mono" value={image} onChange={(e) => setImage(e.target.value.trim())} placeholder="ex. louislam/uptime-kuma:1" />
                </label>
                <label className="field">
                  <span>Commande (optionnelle)</span>
                  <input className="input mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="celle de l’image par défaut" />
                </label>
                <div className="section-title">Ports publics</div>
                <PortsEditor ports={ports} onChange={setPorts} />
                <div className="section-title">Dossiers persistants (dans le conteneur)</div>
                {volumes.map((v, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <input className="input mono" style={{ flex: 1 }} value={v} onChange={(e) => setVolumes(volumes.map((x, j) => (j === i ? e.target.value.trim() : x)))} placeholder="/data" />
                    <button className="btn ghost icon" onClick={() => setVolumes(volumes.filter((_, j) => j !== i))}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <button className="btn sm" onClick={() => setVolumes([...volumes, ''])}>
                  <Plus size={11} /> Dossier
                </button>
                <div className="group-box" style={{ marginTop: 12 }}>
                  <div className="gb-row">
                    <span className="label">
                      Console (entrée standard)
                      <small>Pour les serveurs qui lisent leurs commandes sur stdin</small>
                    </span>
                    <Switch on={stdin} onChange={setStdin} />
                  </div>
                </div>
              </>
            )}

            {tpl.fields.length > 0 && (
              <>
                <div className="section-title">Réglages</div>
                <Fields tpl={tpl} values={values} set={(k, v) => setValues((x: any) => ({ ...x, [k]: v }))} />
              </>
            )}
            <div className="section-title">Variables supplémentaires</div>
            <EnvEditor env={env} onChange={setEnv} />
          </div>

          <div>
            <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
              <TplIcon tpl={tpl} size={42} />
              <div style={{ minWidth: 0 }}>
                <b>{tpl.name}</b>
                <div className="faint mono ellipsis" style={{ fontSize: 11 }}>{tpl.image || (tpl.fromRepo ? 'depuis GitHub' : image || 'image au choix')}</div>
              </div>
            </div>
            <label className="field">
              <span>Mémoire max (Mo)</span>
              <input className="input mono" value={memory} onChange={(e) => setMemory(e.target.value.replace(/\D/g, ''))} />
              <small style={memWarn ? { color: 'var(--orange)' } : undefined}>
                {mem ? `${bytes(mem.available)} disponibles sur ${bytes(mem.total)}` : 'Lecture du serveur…'}
                {memWarn ? ' — plus que la mémoire libre !' : ''} · minimum {tpl.memory.min} Mo
              </small>
            </label>
            {disk && (
              <div className="faint" style={{ fontSize: 11.5, marginTop: -4, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Server size={11} /> Disque {disk.mount} : {bytes(disk.avail)} libres
              </div>
            )}
            {tpl.ports.length > 0 && (
              <div className="group-box" style={{ marginBottom: 12 }}>
                {tpl.ports.map((p: any) => (
                  <div key={p.key} className="gb-row" style={{ fontSize: 12.5 }}>
                    <span className="label">{p.label}</span>
                    <span className="mono faint">
                      {p.port}
                      {p.range ? `-${p.port + p.range - 1}` : ''}/{p.proto === 'both' ? 'tcp+udp' : p.proto}
                    </span>
                    {p.private && <span className="badge">local</span>}
                  </div>
                ))}
              </div>
            )}
            {(tpl.ports.length > 0 || tpl.custom) && (
              <div className="group-box" style={{ marginBottom: 12 }}>
                <div className="gb-row">
                  <span className="label">
                    Ouvrir les ports dans ufw
                    <small>Si ufw est actif sur le serveur</small>
                  </span>
                  <Switch on={openFirewall} onChange={setOpenFirewall} />
                </div>
              </div>
            )}
            <div className="card" style={{ fontSize: 12, lineHeight: 1.6 }}>
              <b>À l’installation</b>
              <div className="muted">
                1. {tpl.fromRepo ? `Récupère ${repo || 'le dépôt'}${runtime === 'dockerfile' ? ' et construit son image' : ''}` : 'Télécharge l’image'}
                <br />
                2. Attribue les ports (le port standard si libre, sinon le suivant)
                <br />
                3. Crée les volumes persistants et démarre le conteneur
                <br />
                4. Vérifie qu’il reste en ligne{tpl.hasSecrets ? ' et récupère les identifiants' : ''}
              </div>
              {tpl.notes && <div className="faint" style={{ marginTop: 8 }}>ℹ {tpl.notes}</div>}
            </div>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
