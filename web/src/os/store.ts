import { create } from 'zustand';

export type Win = {
  id: string;
  app: string;
  title?: string;
  props: Record<string, any>;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  min: boolean;
  max: boolean;
  closing?: boolean;
};

export type Server = {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  source: 'ssh-config' | 'orbitos';
  color?: string;
  hidden: boolean;
  connected: boolean;
  lastError: string | null;
};

type Toast = { id: number; title: string; message?: string; kind: 'ok' | 'error' | 'info' | 'warn' };
type Dialog =
  | { id: number; type: 'confirm'; title: string; message?: React.ReactNode; confirm?: string; danger?: boolean; resolve: (v: boolean) => void }
  | { id: number; type: 'prompt'; title: string; message?: string; label?: string; value?: string; confirm?: string; resolve: (v: string | null) => void };

type AppSize = { w: number; h: number };

export type Settings = {
  instanceName: string;
  modules: Record<string, boolean>;
  defaultDomain: string;
  timezone: string;
  onboarded: boolean;
  passwordFromEnv: boolean;
  catalog: { id: string; name: string; group: string; description: string; apiGuarded: boolean }[];
};

type State = {
  wins: Win[];
  focused: string | null;
  z: number;
  serverId: string;
  servers: Server[];
  toasts: Toast[];
  dialogs: Dialog[];
  spotlight: boolean;
  doctor: { crit: number; warn: number; info: number } | null;
  readonly: boolean;
  settings: Settings | null;
  open: (app: string, props?: Record<string, any>, opts?: { size?: AppSize; singleton?: boolean; title?: string }) => string;
  close: (id: string) => void;
  focus: (id: string) => void;
  update: (id: string, patch: Partial<Win>) => void;
  setProps: (id: string, props: Record<string, any>) => void;
  minimize: (id: string) => void;
  toggleMax: (id: string) => void;
  setServer: (id: string) => void;
  setServers: (s: Server[]) => void;
  set: (p: Partial<State>) => void;
};

const LS_KEY = 'orbitos.layout.v1';
const lsGet = (k: string) => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null');
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: any) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* stockage indisponible */
  }
};

let seq = 0;
const geometry: Record<string, { x: number; y: number; w: number; h: number }> = lsGet(LS_KEY) || {};

export const useOS = create<State>((set, get) => ({
  wins: [],
  focused: null,
  z: 10,
  serverId: lsGet('orbitos.server') || '',
  servers: [],
  toasts: [],
  dialogs: [],
  spotlight: false,
  doctor: null,
  readonly: false,
  settings: null,

  open(app, props = {}, opts = {}) {
    const { wins, z } = get();
    if (opts.singleton !== false) {
      const existing = wins.find((w) => w.app === app && !w.closing);
      if (existing && opts.singleton) {
        set({
          wins: wins.map((w) => (w.id === existing.id ? { ...w, min: false, z: z + 1, props: { ...w.props, ...props, nonce: Date.now() } } : w)),
          focused: existing.id,
          z: z + 1,
        });
        return existing.id;
      }
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const saved = geometry[app];
    const size = opts.size || { w: 980, h: 620 };
    const w = Math.min(saved?.w || size.w, vw - 40);
    const h = Math.min(saved?.h || size.h, vh - 130);
    const offset = (wins.filter((x) => !x.closing).length % 6) * 26;
    const x = saved && !wins.some((x) => x.app === app) ? saved.x : Math.max(20, (vw - w) / 2 - 140 + offset);
    const y = saved && !wins.some((x) => x.app === app) ? saved.y : Math.max(44, (vh - h) / 2 - 40 + offset);
    const id = `w${++seq}`;
    set({
      wins: [...wins, { id, app, props, title: opts.title, x: Math.min(x, vw - 120), y: Math.min(Math.max(y, 36), vh - 120), w, h, z: z + 1, min: false, max: false }],
      focused: id,
      z: z + 1,
    });
    return id;
  },
  close(id) {
    set({ wins: get().wins.map((w) => (w.id === id ? { ...w, closing: true } : w)) });
    setTimeout(() => {
      const wins = get().wins.filter((w) => w.id !== id);
      const top = [...wins].filter((w) => !w.min).sort((a, b) => b.z - a.z)[0];
      set({ wins, focused: top?.id || null });
    }, 150);
  },
  focus(id) {
    const { z, focused, wins } = get();
    if (focused === id && wins.find((w) => w.id === id)?.z === z) return;
    set({ wins: wins.map((w) => (w.id === id ? { ...w, z: z + 1, min: false } : w)), focused: id, z: z + 1 });
  },
  update(id, patch) {
    const wins = get().wins.map((w) => (w.id === id ? { ...w, ...patch } : w));
    set({ wins });
    const w = wins.find((x) => x.id === id);
    if (w && !w.max && ('x' in patch || 'w' in patch)) {
      geometry[w.app] = { x: w.x, y: w.y, w: w.w, h: w.h };
      lsSet(LS_KEY, geometry);
    }
  },
  setProps(id, props) {
    set({ wins: get().wins.map((w) => (w.id === id ? { ...w, props: { ...w.props, ...props } } : w)) });
  },
  minimize(id) {
    const wins = get().wins.map((w) => (w.id === id ? { ...w, min: true } : w));
    const top = wins.filter((w) => !w.min).sort((a, b) => b.z - a.z)[0];
    set({ wins, focused: top?.id || null });
  },
  toggleMax(id) {
    set({ wins: get().wins.map((w) => (w.id === id ? { ...w, max: !w.max } : w)) });
  },
  setServer(id) {
    lsSet('orbitos.server', id);
    set({ serverId: id, doctor: null });
  },
  setServers(servers) {
    const { serverId } = get();
    const visible = servers.filter((s) => !s.hidden);
    const next = visible.find((s) => s.id === serverId) ? serverId : visible[0]?.id || '';
    if (next !== serverId) lsSet('orbitos.server', next);
    set({ servers, serverId: next });
  },
  set: (p) => set(p as any),
}));

let tid = 0;
export function toast(title: string, kind: Toast['kind'] = 'ok', message?: string) {
  const id = ++tid;
  useOS.setState((s) => ({ toasts: [...s.toasts, { id, title, message, kind }] }));
  setTimeout(() => useOS.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 8000 : 4200);
}

let did = 0;
export function confirm(o: { title: string; message?: React.ReactNode; confirm?: string; danger?: boolean }) {
  return new Promise<boolean>((resolve) => {
    const id = ++did;
    useOS.setState((s) => ({
      dialogs: [
        ...s.dialogs,
        {
          id,
          type: 'confirm',
          ...o,
          resolve: (v: boolean) => {
            useOS.setState((st) => ({ dialogs: st.dialogs.filter((d) => d.id !== id) }));
            resolve(v);
          },
        },
      ],
    }));
  });
}
export function prompt(o: { title: string; message?: string; label?: string; value?: string; confirm?: string }) {
  return new Promise<string | null>((resolve) => {
    const id = ++did;
    useOS.setState((s) => ({
      dialogs: [
        ...s.dialogs,
        {
          id,
          type: 'prompt',
          ...o,
          resolve: (v: string | null) => {
            useOS.setState((st) => ({ dialogs: st.dialogs.filter((d) => d.id !== id) }));
            resolve(v);
          },
        },
      ],
    }));
  });
}

/** Exécute une action avec toast de succès/erreur. */
export async function run<T>(label: string, fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    toast(okMsg || label, 'ok');
    return r;
  } catch (e: any) {
    toast(`${label} : échec`, 'error', e.details?.output ? `${e.message}\n${String(e.details.output).slice(0, 400)}` : e.message);
    return undefined;
  }
}

export const useServer = () => useOS((s) => s.serverId);
export const useServerInfo = () => useOS((s) => s.servers.find((x) => x.id === s.serverId));
