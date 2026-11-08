import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  FileText,
  FileCode2,
  FileImage,
  FileArchive,
  File as FileIcon,
  Home,
  HardDrive,
  FolderPlus,
  Upload,
  RefreshCw,
  Globe,
  Box,
  Database,
  ScrollText,
  Lock,
  Eye,
  EyeOff,
  Link2,
  Archive,
} from 'lucide-react';
import { sapi, useApi } from '../lib/api';
import { bytes, dateTime, joinPath, parentPath } from '../lib/format';
import { useOS, useServer, confirm, prompt, run, toast } from '../os/store';
import { ErrorBox, Loading, SearchField, useMenu, useSort, Sheet, Empty } from '../os/ui';
import { appById, type AppProps } from './registry';

const TEXT_EXT = /\.(txt|md|conf|cnf|ini|env|ya?ml|json|jsonc|js|mjs|cjs|ts|tsx|jsx|css|scss|html?|xml|sh|bash|zsh|py|rb|php|go|rs|java|sql|toml|lock|log|service|timer|socket|csv|svg|dockerfile|gitignore|htaccess|properties|vue|svelte|astro)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|ico)$/i;
const ARCH_EXT = /\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i;

function iconFor(item: any) {
  if (item.type === 'dir') return <Folder className="file-icon" fill="rgba(90,170,255,.35)" color="#5eb0ff" />;
  if (IMG_EXT.test(item.name)) return <FileImage className="file-icon" color="var(--purple)" />;
  if (ARCH_EXT.test(item.name)) return <FileArchive className="file-icon" color="var(--orange)" />;
  if (/\.(js|ts|tsx|jsx|py|go|rs|php|sh|json|ya?ml|conf)$/i.test(item.name) || /^(Dockerfile|Makefile|compose)/.test(item.name)) return <FileCode2 className="file-icon" color="var(--cyan)" />;
  if (TEXT_EXT.test(item.name) || !item.name.includes('.')) return <FileText className="file-icon" color="var(--text-2)" />;
  return <FileIcon className="file-icon" color="var(--text-3)" />;
}

export default function Finder({ win }: AppProps) {
  const sid = useServer();
  const { open, update } = useOS();
  const [history, setHistory] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const path = history[hi] || '';
  const [sel, setSel] = useState<string | null>(null);
  const [qv, setQ] = useState('');
  const [hidden, setHidden] = useState(false);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const menu = useMenu();

  const places = useApi(() => sapi(sid, 'files/places'), [sid]);
  const containers = useApi(() => sapi(sid, 'docker/containers'), [sid]);
  const listing = useApi(path ? () => sapi(sid, `files/list?path=${encodeURIComponent(path)}`) : null, [sid, path]);

  const go = (p: string) => {
    setSel(null);
    setQ('');
    setHistory((h) => [...h.slice(0, hi + 1), p]);
    setHi((i) => i + 1);
  };

  // Chemin initial ou demandé par une autre app
  useEffect(() => {
    if (win.props.path) go(win.props.path);
    else if (places.data && !path) go(places.data.home || '/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.props.nonce, win.props.path, places.data]);

  useEffect(() => {
    update(win.id, { title: path ? `${path.split('/').filter(Boolean).pop() || '/'} — Finder` : 'Finder' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Changement de serveur : on repart du home
  const lastSid = useRef(sid);
  useEffect(() => {
    if (lastSid.current !== sid) {
      lastSid.current = sid;
      setHistory([]);
      setHi(-1);
    }
  }, [sid]);

  const items = useMemo(() => {
    const all = listing.data?.items || [];
    return all.filter((i: any) => (hidden || !i.name.startsWith('.')) && (!qv || i.name.toLowerCase().includes(qv.toLowerCase())));
  }, [listing.data, hidden, qv]);
  const { sorted, th } = useSort<any>(items, { key: 'name', dir: 1 });
  const dirsFirst = useMemo(() => [...sorted.filter((i) => i.type === 'dir'), ...sorted.filter((i) => i.type !== 'dir')], [sorted]);

  const openItem = (item: any) => {
    if (item.type === 'dir') return go(item.path);
    if (IMG_EXT.test(item.name)) return setPreview(item);
    if (item.size > 3 * 1024 * 1024) return download(item);
    open('editor', { path: item.path, server: sid }, { size: appById('editor')!.size, title: item.name });
  };

  const download = (item: any) => {
    const a = document.createElement('a');
    a.href = `/api/s/${encodeURIComponent(sid)}/files/download?path=${encodeURIComponent(item.path)}`;
    a.download = item.type === 'dir' ? `${item.name}.tar.gz` : item.name;
    a.click();
  };

  const newFolder = async () => {
    const name = await prompt({ title: 'Nouveau dossier', label: 'Nom du dossier', value: 'nouveau-dossier', confirm: 'Créer' });
    if (!name) return;
    await run('Dossier créé', () => sapi(sid, 'files/mkdir', { body: { path: joinPath(path, name) } }));
    listing.reload(true);
  };

  const newFile = async () => {
    const name = await prompt({ title: 'Nouveau fichier', label: 'Nom du fichier', value: 'nouveau.txt', confirm: 'Créer' });
    if (!name) return;
    const r = await run('Fichier créé', () => sapi(sid, 'files/write', { body: { path: joinPath(path, name), content: '' } }));
    listing.reload(true);
    if (r) open('editor', { path: joinPath(path, name), server: sid }, { size: appById('editor')!.size, title: name });
  };

  const renameItem = async (item: any) => {
    const name = await prompt({ title: `Renommer « ${item.name} »`, value: item.name, confirm: 'Renommer' });
    if (!name || name === item.name) return;
    await run('Renommé', () => sapi(sid, 'files/rename', { body: { from: item.path, to: joinPath(path, name) } }));
    listing.reload(true);
  };

  const trashItem = async (item: any) => {
    const ok = await confirm({
      title: `Mettre « ${item.name} » à la corbeille ?`,
      message: 'L’élément est déplacé dans /var/backups/orbitos/trash sur le serveur. Rien n’est effacé définitivement.',
      confirm: 'Corbeille',
      danger: true,
    });
    if (!ok) return;
    const r: any = await run('Déplacé dans la corbeille', () => sapi(sid, 'files/trash', { body: { path: item.path } }));
    if (r) toast('Corbeille', 'info', r.trashedTo);
    listing.reload(true);
  };

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    for (const [i, f] of list.entries()) {
      setBusy(`Envoi ${i + 1}/${list.length} : ${f.name}`);
      try {
        await sapi(sid, `files/upload?path=${encodeURIComponent(joinPath(path, f.name))}`, { method: 'PUT', raw: f, headers: { 'Content-Type': 'application/octet-stream' } });
      } catch (e: any) {
        toast(`Échec de l’envoi : ${f.name}`, 'error', e.message);
      }
    }
    setBusy('');
    toast(`${list.length} fichier${list.length > 1 ? 's' : ''} envoyé${list.length > 1 ? 's' : ''}`);
    listing.reload(true);
  };

  const openContainerFs = async (name: string) => {
    try {
      const r = await sapi(sid, `docker/containers/${encodeURIComponent(name)}/root`);
      go(r.path || r.root);
    } catch (e: any) {
      toast('Impossible d’ouvrir le conteneur', 'error', e.message);
    }
  };

  const ctx = (e: React.MouseEvent, item?: any) => {
    if (item) setSel(item.path);
    menu.openAt(
      e,
      item
        ? [
            { label: 'Ouvrir', onClick: () => openItem(item) },
            ...(item.type !== 'dir' ? [{ label: 'Ouvrir dans l’éditeur', onClick: () => open('editor', { path: item.path, server: sid }, { size: appById('editor')!.size, title: item.name }) }] : []),
            { label: item.type === 'dir' ? 'Télécharger (.tar.gz)' : 'Télécharger', onClick: () => download(item) },
            'sep',
            { label: 'Renommer…', onClick: () => renameItem(item) },
            { label: 'Copier le chemin', onClick: () => navigator.clipboard.writeText(item.path).then(() => toast('Chemin copié')) },
            ...(item.type === 'dir' ? [{ label: 'Ouvrir un terminal ici', onClick: () => open('terminal', { newTab: { mode: 'shell', server: sid, cwd: item.path } }, { singleton: true, size: appById('terminal')!.size }) }] : []),
            ...(item.path.startsWith('/var/log/') && item.type !== 'dir' ? [{ label: 'Suivre dans la Console', onClick: () => open('console', { source: { kind: 'file', target: item.path } }, { size: appById('console')!.size }) }] : []),
            'sep',
            { label: 'Mettre à la corbeille', danger: true, onClick: () => trashItem(item) },
          ]
        : [
            { label: 'Nouveau dossier…', onClick: newFolder },
            { label: 'Nouveau fichier…', onClick: newFile },
            { label: 'Envoyer des fichiers…', onClick: () => fileInput.current?.click() },
            'sep',
            { label: 'Ouvrir un terminal ici', onClick: () => open('terminal', { newTab: { mode: 'shell', server: sid, cwd: path } }, { singleton: true, size: appById('terminal')!.size }) },
            { label: hidden ? 'Masquer les fichiers cachés' : 'Afficher les fichiers cachés', onClick: () => setHidden(!hidden) },
          ],
    );
  };

  const crumbs = path.split('/').filter(Boolean);
  const placeIcon: Record<string, any> = {
    '/etc/nginx': Globe,
    '/var/www': Globe,
    '/opt': Box,
    '/srv': HardDrive,
    '/var/log': ScrollText,
    '/var/lib/docker/volumes': Database,
    '/etc/letsencrypt/live': Lock,
    '/var/backups/orbitos': Archive,
  };

  return (
    <div className="app" onKeyDown={(e) => {
      const it = dirsFirst.find((i) => i.path === sel);
      if (!it) return;
      if (e.key === 'Enter') openItem(it);
      if ((e.metaKey || e.ctrlKey) && e.key === 'Backspace') trashItem(it);
    }} tabIndex={-1}>
      <div className="sidebar">
        <div className="sb-title">Favoris</div>
        {places.data && (
          <>
            <button className={`sb-item ${path === places.data.home ? 'on' : ''}`} onClick={() => go(places.data.home)}>
              <Home size={15} /> {places.data.home === '/root' ? 'root' : places.data.home.split('/').pop()}
            </button>
            <button className={`sb-item ${path === '/' ? 'on' : ''}`} onClick={() => go('/')}>
              <HardDrive size={15} /> Racine
            </button>
            {places.data.dirs.map((d: string) => {
              const Ic = placeIcon[d] || Folder;
              return (
                <button key={d} className={`sb-item ${path === d ? 'on' : ''}`} onClick={() => go(d)} title={d}>
                  <Ic size={15} /> <span className="ellipsis">{d === '/var/lib/docker/volumes' ? 'Volumes Docker' : d === '/etc/letsencrypt/live' ? 'Certificats' : d === '/var/backups/orbitos' ? 'Sauvegardes & corbeille' : d}</span>
                </button>
              );
            })}
          </>
        )}
        {Array.isArray(containers.data) && containers.data.some((c: any) => c.state === 'running') && (
          <>
            <div className="sb-title">Conteneurs</div>
            {containers.data
              .filter((c: any) => c.state === 'running')
              .map((c: any) => (
                <button key={c.name} className={`sb-item ${path.startsWith('/proc/') && win.props.container === c.name ? 'on' : ''}`} onClick={() => openContainerFs(c.name)} title={`Système de fichiers de ${c.name}`}>
                  <Box size={15} style={{ color: 'var(--cyan)' }} /> <span className="ellipsis">{c.name}</span>
                </button>
              ))}
          </>
        )}
      </div>
      <div className="app-col" onDragOver={(e) => (e.preventDefault(), setDrag(true))} onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)} onDrop={(e) => (e.preventDefault(), setDrag(false), e.dataTransfer.files.length && upload(e.dataTransfer.files))}>
        <div className="toolbar">
          <button className="btn ghost icon" disabled={hi <= 0} onClick={() => setHi(hi - 1)}>
            <ChevronLeft size={16} />
          </button>
          <button className="btn ghost icon" disabled={hi >= history.length - 1} onClick={() => setHi(hi + 1)}>
            <ChevronRight size={16} />
          </button>
          <div className="pathbar" style={{ flex: 1 }}>
            <button onClick={() => go('/')}>/</button>
            {crumbs.map((c, i) => (
              <button key={i} onClick={() => go('/' + crumbs.slice(0, i + 1).join('/'))}>
                {c}
              </button>
            ))}
          </div>
          {busy && <span className="faint" style={{ fontSize: 12 }}>{busy}</span>}
          <button className="btn ghost icon" title={hidden ? 'Masquer les fichiers cachés' : 'Afficher les fichiers cachés'} onClick={() => setHidden(!hidden)}>
            {hidden ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
          <button className="btn ghost icon" title="Nouveau dossier" onClick={newFolder}>
            <FolderPlus size={15} />
          </button>
          <button className="btn ghost icon" title="Envoyer des fichiers" onClick={() => fileInput.current?.click()}>
            <Upload size={15} />
          </button>
          <button className="btn ghost icon" title="Actualiser" onClick={() => listing.reload()}>
            <RefreshCw size={14} />
          </button>
          <SearchField value={qv} onChange={setQ} width={160} />
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
        </div>
        <ErrorBox error={listing.error} onRetry={() => listing.reload()} />
        <div className="content" onContextMenu={(e) => ctx(e)} onClick={(e) => e.target === e.currentTarget && setSel(null)}>
          {listing.loading && !listing.data ? (
            <Loading />
          ) : dirsFirst.length === 0 && !listing.error ? (
            <Empty title={qv ? 'Aucun résultat' : 'Dossier vide'}>Glisse des fichiers ici pour les envoyer</Empty>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  {th('name', 'Nom')}
                  {th('mtime', 'Modifié')}
                  {th('size', 'Taille', 'num')}
                  <th>Droits</th>
                </tr>
              </thead>
              <tbody>
                {path !== '/' && (
                  <tr onDoubleClick={() => go(parentPath(path))}>
                    <td colSpan={4} className="muted">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <Folder className="file-icon" color="var(--text-3)" /> ..
                      </span>
                    </td>
                  </tr>
                )}
                {dirsFirst.map((it: any) => (
                  <tr key={it.path} className={sel === it.path ? 'sel' : ''} onClick={() => setSel(it.path)} onDoubleClick={() => openItem(it)} onContextMenu={(e) => ctx(e, it)} draggable={false}>
                    <td style={{ maxWidth: 420 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        {iconFor(it)}
                        <span className="ellipsis">{it.name}</span>
                        {it.link && <Link2 size={11} className="faint" style={{ flex: 'none' }} />}
                        {it.link && <span className="faint mono ellipsis" style={{ fontSize: 11 }}>→ {it.link}</span>}
                      </span>
                    </td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateTime(it.mtime)}</td>
                    <td className="num muted">{it.type === 'dir' ? '—' : bytes(it.size)}</td>
                    <td className="mono faint" style={{ fontSize: 11 }}>{it.mode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {drag && <div className="drop-zone">Déposer pour envoyer dans {path}</div>}
        </div>
        <div className="toolbar" style={{ borderTop: '0.5px solid var(--line)', borderBottom: 0, minHeight: 28, padding: '4px 12px', fontSize: 11.5 }}>
          <span className="faint">
            {dirsFirst.length} élément{dirsFirst.length > 1 ? 's' : ''}
            {listing.data && listing.data.items.length !== dirsFirst.length ? ` (${listing.data.items.length - dirsFirst.length} masqués)` : ''}
          </span>
        </div>
      </div>
      {preview && (
        <Sheet title={preview.name} subtitle={`${preview.path} · ${bytes(preview.size)}`} onClose={() => setPreview(null)} wide footer={<button className="btn" onClick={() => download(preview)}>Télécharger</button>}>
          <div style={{ display: 'grid', placeItems: 'center', background: 'repeating-conic-gradient(#1a1c24 0% 25%, #22252e 0% 50%) 50% / 20px 20px', borderRadius: 8, padding: 12 }}>
            <img src={`/api/s/${encodeURIComponent(sid)}/files/raw?path=${encodeURIComponent(preview.path)}`} style={{ maxWidth: '100%', maxHeight: '60vh' }} alt="" />
          </div>
        </Sheet>
      )}
      {menu.node}
    </div>
  );
}
