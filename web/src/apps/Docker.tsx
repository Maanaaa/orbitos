import { useEffect, useMemo, useState } from 'react';
import { Box, Layers, Image as ImageIcon, Database, Play, Square, RotateCw, ScrollText, SquareTerminal, FolderOpen, RefreshCw, Trash2, Eye, EyeOff, FileCode2, Download, Sparkles, Globe, AlertTriangle } from 'lucide-react';
import { sapi, useApi } from '../lib/api';
import { bytes } from '../lib/format';
import { useOS, useServer, confirm, run, toast } from '../os/store';
import { ErrorBox, Loading, SearchField, StateBadge, Empty, Spinner, useSort } from '../os/ui';
import { appById, type AppProps } from './registry';

type Tab = 'containers' | 'stacks' | 'images' | 'volumes';

export default function Docker({ win }: AppProps) {
  const sid = useServer();
  const [tab, setTab] = useState<Tab>(win.props.tab || 'containers');
  const [select, setSelect] = useState<string | null>(win.props.select || null);
  const containers = useApi(() => sapi(sid, 'docker/containers'), [sid], { interval: 10000 });

  useEffect(() => {
    if (win.props.tab) setTab(win.props.tab);
    if (win.props.select) setSelect(win.props.select);
  }, [win.props.nonce, win.props.tab, win.props.select]);

  const cs = containers.data || [];
  const counts = { running: cs.filter((c: any) => c.state === 'running').length, total: cs.length };

  return (
    <div className="app">
      <div className="sidebar">
        <div className="sb-title">Docker</div>
        <button className={`sb-item ${tab === 'containers' ? 'on' : ''}`} onClick={() => setTab('containers')}>
          <Box size={15} /> Conteneurs <span className="count">{counts.running}/{counts.total}</span>
        </button>
        <button className={`sb-item ${tab === 'stacks' ? 'on' : ''}`} onClick={() => setTab('stacks')}>
          <Layers size={15} /> Stacks
        </button>
        <button className={`sb-item ${tab === 'images' ? 'on' : ''}`} onClick={() => setTab('images')}>
          <ImageIcon size={15} /> Images
        </button>
        <button className={`sb-item ${tab === 'volumes' ? 'on' : ''}`} onClick={() => setTab('volumes')}>
          <Database size={15} /> Volumes
        </button>
      </div>
      {tab === 'containers' && <Containers sid={sid} api={containers} select={select} setSelect={setSelect} />}
      {tab === 'stacks' && <Stacks sid={sid} onContainer={(n) => (setTab('containers'), setSelect(n))} />}
      {tab === 'images' && <Images sid={sid} />}
      {tab === 'volumes' && <Volumes sid={sid} />}
    </div>
  );
}

function useActions(sid: string, reload: () => void) {
  const { open } = useOS();
  const act = async (name: string, action: string) => {
    const labels: Record<string, string> = { start: 'Démarrer', stop: 'Arrêter', restart: 'Redémarrer', rm: 'Supprimer' };
    if (action !== 'start') {
      const ok = await confirm({
        title: `${labels[action]} ${name} ?`,
        message: action === 'rm' ? 'Le conteneur est supprimé (ses volumes nommés sont conservés).' : 'Le service sera interrompu le temps de l’opération.',
        confirm: labels[action],
        danger: true,
      });
      if (!ok) return;
    }
    await run(`${labels[action]} ${name}`, () => sapi(sid, `docker/containers/${encodeURIComponent(name)}/${action}`, { method: 'POST' }));
    reload();
  };
  const logs = (name: string) => open('console', { source: { kind: 'container', target: name } }, { size: appById('console')!.size });
  const shell = (name: string) => open('terminal', { newTab: { mode: 'container', target: name, server: sid } }, { singleton: true, size: appById('terminal')!.size });
  const files = async (name: string) => {
    try {
      const r = await sapi(sid, `docker/containers/${encodeURIComponent(name)}/root`);
      open('finder', { path: r.path, container: name }, { size: appById('finder')!.size });
    } catch (e: any) {
      toast('Impossible d’ouvrir les fichiers', 'error', e.message);
    }
  };
  return { act, logs, shell, files };
}

function Containers({ sid, api: c, select, setSelect }: { sid: string; api: any; select: string | null; setSelect: (s: string | null) => void }) {
  const [qv, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const { act, logs, shell, files } = useActions(sid, () => c.reload(true));

  const rows = useMemo(() => {
    let r = c.data || [];
    if (filter === 'running') r = r.filter((x: any) => x.state === 'running');
    if (filter === 'stopped') r = r.filter((x: any) => x.state !== 'running');
    if (qv) r = r.filter((x: any) => `${x.name} ${x.image} ${x.project || ''}`.toLowerCase().includes(qv.toLowerCase()));
    return r;
  }, [c.data, qv, filter]);

  const groups = useMemo(() => {
    const g = new Map<string, any[]>();
    for (const r of rows) {
      const k = r.project || '— sans stack —';
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(r);
    }
    return [...g.entries()].sort((a, b) => (a[0].startsWith('—') ? 1 : b[0].startsWith('—') ? -1 : a[0].localeCompare(b[0])));
  }, [rows]);

  return (
    <div className="split">
      <div className="app-col">
        <div className="toolbar">
          <h2>Conteneurs</h2>
          <div className="segmented">
            {(['all', 'running', 'stopped'] as const).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {{ all: 'Tous', running: 'Actifs', stopped: 'Arrêtés' }[f]}
              </button>
            ))}
          </div>
          <div className="grow" />
          <SearchField value={qv} onChange={setQ} width={180} />
          <button className="btn ghost icon" onClick={() => c.reload()} title="Actualiser">
            {c.loading ? <Spinner size={13} /> : <RefreshCw size={14} />}
          </button>
        </div>
        <ErrorBox error={c.error} onRetry={() => c.reload()} />
        <div className="content">
          {!c.data && !c.error ? (
            <Loading />
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>État</th>
                  <th>Image</th>
                  <th>Ports</th>
                  <th>Statut</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {groups.map(([g, list]) => (
                  <GroupRows key={g} name={g} list={list} select={select} setSelect={setSelect} act={act} logs={logs} shell={shell} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {select && <ContainerDetail sid={sid} name={select} onClose={() => setSelect(null)} act={act} logs={logs} shell={shell} files={files} />}
    </div>
  );
}

function GroupRows({ name, list, select, setSelect, act, logs, shell }: any) {
  return (
    <>
      <tr className="group">
        <td colSpan={6}>
          <Layers size={11} style={{ verticalAlign: -1, marginRight: 6 }} />
          {name} <span className="faint" style={{ fontWeight: 400 }}>· {list.filter((c: any) => c.state === 'running').length}/{list.length}</span>
        </td>
      </tr>
      {list.map((ct: any) => (
        <tr key={ct.name} className={select === ct.name ? 'sel' : ''} onClick={() => setSelect(ct.name)} onDoubleClick={() => logs(ct.name)}>
          <td>
            <b style={{ fontWeight: 550 }}>{ct.name}</b>
          </td>
          <td>
            <StateBadge state={ct.state} health={ct.health} />
          </td>
          <td className="mono muted ellipsis" style={{ maxWidth: 240, fontSize: 11.5 }} title={ct.image}>
            {ct.image}
          </td>
          <td className="mono" style={{ fontSize: 11.5 }}>
            {ct.ports
              .filter((p: any) => p.hostPort)
              .slice(0, 3)
              .map((p: any) => (
                <span key={`${p.hostPort}-${p.port}`} style={{ color: p.public ? 'var(--orange)' : 'var(--text-2)', marginRight: 6 }} title={p.public ? 'Exposé sur Internet (contourne UFW)' : 'Local'}>
                  {p.public ? '⚠︎ ' : ''}
                  {p.hostPort}→{p.port}
                </span>
              ))}
          </td>
          <td className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{ct.status}</td>
          <td>
            <div className="row-actions" onClick={(e) => e.stopPropagation()}>
              {ct.state === 'running' ? (
                <>
                  <button className="btn sm ghost icon" title="Logs" onClick={() => logs(ct.name)}>
                    <ScrollText size={12} />
                  </button>
                  <button className="btn sm ghost icon" title="Shell" onClick={() => shell(ct.name)}>
                    <SquareTerminal size={12} />
                  </button>
                  <button className="btn sm ghost icon" title="Redémarrer" onClick={() => act(ct.name, 'restart')}>
                    <RotateCw size={12} />
                  </button>
                  <button className="btn sm ghost icon" title="Arrêter" onClick={() => act(ct.name, 'stop')}>
                    <Square size={11} />
                  </button>
                </>
              ) : (
                <button className="btn sm ghost icon" title="Démarrer" onClick={() => act(ct.name, 'start')}>
                  <Play size={12} />
                </button>
              )}
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

function ContainerDetail({ sid, name, onClose, act, logs, shell, files }: any) {
  const d = useApi(() => sapi(sid, `docker/containers/${encodeURIComponent(name)}`), [sid, name], { interval: 15000 });
  const [showSecrets, setShowSecrets] = useState(false);
  const { open } = useOS();
  const i = d.data;
  return (
    <div className="detail">
      <div className="toolbar" style={{ position: 'sticky', top: 0, background: 'rgba(24,26,34,.96)', zIndex: 2 }}>
        <Box size={16} color="var(--cyan)" />
        <b className="ellipsis" style={{ flex: 1 }}>{name}</b>
        <button className="btn ghost sm" onClick={onClose}>
          Fermer
        </button>
      </div>
      <ErrorBox error={d.error} />
      {!i ? (
        !d.error && <Loading />
      ) : (
        <div className="pad">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {i.state.Running ? (
              <>
                <button className="btn sm" onClick={() => act(name, 'restart')}>
                  <RotateCw size={12} /> Redémarrer
                </button>
                <button className="btn sm" onClick={() => act(name, 'stop')}>
                  <Square size={11} /> Arrêter
                </button>
                <button className="btn sm" onClick={() => shell(name)}>
                  <SquareTerminal size={12} /> Shell
                </button>
                <button className="btn sm" onClick={() => files(name)}>
                  <FolderOpen size={12} /> Fichiers
                </button>
              </>
            ) : (
              <>
                <button className="btn sm primary" onClick={() => act(name, 'start')}>
                  <Play size={12} /> Démarrer
                </button>
                <button className="btn sm danger" onClick={() => act(name, 'rm')}>
                  <Trash2 size={12} /> Supprimer
                </button>
              </>
            )}
            <button className="btn sm" onClick={() => logs(name)}>
              <ScrollText size={12} /> Logs
            </button>
          </div>

          <dl className="kv">
            <dt>État</dt>
            <dd>
              <StateBadge state={i.state.Status} health={i.state.Health?.Status} /> {i.state.Running ? `depuis ${new Date(i.state.StartedAt).toLocaleString('fr-FR')}` : i.state.ExitCode != null ? `code ${i.state.ExitCode}` : ''}
            </dd>
            <dt>Image</dt>
            <dd className="mono">{i.image}</dd>
            <dt>Redémarrages</dt>
            <dd>
              {i.restartCount} · politique <span className="mono">{i.restartPolicy?.Name || 'no'}</span>
            </dd>
            <dt>Commande</dt>
            <dd className="mono" style={{ fontSize: 11.5 }}>{i.cmd}</dd>
            {i.memoryLimit > 0 && (
              <>
                <dt>Limite RAM</dt>
                <dd>{bytes(i.memoryLimit)}</dd>
              </>
            )}
            {i.labels['com.docker.compose.project'] && (
              <>
                <dt>Stack</dt>
                <dd>{i.labels['com.docker.compose.project']}</dd>
              </>
            )}
            {i.labels['com.docker.compose.project.working_dir'] && (
              <>
                <dt>Dossier</dt>
                <dd>
                  <a onClick={() => open('finder', { path: i.labels['com.docker.compose.project.working_dir'] }, { size: appById('finder')!.size })} className="mono" style={{ fontSize: 11.5 }}>
                    {i.labels['com.docker.compose.project.working_dir']}
                  </a>
                </dd>
              </>
            )}
          </dl>

          <div className="section-title" style={{ marginTop: 18 }}>Ports</div>
          {Object.keys(i.ports).length === 0 ? (
            <div className="faint">Aucun</div>
          ) : (
            <div className="group-box">
              {Object.entries(i.ports).map(([k, v]: any) => (
                <div className="gb-row" key={k}>
                  <span className="mono">{k}</span>
                  <span className="label mono muted" style={{ textAlign: 'right' }}>
                    {(v || []).map((b: any) => `${b.HostIp || '0.0.0.0'}:${b.HostPort}`).join(', ') || 'interne'}
                  </span>
                  {(v || []).some((b: any) => !b.HostIp || b.HostIp === '0.0.0.0' || b.HostIp === '::') && (
                    <span title="Exposé sur Internet : Docker contourne UFW">
                      <AlertTriangle size={13} color="var(--orange)" />
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="section-title">Montages</div>
          {i.mounts.length === 0 ? (
            <div className="faint">Aucun</div>
          ) : (
            <div className="group-box">
              {i.mounts.map((m: any) => (
                <div className="gb-row" key={m.destination}>
                  <div className="label">
                    <span className="mono" style={{ fontSize: 11.5 }}>{m.destination}</span>
                    <small className="mono ellipsis">{m.type === 'volume' ? `volume ${m.name}` : m.source}</small>
                  </div>
                  {!m.rw && <span className="badge">ro</span>}
                  <button className="btn sm ghost icon" title="Ouvrir dans le Finder" onClick={() => open('finder', { path: m.source }, { size: appById('finder')!.size })}>
                    <FolderOpen size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="section-title">Réseaux</div>
          <div className="group-box">
            {i.networks.map((n: any) => (
              <div className="gb-row" key={n.name}>
                <span className="label">{n.name}</span>
                <span className="mono muted">{n.ip || '—'}</span>
              </div>
            ))}
          </div>

          <div className="section-title" style={{ display: 'flex', alignItems: 'center' }}>
            Environnement ({i.env.length})
            <button className="btn sm ghost" style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }} onClick={() => setShowSecrets(!showSecrets)}>
              {showSecrets ? <EyeOff size={12} /> : <Eye size={12} />} {showSecrets ? 'Masquer' : 'Révéler'} les secrets
            </button>
          </div>
          <div className="group-box selectable">
            {i.env.map((e: any) => (
              <div className="gb-row" key={e.key} style={{ minHeight: 30, padding: '5px 12px' }}>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--cyan)' }}>{e.key}</span>
                <span className="label mono muted ellipsis" style={{ textAlign: 'right', fontSize: 11.5 }} title={showSecrets || !e.secret ? e.value : ''}>
                  {e.secret && !showSecrets ? '••••••••' : e.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stacks({ sid, onContainer }: { sid: string; onContainer: (n: string) => void }) {
  const s = useApi(() => sapi(sid, 'docker/stacks'), [sid], { interval: 15000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [output, setOutput] = useState<{ title: string; text: string } | null>(null);
  const { open } = useOS();
  const [qv, setQ] = useState('');

  const act = async (st: any, action: string) => {
    const labels: Record<string, string> = { start: 'Démarrer', stop: 'Arrêter', restart: 'Redémarrer', up: 'Redéployer (up -d)', pull: 'Mettre à jour les images (pull)', down: 'Arrêter et supprimer (down)' };
    const portainerWarn = st.managedBy === 'portainer' && ['up', 'down', 'pull'].includes(action) ? '\n\nCette stack est gérée par Portainer : préfère un redéploiement depuis Portainer pour garder ses variables d’environnement.' : '';
    if (action !== 'start') {
      const ok = await confirm({ title: `${labels[action]} « ${st.name} » ?`, message: `${st.total} conteneur(s) concerné(s).${portainerWarn}`, confirm: labels[action].split(' ')[0], danger: true });
      if (!ok) return;
    }
    setBusy(`${st.name}:${action}`);
    const r = await run(`${labels[action]} ${st.name}`, () => sapi(sid, `docker/stacks/${encodeURIComponent(st.name)}/${action}`, { method: 'POST' }));
    setBusy(null);
    if (typeof r === 'string' && r.trim() && ['up', 'pull', 'down'].includes(action)) setOutput({ title: `${st.name} — ${action}`, text: r });
    s.reload(true);
  };

  const list = (s.data || []).filter((x: any) => !qv || x.name.toLowerCase().includes(qv.toLowerCase()));

  return (
    <div className="app-col">
      <div className="toolbar">
        <h2>Stacks</h2>
        <span className="faint" style={{ fontSize: 12 }}>Portainer, /root, /opt… toutes sources confondues</span>
        <div className="grow" />
        <SearchField value={qv} onChange={setQ} width={170} />
        <button className="btn ghost icon" onClick={() => s.reload()}>
          {s.loading ? <Spinner size={13} /> : <RefreshCw size={14} />}
        </button>
      </div>
      <ErrorBox error={s.error} />
      <div className="content pad">
        {!s.data && !s.error && <Loading />}
        <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {list.map((st: any) => {
            const allUp = st.running === st.total && st.total > 0;
            const none = st.running === 0;
            return (
              <div className="card" key={st.name} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`status-dot ${allUp ? 'green' : none ? 'red' : 'orange'}`} />
                  <b className="ellipsis" style={{ flex: 1, fontSize: 13.5 }} title={st.name}>{st.name}</b>
                  <span className={`badge ${st.managedBy === 'portainer' ? 'blue' : 'purple'}`}>{st.managedBy === 'portainer' ? 'Portainer' : 'Compose'}</span>
                </div>
                <div className="mono faint ellipsis" style={{ fontSize: 11 }} title={st.configFiles.join('\n')}>{st.workdir}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {st.containers.map((c: any) => (
                    <button key={c.name} className="badge" style={{ border: 0, cursor: 'default', color: c.state === 'running' ? (c.health === 'unhealthy' ? '#ff6b61' : '#4ade80') : 'var(--text-3)' }} onClick={() => onContainer(c.name)} title={`${c.image} · ${c.state}`}>
                      ● {c.service || c.name}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 'auto', flexWrap: 'wrap' }}>
                  {none ? (
                    <button className="btn sm primary" disabled={!!busy} onClick={() => act(st, 'start')}>
                      <Play size={11} /> Démarrer
                    </button>
                  ) : (
                    <>
                      <button className="btn sm" disabled={!!busy} onClick={() => act(st, 'restart')}>
                        {busy === `${st.name}:restart` ? <Spinner size={11} /> : <RotateCw size={11} />} Redémarrer
                      </button>
                      <button className="btn sm" disabled={!!busy} onClick={() => act(st, 'stop')}>
                        <Square size={10} /> Arrêter
                      </button>
                    </>
                  )}
                  <button className="btn sm" disabled={!!busy || st.filesFound.length !== st.configFiles.length} onClick={() => act(st, 'pull')} title="docker compose pull">
                    {busy === `${st.name}:pull` ? <Spinner size={11} /> : <Download size={11} />}
                  </button>
                  <button className="btn sm" disabled={!!busy || st.filesFound.length !== st.configFiles.length} onClick={() => act(st, 'up')} title="docker compose up -d">
                    {busy === `${st.name}:up` ? <Spinner size={11} /> : <Sparkles size={11} />} Up
                  </button>
                  <div className="grow" style={{ flex: 1 }} />
                  {st.filesFound[0] && (
                    <button className="btn sm ghost icon" title="Éditer le compose" onClick={() => open('editor', { path: st.filesFound[0], server: sid }, { size: appById('editor')!.size, title: st.filesFound[0].split('/').pop() })}>
                      <FileCode2 size={12} />
                    </button>
                  )}
                  <button className="btn sm ghost icon" title="Ouvrir le dossier" onClick={() => open('finder', { path: st.workdir }, { size: appById('finder')!.size })}>
                    <FolderOpen size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {output && (
        <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOutput(null)}>
          <div className="sheet wide">
            <div className="sheet-head">
              <h3>{output.title}</h3>
            </div>
            <div className="sheet-body">
              <pre className="code">{output.text}</pre>
            </div>
            <div className="sheet-foot">
              <button className="btn primary" onClick={() => setOutput(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Images({ sid }: { sid: string }) {
  const im = useApi(() => sapi(sid, 'docker/images'), [sid]);
  const { sorted, th } = useSort<any>(im.data, { key: 'repository', dir: 1 });
  const dangling = (im.data || []).filter((i: any) => i.dangling).length;
  const prune = async () => {
    if (!(await confirm({ title: `Supprimer ${dangling} images orphelines ?`, message: 'docker image prune -f : seules les images <none> non utilisées sont supprimées.', confirm: 'Nettoyer', danger: true }))) return;
    const r: any = await run('Images orphelines supprimées', () => sapi(sid, 'docker/images', { body: { action: 'prune-dangling' } }));
    if (typeof r === 'string') toast('Espace libéré', 'info', r.split('\n').filter((l) => /reclaimed/i.test(l)).join('') || undefined);
    im.reload(true);
  };
  const rm = async (i: any) => {
    const ref = i.dangling ? i.id : `${i.repository}:${i.tag}`;
    if (!(await confirm({ title: `Supprimer l’image ${ref} ?`, confirm: 'Supprimer', danger: true }))) return;
    await run('Image supprimée', () => sapi(sid, 'docker/images', { body: { action: 'rm', ref } }));
    im.reload(true);
  };
  const pull = async (i: any) => {
    const ref = `${i.repository}:${i.tag}`;
    await run(`Image à jour : ${ref}`, () => sapi(sid, 'docker/images', { body: { action: 'pull', ref } }));
    im.reload(true);
  };
  return (
    <div className="app-col">
      <div className="toolbar">
        <h2>Images</h2>
        <span className="faint" style={{ fontSize: 12 }}>{im.data?.length ?? '…'} images</span>
        <div className="grow" />
        {dangling > 0 && (
          <button className="btn sm danger" onClick={prune}>
            <Sparkles size={12} /> Nettoyer {dangling} orphelines
          </button>
        )}
        <button className="btn ghost icon" onClick={() => im.reload()}>
          <RefreshCw size={14} />
        </button>
      </div>
      <ErrorBox error={im.error} />
      <div className="content">
        {!im.data && !im.error ? (
          <Loading />
        ) : (
          <table className="grid">
            <thead>
              <tr>
                {th('repository', 'Dépôt')}
                {th('tag', 'Tag')}
                {th('id', 'ID')}
                {th('created', 'Créée')}
                {th('size', 'Taille', 'num')}
                <th>Usage</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((i: any) => (
                <tr key={i.id + i.tag + i.repository}>
                  <td className="ellipsis" style={{ maxWidth: 320 }}>{i.repository}</td>
                  <td>
                    <span className={`badge ${i.tag === 'latest' ? 'orange' : i.tag === '<none>' ? '' : 'blue'}`}>{i.tag}</span>
                  </td>
                  <td className="mono faint" style={{ fontSize: 11.5 }}>{i.id}</td>
                  <td className="muted">{i.created}</td>
                  <td className="num">{i.size}</td>
                  <td>{i.inUse ? <span className="badge green">utilisée</span> : i.dangling ? <span className="badge">orpheline</span> : <span className="faint">—</span>}</td>
                  <td>
                    <div className="row-actions">
                      {!i.dangling && (
                        <button className="btn sm ghost icon" title="Pull" onClick={() => pull(i)}>
                          <Download size={12} />
                        </button>
                      )}
                      {!i.inUse && (
                        <button className="btn sm ghost icon" title="Supprimer" onClick={() => rm(i)}>
                          <Trash2 size={12} />
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
    </div>
  );
}

function Volumes({ sid }: { sid: string }) {
  const v = useApi(() => sapi(sid, 'docker/volumes'), [sid]);
  const [sizes, setSizes] = useState<Record<string, number | 'loading'>>({});
  const [onlyOrphans, setOnlyOrphans] = useState(false);
  const { open } = useOS();
  const size = async (name: string) => {
    setSizes((s) => ({ ...s, [name]: 'loading' }));
    try {
      const r = await sapi(sid, `docker/volumes/${encodeURIComponent(name)}/size`);
      setSizes((s) => ({ ...s, [name]: r.size }));
    } catch {
      setSizes((s) => {
        const { [name]: _, ...rest } = s;
        return rest;
      });
    }
  };
  const rows = (v.data || []).filter((x: any) => !onlyOrphans || x.orphan);
  const { sorted, th } = useSort<any>(rows, { key: 'name', dir: 1 });
  return (
    <div className="app-col">
      <div className="toolbar">
        <h2>Volumes</h2>
        <span className="faint" style={{ fontSize: 12 }}>{v.data?.length ?? '…'} volumes · {(v.data || []).filter((x: any) => x.orphan).length} non rattachés</span>
        <div className="grow" />
        <button className={`btn sm ${onlyOrphans ? 'primary' : ''}`} onClick={() => setOnlyOrphans(!onlyOrphans)}>
          Non rattachés uniquement
        </button>
      </div>
      <ErrorBox error={v.error} />
      <div className="content">
        {!v.data && !v.error ? (
          <Loading />
        ) : sorted.length === 0 ? (
          <Empty title="Aucun volume" />
        ) : (
          <table className="grid">
            <thead>
              <tr>
                {th('name', 'Nom')}
                {th('project', 'Stack')}
                <th>Utilisé par</th>
                <th className="num">Taille</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((x: any) => (
                <tr key={x.name}>
                  <td className="mono ellipsis" style={{ maxWidth: 340, fontSize: 11.5 }} title={x.name}>
                    {x.name}
                  </td>
                  <td className="muted">{x.project || '—'}</td>
                  <td>{x.orphan ? <span className="badge orange">non rattaché</span> : <span className="muted ellipsis">{x.usedBy.join(', ') || 'conteneur arrêté'}</span>}</td>
                  <td className="num">
                    {sizes[x.name] === 'loading' ? (
                      <Spinner size={12} />
                    ) : sizes[x.name] != null ? (
                      bytes(sizes[x.name] as number)
                    ) : (
                      <button className="btn sm ghost" onClick={() => size(x.name)}>
                        Calculer
                      </button>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn sm ghost icon" title="Parcourir" onClick={() => open('finder', { path: x.mountpoint }, { size: appById('finder')!.size })}>
                        <FolderOpen size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export { Globe };
