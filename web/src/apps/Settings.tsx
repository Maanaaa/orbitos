import { useEffect, useState } from 'react';
import { SlidersHorizontal, LayoutGrid, Plug, DatabaseBackup, ShieldCheck, Info, FolderGit2 as Github, Cloud, Download, Plus, ExternalLink, Sparkles } from 'lucide-react';
import { api, sapi, useApi } from '../lib/api';
import { useOS, run, toast, confirm } from '../os/store';
import { Switch, Spinner, ErrorBox } from '../os/ui';
import { TzList } from '../os/Onboarding';
import { Integrations } from './Sites';
import { AddRepoSheet } from './Backup';
import type { AppProps } from './registry';

type Section = 'general' | 'modules' | 'integrations' | 'backup' | 'security' | 'about';
const SECTIONS: [Section, string, any][] = [
  ['general', 'Général', SlidersHorizontal],
  ['modules', 'Modules', LayoutGrid],
  ['integrations', 'Intégrations', Plug],
  ['backup', 'Sauvegarde', DatabaseBackup],
  ['security', 'Sécurité', ShieldCheck],
  ['about', 'À propos', Info],
];

export default function Settings({ win }: AppProps) {
  const [sec, setSec] = useState<Section>(win.props.section || 'general');
  useEffect(() => {
    if (win.props.section) setSec(win.props.section);
  }, [win.props.nonce]);
  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div className="sidebar">
        {SECTIONS.map(([id, label, Ic]) => (
          <button key={id} className={`sb-item ${sec === id ? 'on' : ''}`} onClick={() => setSec(id)}>
            <Ic size={14} /> {label}
          </button>
        ))}
      </div>
      <div className="content pad" style={{ maxWidth: 720 }}>
        {sec === 'general' && <General />}
        {sec === 'modules' && <Modules />}
        {sec === 'integrations' && <IntegrationsSection />}
        {sec === 'backup' && <BackupSection />}
        {sec === 'security' && <Security />}
        {sec === 'about' && <About />}
      </div>
    </div>
  );
}

async function patch(body: any, label = 'Réglages enregistrés') {
  const s = await run(label, () => api('/api/settings', { method: 'PATCH', body }));
  if (s) useOS.setState({ settings: s as any });
  return s;
}

function General() {
  const settings = useOS((s) => s.settings);
  const [f, setF] = useState({ instanceName: '', timezone: '', defaultDomain: '' });
  useEffect(() => {
    if (settings) setF({ instanceName: settings.instanceName, timezone: settings.timezone, defaultDomain: settings.defaultDomain });
  }, [settings?.instanceName, settings?.timezone, settings?.defaultDomain]);
  if (!settings) return <Spinner />;
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Général</h2>
      <label className="field">
        <span>Nom de l’instance</span>
        <input className="input" value={f.instanceName} onChange={(e) => setF({ ...f, instanceName: e.target.value })} />
        <small>Affiché dans la barre de menus et l’onglet du navigateur.</small>
      </label>
      <div className="field-row">
        <label className="field">
          <span>Fuseau horaire</span>
          <input className="input mono" list="orbit-tz" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value.trim() })} />
          <small>Appliqué aux applications hébergées (variable TZ) et à Backrest lors de son installation.</small>
        </label>
        <label className="field">
          <span>Domaine principal</span>
          <input className="input mono" value={f.defaultDomain} placeholder="example.com" onChange={(e) => setF({ ...f, defaultDomain: e.target.value.trim().toLowerCase() })} />
          <small>Proposé pour les nouveaux sous-domaines et sites.</small>
        </label>
      </div>
      <TzList />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" onClick={() => patch(f)}>
          Enregistrer
        </button>
        <button className="btn ghost" onClick={() => patch({ onboarded: false }, 'Accueil relancé')}>
          <Sparkles size={12} /> Relancer l’accueil
        </button>
      </div>
    </>
  );
}

function Modules() {
  const settings = useOS((s) => s.settings);
  if (!settings) return <Spinner />;
  const groups = [...new Set(settings.catalog.map((m) => m.group))];
  const toggle = (id: string, v: boolean) => patch({ modules: { [id]: v } }, v ? 'Module activé' : 'Module désactivé');
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Modules</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5, lineHeight: 1.6 }}>
        Un module coupé disparaît du Dock, de Spotlight et des menus. Ceux marqués <span className="badge">API</span> sont aussi bloqués côté serveur. Serveurs, Journal et Réglages restent toujours disponibles.
      </p>
      {groups.map((g) => (
        <div key={g}>
          <div className="section-title">{g}</div>
          <div className="group-box">
            {settings.catalog
              .filter((m) => m.group === g)
              .map((m) => (
                <div key={m.id} className="gb-row">
                  <span className="label">
                    <span>
                      {m.name} {m.apiGuarded && <span className="badge" style={{ marginLeft: 4 }}>API</span>}
                    </span>
                    <small>{m.description}</small>
                  </span>
                  <Switch on={settings.modules[m.id] !== false} onChange={(v) => toggle(m.id, v)} />
                </div>
              ))}
          </div>
        </div>
      ))}
    </>
  );
}

function IntegrationsSection() {
  const integ = useApi(() => api('/api/integrations'), []);
  const [open, setOpen] = useState(false);
  const gh = integ.data?.github;
  const pt = integ.data?.portainer;
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Intégrations</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5, lineHeight: 1.6 }}>Les secrets restent dans le volume de données d’OrbitOS (fichier 0600) et ne sont jamais renvoyés au navigateur.</p>
      <ErrorBox error={integ.error} />
      <div className="group-box" style={{ marginBottom: 12 }}>
        <div className="gb-row">
          <Github size={16} />
          <span className="label">
            GitHub
            <small>{gh?.login ? `Connecté en tant que ${gh.login}` : gh?.error || 'Non connecté — requis pour les sites et bots depuis un dépôt privé'}</small>
          </span>
          <span className={`status-dot ${gh?.login ? 'green' : gh?.error ? 'red' : ''}`} />
        </div>
        <div className="gb-row">
          <Plug size={16} />
          <span className="label">
            Portainer
            <small>{pt?.configured ? `${pt.url} · serveur géré : ${pt.server || 'non précisé (à renseigner)'}` : 'Non configuré — les conteneurs passent par docker compose'}</small>
          </span>
          <span className={`status-dot ${pt?.configured && !pt?.error ? 'green' : pt?.error ? 'red' : ''}`} />
        </div>
      </div>
      {pt?.configured && !pt.server && (
        <div className="error-box" style={{ margin: '0 0 12px', fontSize: 12 }}>
          Renseigne le « serveur géré » de Portainer : sinon les applications de tous les serveurs seraient envoyées vers ce Portainer.
        </div>
      )}
      <button className="btn primary" onClick={() => setOpen(true)}>
        Configurer GitHub et Portainer
      </button>
      {open && <Integrations onClose={() => (setOpen(false), integ.reload(true))} />}
    </>
  );
}

function BackupSection() {
  const servers = useOS((s) => s.servers.filter((x) => !x.hidden));
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Sauvegarde</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5, lineHeight: 1.6 }}>
        OrbitOS pilote <b>Backrest</b>, qui exécute <b>restic</b> : sauvegardes chiffrées, dédupliquées, vers Backblaze B2, S3, un dossier local ou un rest-server. Installe Backrest sur un serveur, ajoute un dépôt, puis crée tes plans dans l’app Sauvegarde.
      </p>
      {servers.map((s) => (
        <BackrestServer key={s.id} sid={s.id} name={s.name} />
      ))}
    </>
  );
}

function BackrestServer({ sid, name }: { sid: string; name: string }) {
  const st = useApi(() => sapi(sid, 'backrest'), [sid]);
  const open = useOS((s) => s.open);
  const [repo, setRepo] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = st.data;
  const install = async () => {
    if (
      !(await confirm({
        title: `Installer Backrest sur ${name} ?`,
        message: 'Conteneur garethgeorge/backrest dans /opt/orbitos-backrest, lié à 127.0.0.1:9898 (accessible seulement via OrbitOS/SSH). Les dossiers de l’hôte sont montés en lecture seule ; /srv/restic accueille les dépôts locaux.',
        confirm: 'Installer',
      }))
    )
      return;
    setBusy(true);
    await run('Backrest installé', () => sapi(sid, 'backrest/install', { method: 'POST' }));
    setBusy(false);
    st.reload();
  };
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <DatabaseBackup size={18} color="var(--cyan)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{name}</b>
          <div className="faint" style={{ fontSize: 12 }}>
            {st.loading && !d ? 'Recherche de Backrest…' : !d ? st.error?.message : !d.found ? 'Backrest non installé' : d.error ? d.error : `Backrest ${d.instance || ''} · ${d.repos.length} dépôt(s) · ${d.plans.length} plan(s)`}
          </div>
        </div>
        {d && !d.found && (
          <button className="btn primary sm" disabled={busy} onClick={install}>
            {busy ? <Spinner size={11} /> : <Download size={12} />} Installer Backrest
          </button>
        )}
        {d?.found && !d.error && (
          <>
            <button className="btn sm" onClick={() => setRepo(true)}>
              <Plus size={11} /> Dépôt restic
            </button>
            <button className="btn sm ghost" onClick={() => (useOS.getState().setServer(sid), open('backup', {}, { singleton: true, size: { w: 1120, h: 680 } }))}>
              Ouvrir
            </button>
          </>
        )}
      </div>
      {d?.repos?.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {d.repos.map((r: any) => (
            <div key={r.id} className="faint mono" style={{ fontSize: 11.5, display: 'flex', gap: 6, alignItems: 'center' }}>
              <Cloud size={11} /> {r.id} — {r.uri}
            </div>
          ))}
        </div>
      )}
      {repo && <AddRepoSheet sid={sid} onClose={() => setRepo(false)} onDone={() => (setRepo(false), st.reload())} />}
    </div>
  );
}

function Security() {
  const settings = useOS((s) => s.settings);
  const readonly = useOS((s) => s.readonly);
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const change = async () => {
    if (f.next !== f.confirm) return toast('Les deux mots de passe diffèrent', 'error');
    const r = await run('Mot de passe changé', () => api('/api/settings/password', { body: { current: f.current, next: f.next } }), 'Mot de passe changé : les autres sessions sont déconnectées');
    if (r) setF({ current: '', next: '', confirm: '' });
  };
  return (
    <>
      <h2 style={{ marginTop: 0 }}>Sécurité</h2>
      <div className="section-title">Mot de passe d’OrbitOS</div>
      {settings?.passwordFromEnv ? (
        <div className="card" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          Le mot de passe est imposé par la variable <span className="mono">ORBIT_PASSWORD</span> : modifie-la (fichier .env ou variables de la stack) puis redémarre le conteneur.
        </div>
      ) : (
        <>
          <label className="field">
            <span>Mot de passe actuel</span>
            <input className="input" type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Nouveau (12 caractères min.)</span>
              <input className="input" type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
            </label>
            <label className="field">
              <span>Confirmation</span>
              <input className="input" type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
            </label>
          </div>
          <button className="btn primary" disabled={!f.current || f.next.length < 12} onClick={change}>
            Changer le mot de passe
          </button>
        </>
      )}
      <div className="section-title">Protections actives</div>
      <div className="group-box">
        {[
          ['Mode lecture seule', readonly ? 'Actif (ORBIT_READONLY=1) : aucune action ne modifie les serveurs' : 'Inactif — mets ORBIT_READONLY=1 pour un accès en consultation seule'],
          ['Session', 'Cookie signé HttpOnly + SameSite=Strict, 30 jours ; anti-CSRF sur chaque action'],
          ['Hôtes autorisés', 'Liste blanche ORBIT_HOSTS (anti DNS-rebinding)'],
          ['SSH', 'Clés montées en lecture seule, empreintes des serveurs vérifiées strictement'],
          ['Écritures', 'Sauvegarde horodatée avant modification, nginx -t avant reload, corbeille serveur'],
        ].map(([k, v]) => (
          <div key={k} className="gb-row">
            <span className="label">
              {k}
              <small>{v}</small>
            </span>
          </div>
        ))}
      </div>
      <p className="faint" style={{ fontSize: 12, lineHeight: 1.6 }}>Pour un accès depuis Internet, place OrbitOS derrière un SSO (Authentik, Authelia…) ou un VPN : il donne un shell sur tes serveurs.</p>
    </>
  );
}

function About() {
  const s = useApi(() => api('/api/session'), []);
  return (
    <>
      <h2 style={{ marginTop: 0 }}>À propos</h2>
      <dl className="kv">
        <dt>Version</dt>
        <dd>{s.data?.version || '—'}</dd>
        <dt>Commit</dt>
        <dd className="mono">{s.data?.commit || '—'}</dd>
        <dt>Licence</dt>
        <dd>MIT</dd>
      </dl>
      <a className="btn" href="https://github.com/Maanaaa/orbitos" target="_blank" rel="noreferrer noopener" style={{ textDecoration: 'none', marginTop: 12 }}>
        <Github size={13} /> Code source <ExternalLink size={11} />
      </a>
    </>
  );
}
