import { useOS } from '../os/store';
import { api, useApi } from '../lib/api';
import type { AppProps } from './registry';

export default function About(_: AppProps) {
  const servers = useOS((s) => s.servers);
  const session = useApi(() => api('/api/session'), []);
  return (
    <div className="pad" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingTop: 30 }}>
      <img src="/orbit.svg" width={88} height={88} alt="" style={{ borderRadius: 20, boxShadow: '0 0 50px rgba(100,210,255,.35)' }} />
      <h2 style={{ margin: '14px 0 0', fontWeight: 650, letterSpacing: '-.02em', fontSize: 24 }}>OrbitOS</h2>
      <div className="muted">Version {session.data?.version || '…'}{session.data?.commit && session.data.commit !== 'dev' ? ` · ${session.data.commit.slice(0, 7)}` : ''}</div>
      <div className="muted" style={{ maxWidth: 320, marginTop: 10 }}>
        Superviseur de serveurs en mode OS : Docker, fichiers, domaines nginx, logs et sécurité, au-dessus de SSH.
      </div>
      <div className="faint mono" style={{ fontSize: 11.5, marginTop: 14 }}>
        {servers.length} serveur{servers.length > 1 ? 's' : ''} · SSH ed25519 · host keys vérifiées
      </div>
    </div>
  );
}
