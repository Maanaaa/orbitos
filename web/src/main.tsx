import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight } from 'lucide-react';
import './styles.css';
import '@xterm/xterm/css/xterm.css';
import { api, setUnauthorizedHandler } from './lib/api';
import { Desktop, Wallpaper } from './os/Desktop';
import { useOS } from './os/store';
import { Spinner } from './os/ui';

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api('/api/login', { body: { password: pw } });
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setShake(true);
      setTimeout(() => setShake(false), 450);
      setPw('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Wallpaper />
      <div className="login">
        <div className="avatar">
          <img src="/orbit.svg" width={60} height={60} alt="" />
        </div>
        <h1>OrbitOS</h1>
        <form onSubmit={submit} className={shake ? 'shake' : ''}>
          <input className="input" type="password" autoFocus placeholder="Mot de passe" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="go" disabled={!pw || busy} aria-label="Se connecter">
            {busy ? <Spinner size={14} /> : <ArrowRight size={15} />}
          </button>
        </form>
        <div className="err">{err}</div>
      </div>
    </>
  );
}

function App() {
  const [state, setState] = useState<'loading' | 'login' | 'desktop'>('loading');
  useEffect(() => {
    setUnauthorizedHandler(() => setState('login'));
    api('/api/session')
      .then((s) => {
        useOS.setState({ readonly: !!s.readonly });
        setState(s.authenticated ? 'desktop' : 'login');
      })
      .catch(() => setState('login'));
  }, []);
  if (state === 'loading') return <Wallpaper />;
  if (state === 'login') return <Login onDone={() => setState('desktop')} />;
  return <Desktop />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
