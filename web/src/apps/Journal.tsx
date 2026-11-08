import { useState } from 'react';
import { CheckCircle2, XCircle, RefreshCw, Download } from 'lucide-react';
import { api, useApi } from '../lib/api';
import { dateTime } from '../lib/format';
import { ErrorBox, Loading, SearchField, Empty } from '../os/ui';
import type { AppProps } from './registry';

export default function Journal(_: AppProps) {
  const j = useApi(() => api('/api/journal?limit=1000'), [], { interval: 20000 });
  const [qv, setQ] = useState('');
  const rows = (j.data || []).filter((e: any) => !qv || `${e.server} ${e.kind} ${e.target} ${e.error || ''}`.toLowerCase().includes(qv.toLowerCase()));

  const exportMd = () => {
    const md = [
      '# Journal OrbitOS',
      '',
      '| Date | Serveur | Action | Cible | Statut |',
      '| :--- | :--- | :--- | :--- | :--- |',
      ...rows.map((e: any) => `| ${new Date(e.at).toLocaleString('fr-FR')} | ${e.server} | ${e.kind} | \`${String(e.target).replace(/\|/g, '\\|')}\` | ${e.ok ? '**Succès**' : `**Échec** : ${String(e.error || '').replace(/\|/g, '\\|').slice(0, 120)}`} |`),
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `orbitos-journal-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
  };

  return (
    <div className="app-col">
      <div className="toolbar">
        <h2>Journal</h2>
        <span className="faint" style={{ fontSize: 12 }}>Chaque action qui modifie un serveur est consignée</span>
        <div className="grow" />
        <SearchField value={qv} onChange={setQ} />
        <button className="btn" onClick={exportMd} title="Exporter le journal en Markdown">
          <Download size={13} /> Markdown
        </button>
        <button className="btn ghost icon" onClick={() => j.reload()}>
          <RefreshCw size={14} />
        </button>
      </div>
      <ErrorBox error={j.error} />
      <div className="content">
        {!j.data && !j.error ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="Aucune action pour l’instant" />
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th style={{ width: 24 }} />
                <th>Date</th>
                <th>Serveur</th>
                <th>Action</th>
                <th>Cible</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e: any, i: number) => (
                <tr key={i} title={e.error || ''}>
                  <td>{e.ok ? <CheckCircle2 size={14} color="var(--green)" /> : <XCircle size={14} color="var(--red)" />}</td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateTime(e.at)}</td>
                  <td>{e.server}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{e.kind}</td>
                  <td className="mono ellipsis selectable" style={{ fontSize: 11.5, maxWidth: 380 }}>
                    {e.target}
                    {!e.ok && e.error && <div style={{ color: '#ff8a80' }} className="ellipsis">{e.error}</div>}
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
