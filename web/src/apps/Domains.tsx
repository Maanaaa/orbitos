import { useEffect, useMemo, useState } from 'react';
import {
  Globe,
  Plus,
  RefreshCw,
  ShieldCheck,
  Lock,
  LockOpen,
  ExternalLink,
  FileCode2,
  Trash2,
  ArrowRightLeft,
  FolderTree,
  Server,
  EyeOff,
  KeyRound,
  Zap,
  CheckCircle2,
  XCircle,
  CircleDashed,
  Stethoscope,
  RotateCw,
} from 'lucide-react';
import { sapi, useApi } from '../lib/api';
import { useOS, useServer, confirm, run, toast } from '../os/store';
import { ErrorBox, Loading, SearchField, Segmented, Switch, Sheet, Spinner, Empty, useSort } from '../os/ui';
import { appById, type AppProps } from './registry';

const KIND: Record<string, { label: string; cls: string; icon: any }> = {
  proxy: { label: 'Proxy', cls: 'blue', icon: Server },
  static: { label: 'Statique', cls: 'purple', icon: FolderTree },
  redirect: { label: 'Redirection', cls: 'orange', icon: ArrowRightLeft },
  php: { label: 'PHP', cls: 'cyan', icon: FileCode2 },
  other: { label: 'Autre', cls: '', icon: Globe },
};

export default function Domains({ win }: AppProps) {
  const sid = useServer();
  const scan = useApi(() => sapi(sid, 'nginx'), [sid]);
  const [tab, setTab] = useState<'vhosts' | 'certs'>(win.props.tab || 'vhosts');
  const [filter, setFilter] = useState<'all' | 'enabled' | 'down' | 'disabled'>('enabled');
  const [qv, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(win.props.select || win.props.vhost || null);
  const [wizard, setWizard] = useState(false);

  useEffect(() => {
    if (win.props.wizard) setWizard(true);
    if (win.props.select || win.props.vhost) {
      setSel(win.props.select || win.props.vhost);
      setFilter('all');
      setTab('vhosts');
    }
    if (win.props.tab) setTab(win.props.tab);
  }, [win.props.nonce, win.props.wizard, win.props.select, win.props.vhost, win.props.tab]);

  const vhosts = useMemo(() => {
    let v = scan.data?.vhosts || [];
    if (filter === 'enabled') v = v.filter((x: any) => x.enabled);
    if (filter === 'down') v = v.filter((x: any) => x.health === 'down' || x.health === 'warn');
    if (filter === 'disabled') v = v.filter((x: any) => !x.enabled);
    if (qv) v = v.filter((x: any) => `${x.name} ${x.serverNames.join(' ')} ${x.upstreams.map((u: any) => u.port).join(' ')}`.toLowerCase().includes(qv.toLowerCase()));
    return v;
  }, [scan.data, filter, qv]);

  const selected = scan.data?.vhosts.find((v: any) => v.name === sel);
  const stats = scan.data
    ? {
        enabled: scan.data.vhosts.filter((v: any) => v.enabled).length,
        down: scan.data.vhosts.filter((v: any) => v.health === 'down').length,
        certs: scan.data.certs.length,
        expiring: scan.data.certs.filter((c: any) => c.daysLeft != null && c.daysLeft < 15).length,
      }
    : null;

  const nginxTest = async () => {
    try {
      const r = await sapi(sid, 'nginx/test', { body: { reload: false } });
      toast(r.ok ? 'nginx -t : configuration valide' : 'nginx -t : erreurs', r.ok ? 'ok' : 'error', r.output);
    } catch (e: any) {
      toast('nginx -t', 'error', e.message);
    }
  };

  return (
    <div className="app-col">
      <div className="toolbar">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'vhosts', label: <>Vhosts {stats && <span className="faint">{stats.enabled}</span>}</> },
            { value: 'certs', label: <>Certificats {stats && <span className="faint">{stats.certs}</span>}</> },
          ]}
        />
        {tab === 'vhosts' && (
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'enabled', label: 'Actifs' },
              { value: 'down', label: <>En panne {stats?.down ? <span className="badge red" style={{ height: 15, padding: '0 5px' }}>{stats.down}</span> : null}</> },
              { value: 'disabled', label: 'Désactivés' },
              { value: 'all', label: 'Tous' },
            ]}
          />
        )}
        <div className="grow" />
        {scan.data && (
          <span className="badge" title="État du service nginx">
            <span className={`status-dot ${scan.data.nginx === 'active' ? 'green' : 'red'}`} style={{ width: 6, height: 6 }} /> nginx {scan.data.nginx}
          </span>
        )}
        <SearchField value={qv} onChange={setQ} width={170} />
        <button className="btn ghost icon" title="nginx -t" onClick={nginxTest}>
          <Stethoscope size={14} />
        </button>
        <button className="btn ghost icon" title="Actualiser" onClick={() => scan.reload()}>
          {scan.loading ? <Spinner size={13} /> : <RefreshCw size={14} />}
        </button>
        <button className="btn primary" onClick={() => setWizard(true)}>
          <Plus size={14} /> Nouveau domaine
        </button>
      </div>
      <ErrorBox error={scan.error} onRetry={() => scan.reload()} />
      {!scan.data && !scan.error ? (
        <Loading label="Analyse des vhosts nginx…" />
      ) : scan.data && tab === 'vhosts' ? (
        <div className="split">
          <div className="content">
            {vhosts.length === 0 ? (
              <Empty title="Aucun vhost" />
            ) : (
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 24 }} />
                    <th>Domaine</th>
                    <th>Type</th>
                    <th>Cible</th>
                    <th>SSL</th>
                    <th>Options</th>
                    <th style={{ width: 50 }}>Actif</th>
                  </tr>
                </thead>
                <tbody>
                  {vhosts.map((v: any) => (
                    <VhostRow key={v.file} v={v} sel={sel === v.name} onSel={() => setSel(v.name)} sid={sid} reload={() => scan.reload(true)} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {selected && <VhostDetail v={selected} sid={sid} onClose={() => setSel(null)} reload={() => scan.reload(true)} />}
        </div>
      ) : scan.data ? (
        <Certs sid={sid} data={scan.data} reload={() => scan.reload(true)} onVhost={(n) => (setTab('vhosts'), setFilter('all'), setSel(n))} />
      ) : null}
      {wizard && scan.data && (
        <Wizard
          sid={sid}
          ctx={scan.data}
          onClose={() => setWizard(false)}
          onDone={(name) => {
            scan.reload(true);
            setFilter('all');
            setSel(name);
          }}
        />
      )}
    </div>
  );
}

function Target({ v }: { v: any }) {
  if (v.kind === 'proxy')
    return (
      <span className="mono" style={{ fontSize: 11.5 }}>
        {v.upstreams.map((u: any) => (
          <span key={u.raw} style={{ marginRight: 8, color: u.up === false ? 'var(--red)' : u.up ? 'var(--text)' : 'var(--text-2)' }} title={u.up === false ? 'Rien n’écoute sur ce port' : u.up ? 'Port actif' : 'Cible distante'}>
            {u.up === false ? '✕ ' : ''}
            {u.host === '127.0.0.1' || u.host === 'localhost' ? `:${u.port}` : u.raw}
          </span>
        ))}
      </span>
    );
  if (v.kind === 'redirect') return <span className="mono muted ellipsis" style={{ fontSize: 11.5 }}>→ {v.redirects[0]}</span>;
  if (v.roots.length) return <span className="mono muted ellipsis" style={{ fontSize: 11.5 }}>{v.roots[0]}</span>;
  return <span className="faint">—</span>;
}

function VhostRow({ v, sel, onSel, sid, reload }: { v: any; sel: boolean; onSel: () => void; sid: string; reload: () => void }) {
  const k = KIND[v.kind] || KIND.other;
  const [busy, setBusy] = useState(false);
  const toggle = async (on: boolean) => {
    if (!on && !(await confirm({ title: `Désactiver ${v.serverNames[0] || v.name} ?`, message: 'Le lien sites-enabled est retiré puis nginx est rechargé (nginx -t vérifié, rollback automatique).', confirm: 'Désactiver', danger: true }))) return;
    setBusy(true);
    await run(on ? 'Vhost activé' : 'Vhost désactivé', () => sapi(sid, `nginx/vhosts/${encodeURIComponent(v.name)}/${on ? 'enable' : 'disable'}`, { method: 'POST' }));
    setBusy(false);
    reload();
  };
  return (
    <tr className={sel ? 'sel' : ''} onClick={onSel}>
      <td>
        <span className={`status-dot ${v.health === 'ok' ? 'green' : v.health === 'down' ? 'red' : v.health === 'warn' ? 'orange' : ''}`} />
      </td>
      <td style={{ maxWidth: 300 }}>
        <div className="ellipsis" style={{ fontWeight: 550 }}>{v.serverNames[0] || v.name}</div>
        {v.serverNames.length > 1 && <div className="faint ellipsis" style={{ fontSize: 11 }}>+ {v.serverNames.slice(1).join(', ')}</div>}
      </td>
      <td>
        <span className={`badge ${k.cls}`}>{k.label}</span>
      </td>
      <td style={{ maxWidth: 220 }}>
        <Target v={v} />
      </td>
      <td>
        {v.ssl ? (
          <span className={`badge ${v.minCertDays != null && v.minCertDays < 15 ? 'orange' : 'green'}`}>
            <Lock size={10} /> {v.minCertDays != null ? `${v.minCertDays} j` : 'oui'}
          </span>
        ) : (
          <span className="badge">
            <LockOpen size={10} /> http
          </span>
        )}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {v.authentik && <span className="badge purple" title="Forward-auth Authentik" style={{ marginRight: 3 }}><KeyRound size={10} /> SSO</span>}
        {v.noindex && <span className="badge" title="noindex" style={{ marginRight: 3 }}><EyeOff size={10} /></span>}
        {v.microcache && <span className="badge cyan" title="Micro-cache nginx"><Zap size={10} /></span>}
        {v.defaultServer && <span className="badge">défaut</span>}
      </td>
      <td onClick={(e) => e.stopPropagation()}>{busy ? <Spinner size={14} /> : v.inEnabledDir ? <span className="faint" title="Fichier réel dans sites-enabled">fixe</span> : <Switch on={v.enabled} onChange={toggle} />}</td>
    </tr>
  );
}

function CheckLine({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <div className="gb-row">
      {ok === null ? <CircleDashed size={15} className="faint" /> : ok ? <CheckCircle2 size={15} color="var(--green)" /> : <XCircle size={15} color="var(--red)" />}
      <span className="label">
        {label}
        {detail && <small className="mono">{detail}</small>}
      </span>
    </div>
  );
}

function VhostDetail({ v, sid, onClose, reload }: { v: any; sid: string; onClose: () => void; reload: () => void }) {
  const { open } = useOS();
  const [check, setCheck] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const main = v.serverNames[0];

  const doCheck = async () => {
    if (!main) return;
    setChecking(true);
    try {
      setCheck(await sapi(sid, `nginx/check?name=${encodeURIComponent(main)}`));
    } catch (e: any) {
      toast('Vérification impossible', 'error', e.message);
    }
    setChecking(false);
  };
  useEffect(() => {
    setCheck(null);
    if (main && v.enabled && !main.includes('*')) doCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.name]);

  const enableSsl = async () => {
    if (!(await confirm({ title: `Activer HTTPS sur ${main} ?`, message: 'certbot --nginx obtient un certificat Let’s Encrypt et ajoute la redirection HTTP → HTTPS.', confirm: 'Activer' }))) return;
    await run('HTTPS activé', () => sapi(sid, `nginx/vhosts/${encodeURIComponent(v.name)}/ssl`, { body: { domain: main } }));
    reload();
  };
  const remove = async () => {
    if (!(await confirm({ title: `Supprimer le vhost ${v.name} ?`, message: 'Il est désactivé, nginx est rechargé, puis le fichier part dans la corbeille serveur. Le certificat est conservé.', confirm: 'Supprimer', danger: true }))) return;
    const r = await run('Vhost supprimé', () => sapi(sid, `nginx/vhosts/${encodeURIComponent(v.name)}/remove`, { method: 'POST' }));
    if (r) {
      onClose();
      reload();
    }
  };

  const httpOk = (r: any) => r && !r.error && r.status < 500;
  return (
    <div className="detail">
      <div className="toolbar" style={{ position: 'sticky', top: 0, background: 'rgba(24,26,34,.96)', zIndex: 2 }}>
        <Globe size={16} color="var(--mint)" />
        <b className="ellipsis" style={{ flex: 1 }}>{main || v.name}</b>
        <button className="btn ghost sm" onClick={onClose}>
          Fermer
        </button>
      </div>
      <div className="pad">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {main && (
            <a className="btn sm" href={`${v.ssl ? 'https' : 'http'}://${main}`} target="_blank" rel="noreferrer noopener" style={{ textDecoration: 'none' }}>
              <ExternalLink size={12} /> Ouvrir
            </a>
          )}
          <button className="btn sm" onClick={() => open('editor', { path: v.file, server: sid }, { size: appById('editor')!.size, title: v.name })}>
            <FileCode2 size={12} /> Éditer la config
          </button>
          {!v.ssl && v.enabled && main && (
            <button className="btn sm primary" onClick={enableSsl}>
              <ShieldCheck size={12} /> Activer HTTPS
            </button>
          )}
          {!v.inEnabledDir && v.name !== '00-default' && (
            <button className="btn sm danger" onClick={remove}>
              <Trash2 size={12} /> Supprimer
            </button>
          )}
        </div>

        <dl className="kv">
          <dt>Fichier</dt>
          <dd className="mono" style={{ fontSize: 11.5 }}>{v.file}</dd>
          <dt>Noms</dt>
          <dd>{v.serverNames.join(', ') || '—'}</dd>
          <dt>Type</dt>
          <dd>{(KIND[v.kind] || KIND.other).label}</dd>
          {v.roots.length > 0 && (
            <>
              <dt>Racine</dt>
              <dd>
                <a className="mono" style={{ fontSize: 11.5 }} onClick={() => open('finder', { path: v.roots[0] }, { size: appById('finder')!.size })}>
                  {v.roots[0]}
                </a>
              </dd>
            </>
          )}
          {v.redirects.length > 0 && (
            <>
              <dt>Redirige vers</dt>
              <dd className="mono" style={{ fontSize: 11.5 }}>{v.redirects.join(', ')}</dd>
            </>
          )}
        </dl>

        {v.upstreams.length > 0 && (
          <>
            <div className="section-title" style={{ marginTop: 18 }}>Upstreams</div>
            <div className="group-box">
              {v.upstreams.map((u: any) => (
                <CheckLine key={u.raw} ok={u.up} label={`${u.scheme}://${u.raw}`} detail={u.up === false ? 'Aucun service n’écoute : 502 pour les visiteurs' : u.up ? 'Port à l’écoute' : 'Hôte distant (non vérifié)'} />
              ))}
            </div>
          </>
        )}

        {v.certs.length > 0 && (
          <>
            <div className="section-title">Certificats</div>
            <div className="group-box">
              {v.certs.map((c: any) => (
                <CheckLine key={c.name} ok={c.missing ? false : c.daysLeft >= 15} label={c.name} detail={c.missing ? 'introuvable' : `expire dans ${c.daysLeft} j · ${new Date(c.expires).toLocaleDateString('fr-FR')}`} />
              ))}
            </div>
          </>
        )}

        {main && (
          <>
            <div className="section-title" style={{ display: 'flex', alignItems: 'center' }}>
              Vérification externe
              <button className="btn sm ghost" style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }} onClick={doCheck} disabled={checking}>
                {checking ? <Spinner size={11} /> : <RotateCw size={11} />} Vérifier
              </button>
            </div>
            <div className="group-box">
              {!check ? (
                <CheckLine ok={null} label={checking ? 'Vérification…' : 'Non vérifié'} />
              ) : (
                <>
                  <CheckLine ok={check.pointsHere} label="DNS" detail={`${check.dns.a.join(', ') || 'aucun A'}${check.pointsHere ? '' : ` · attendu ${check.expected.join(', ')}`}`} />
                  {check.http && <CheckLine ok={httpOk(check.http)} label="HTTP" detail={check.http.error || `${check.http.status} · ${check.http.ms} ms${check.http.location ? ` → ${check.http.location}` : ''}`} />}
                  {check.https && <CheckLine ok={httpOk(check.https)} label="HTTPS" detail={check.https.error || `${check.https.status} · ${check.https.ms} ms${check.https.server ? ` · ${check.https.server}` : ''}`} />}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Certs({ sid, data, reload, onVhost }: { sid: string; data: any; reload: () => void; onVhost: (n: string) => void }) {
  const { sorted, th } = useSort<any>(data.certs, { key: 'daysLeft', dir: 1 });
  const [busy, setBusy] = useState<string | null>(null);
  const renew = async (c: any) => {
    setBusy(c.name);
    const r: any = await run(`Certificat ${c.name}`, () => sapi(sid, `nginx/certs/${encodeURIComponent(c.name)}/renew`, { method: 'POST' }), 'Renouvellement terminé');
    if (r?.output) toast('certbot', 'info', r.output.slice(-400));
    setBusy(null);
    reload();
  };
  return (
    <div className="content">
      <table className="grid">
        <thead>
          <tr>
            {th('name', 'Certificat')}
            <th>Domaines</th>
            {th('daysLeft', 'Expire dans', 'num')}
            <th>Utilisé</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sorted.map((c: any) => {
            const vh = data.vhosts.find((v: any) => v.certNames.includes(c.name));
            return (
              <tr key={c.name}>
                <td>
                  <Lock size={11} style={{ verticalAlign: -1, marginRight: 6, color: c.daysLeft < 15 ? 'var(--orange)' : 'var(--green)' }} />
                  <b style={{ fontWeight: 550 }}>{c.name}</b>
                </td>
                <td className="muted ellipsis" style={{ maxWidth: 300 }}>{c.domains.join(', ')}</td>
                <td className="num" style={{ color: c.daysLeft < 7 ? 'var(--red)' : c.daysLeft < 15 ? 'var(--orange)' : undefined }}>{c.daysLeft} j</td>
                <td>{c.used ? <a onClick={() => vh && onVhost(vh.name)}>{vh?.name}</a> : <span className="badge orange">sans vhost</span>}</td>
                <td>
                  <div className="row-actions">
                    <button className="btn sm ghost" disabled={busy === c.name} onClick={() => renew(c)}>
                      {busy === c.name ? <Spinner size={11} /> : <RotateCw size={11} />} Renouveler
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────── Assistant ─────────────────────────

function Wizard({ sid, ctx, onClose, onDone }: { sid: string; ctx: any; onClose: () => void; onDone: (name: string) => void }) {
  const server = useOS((s) => s.servers.find((x) => x.id === sid));
  const baseDomain = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of ctx.vhosts) for (const n of v.serverNames) {
      const parts = n.split('.');
      if (parts.length >= 2) {
        const b = parts.slice(-2).join('.');
        counts[b] = (counts[b] || 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'example.com';
  }, [ctx]);
  const [f, setF] = useState<any>({ domain: `app.${baseDomain}`, type: 'proxy', host: '127.0.0.1', port: '', scheme: 'http', ssl: true, noindex: false, authentik: false, maxBody: 50, spa: false, target: 'https://', keepPath: true, permanent: true });
  const [preview, setPreview] = useState('');
  const [previewErr, setPreviewErr] = useState('');
  const [dns, setDns] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const containers = useApi(() => sapi(sid, 'docker/containers'), [sid]);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));

  // Ports locaux publiés par les conteneurs (candidats pour un proxy)
  const localPorts = useMemo(() => {
    const list: { port: string; name: string; used: boolean }[] = [];
    const used = new Set(ctx.vhosts.flatMap((v: any) => v.upstreams.map((u: any) => String(u.port))));
    for (const c of containers.data || [])
      for (const p of c.ports) if (p.hostPort && c.state === 'running') list.push({ port: p.hostPort, name: c.name, used: used.has(p.hostPort) });
    return list.filter((x, i, a) => a.findIndex((y) => y.port === x.port) === i).sort((a, b) => Number(a.used) - Number(b.used) || a.name.localeCompare(b.name));
  }, [containers.data, ctx]);

  useEffect(() => {
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const r = await sapi(sid, 'nginx/preview', { body: f });
        if (stale) return;
        setPreview(r.config);
        setPreviewErr('');
      } catch (e: any) {
        if (stale) return;
        setPreview('');
        setPreviewErr(e.message);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [f, sid]);

  useEffect(() => {
    setDns(null);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(f.domain)) return;
    const t = setTimeout(() => sapi(sid, `nginx/check?name=${encodeURIComponent(f.domain)}`).then(setDns, () => setDns(null)), 600);
    return () => clearTimeout(t);
  }, [f.domain, sid]);

  const exists = ctx.vhosts.some((v: any) => v.serverNames.includes(f.domain) && v.enabled);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await sapi(sid, 'nginx/create', { body: f });
      setResult(r);
      if (r.ok) {
        toast(`${f.domain} est en ligne`, 'ok');
        onDone(f.domain);
      }
    } catch (e: any) {
      toast('Création impossible', 'error', e.message);
    }
    setBusy(false);
  };

  if (result)
    return (
      <Sheet
        title={result.ok ? `${f.domain} est prêt` : 'La création a échoué'}
        subtitle={result.ok ? 'Toutes les étapes ont été journalisées.' : 'Rien n’a été laissé dans un état cassé : nginx tourne sur l’ancienne configuration.'}
        onClose={onClose}
        footer={
          <>
            {result.url && (
              <a className="btn" href={result.url} target="_blank" rel="noreferrer noopener" style={{ textDecoration: 'none' }}>
                <ExternalLink size={12} /> Ouvrir
              </a>
            )}
            <button className="btn primary" onClick={onClose}>
              Terminé
            </button>
          </>
        }
      >
        <div className="steps">
          {result.steps.map((s: any, i: number) => (
            <div className="st" key={i}>
              {s.ok ? <CheckCircle2 size={16} color="var(--green)" /> : <XCircle size={16} color="var(--red)" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{s.label}</div>
                {s.detail && <pre className="code" style={{ marginTop: 6 }}>{s.detail}</pre>}
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    );

  return (
    <Sheet
      wide
      title="Nouveau domaine"
      subtitle={`Sur ${server?.name || sid} : écriture dans sites-available, activation, nginx -t (rollback si erreur), reload, puis certificat Let’s Encrypt.`}
      onClose={onClose}
      footer={
        <>
          <span className="faint" style={{ marginRight: 'auto', fontSize: 12 }}>
            {exists ? <span style={{ color: 'var(--red)' }}>Ce domaine est déjà servi par un vhost actif</span> : previewErr || ''}
          </span>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" disabled={busy || !!previewErr || exists} onClick={submit}>
            {busy ? <Spinner size={12} /> : <Plus size={13} />} Créer et mettre en ligne
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20 }}>
        <div>
          <label className="field">
            <span>Nom de domaine</span>
            <input className="input mono" value={f.domain} onChange={(e) => set('domain', e.target.value.trim().toLowerCase())} spellCheck={false} autoFocus />
            <small>
              {dns ? (
                dns.pointsHere ? (
                  <span style={{ color: 'var(--green)' }}>✓ DNS OK : {dns.dns.a.join(', ')}</span>
                ) : (
                  <span style={{ color: 'var(--orange)' }}>
                    DNS : {dns.dns.a.join(', ') || 'aucun enregistrement A'} · crée un A → {dns.expected.join(', ')} pour le SSL
                  </span>
                )
              ) : (
                'Vérification DNS…'
              )}
            </small>
          </label>

          <div className="type-cards">
            {[
              ['proxy', Server, 'Reverse proxy', 'Vers un conteneur ou un port local'],
              ['static', FolderTree, 'Site statique', 'Fichiers servis depuis /var/www'],
              ['redirect', ArrowRightLeft, 'Redirection', '301/302 vers une autre URL'],
            ].map(([id, Ic, t, d]: any) => (
              <button key={id} className={`type-card ${f.type === id ? 'on' : ''}`} onClick={() => set('type', id)}>
                <Ic size={18} color="var(--cyan)" />
                <b>{t}</b>
                <small>{d}</small>
              </button>
            ))}
          </div>

          {f.type === 'proxy' && (
            <>
              <label className="field">
                <span>Conteneur ou service cible</span>
                <select className="select" value={f.port} onChange={(e) => set('port', e.target.value)}>
                  <option value="">— choisir un port publié —</option>
                  {localPorts.map((p) => (
                    <option key={p.port} value={p.port}>
                      :{p.port} · {p.name}
                      {p.used ? ' (déjà routé)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-row">
                <label className="field" style={{ flex: '0 0 90px' }}>
                  <span>Schéma</span>
                  <select className="select" value={f.scheme} onChange={(e) => set('scheme', e.target.value)}>
                    <option>http</option>
                    <option>https</option>
                  </select>
                </label>
                <label className="field">
                  <span>Hôte</span>
                  <input className="input mono" value={f.host} onChange={(e) => set('host', e.target.value)} />
                </label>
                <label className="field" style={{ flex: '0 0 100px' }}>
                  <span>Port</span>
                  <input className="input mono" value={f.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} placeholder="3000" />
                </label>
              </div>
            </>
          )}
          {f.type === 'static' && (
            <>
              <label className="field">
                <span>Dossier racine</span>
                <input className="input mono" value={f.root ?? `/var/www/${f.domain}`} onChange={(e) => set('root', e.target.value)} />
                <small>Créé avec une page d’accueil s’il n’existe pas. Dépose ensuite tes fichiers via le Finder.</small>
              </label>
              <div className="group-box" style={{ marginBottom: 12 }}>
                <div className="gb-row">
                  <span className="label">
                    Application monopage (SPA)
                    <small>Toutes les routes inconnues servent index.html</small>
                  </span>
                  <Switch on={f.spa} onChange={(v) => set('spa', v)} />
                </div>
              </div>
            </>
          )}
          {f.type === 'redirect' && (
            <>
              <label className="field">
                <span>URL cible</span>
                <input className="input mono" value={f.target} onChange={(e) => set('target', e.target.value)} />
              </label>
              <div className="group-box" style={{ marginBottom: 12 }}>
                <div className="gb-row">
                  <span className="label">Conserver le chemin</span>
                  <Switch on={f.keepPath} onChange={(v) => set('keepPath', v)} />
                </div>
                <div className="gb-row">
                  <span className="label">
                    Permanente (301)
                    <small>Sinon temporaire (302)</small>
                  </span>
                  <Switch on={f.permanent} onChange={(v) => set('permanent', v)} />
                </div>
              </div>
            </>
          )}

          <div className="group-box">
            <div className="gb-row">
              <Lock size={15} color="var(--green)" />
              <span className="label">
                HTTPS Let’s Encrypt
                <small>certbot --nginx + redirection automatique</small>
              </span>
              <Switch on={f.ssl} onChange={(v) => set('ssl', v)} />
            </div>
            <div className="gb-row">
              <EyeOff size={15} color="var(--text-2)" />
              <span className="label">
                Ne pas indexer
                <small>snippets/noindex.conf (préprod, outils)</small>
              </span>
              <Switch on={f.noindex} onChange={(v) => set('noindex', v)} />
            </div>
            {f.type !== 'redirect' && (
              <div className="gb-row" style={{ opacity: ctx.authentikOutpost ? 1 : 0.45 }}>
                <KeyRound size={15} color="var(--purple)" />
                <span className="label">
                  Protéger par Authentik (SSO)
                  <small>{ctx.authentikOutpost ? `Forward-auth via ${ctx.authentikOutpost} · nécessite un provider Forward Auth` : 'Aucun outpost détecté sur ce serveur'}</small>
                </span>
                <Switch on={f.authentik} onChange={(v) => set('authentik', v)} disabled={!ctx.authentikOutpost} />
              </div>
            )}
            {f.type !== 'redirect' && (
              <div className="gb-row">
                <span className="label">Taille max. d’upload</span>
                <input className="input mono" style={{ width: 70, textAlign: 'right' }} value={f.maxBody} onChange={(e) => set('maxBody', e.target.value.replace(/\D/g, ''))} />
                <span className="faint">Mo</span>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Aperçu de la configuration</div>
          <pre className="code" style={{ flex: 1, maxHeight: 520, fontSize: 11.5 }}>{preview || ' '}</pre>
        </div>
      </div>
    </Sheet>
  );
}
