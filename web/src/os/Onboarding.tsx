import { useState } from 'react';
import { ArrowRight, Check, Plus, Server as ServerIcon, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { useOS, toast } from './store';
import { Sheet, Switch, Spinner } from './ui';
import { AddServer } from '../apps/Servers';

const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC';
  } catch {
    return 'Etc/UTC';
  }
};

/** Accueil du premier lancement : nom, serveurs, modules. Tout reste modifiable dans Réglages. */
export default function Onboarding() {
  const { settings, servers, set } = useOS();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(settings?.instanceName || 'OrbitOS');
  const [tz, setTz] = useState(settings?.timezone && settings.timezone !== 'Etc/UTC' ? settings.timezone : browserTz());
  const [domain, setDomain] = useState(settings?.defaultDomain || '');
  const [modules, setModules] = useState<Record<string, boolean>>(settings?.modules || {});
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!settings) return null;
  const groups = [...new Set(settings.catalog.map((m) => m.group))];

  const finish = async (skip = false) => {
    setBusy(true);
    try {
      const s = await api('/api/settings', { method: 'PATCH', body: skip ? { onboarded: true } : { instanceName: name, timezone: tz, defaultDomain: domain, modules, onboarded: true } });
      set({ settings: s });
      if (!skip) toast(`Bienvenue dans ${s.instanceName}`, 'ok', 'Tout se règle à nouveau dans Réglages.');
    } catch (e: any) {
      toast('Enregistrement impossible', 'error', e.message);
    }
    setBusy(false);
  };
  const reloadServers = () => api('/api/servers').then((s) => useOS.getState().setServers(s));

  const steps = ['Bienvenue', 'Serveurs', 'Modules'];
  return (
    <>
      <Sheet
        global
        wide
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} color="var(--cyan)" /> {steps[step]}
          </span>
        }
        subtitle={`Étape ${step + 1} sur ${steps.length} · tout reste modifiable ensuite dans Réglages`}
        onClose={() => finish(true)}
        footer={
          <>
            <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => finish(true)}>
              Passer
            </button>
            {step > 0 && (
              <button className="btn" onClick={() => setStep(step - 1)}>
                Retour
              </button>
            )}
            {step < steps.length - 1 ? (
              <button className="btn primary" onClick={() => setStep(step + 1)} disabled={step === 0 && !name.trim()}>
                Continuer <ArrowRight size={13} />
              </button>
            ) : (
              <button className="btn primary" disabled={busy} onClick={() => finish()}>
                {busy ? <Spinner size={12} /> : <Check size={13} />} Terminer
              </button>
            )}
          </>
        }
      >
        {step === 0 && (
          <div>
            <p className="muted" style={{ marginTop: 0, lineHeight: 1.6 }}>
              OrbitOS pilote tes serveurs par <b>SSH</b>, sans rien installer dessus. Donne un nom à cette instance et quelques valeurs par défaut.
            </p>
            <div className="field-row">
              <label className="field">
                <span>Nom de l’instance</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </label>
              <label className="field">
                <span>Fuseau horaire</span>
                <input className="input mono" value={tz} onChange={(e) => setTz(e.target.value.trim())} list="orbit-tz" />
              </label>
            </div>
            <label className="field">
              <span>Domaine principal (optionnel)</span>
              <input className="input mono" value={domain} onChange={(e) => setDomain(e.target.value.trim().toLowerCase())} placeholder="example.com" />
              <small>Proposé par défaut pour les nouveaux sous-domaines et sites.</small>
            </label>
            <TzList />
          </div>
        )}
        {step === 1 && (
          <div>
            <p className="muted" style={{ marginTop: 0, lineHeight: 1.6 }}>
              Les alias de <span className="mono">~/.ssh/config</span> monté dans le conteneur sont détectés automatiquement. Tu peux aussi en ajouter ici (connexion par clé).
            </p>
            <div className="group-box" style={{ marginBottom: 12 }}>
              {servers.length === 0 && <div className="gb-row faint">Aucun serveur pour l’instant</div>}
              {servers.map((s) => (
                <div key={s.id} className="gb-row">
                  <ServerIcon size={15} color="var(--accent)" />
                  <span className="label">
                    {s.name}
                    <small className="mono">
                      {s.user}@{s.host}:{s.port} · {s.source === 'ssh-config' ? '~/.ssh/config' : 'ajouté dans OrbitOS'}
                    </small>
                  </span>
                  <span className={`status-dot ${s.connected ? 'green' : s.lastError ? 'red' : ''}`} title={s.lastError || (s.connected ? 'connecté' : 'pas encore contacté')} />
                </div>
              ))}
            </div>
            <button className="btn" onClick={() => setAdding(true)}>
              <Plus size={13} /> Ajouter un serveur
            </button>
          </div>
        )}
        {step === 2 && (
          <div>
            <p className="muted" style={{ marginTop: 0, lineHeight: 1.6 }}>Garde seulement ce dont tu as besoin : les modules coupés disparaissent du Dock, de Spotlight et, pour certains, de l’API.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {groups.map((g) => (
                <div key={g}>
                  <div className="section-title" style={{ marginTop: 0 }}>{g}</div>
                  <div className="group-box">
                    {settings.catalog
                      .filter((m) => m.group === g)
                      .map((m) => (
                        <div key={m.id} className="gb-row">
                          <span className="label">
                            {m.name}
                            <small>{m.description}</small>
                          </span>
                          <Switch on={modules[m.id] !== false} onChange={(v) => setModules((x) => ({ ...x, [m.id]: v }))} />
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 18 }}>
          {steps.map((_, i) => (
            <span key={i} style={{ width: i === step ? 18 : 6, height: 6, borderRadius: 3, background: i === step ? 'var(--accent)' : 'rgba(255,255,255,.2)', transition: 'width .2s' }} />
          ))}
        </div>
      </Sheet>
      {adding && <AddServer onClose={() => setAdding(false)} onDone={() => (setAdding(false), reloadServers())} />}
    </>
  );
}

/** Suggestions de fuseaux horaires (datalist partagée avec Réglages). */
export function TzList() {
  let zones: string[] = [];
  try {
    zones = (Intl as any).supportedValuesOf?.('timeZone') || [];
  } catch {
    zones = [];
  }
  return (
    <datalist id="orbit-tz">
      {zones.map((z) => (
        <option key={z} value={z} />
      ))}
    </datalist>
  );
}
