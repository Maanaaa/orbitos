import { useEffect, useState } from 'react';
import { Plus, Server, Trash2, Zap, CheckCircle2, XCircle, Eye, EyeOff, Terminal as TermIcon } from 'lucide-react';
import { api, sapi } from '../lib/api';
import { useOS, run, confirm, type Server as S } from '../os/store';
import { Sheet, Spinner, Switch } from '../os/ui';
import { appById, type AppProps } from './registry';

export default function Servers(_: AppProps) {
  const { servers, serverId, setServer, setServers, open } = useOS();
  const [pings, setPings] = useState<Record<string, any>>({});
  const [adding, setAdding] = useState(false);

  const reload = () => api<S[]>('/api/servers').then(setServers);
  const ping = async (id: string) => {
    setPings((p) => ({ ...p, [id]: 'loading' }));
    try {
      const r = await sapi(id, 'ping');
      setPings((p) => ({ ...p, [id]: r }));
    } catch (e: any) {
      setPings((p) => ({ ...p, [id]: { error: e.message } }));
    }
  };
  useEffect(() => {
    servers.filter((s) => !s.hidden).forEach((s) => ping(s.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers.length]);

  const remove = async (s: S) => {
    if (!(await confirm({ title: `Retirer ${s.name} d’OrbitOS ?`, message: 'Rien n’est modifié sur le serveur lui-même.', confirm: 'Retirer', danger: true }))) return;
    await run('Serveur retiré', () => api(`/api/servers/${encodeURIComponent(s.id)}`, { method: 'DELETE' }));
    reload();
  };
  const forget = async (s: S) => {
    const ok = await confirm({
      title: `Oublier la clé d’hôte de ${s.name} ?`,
      message: 'À ne faire que si tu sais pourquoi la clé a changé (serveur réinstallé). La prochaine connexion acceptera la nouvelle clé.',
      confirm: 'Oublier',
      danger: true,
    });
    if (!ok) return;
    await run('Clé d’hôte oubliée', () => api(`/api/servers/${encodeURIComponent(s.id)}/forget-hostkey`, { method: 'POST' }));
    ping(s.id);
  };
  const toggleHidden = async (s: S) => {
    await api(`/api/servers/${encodeURIComponent(s.id)}`, { method: 'PATCH', body: { hidden: !s.hidden } });
    reload();
  };

  return (
    <div className="app-col">
      <div className="toolbar">
        <h2>Serveurs</h2>
        <span className="faint" style={{ fontSize: 12 }}>Source : ~/.ssh/config (lecture seule) + serveurs ajoutés ici</span>
        <div className="grow" />
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Plus size={13} /> Ajouter
        </button>
      </div>
      <div className="content pad">
        <div className="group-box">
          {servers.map((s) => {
            const p = pings[s.id];
            return (
              <div className="gb-row" key={s.id} style={{ opacity: s.hidden ? 0.5 : 1, padding: '12px 14px' }}>
                <div className="app-icon" style={{ width: 36, height: 36, background: 'linear-gradient(160deg,#79e1ff,#3653d6 75%)', flex: 'none' }}>
                  <Server size={18} />
                </div>
                <div className="label">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <b>{s.name}</b>
                    {s.id === serverId && <span className="badge blue">actif</span>}
                    <span className="badge">{s.source === 'ssh-config' ? '~/.ssh/config' : 'OrbitOS'}</span>
                  </div>
                  <small className="mono">
                    {s.user}@{s.host}:{s.port}
                  </small>
                  {p && p !== 'loading' && p.error && <small style={{ color: '#ff8a80', whiteSpace: 'normal' }}>{p.error}</small>}
                  {p && p !== 'loading' && p.error?.includes('Oublier la clé') && (
                    <button className="btn sm danger" style={{ marginTop: 6 }} onClick={() => forget(s)}>
                      Oublier la clé d’hôte
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
                  {p === 'loading' ? (
                    <Spinner size={14} />
                  ) : p?.error ? (
                    <XCircle size={16} color="var(--red)" />
                  ) : p ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }} className="mono faint">
                      <CheckCircle2 size={16} color="var(--green)" /> {p.latency} ms
                      {p.caps.root ? <span className="badge orange">root</span> : p.caps.sudo ? <span className="badge blue">sudo</span> : null}
                      {p.caps.docker && <span className="badge cyan">docker</span>}
                    </span>
                  ) : null}
                  <button className="btn sm ghost icon" title="Tester la connexion" onClick={() => ping(s.id)}>
                    <Zap size={12} />
                  </button>
                  <button className="btn sm ghost icon" title="Terminal" onClick={() => open('terminal', { newTab: { mode: 'shell', server: s.id } }, { singleton: true, size: appById('terminal')!.size })}>
                    <TermIcon size={12} />
                  </button>
                  <button className="btn sm ghost icon" title={s.hidden ? 'Afficher' : 'Masquer'} onClick={() => toggleHidden(s)}>
                    {s.hidden ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  {s.source === 'orbitos' && (
                    <button className="btn sm ghost icon" title="Retirer" onClick={() => remove(s)}>
                      <Trash2 size={12} />
                    </button>
                  )}
                  <button className="btn sm" disabled={s.id === serverId || s.hidden} onClick={() => setServer(s.id)}>
                    Utiliser
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.6 }}>
          Les clés d’hôte sont vérifiées strictement avec ton <span className="mono">~/.ssh/known_hosts</span>. Si la clé d’un serveur a changé, la connexion est refusée (protection MITM). Un serveur jamais vu est accepté au premier contact puis mémorisé.
        </div>
      </div>
      {adding && <AddServer onClose={() => setAdding(false)} onDone={() => (setAdding(false), reload())} />}
    </div>
  );
}

function AddServer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ id: '', name: '', host: '', port: '22', user: 'root', identityFile: '' });
  const [keys, setKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [useDefault, setUseDefault] = useState(true);
  useEffect(() => {
    api<string[]>('/api/keys').then((k) => {
      setKeys(k);
      if (k[0]) setF((x) => ({ ...x, identityFile: k.includes('id_ed25519') ? 'id_ed25519' : k[0] }));
    });
  }, []);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setBusy(true);
    const r = await run('Serveur ajouté', () => api('/api/servers', { body: { ...f, id: f.id || f.name.toLowerCase().replace(/[^a-z0-9_.-]/g, '-'), identityFile: useDefault ? '' : f.identityFile } }));
    setBusy(false);
    if (r) onDone();
  };
  return (
    <Sheet
      title="Ajouter un serveur"
      subtitle="Connexion SSH par clé. La clé privée reste dans ~/.ssh, elle n’est jamais copiée."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={busy || !f.host || !(f.id || f.name)} onClick={submit}>
            {busy ? <Spinner size={12} /> : <Plus size={13} />} Ajouter
          </button>
        </>
      }
    >
      <div className="field-row">
        <label className="field">
          <span>Nom</span>
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="hetzner-prod" autoFocus />
        </label>
        <label className="field">
          <span>Identifiant</span>
          <input className="input mono" value={f.id} onChange={(e) => set('id', e.target.value)} placeholder={f.name.toLowerCase().replace(/[^a-z0-9_.-]/g, '-') || 'auto'} />
        </label>
      </div>
      <div className="field-row">
        <label className="field" style={{ flex: 3 }}>
          <span>Hôte</span>
          <input className="input mono" value={f.host} onChange={(e) => set('host', e.target.value.trim())} placeholder="203.0.113.10" />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>Port</span>
          <input className="input mono" value={f.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="field" style={{ flex: 2 }}>
          <span>Utilisateur</span>
          <input className="input mono" value={f.user} onChange={(e) => set('user', e.target.value.trim())} />
        </label>
      </div>
      <div className="group-box" style={{ marginBottom: 12 }}>
        <div className="gb-row">
          <span className="label">
            Clés par défaut
            <small>id_ed25519, id_ecdsa, id_rsa</small>
          </span>
          <Switch on={useDefault} onChange={setUseDefault} />
        </div>
        {!useDefault && (
          <div className="gb-row">
            <span className="label">Clé privée</span>
            <select className="select" value={f.identityFile} onChange={(e) => set('identityFile', e.target.value)}>
              {keys.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="faint" style={{ fontSize: 12 }}>
        Astuce : un serveur ajouté dans ton <span className="mono">~/.ssh/config</span> apparaît automatiquement ici.
      </div>
    </Sheet>
  );
}
