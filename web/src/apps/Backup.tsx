import { useEffect, useMemo, useState } from 'react';
import {
  DatabaseBackup,
  Plus,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  AlertTriangle,
  Unlock,
  FolderOpen,
  ArchiveRestore,
  Trash2,
  Settings2,
  History,
  Camera,
  HardDrive,
  Box,
  Gamepad2,
  Folder,
  KeyRound,
  RefreshCw,
  Cloud,
} from 'lucide-react';
import { api, sapi, useApi } from '../lib/api';
import { ago, bytes, dateTime } from '../lib/format';
import { useOS, useServer, confirm, run, toast } from '../os/store';
import { ErrorBox, Loading, Sheet, Spinner, Switch, Empty, Segmented, SearchField } from '../os/ui';
import type { AppProps } from './registry';

type Status = any;
type Plan = any;

// ───────── Formatage ─────────
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
function scheduleLabel(s: any) {
  if (!s || s.disabled) return 'manuelle uniquement';
  if (s.maxFrequencyDays) return `tous les ${s.maxFrequencyDays} j`;
  if (s.maxFrequencyHours) return `toutes les ${s.maxFrequencyHours} h`;
  const m = /^(\d+) (\d+) \* \* (\*|\d)$/.exec(s.cron || '');
  if (m) {
    const t = `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`;
    return m[3] === '*' ? `chaque jour à ${t}` : `chaque ${DAYS[Number(m[3]) % 7]} à ${t}`;
  }
  const h = /^(\d+) \*\/(\d+) \* \* \*$/.exec(s.cron || '');
  if (h) return `toutes les ${h[2]} h`;
  return s.cron || '—';
}
function retentionLabel(r: any) {
  if (!r) return '—';
  if (r.policyKeepAll) return 'tout garder';
  if (r.policyKeepLastN) return `${r.policyKeepLastN} dernières`;
  const b = r.policyTimeBucketed || {};
  return [b.hourly && `${b.hourly} h`, b.daily && `${b.daily} j`, b.weekly && `${b.weekly} sem`, b.monthly && `${b.monthly} mois`, b.yearly && `${b.yearly} ans`].filter(Boolean).join(' · ') || '—';
}
const statusIcon = (st?: string, size = 14) =>
  st === 'success' ? (
    <CheckCircle2 size={size} color="var(--green)" />
  ) : st === 'error' ? (
    <XCircle size={size} color="var(--red)" />
  ) : st === 'warning' ? (
    <AlertTriangle size={size} color="var(--orange)" />
  ) : st === 'inprogress' ? (
    <Loader2 size={size} color="var(--orange)" className="spin" />
  ) : st === 'pending' ? (
    <Clock size={size} color="var(--text-3)" />
  ) : (
    <Clock size={size} className="faint" />
  );
const opLabel: Record<string, string> = { backup: 'Sauvegarde', forget: 'Rétention', prune: 'Nettoyage', check: 'Vérification', restore: 'Restauration', indexSnapshot: 'Indexation', stats: 'Statistiques', runHook: 'Hook', runCommand: 'Commande' };

/** Chemin hôte → chemin Backrest, d'après les montages (pour l'aperçu dans le navigateur). */
function mapPath(mounts: any[], host: string) {
  const p = host.replace(/\/+$/, '') || '/';
  const m = [...mounts].sort((a, b) => b.source.length - a.source.length).find((x) => p === x.source || p.startsWith(x.source + '/'));
  return m ? m.dest + p.slice(m.source.length) : null;
}

export default function Backup({ win }: AppProps) {
  const sid = useServer();
  const servers = useOS((s) => s.servers);
  const st = useApi<Status>(() => (sid ? sapi(sid, 'backrest') : Promise.resolve(null)), [sid], { interval: 15000 });
  const [sel, setSel] = useState<string | null>(null);
  const [wizard, setWizard] = useState<any>(null);
  const [qv, setQ] = useState('');
  const [creds, setCreds] = useState(false);
  const [addRepo, setAddRepo] = useState(false);

  useEffect(() => {
    if (win.props.prefill) setWizard(win.props.prefill);
  }, [win.props.nonce]);

  const d = st.data;
  const plans: Plan[] = useMemo(() => (d?.plans || []).filter((p: Plan) => !qv || p.id.toLowerCase().includes(qv.toLowerCase()) || p.paths.some((x: any) => (x.host || x.path).toLowerCase().includes(qv.toLowerCase()))), [d, qv]);
  const selected = d?.plans?.find((p: Plan) => p.id === sel);
  const sname = servers.find((s) => s.id === sid)?.name || sid;

  const runNow = async (p: Plan) => {
    await run(`Sauvegarde « ${p.id} » lancée`, () => sapi(sid, `backrest/plans/${p.id}/run`, { method: 'POST' }));
    setTimeout(() => st.reload(true), 2500);
  };
  const unlock = async (repo: string) => {
    if (
      !(await confirm({
        title: `Déverrouiller le dépôt ${repo} ?`,
        message: 'Lance « restic unlock » via Backrest : seuls les verrous orphelins (processus disparus) sont retirés, une opération réellement en cours n’est pas touchée. À faire en dehors des horaires de sauvegarde.',
        confirm: 'Déverrouiller',
      }))
    )
      return;
    await run('Déverrouillage demandé', () => sapi(sid, `backrest/repos/${repo}/unlock`, { method: 'POST' }));
    st.reload(true);
  };

  const okCount = (d?.plans || []).filter((p: Plan) => p.last?.status === 'success').length;
  const errCount = (d?.plans || []).filter((p: Plan) => p.last?.status === 'error').length;

  return (
    <div className="app-col">
      <div className="toolbar">
        <h2>Sauvegarde</h2>
        {d?.found && d.plans && (
          <span className="faint" style={{ fontSize: 12 }}>
            Backrest <span className="mono">{d.instance}</span> · {d.plans.length} plans · <span style={{ color: 'var(--green)' }}>{okCount} OK</span>
            {errCount > 0 && <span style={{ color: 'var(--red)' }}> · {errCount} en échec</span>}
          </span>
        )}
        <div className="grow" />
        {d?.plans && <SearchField value={qv} onChange={setQ} placeholder="Filtrer" width={160} />}
        <button className="btn ghost icon" onClick={() => st.reload()} title="Actualiser">
          <RefreshCw size={13} />
        </button>
        {d?.found && (
          <button className="btn ghost icon" onClick={() => setCreds(true)} title="Identifiants Backrest">
            <KeyRound size={13} />
          </button>
        )}
        <button className="btn primary" disabled={!d?.plans || !d.repos?.length} onClick={() => setWizard({})}>
          <Plus size={14} /> Nouvelle sauvegarde
        </button>
      </div>
      <ErrorBox error={st.error} onRetry={() => st.reload()} />
      {d?.lockedRepos?.map((r: string) => (
        <div key={r} className="error-box" style={{ margin: '10px 16px 0', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,159,10,.1)', color: '#ffc56b', boxShadow: '0 0 0 .5px rgba(255,159,10,.3) inset' }}>
          <AlertTriangle size={15} />
          <div style={{ flex: 1, fontSize: 12.5 }}>
            <b>Rétention bloquée sur {r}</b> : un verrou restic empêche « forget » de purger les anciennes sauvegardes. Les nouvelles sauvegardes passent, mais le dépôt grossit.
          </div>
          <button className="btn sm" onClick={() => unlock(r)}>
            <Unlock size={11} /> Déverrouiller
          </button>
        </div>
      ))}
      <div className="split">
        <div className="content pad">
          {!d && !st.error ? (
            <Loading />
          ) : d && !d.found ? (
            <Empty icon={<DatabaseBackup size={38} strokeWidth={1.3} />} title={`Pas de Backrest sur ${sname}`}>
              <div style={{ maxWidth: 400 }}>OrbitOS pilote Backrest (qui exécute restic). Installe-le sur ce serveur en un clic, ou choisis un autre serveur dans la barre de menus.</div>
              <button className="btn primary" style={{ marginTop: 8 }} onClick={() => useOS.getState().open('settings', { section: 'backup' }, { singleton: true, size: { w: 900, h: 620 } })}>
                Installer Backrest…
              </button>
            </Empty>
          ) : d?.error ? (
            <Empty icon={<AlertTriangle size={36} strokeWidth={1.3} />} title="Backrest ne répond pas">
              <div style={{ maxWidth: 420 }}>{d.error}</div>
              {d.needsAuth && (
                <button className="btn primary" style={{ marginTop: 8 }} onClick={() => setCreds(true)}>
                  <KeyRound size={12} /> Identifiants
                </button>
              )}
            </Empty>
          ) : d ? (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                {d.repos.map((r: any) => (
                  <div key={r.id} className="card" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <Cloud size={14} color="var(--cyan)" />
                    <b>{r.id}</b>
                    <span className="faint mono ellipsis" style={{ maxWidth: 360 }}>{r.uri}</span>
                  </div>
                ))}
                <button className="btn sm ghost" onClick={() => setAddRepo(true)}>
                  <Plus size={11} /> Dépôt restic
                </button>
                {!d.repos.length && <span className="faint" style={{ fontSize: 12, alignSelf: 'center' }}>Ajoute d’abord un dépôt restic pour créer des plans.</span>}
              </div>
              <div className="group-box">
                {plans.map((p: Plan) => (
                  <div key={p.id} className="gb-row" style={{ cursor: 'default', padding: '9px 12px', background: sel === p.id ? 'rgba(10,132,255,.14)' : undefined }} onClick={() => setSel(p.id)}>
                    {p.running ? statusIcon('inprogress', 16) : statusIcon(p.last?.status, 16)}
                    <div className="label" style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <b style={{ fontSize: 13 }}>{p.id}</b>
                        {p.forget?.status === 'error' && <span className="badge orange">rétention en échec</span>}
                      </div>
                      <small className="ellipsis mono" style={{ fontSize: 11 }}>{p.paths.map((x: any) => (x.host || x.path).replace('/var/lib/docker/volumes/', '⧉ ')).join('  ·  ')}</small>
                    </div>
                    <div style={{ textAlign: 'right', flex: 'none', fontSize: 11.5 }}>
                      <div className="muted">{scheduleLabel(p.schedule)}</div>
                      <div className="faint">
                        {p.running ? 'en cours…' : p.last ? `${ago(p.last.start)}${p.last.bytesAdded != null ? ` · +${bytes(p.last.bytesAdded)}` : ''}` : 'jamais'}
                      </div>
                    </div>
                    <button className="btn sm ghost" disabled={!!p.running} onClick={(e) => (e.stopPropagation(), runNow(p))} title="Sauvegarder maintenant">
                      <Play size={11} />
                    </button>
                  </div>
                ))}
                {!plans.length && <div className="gb-row faint">Aucun plan</div>}
              </div>
            </>
          ) : null}
        </div>
        {selected && d && <PlanDetail key={selected.id} sid={sid} status={d} plan={selected} onClose={() => setSel(null)} reload={() => st.reload(true)} onRun={() => runNow(selected)} />}
      </div>
      {wizard && d?.plans && (
        <NewPlan
          sid={sid}
          status={d}
          prefill={wizard}
          onClose={() => setWizard(null)}
          onCreated={(id) => {
            setWizard(null);
            setSel(id);
            st.reload(true);
            setTimeout(() => st.reload(true), 4000);
          }}
        />
      )}
      {addRepo && <AddRepoSheet sid={sid} onClose={() => setAddRepo(false)} onDone={() => (setAddRepo(false), st.reload(true))} />}
      {creds && <Credentials sid={sid} onClose={() => (setCreds(false), st.reload())} />}
    </div>
  );
}

// ───────────────────────── Détail d'un plan ─────────────────────────

function PlanDetail({ sid, status, plan, onClose, reload, onRun }: { sid: string; status: Status; plan: Plan; onClose: () => void; reload: () => void; onRun: () => void }) {
  const [tab, setTab] = useState<'snapshots' | 'history' | 'settings'>('snapshots');
  const open = useOS((s) => s.open);
  const remove = async () => {
    if (!(await confirm({ title: `Supprimer le plan « ${plan.id} » ?`, message: 'Le plan disparaît de Backrest (copie de config.json conservée). Les instantanés déjà envoyés restent dans le dépôt restic et pourront être purgés à la main.', confirm: 'Supprimer', danger: true }))) return;
    const r = await run('Plan supprimé', () => sapi(sid, `backrest/plans/${plan.id}`, { method: 'DELETE' }));
    if (r) {
      onClose();
      reload();
    }
  };
  return (
    <div className="detail" style={{ width: 540, display: 'flex', flexDirection: 'column' }}>
      <div className="toolbar" style={{ background: 'rgba(24,26,34,.96)' }}>
        <DatabaseBackup size={16} color="var(--cyan)" />
        <b className="ellipsis" style={{ flex: 1 }}>{plan.id}</b>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'snapshots', label: <Camera size={12} /> },
            { value: 'history', label: <History size={12} /> },
            { value: 'settings', label: <Settings2 size={12} /> },
          ]}
        />
        <button className="btn ghost sm" onClick={onClose}>
          Fermer
        </button>
      </div>
      <div className="pad" style={{ paddingBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
          <button className="btn primary sm" disabled={!!plan.running} onClick={onRun}>
            {plan.running ? <Spinner size={11} /> : <Play size={11} />} {plan.running ? 'En cours…' : 'Sauvegarder maintenant'}
          </button>
          <div style={{ flex: 1 }} />
          <span className="faint" style={{ fontSize: 11.5 }}>
            {scheduleLabel(plan.schedule)} · garde {retentionLabel(plan.retention)}
          </span>
        </div>
        {plan.running?.percent != null && (
          <div className="faint" style={{ fontSize: 11.5, marginBottom: 8 }}>
            Progression : {Math.round(plan.running.percent * 100)} %
          </div>
        )}
        {plan.forget?.status === 'error' && (
          <div className="error-box" style={{ margin: '0 0 10px', fontSize: 11.5, whiteSpace: 'pre-wrap', maxHeight: 90, overflow: 'auto' }}>
            Dernière rétention ({ago(plan.forget.start)}) : {plan.forget.message}
          </div>
        )}
        <div className="group-box">
          {plan.paths.map((x: any) => (
            <div key={x.path} className="gb-row" style={{ padding: '6px 12px', fontSize: 12 }}>
              {x.host?.startsWith('/var/lib/docker/volumes/') ? <Box size={13} color="var(--cyan)" /> : <Folder size={13} color="var(--accent)" />}
              <span className="label mono ellipsis" title={`Dans Backrest : ${x.path}`}>{x.host || x.path}</span>
              {x.host && (
                <button className="btn sm ghost icon" title="Ouvrir dans le Finder" onClick={() => open('finder', { path: x.host.startsWith('/var/lib/docker/volumes/') && !x.host.endsWith('/_data') ? `${x.host}/_data` : x.host }, { size: { w: 1000, h: 620 } })}>
                  <FolderOpen size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      {tab === 'snapshots' && <Snapshots sid={sid} plan={plan} />}
      {tab === 'history' && <Operations sid={sid} plan={plan} />}
      {tab === 'settings' && <PlanSettings sid={sid} status={status} plan={plan} reload={reload} onRemove={remove} />}
    </div>
  );
}

function Snapshots({ sid, plan }: { sid: string; plan: Plan }) {
  const list = useApi(() => sapi(sid, `backrest/plans/${plan.id}/snapshots`), [sid, plan.id, plan.last?.start]);
  const open = useOS((s) => s.open);
  const restore = async (s: any) => {
    if (
      !(await confirm({
        title: `Restaurer l’instantané du ${dateTime(s.time)} ?`,
        message: 'Les fichiers sont restaurés dans un dossier neuf (/tmp/orbitos-restore/…) : rien n’est écrasé. Tu copies ensuite ce dont tu as besoin depuis le Finder.',
        confirm: 'Restaurer',
      }))
    )
      return;
    const r: any = await run('Restauration lancée', () => sapi(sid, `backrest/plans/${plan.id}/restore`, { body: { snapshotId: s.id } }));
    if (r?.target)
      toast('Restauration en cours', 'info', `Destination : ${r.target}\n(suivi dans l’historique ; /tmp est vidé au redémarrage du serveur)`), setTimeout(() => open('finder', { path: r.target.replace(/\/[^/]+$/, '') }, { size: { w: 1000, h: 620 } }), 1500);
  };
  return (
    <div className="content" style={{ borderTop: '0.5px solid var(--line)' }}>
      <ErrorBox error={list.error} />
      {list.loading && !list.data && <Loading label="Lecture du dépôt restic…" />}
      {list.data?.length === 0 && <div className="pad faint">Aucun instantané pour l’instant.</div>}
      {list.data && list.data.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>Date</th>
              <th style={{ textAlign: 'right' }}>Ajouté</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th style={{ textAlign: 'right' }}>Fichiers</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data.map((s: any) => (
              <tr key={s.id}>
                <td>
                  {dateTime(s.time)}
                  <div className="faint mono" style={{ fontSize: 10.5 }}>{s.id.slice(0, 8)}</div>
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{s.bytesAdded != null ? bytes(s.bytesAdded) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{s.bytesProcessed != null ? bytes(s.bytesProcessed) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{s.files ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn sm ghost" onClick={() => restore(s)} title="Restaurer dans un dossier">
                    <ArchiveRestore size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Operations({ sid, plan }: { sid: string; plan: Plan }) {
  const ops = useApi(() => sapi(sid, `backrest/plans/${plan.id}/operations`), [sid, plan.id], { interval: 6000 });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="content" style={{ borderTop: '0.5px solid var(--line)' }}>
      <ErrorBox error={ops.error} />
      {!ops.data && !ops.error && <Loading />}
      <div className="group-box" style={{ margin: 12 }}>
        {ops.data?.map((o: any) => (
          <div key={o.id}>
            <div className="gb-row" style={{ padding: '6px 12px', cursor: o.message ? 'default' : undefined }} onClick={() => o.message && setOpen(open === o.id ? null : o.id)}>
              {statusIcon(o.status)}
              <span className="label" style={{ fontSize: 12.5 }}>
                {opLabel[o.kind] || o.kind}
                <small>
                  {o.status === 'pending' ? `prévue ${dateTime(o.start)}` : `${dateTime(o.start)}${o.end && o.start ? ` · ${Math.max(1, Math.round((o.end - o.start) / 1000))} s` : ''}`}
                  {o.bytesAdded != null ? ` · +${bytes(o.bytesAdded)}` : ''}
                </small>
              </span>
              {o.snapshotId && <span className="mono faint" style={{ fontSize: 10.5 }}>{o.snapshotId.slice(0, 8)}</span>}
            </div>
            {open === o.id && <div className="logbox" style={{ maxHeight: 160, margin: '0 12px 8px', whiteSpace: 'pre-wrap' }}>{o.message}</div>}
          </div>
        ))}
        {ops.data?.length === 0 && <div className="gb-row faint">Aucune opération</div>}
      </div>
    </div>
  );
}

// ───────────────────────── Formulaire de plan ─────────────────────────

type Sched = { mode: 'daily' | 'weekly' | 'hours' | 'cron' | 'manual'; time: string; day: string; hours: string; cron: string };
type Ret = { mode: 'standard' | 'long' | 'last' | 'custom'; daily: string; weekly: string; monthly: string; yearly: string; last: string };

function schedFrom(s: any): Sched {
  const base: Sched = { mode: 'daily', time: '04:30', day: '0', hours: '6', cron: s?.cron || '30 4 * * *' };
  if (!s || s.disabled) return { ...base, mode: s?.disabled ? 'manual' : 'daily' };
  const m = /^(\d+) (\d+) \* \* (\*|\d)$/.exec(s.cron || '');
  if (m) return { ...base, mode: m[3] === '*' ? 'daily' : 'weekly', time: `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`, day: m[3] === '*' ? '0' : m[3] };
  const h = /^0 \*\/(\d+) \* \* \*$/.exec(s.cron || '');
  if (h) return { ...base, mode: 'hours', hours: h[1] };
  return { ...base, mode: 'cron' };
}
function schedTo(s: Sched) {
  const [hh, mm] = s.time.split(':').map((x) => Number(x) || 0);
  if (s.mode === 'manual') return { disabled: true };
  if (s.mode === 'daily') return { cron: `${mm} ${hh} * * *` };
  if (s.mode === 'weekly') return { cron: `${mm} ${hh} * * ${s.day}` };
  if (s.mode === 'hours') return { cron: `0 */${Math.max(1, Number(s.hours) || 6)} * * *` };
  return { cron: s.cron.trim() };
}
function retFrom(r: any): Ret {
  const b = r?.policyTimeBucketed;
  const base: Ret = { mode: 'standard', daily: '7', weekly: '4', monthly: '6', yearly: '0', last: '10' };
  if (r?.policyKeepLastN) return { ...base, mode: 'last', last: String(r.policyKeepLastN) };
  if (b) {
    const v = { daily: String(b.daily || 0), weekly: String(b.weekly || 0), monthly: String(b.monthly || 0), yearly: String(b.yearly || 0) };
    const std = v.daily === '7' && v.weekly === '4' && v.monthly === '6' && v.yearly === '0';
    const long = v.daily === '14' && v.weekly === '8' && v.monthly === '12' && v.yearly === '2';
    return { ...base, ...v, mode: std ? 'standard' : long ? 'long' : 'custom' };
  }
  return base;
}
function retTo(r: Ret) {
  if (r.mode === 'standard') return { daily: 7, weekly: 4, monthly: 6 };
  if (r.mode === 'long') return { daily: 14, weekly: 8, monthly: 12, yearly: 2 };
  if (r.mode === 'last') return { keepLastN: Number(r.last) || 10 };
  return { daily: Number(r.daily), weekly: Number(r.weekly), monthly: Number(r.monthly), yearly: Number(r.yearly) };
}

/** Prochain créneau libre dans la fenêtre nocturne (les plans existants s'étalent de 2 en 2 min dès 04:00). */
function nextSlot(plans: Plan[]) {
  const used = new Set(
    plans
      .map((p) => /^(\d+) 4 \* \* \*$/.exec(p.schedule?.cron || '')?.[1])
      .filter(Boolean)
      .map(Number),
  );
  for (let m = 0; m < 60; m += 2) if (!used.has(m)) return `04:${String(m).padStart(2, '0')}`;
  return '05:00';
}

function ScheduleEditor({ s, set }: { s: Sched; set: (s: Sched) => void }) {
  return (
    <>
      <div className="field-row">
        <label className="field" style={{ flex: '0 0 170px' }}>
          <span>Fréquence</span>
          <select className="select" value={s.mode} onChange={(e) => set({ ...s, mode: e.target.value as any })}>
            <option value="daily">Chaque jour</option>
            <option value="weekly">Chaque semaine</option>
            <option value="hours">Toutes les N heures</option>
            <option value="cron">Cron personnalisé</option>
            <option value="manual">Manuelle uniquement</option>
          </select>
        </label>
        {s.mode === 'weekly' && (
          <label className="field" style={{ flex: '0 0 120px' }}>
            <span>Jour</span>
            <select className="select" value={s.day} onChange={(e) => set({ ...s, day: e.target.value })}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {DAYS[d]}
                </option>
              ))}
            </select>
          </label>
        )}
        {(s.mode === 'daily' || s.mode === 'weekly') && (
          <label className="field" style={{ flex: '0 0 100px' }}>
            <span>Heure</span>
            <input className="input mono" type="time" value={s.time} onChange={(e) => set({ ...s, time: e.target.value })} />
          </label>
        )}
        {s.mode === 'hours' && (
          <label className="field" style={{ flex: '0 0 100px' }}>
            <span>Heures</span>
            <input className="input mono" value={s.hours} onChange={(e) => set({ ...s, hours: e.target.value.replace(/\D/g, '') })} />
          </label>
        )}
        {s.mode === 'cron' && (
          <label className="field">
            <span>Cron (heure du serveur)</span>
            <input className="input mono" value={s.cron} onChange={(e) => set({ ...s, cron: e.target.value })} />
          </label>
        )}
      </div>
    </>
  );
}

function RetentionEditor({ r, set }: { r: Ret; set: (r: Ret) => void }) {
  return (
    <>
      <Segmented
        value={r.mode}
        onChange={(mode) => set({ ...r, mode })}
        options={[
          { value: 'standard', label: '7 j · 4 sem · 6 mois' },
          { value: 'long', label: 'Longue' },
          { value: 'last', label: 'N dernières' },
          { value: 'custom', label: 'Perso' },
        ]}
      />
      <div style={{ marginTop: 10 }}>
        {r.mode === 'long' && <div className="faint" style={{ fontSize: 12 }}>14 quotidiennes, 8 hebdomadaires, 12 mensuelles, 2 annuelles</div>}
        {r.mode === 'last' && (
          <label className="field" style={{ maxWidth: 160 }}>
            <span>Nombre à garder</span>
            <input className="input mono" value={r.last} onChange={(e) => set({ ...r, last: e.target.value.replace(/\D/g, '') })} />
          </label>
        )}
        {r.mode === 'custom' && (
          <div className="field-row">
            {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((k) => (
              <label key={k} className="field">
                <span>{{ daily: 'Jours', weekly: 'Semaines', monthly: 'Mois', yearly: 'Années' }[k]}</span>
                <input className="input mono" value={r[k]} onChange={(e) => set({ ...r, [k]: e.target.value.replace(/\D/g, '') })} />
              </label>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function PathList({ paths, setPaths, mounts }: { paths: string[]; setPaths: (p: string[]) => void; mounts: any[] }) {
  const [manual, setManual] = useState('');
  const add = (p: string) => {
    const v = p.trim().replace(/\/+$/, '');
    if (v && !paths.includes(v)) setPaths([...paths, v]);
  };
  return (
    <div>
      <div className="group-box" style={{ marginBottom: 8 }}>
        {paths.length === 0 && <div className="gb-row faint">Aucune source sélectionnée</div>}
        {paths.map((p) => {
          const c = mapPath(mounts, p);
          return (
            <div key={p} className="gb-row" style={{ padding: '6px 12px', fontSize: 12 }}>
              {p.startsWith('/var/lib/docker/volumes/') ? <Box size={13} color="var(--cyan)" /> : <Folder size={13} color="var(--accent)" />}
              <span className="label">
                <span className="mono ellipsis">{p}</span>
                <small className="mono" style={c ? undefined : { color: 'var(--red)' }}>{c ? `→ ${c}` : 'non visible par Backrest (aucun montage)'}</small>
              </span>
              <button className="btn ghost icon" onClick={() => setPaths(paths.filter((x) => x !== p))}>
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="input mono" style={{ flex: 1 }} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="/root/mon-projet/data" onKeyDown={(e) => e.key === 'Enter' && (add(manual), setManual(''))} />
        <button className="btn" disabled={!manual.startsWith('/')} onClick={() => (add(manual), setManual(''))}>
          <Plus size={12} /> Dossier
        </button>
      </div>
      <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>Visibles par Backrest : {mounts.map((m) => m.source).join(', ')}</div>
    </div>
  );
}

function NewPlan({ sid, status, prefill, onClose, onCreated }: { sid: string; status: Status; prefill: any; onClose: () => void; onCreated: (id: string) => void }) {
  const src = useApi(() => sapi(sid, 'backrest/sources'), [sid]);
  const apps = useApi(() => api('/api/apps').then((l: any[]) => l.filter((a) => a.server === sid && a.volumes?.length)), [sid]);
  const [id, setId] = useState<string>(prefill.id || '');
  const [repo, setRepo] = useState(status.repos[0]?.id || '');
  const [paths, setPaths] = useState<string[]>(prefill.paths || []);
  const [sched, setSched] = useState<Sched>({ ...schedFrom(null), time: nextSlot(status.plans) });
  const [ret, setRet] = useState<Ret>(retFrom(null));
  const [excludes, setExcludes] = useState('*node_modules*\n*.log');
  const [runNow, setRunNow] = useState(true);
  const [tab, setTab] = useState<'apps' | 'volumes'>('apps');
  const [qv, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (p: string) => setPaths((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]));
  const exists = status.plans.some((p: Plan) => p.id === id);

  const submit = async () => {
    setBusy(true);
    try {
      await sapi(sid, 'backrest/plans', { body: { id, repo, paths, schedule: schedTo(sched), retention: retTo(ret), excludes: excludes.split('\n').map((x) => x.trim()).filter(Boolean), runNow } });
      toast(`Plan « ${id} » créé dans Backrest`, 'ok', runNow ? 'Première sauvegarde lancée vers le dépôt restic.' : undefined);
      onCreated(id);
    } catch (e: any) {
      toast('Création impossible', 'error', e.message);
    }
    setBusy(false);
  };

  const vols = (src.data?.volumes || []).filter((v: any) => !qv || v.name.toLowerCase().includes(qv.toLowerCase()));
  return (
    <Sheet
      wide
      title="Nouvelle sauvegarde"
      subtitle="Crée un plan Backrest : les instantanés partent chiffrés dans le dépôt restic."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={busy || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,48}$/.test(id) || exists || !paths.length || !repo} onClick={submit}>
            {busy ? <Spinner size={12} /> : <DatabaseBackup size={13} />} Créer{runNow ? ' et sauvegarder' : ''}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20 }}>
        <div>
          <div className="field-row">
            <label className="field">
              <span>Nom du plan</span>
              <input className="input mono" value={id} onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))} placeholder="minecraft-survie" />
              {exists && <small style={{ color: 'var(--red)' }}>Ce nom existe déjà</small>}
            </label>
            <label className="field" style={{ flex: '0 0 160px' }}>
              <span>Dépôt restic</span>
              <select className="select" value={repo} onChange={(e) => setRepo(e.target.value)}>
                {status.repos.map((r: any) => (
                  <option key={r.id} value={r.id}>
                    {r.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="section-title">Quoi sauvegarder</div>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'apps', label: <><Gamepad2 size={11} /> Apps OrbitOS</> },
              { value: 'volumes', label: <><HardDrive size={11} /> Volumes Docker</> },
            ]}
          />
          <div className="group-box" style={{ marginTop: 8, maxHeight: 230, overflow: 'auto' }}>
            {tab === 'apps' ? (
              <>
                {apps.loading && !apps.data && (
                  <div className="gb-row">
                    <Spinner size={12} /> Chargement…
                  </div>
                )}
                {apps.data?.length === 0 && <div className="gb-row faint">Aucune app hébergée sur ce serveur</div>}
                {apps.data?.map((a: any) => {
                  const ps = a.volumes.map((v: any) => `/var/lib/docker/volumes/${v.name}`);
                  const on = ps.every((p: string) => paths.includes(p));
                  return (
                    <div key={a.id} className="gb-row" style={{ cursor: 'default', padding: '6px 12px' }} onClick={() => (on ? setPaths(paths.filter((p) => !ps.includes(p))) : (setPaths([...new Set([...paths, ...ps])]), !id && setId(a.id)))}>
                      <input type="checkbox" readOnly checked={on} />
                      <span className="label">
                        {a.name}
                        <small className="mono">{a.volumes.map((v: any) => v.name).join(', ')}</small>
                      </span>
                    </div>
                  );
                })}
              </>
            ) : (
              <>
                <div className="gb-row" style={{ padding: 6 }}>
                  <input className="input" style={{ width: '100%' }} value={qv} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer les volumes" />
                </div>
                {src.loading && !src.data && (
                  <div className="gb-row">
                    <Spinner size={12} /> Chargement…
                  </div>
                )}
                {vols.map((v: any) => (
                  <div key={v.name} className="gb-row" style={{ cursor: 'default', padding: '5px 12px', fontSize: 12 }} onClick={() => v.container && toggle(v.host)}>
                    <input type="checkbox" readOnly checked={paths.includes(v.host)} disabled={!v.container} />
                    <span className="label mono ellipsis">{v.name}</span>
                    {v.covered && <span className="badge green">déjà sauvegardé</span>}
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="section-title">Sources du plan</div>
          <PathList paths={paths} setPaths={setPaths} mounts={status.mounts} />
        </div>
        <div>
          <div className="section-title" style={{ marginTop: 0 }}>Quand</div>
          <ScheduleEditor s={sched} set={setSched} />
          <div className="faint" style={{ fontSize: 11.5, marginTop: -4, marginBottom: 10 }}>Créneau libre proposé après les plans existants de la nuit, pour étaler la charge.</div>
          <div className="section-title">Combien de temps garder</div>
          <RetentionEditor r={ret} set={setRet} />
          <div className="section-title">Exclusions (une par ligne)</div>
          <textarea className="textarea mono" rows={3} value={excludes} onChange={(e) => setExcludes(e.target.value)} style={{ width: '100%' }} />
          <div className="group-box" style={{ marginTop: 12 }}>
            <div className="gb-row">
              <span className="label">
                Sauvegarder tout de suite
                <small>Premier instantané envoyé dès la création</small>
              </span>
              <Switch on={runNow} onChange={setRunNow} />
            </div>
          </div>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.5 }}>
            OrbitOS copie config.json de Backrest (config.json.bak_orbitos_…) avant chaque modification, puis applique le plan par l’API : pas de redémarrage de Backrest.
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function PlanSettings({ sid, status, plan, reload, onRemove }: { sid: string; status: Status; plan: Plan; reload: () => void; onRemove: () => void }) {
  const [paths, setPaths] = useState<string[]>(plan.paths.map((x: any) => x.host || x.path));
  const [sched, setSched] = useState<Sched>(schedFrom(plan.schedule));
  const [ret, setRet] = useState<Ret>(retFrom(plan.retention));
  const [excludes, setExcludes] = useState((plan.excludes || []).join('\n'));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await run('Plan mis à jour dans Backrest', () => sapi(sid, `backrest/plans/${plan.id}`, { method: 'PATCH', body: { paths, schedule: schedTo(sched), retention: retTo(ret), excludes: excludes.split('\n').map((x: string) => x.trim()).filter(Boolean) } }));
    setBusy(false);
    if (r) reload();
  };
  return (
    <div className="content pad" style={{ borderTop: '0.5px solid var(--line)' }}>
      <div className="section-title" style={{ marginTop: 0 }}>Sources</div>
      <PathList paths={paths} setPaths={setPaths} mounts={status.mounts} />
      <div className="section-title">Quand</div>
      <ScheduleEditor s={sched} set={setSched} />
      <div className="section-title">Rétention</div>
      <RetentionEditor r={ret} set={setRet} />
      <div className="section-title">Exclusions</div>
      <textarea className="textarea mono" rows={3} value={excludes} onChange={(e) => setExcludes(e.target.value)} style={{ width: '100%' }} />
      {plan.hooks > 0 && <div className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>{plan.hooks} hook(s) Backrest conservé(s) tels quels.</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button className="btn primary" disabled={busy || !paths.length} onClick={save}>
          {busy ? <Spinner size={12} /> : null} Enregistrer
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn danger" onClick={onRemove}>
          <Trash2 size={12} /> Supprimer le plan
        </button>
      </div>
    </div>
  );
}

function Credentials({ sid, onClose }: { sid: string; onClose: () => void }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const save = async (clear = false) => {
    const r = await run(clear ? 'Identifiants retirés' : 'Identifiants enregistrés', () => sapi(sid, 'backrest/credentials', { body: clear ? {} : { username: u, password: p } }));
    if (r) onClose();
  };
  return (
    <Sheet
      title="Identifiants Backrest"
      subtitle="Seulement si l’authentification de Backrest est activée. Stockés dans le volume d’OrbitOS (0600), jamais renvoyés au navigateur."
      onClose={onClose}
      footer={
        <>
          <button className="btn" style={{ marginRight: 'auto' }} onClick={() => save(true)}>
            Retirer
          </button>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={!u} onClick={() => save()}>
            Enregistrer
          </button>
        </>
      }
    >
      <label className="field">
        <span>Utilisateur</span>
        <input className="input" value={u} onChange={(e) => setU(e.target.value)} />
      </label>
      <label className="field">
        <span>Mot de passe</span>
        <input className="input" type="password" value={p} onChange={(e) => setP(e.target.value)} />
      </label>
    </Sheet>
  );
}

// ───────────────────────── Ajout d'un dépôt restic ─────────────────────────

const REPO_TYPES: [string, string, string][] = [
  ['b2', 'Backblaze B2', 'Bucket B2 et clé d’application'],
  ['s3', 'S3 compatible', 'AWS, Wasabi, Scaleway, MinIO, R2…'],
  ['local', 'Dossier du serveur', 'Ex. /srv/restic/<nom> (disque séparé de préférence)'],
  ['rest', 'rest-server', 'https://utilisateur:motdepasse@hôte/chemin'],
];

export function AddRepoSheet({ sid, onClose, onDone }: { sid: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<any>({ type: 'b2', id: '', bucket: '', path: '', keyId: '', secret: '', endpoint: 'https://', region: '', url: 'https://', password: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((x: any) => ({ ...x, [k]: v }));
  const submit = async () => {
    setBusy(true);
    try {
      const r: any = await sapi(sid, 'backrest/repos', { body: f });
      if (r.password) {
        await confirm({
          title: 'Note le mot de passe du dépôt',
          message: (
            <div>
              Sans lui, <b>les sauvegardes sont illisibles</b>. Il ne sera plus affiché (Backrest le conserve dans sa configuration).
              <div className="mono" style={{ marginTop: 10, padding: 10, background: 'rgba(255,255,255,.06)', borderRadius: 8, userSelect: 'all', wordBreak: 'break-all' }}>{r.password}</div>
            </div>
          ),
          confirm: 'C’est noté',
        });
      }
      toast(`Dépôt « ${r.id} » ajouté et initialisé`, 'ok');
      onDone();
    } catch (e: any) {
      toast('Ajout impossible', 'error', e.message);
    }
    setBusy(false);
  };
  const field = (k: string, label: string, props: any = {}) => (
    <label className="field" key={k}>
      <span>{label}</span>
      <input className="input mono" value={f[k]} onChange={(e) => set(k, e.target.value.trim())} {...props} />
    </label>
  );
  return (
    <Sheet
      wide
      title="Ajouter un dépôt restic"
      subtitle="Backrest l’initialise (restic init) s’il est vide, puis vérifie et nettoie chaque mois."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={busy || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,40}$/.test(f.id)} onClick={submit}>
            {busy ? <Spinner size={12} /> : <Plus size={13} />} Ajouter
          </button>
        </>
      }
    >
      <div className="type-cards" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {REPO_TYPES.map(([id, t, d]) => (
          <button key={id} className={`type-card ${f.type === id ? 'on' : ''}`} onClick={() => set('type', id)}>
            <Cloud size={16} color="var(--cyan)" />
            <b>{t}</b>
            <small>{d}</small>
          </button>
        ))}
      </div>
      <div className="field-row">
        {field('id', 'Identifiant du dépôt', { placeholder: 'offsite-b2' })}
        {f.type === 'local' && field('path', 'Dossier sur le serveur', { placeholder: '/srv/restic/principal' })}
        {f.type === 'rest' && field('url', 'URL')}
      </div>
      {f.type === 'b2' && (
        <>
          <div className="field-row">
            {field('bucket', 'Bucket')}
            {field('path', 'Chemin dans le bucket', { placeholder: 'restic' })}
          </div>
          <div className="field-row">
            {field('keyId', 'keyID')}
            {field('secret', 'applicationKey', { type: 'password' })}
          </div>
        </>
      )}
      {f.type === 's3' && (
        <>
          <div className="field-row">
            {field('endpoint', 'Endpoint', { placeholder: 'https://s3.eu-central-003.backblazeb2.com' })}
            {field('region', 'Région (optionnel)')}
          </div>
          <div className="field-row">
            {field('bucket', 'Bucket')}
            {field('path', 'Préfixe (optionnel)')}
          </div>
          <div className="field-row">
            {field('keyId', 'Access key')}
            {field('secret', 'Secret key', { type: 'password' })}
          </div>
        </>
      )}
      <label className="field">
        <span>Mot de passe de chiffrement restic</span>
        <input className="input mono" type="password" value={f.password} onChange={(e) => set('password', e.target.value)} placeholder="laisser vide pour en générer un" />
        <small>Pour rattacher un dépôt existant, saisis son mot de passe actuel.</small>
      </label>
    </Sheet>
  );
}
