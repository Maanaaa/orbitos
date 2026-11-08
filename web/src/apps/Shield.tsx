import { useMemo, useState } from 'react';
import { ShieldCheck, ShieldAlert, Globe2, Lock, Package, Ban, Unlock, KeyRound } from 'lucide-react';
import { sapi, useApi } from '../lib/api';
import { useServer, confirm, run } from '../os/store';
import { ErrorBox, Loading, Segmented, Empty } from '../os/ui';
import type { AppProps } from './registry';

export default function Shield(_: AppProps) {
  const sid = useServer();
  const s = useApi(() => sapi(sid, 'security'), [sid]);
  const c = useApi(() => sapi(sid, 'docker/containers'), [sid]);
  const [tab, setTab] = useState<'exposure' | 'firewall' | 'bans' | 'system'>('exposure');

  const exposure = useMemo(() => {
    if (!s.data) return [];
    const rows: any[] = [];
    const ufwPorts = new Set(s.data.ufw.rules.map((r: any) => r.to.split('/')[0].replace(' (v6)', '')));
    const pub = s.data.listening.filter((l: any) => !/^(127\.|\[::1\]|::1|%lo)/.test(l.address) && !l.address.startsWith('127.'));
    const seen = new Set<string>();
    for (const l of pub) {
      const key = `${l.port}/${l.proto}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const dockerC = (c.data || []).find((ct: any) => ct.ports.some((p: any) => p.public && p.hostPort === String(l.port)));
      rows.push({
        port: l.port,
        proto: l.proto,
        process: dockerC ? `docker · ${dockerC.name}` : l.process,
        docker: !!dockerC,
        inUfw: ufwPorts.has(String(l.port)) || (l.port === 80 || l.port === 443 ? ufwPorts.has('Nginx Full') : false),
      });
    }
    return rows.sort((a, b) => a.port - b.port);
  }, [s.data, c.data]);

  const unban = async (source: string, value: string, jail?: string) => {
    if (!(await confirm({ title: `Débannir ${value} ?`, message: `Source : ${source}${jail ? ` (${jail})` : ''}`, confirm: 'Débannir' }))) return;
    await run(`${value} débanni`, () => sapi(sid, 'security/unban', { body: { source, value, jail } }));
    s.reload(true);
  };

  const d = s.data;
  return (
    <div className="app-col">
      <div className="toolbar">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'exposure', label: <><Globe2 size={12} /> Exposition</> },
            { value: 'firewall', label: <><ShieldCheck size={12} /> Pare-feu</> },
            { value: 'bans', label: <><Ban size={12} /> Bannissements</> },
            { value: 'system', label: <><Package size={12} /> Système</> },
          ]}
        />
        <div className="grow" />
        {d && (
          <>
            <span className={`badge ${d.ufw.active ? 'green' : 'red'}`}>UFW {d.ufw.active ? 'actif' : 'inactif'}</span>
            {d.crowdsec.available && <span className="badge purple">CrowdSec · {d.crowdsec.decisions.length} décisions</span>}
            {d.fail2ban.length > 0 && <span className="badge blue">fail2ban · {d.fail2ban.length} jail(s)</span>}
          </>
        )}
      </div>
      <ErrorBox error={s.error} onRetry={() => s.reload()} />
      <div className="content">
        {!d && !s.error && <Loading label="Lecture du pare-feu, des ports et des bannissements…" />}
        {d && tab === 'exposure' && (
          <div className="pad">
            <div className="muted" style={{ marginBottom: 12 }}>
              Ports réellement joignables depuis Internet (à l’écoute sur une interface publique). Les ports publiés par Docker <b>contournent UFW</b> : une règle UFW absente ne les protège pas.
            </div>
            <div className="group-box">
              {exposure.map((r) => (
                <div className="gb-row" key={`${r.port}${r.proto}`}>
                  {r.docker ? <ShieldAlert size={16} color="var(--orange)" /> : r.inUfw ? <ShieldCheck size={16} color="var(--green)" /> : <ShieldAlert size={16} color="var(--text-3)" />}
                  <span className="mono" style={{ width: 90, fontWeight: 600 }}>
                    {r.port}/{r.proto.replace('6', '')}
                  </span>
                  <span className="label">
                    {r.process || '—'}
                    <small>{r.docker ? 'Publié par Docker sur 0.0.0.0 : exposé quelle que soit la règle UFW' : r.inUfw ? 'Autorisé dans UFW' : 'Pas de règle UFW : filtré si la politique par défaut est deny'}</small>
                  </span>
                  {r.docker && <span className="badge orange">contourne UFW</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {d && tab === 'firewall' && (
          <table className="grid">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Vers</th>
                <th>Action</th>
                <th>Depuis</th>
                <th>Commentaire</th>
              </tr>
            </thead>
            <tbody>
              {d.ufw.rules.map((r: any) => (
                <tr key={r.n}>
                  <td className="num faint">{r.n}</td>
                  <td className="mono">{r.to}</td>
                  <td>
                    <span className={`badge ${r.action === 'ALLOW' ? 'green' : r.action === 'LIMIT' ? 'orange' : 'red'}`}>{r.action}</span>
                  </td>
                  <td className="muted">{r.from}</td>
                  <td className="muted">{r.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {d && tab === 'bans' && (
          <div className="pad">
            {d.crowdsec.available && (
              <>
                <div className="section-title">CrowdSec</div>
                {d.crowdsec.decisions.length === 0 ? (
                  <div className="faint">Aucune décision active</div>
                ) : (
                  <div className="group-box">
                    {d.crowdsec.decisions.map((x: any) => (
                      <div className="gb-row" key={x.id}>
                        <Ban size={14} color="var(--red)" />
                        <span className="mono" style={{ width: 140 }}>{x.value}</span>
                        <span className="label">
                          {x.reason}
                          <small>
                            {x.type} · {x.duration} {x.country && `· ${x.country}`} {x.as && `· ${x.as}`}
                          </small>
                        </span>
                        {x.scope === 'Ip' && (
                          <button className="btn sm ghost" onClick={() => unban('crowdsec', x.value)}>
                            <Unlock size={11} /> Débannir
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {d.fail2ban.map((j: any) => (
              <div key={j.name}>
                <div className="section-title">
                  fail2ban · {j.name} <span className="faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· {j.total} bannis au total · {j.failed} échecs en cours</span>
                </div>
                {j.banned.length === 0 ? (
                  <div className="faint">Aucune IP bannie actuellement</div>
                ) : (
                  <div className="group-box">
                    {j.banned.map((ip: string) => (
                      <div className="gb-row" key={ip}>
                        <Ban size={14} color="var(--red)" />
                        <span className="label mono">{ip}</span>
                        <button className="btn sm ghost" onClick={() => unban('fail2ban', ip, j.name)}>
                          <Unlock size={11} /> Débannir
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!d.crowdsec.available && d.fail2ban.length === 0 && <Empty title="Ni CrowdSec ni fail2ban détectés" />}
          </div>
        )}
        {d && tab === 'system' && (
          <div className="pad">
            <div className="section-title">SSH</div>
            <div className="group-box">
              <div className="gb-row">
                <KeyRound size={15} />
                <span className="label">Port</span>
                <span className="mono">{d.sshd.port || '—'}</span>
              </div>
              <div className="gb-row">
                <Lock size={15} />
                <span className="label">Connexion root</span>
                <span className={`badge ${d.sshd.permitrootlogin === 'yes' ? 'orange' : 'green'}`}>{d.sshd.permitrootlogin || '—'}</span>
              </div>
              <div className="gb-row">
                <Lock size={15} />
                <span className="label">Authentification par mot de passe</span>
                <span className={`badge ${d.sshd.passwordauthentication === 'yes' ? 'red' : 'green'}`}>{d.sshd.passwordauthentication || '—'}</span>
              </div>
            </div>
            <div className="section-title">Mises à jour disponibles ({d.upgrades.length})</div>
            {d.upgrades.length === 0 ? (
              <div className="faint">Système à jour</div>
            ) : (
              <div className="group-box">
                {d.upgrades.map((p: string) => (
                  <div className="gb-row" key={p} style={{ minHeight: 30 }}>
                    <Package size={13} className="faint" />
                    <span className="label mono" style={{ fontSize: 12 }}>{p}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
