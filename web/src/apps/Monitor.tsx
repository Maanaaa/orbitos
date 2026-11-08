import { useEffect, useRef, useState } from 'react';
import { Cpu, MemoryStick, HardDrive, Network, Skull } from 'lucide-react';
import { sapi, useApi } from '../lib/api';
import { bytes, rate, duration, pct } from '../lib/format';
import { useServer, confirm, run } from '../os/store';
import { Segmented, Sparkline, ErrorBox, Loading, SearchField, useSort, Ring } from '../os/ui';
import type { AppProps } from './registry';

const HISTORY = 90;

export default function Monitor(_: AppProps) {
  const sid = useServer();
  const [tab, setTab] = useState<'overview' | 'processes' | 'containers'>('overview');
  const { data: m, error } = useApi(() => sapi(sid, 'metrics'), [sid], { interval: 2000 });
  const hist = useRef<{ cpu: number[]; mem: number[]; rx: number[]; tx: number[] }>({ cpu: [], mem: [], rx: [], tx: [] });
  const [, force] = useState(0);

  useEffect(() => {
    hist.current = { cpu: [], mem: [], rx: [], tx: [] };
  }, [sid]);
  useEffect(() => {
    if (!m) return;
    const h = hist.current;
    const push = (a: number[], v: number) => {
      a.push(v);
      if (a.length > HISTORY) a.shift();
    };
    if (m.cpu != null) push(h.cpu, m.cpu);
    push(h.mem, (m.mem.used / m.mem.total) * 100);
    if (m.net) {
      push(h.rx, m.net.rx);
      push(h.tx, m.net.tx);
    }
    force((x) => x + 1);
  }, [m]);

  return (
    <div className="app-col">
      <div className="toolbar">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Vue d’ensemble' },
            { value: 'processes', label: 'Processus' },
            { value: 'containers', label: 'Conteneurs' },
          ]}
        />
        <div className="grow" />
        {m && (
          <span className="faint mono" style={{ fontSize: 11.5 }}>
            {m.info.hostname} · {m.info.os} · noyau {m.info.kernel} · up {duration(m.uptime)}
          </span>
        )}
      </div>
      <ErrorBox error={error} />
      <div className="content">
        {tab === 'overview' && (m ? <Overview m={m} h={hist.current} /> : !error && <Loading />)}
        {tab === 'processes' && <Processes sid={sid} />}
        {tab === 'containers' && <ContainerStats sid={sid} />}
      </div>
    </div>
  );
}

function Overview({ m, h }: { m: any; h: { cpu: number[]; mem: number[]; rx: number[]; tx: number[] } }) {
  const memPct = (m.mem.used / m.mem.total) * 100;
  const swapPct = m.mem.swapTotal ? (m.mem.swapUsed / m.mem.swapTotal) * 100 : 0;
  return (
    <div className="pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Cpu size={15} color="var(--cyan)" />
          <span className="metric-label">Processeur</span>
          <span className="faint mono" style={{ marginLeft: 'auto', fontSize: 11 }}>
            charge {m.load.map((l: number) => l.toFixed(2)).join(' · ')}
          </span>
        </div>
        <div className="metric-big">{pct(m.cpu, 1)}</div>
        <Sparkline values={h.cpu} max={100} color="var(--cyan)" height={70} />
        <div className="core-grid" style={{ marginTop: 10 }}>
          {m.perCore.map((c: number | null, i: number) => (
            <div className="core" key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>cœur {i}</span>
                <span style={{ color: 'var(--text-2)' }}>{c == null ? '—' : `${Math.round(c)}%`}</span>
              </div>
              <div className="bar">
                <i style={{ width: `${c ?? 0}%`, background: (c ?? 0) > 85 ? 'var(--red)' : undefined }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <MemoryStick size={15} color="var(--purple)" />
          <span className="metric-label">Mémoire</span>
        </div>
        <div className="metric-big">
          {bytes(m.mem.used)} <span className="faint" style={{ fontSize: 15 }}>/ {bytes(m.mem.total)}</span>
        </div>
        <Sparkline values={h.mem} max={100} color="var(--purple)" height={70} />
        <div style={{ display: 'flex', gap: 18, marginTop: 12 }}>
          <Ring value={memPct} size={58} label="Utilisée" color="var(--purple)" />
          <Ring value={swapPct} size={58} label="Swap" sub={bytes(m.mem.swapUsed)} color={swapPct > 50 ? 'var(--orange)' : 'var(--indigo)'} />
          <div className="kv" style={{ gridTemplateColumns: 'auto auto', alignSelf: 'center', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
            <dt>Disponible</dt>
            <dd className="mono">{bytes(m.mem.available)}</dd>
            <dt>Cache</dt>
            <dd className="mono">{bytes(m.mem.cached)}</dd>
            <dt>Swap total</dt>
            <dd className="mono">{bytes(m.mem.swapTotal)}</dd>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Network size={15} color="var(--mint)" />
          <span className="metric-label">Réseau</span>
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          <div>
            <div className="metric-big" style={{ fontSize: 20 }}>↓ {rate(m.net?.rx)}</div>
            <div className="faint" style={{ fontSize: 11 }}>reçu</div>
          </div>
          <div>
            <div className="metric-big" style={{ fontSize: 20 }}>↑ {rate(m.net?.tx)}</div>
            <div className="faint" style={{ fontSize: 11 }}>envoyé</div>
          </div>
        </div>
        <Sparkline values={h.rx} color="var(--mint)" height={44} />
        <Sparkline values={h.tx} color="var(--blue)" height={44} />
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <HardDrive size={15} color="var(--orange)" />
          <span className="metric-label">Disques</span>
        </div>
        {m.disks.map((d: any) => {
          const p = (d.used / d.size) * 100;
          return (
            <div key={d.mount} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}>
                <span>
                  <b>{d.mount}</b> <span className="faint mono">{d.fs}</span>
                </span>
                <span className="mono">
                  {bytes(d.used)} / {bytes(d.size)}
                </span>
              </div>
              <div className="bar">
                <i style={{ width: `${p}%`, background: p > 90 ? 'var(--red)' : p > 75 ? 'var(--orange)' : undefined }} />
              </div>
              <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>
                {bytes(d.avail)} libres · {p.toFixed(0)} %
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Processes({ sid }: { sid: string }) {
  const { data, error, reload } = useApi(() => sapi(sid, 'processes'), [sid], { interval: 4000 });
  const [qv, setQ] = useState('');
  const rows = (data || []).filter((p: any) => !qv || `${p.comm} ${p.args} ${p.user} ${p.pid}`.toLowerCase().includes(qv.toLowerCase()));
  const { sorted, th } = useSort<any>(rows, { key: 'cpu', dir: -1 });
  const kill = async (p: any, sig: 'TERM' | 'KILL') => {
    if (!(await confirm({ title: `Envoyer SIG${sig} à ${p.comm} (${p.pid}) ?`, message: p.args, confirm: sig === 'KILL' ? 'Tuer' : 'Terminer', danger: true }))) return;
    await run(`SIG${sig} → ${p.pid}`, () => sapi(sid, `processes/${p.pid}/kill`, { body: { signal: sig } }));
    reload(true);
  };
  return (
    <>
      <div className="toolbar" style={{ borderTop: 0 }}>
        <SearchField value={qv} onChange={setQ} placeholder="Filtrer les processus" />
        <span className="faint" style={{ fontSize: 12 }}>60 processus les plus actifs</span>
      </div>
      <ErrorBox error={error} />
      <table className="grid">
        <thead>
          <tr>
            {th('comm', 'Processus')}
            {th('pid', 'PID', 'num')}
            {th('user', 'Utilisateur')}
            {th('cpu', '% CPU', 'num')}
            {th('mem', '% Mém.', 'num')}
            {th('rss', 'Mémoire', 'num')}
            {th('elapsed', 'Durée', 'num')}
            <th />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p: any) => (
            <tr key={p.pid}>
              <td style={{ maxWidth: 380 }}>
                <div className="ellipsis" title={p.args}>
                  <b style={{ fontWeight: 550 }}>{p.comm}</b> <span className="faint mono">{p.args.replace(p.comm, '').slice(0, 120)}</span>
                </div>
              </td>
              <td className="num">{p.pid}</td>
              <td className="muted">{p.user}</td>
              <td className="num" style={{ color: p.cpu > 50 ? 'var(--orange)' : undefined }}>{p.cpu.toFixed(1)}</td>
              <td className="num">{p.mem.toFixed(1)}</td>
              <td className="num">{bytes(p.rss)}</td>
              <td className="num muted">{duration(p.elapsed)}</td>
              <td>
                <div className="row-actions">
                  <button className="btn sm ghost icon" title="Terminer (SIGTERM)" onClick={() => kill(p, 'TERM')}>
                    <Skull size={12} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ContainerStats({ sid }: { sid: string }) {
  const { data, error } = useApi(() => sapi(sid, 'docker/stats'), [sid], { interval: 6000 });
  const { sorted, th } = useSort<any>(data, { key: 'cpu', dir: -1 });
  if (!data && !error) return <Loading label="docker stats…" />;
  return (
    <>
      <ErrorBox error={error} />
      <table className="grid">
        <thead>
          <tr>
            {th('name', 'Conteneur')}
            {th('cpu', '% CPU', 'num')}
            {th('memPct', '% Mém.', 'num')}
            <th>Mémoire</th>
            <th>Réseau E/S</th>
            <th>Disque E/S</th>
            {th('pids', 'PIDs', 'num')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((s: any) => (
            <tr key={s.name}>
              <td>
                <b style={{ fontWeight: 550 }}>{s.name}</b>
              </td>
              <td className="num">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                  <div className="bar" style={{ width: 50 }}>
                    <i style={{ width: `${Math.min(100, s.cpu)}%` }} />
                  </div>
                  {s.cpu.toFixed(1)}
                </div>
              </td>
              <td className="num">{s.memPct.toFixed(1)}</td>
              <td className="mono muted" style={{ fontSize: 11.5 }}>{s.mem}</td>
              <td className="mono muted" style={{ fontSize: 11.5 }}>{s.net}</td>
              <td className="mono muted" style={{ fontSize: 11.5 }}>{s.block}</td>
              <td className="num">{s.pids}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
