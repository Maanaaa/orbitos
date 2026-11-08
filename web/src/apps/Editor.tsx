import { useEffect, useRef, useState } from 'react';
import { Save, RotateCcw, ShieldCheck, FolderOpen } from 'lucide-react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { sapi } from '../lib/api';
import { bytes } from '../lib/format';
import { useOS, toast, confirm } from '../os/store';
import { ErrorBox, Loading } from '../os/ui';
import { appById, type AppProps } from './registry';

const theme = EditorView.theme(
  {
    '&': { color: '#e6e9f2', backgroundColor: '#0f1117' },
    '.cm-content': { caretColor: '#64d2ff', padding: '10px 0' },
    '.cm-cursor': { borderLeftColor: '#64d2ff', borderLeftWidth: '2px' },
    '.cm-gutters': { backgroundColor: '#0f1117', color: 'rgba(230,235,255,.28)', border: 'none', paddingRight: '6px' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.035)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'rgba(230,235,255,.7)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(10,132,255,.35) !important' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(100,210,255,.18)', outline: 'none' },
    '.cm-searchMatch': { backgroundColor: 'rgba(255,214,10,.25)' },
    '.cm-panels': { backgroundColor: '#1a1d26', color: '#e6e9f2' },
    '.cm-tooltip': { backgroundColor: '#1f222c', border: '0.5px solid rgba(255,255,255,.12)' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: '#ff7ab2' },
  { tag: [t.string, t.special(t.string)], color: '#ff8170' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#d9c97c' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#7f8c98', fontStyle: 'italic' },
  { tag: [t.propertyName, t.attributeName], color: '#78c2b3' },
  { tag: [t.variableName, t.definition(t.variableName)], color: '#acf2e4' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#6bdfff' },
  { tag: [t.typeName, t.className, t.tagName], color: '#dabaff' },
  { tag: [t.operator, t.punctuation], color: '#c5cad6' },
  { tag: t.meta, color: '#fd8f3f' },
  { tag: t.heading, color: '#6bdfff', fontWeight: 'bold' },
]);

async function languageFor(path: string) {
  const name = path.split('/').pop()!.toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop()! : '';
  if (path.startsWith('/etc/nginx/') || ext === 'conf' && name.includes('nginx')) {
    const { nginx } = await import('@codemirror/legacy-modes/mode/nginx');
    return StreamLanguage.define(nginx);
  }
  if (['yml', 'yaml'].includes(ext) || name.startsWith('compose') || name.startsWith('docker-compose')) return (await import('@codemirror/lang-yaml')).yaml();
  if (['json', 'jsonc'].includes(ext)) return (await import('@codemirror/lang-json')).json();
  if (['js', 'mjs', 'cjs', 'jsx'].includes(ext)) return (await import('@codemirror/lang-javascript')).javascript({ jsx: true });
  if (['ts', 'tsx'].includes(ext)) return (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: ext === 'tsx' });
  if (['sh', 'bash', 'zsh', 'env'].includes(ext) || name === '.env' || name.startsWith('.env')) {
    const { shell } = await import('@codemirror/legacy-modes/mode/shell');
    return StreamLanguage.define(shell);
  }
  if (name === 'dockerfile' || ext === 'dockerfile') {
    const { dockerFile } = await import('@codemirror/legacy-modes/mode/dockerfile');
    return StreamLanguage.define(dockerFile);
  }
  if (['toml'].includes(ext)) {
    const { toml } = await import('@codemirror/legacy-modes/mode/toml');
    return StreamLanguage.define(toml);
  }
  if (['ini', 'cnf', 'service', 'timer', 'socket', 'properties'].includes(ext)) {
    const { properties } = await import('@codemirror/legacy-modes/mode/properties');
    return StreamLanguage.define(properties);
  }
  if (['py'].includes(ext)) {
    const { python } = await import('@codemirror/legacy-modes/mode/python');
    return StreamLanguage.define(python);
  }
  return [];
}

export default function Editor({ win }: AppProps) {
  const sid: string = win.props.server || useOS.getState().serverId;
  const path: string = win.props.path;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const original = useRef('');
  const [meta, setMeta] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lang] = useState(() => new Compartment());
  const { update, open } = useOS();
  const isNginx = path?.startsWith('/etc/nginx/');

  const save = async () => {
    if (!view.current || saving) return;
    const content = view.current.state.doc.toString();
    setSaving(true);
    try {
      const r: any = await sapi(sid, 'files/write', { body: { path, content } });
      original.current = content;
      setDirty(false);
      toast(isNginx ? 'Enregistré · nginx -t OK · rechargé' : 'Enregistré', 'ok', r?.backup ? `Sauvegarde : ${r.backup}` : undefined);
    } catch (e: any) {
      toast(isNginx ? 'Refusé par nginx -t : rien n’a été modifié' : 'Échec de l’enregistrement', 'error', e.details?.output || e.message);
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const f = await sapi(sid, `files/read?path=${encodeURIComponent(path)}`);
        if (cancelled) return;
        if (f.binary) throw new Error('Fichier binaire : ouverture impossible dans l’éditeur.');
        setMeta(f);
        original.current = f.content;
        const language = await languageFor(path);
        const state = EditorState.create({
          doc: f.content,
          extensions: [
            basicSetup,
            theme,
            syntaxHighlighting(highlight),
            lang.of(language),
            keymap.of([indentWithTab, { key: 'Mod-s', preventDefault: true, run: () => (saveRef.current(), true) }]),
            EditorView.updateListener.of((u) => u.docChanged && setDirty(u.state.doc.toString() !== original.current)),
          ],
        });
        view.current = new EditorView({ state, parent: host.current! });
        view.current.focus();
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    return () => {
      cancelled = true;
      view.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, path]);

  useEffect(() => {
    update(win.id, { title: `${dirty ? '● ' : ''}${path.split('/').pop()}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  const revert = async () => {
    if (!view.current) return;
    if (!(await confirm({ title: 'Annuler les modifications ?', message: 'Le contenu revient à la dernière version enregistrée.', confirm: 'Rétablir', danger: true }))) return;
    view.current.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: original.current } });
  };

  return (
    <div className="app-col">
      <div className="toolbar">
        <span className="mono muted ellipsis" style={{ fontSize: 12, flex: 1 }} title={path}>
          {path}
        </span>
        {meta?.privileged && <span className="badge orange">sudo</span>}
        {isNginx && (
          <span className="badge cyan" title="Chaque enregistrement est validé par nginx -t ; en cas d’échec le fichier est restauré automatiquement.">
            <ShieldCheck size={11} /> nginx -t + rollback
          </span>
        )}
        <span className="faint" style={{ fontSize: 11.5 }}>{meta ? bytes(meta.size) : ''}</span>
        <button className="btn ghost icon" title="Afficher dans le Finder" onClick={() => open('finder', { path: path.replace(/\/[^/]+$/, '') || '/' }, { size: appById('finder')!.size })}>
          <FolderOpen size={14} />
        </button>
        <button className="btn ghost icon" disabled={!dirty} onClick={revert} title="Rétablir">
          <RotateCcw size={14} />
        </button>
        <button className="btn primary" disabled={!dirty || saving} onClick={save}>
          <Save size={13} /> {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
      <ErrorBox error={error} />
      {!meta && !error && <Loading />}
      <div className="cm-host" ref={host} style={{ display: meta ? 'block' : 'none' }} />
    </div>
  );
}
