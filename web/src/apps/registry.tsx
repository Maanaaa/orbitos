import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import {
  Activity,
  Box,
  FolderOpen,
  Globe,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Stethoscope,
  SquareTerminal,
  Cog,
  BookText,
  FileCode2,
  Info,
  Rocket,
  DatabaseBackup,
  type LucideIcon,
} from 'lucide-react';
import type { Win } from '../os/store';

export type AppProps = { win: Win };
export type AppDef = {
  id: string;
  name: string;
  icon: LucideIcon;
  gradient: string;
  size: { w: number; h: number };
  singleton?: boolean;
  dock?: boolean;
  description: string;
  component: LazyExoticComponent<ComponentType<AppProps>>;
};

export const APPS: AppDef[] = [
  {
    id: 'finder',
    name: 'Finder',
    icon: FolderOpen,
    gradient: 'linear-gradient(160deg,#6fd3ff,#1a7cf5 70%)',
    size: { w: 1000, h: 620 },
    dock: true,
    description: 'Fichiers du serveur, des volumes et des conteneurs',
    component: lazy(() => import('./Finder')),
  },
  {
    id: 'terminal',
    name: 'Terminal',
    icon: SquareTerminal,
    gradient: 'linear-gradient(160deg,#3a3f4b,#111318 70%)',
    size: { w: 860, h: 520 },
    singleton: true,
    dock: true,
    description: 'Shell SSH et shell dans les conteneurs',
    component: lazy(() => import('./Terminal')),
  },
  {
    id: 'docker',
    name: 'Docker',
    icon: Box,
    gradient: 'linear-gradient(160deg,#5ac8fa,#0a5bd6 75%)',
    size: { w: 1120, h: 680 },
    singleton: true,
    dock: true,
    description: 'Conteneurs, stacks, images et volumes',
    component: lazy(() => import('./Docker')),
  },
  {
    id: 'domains',
    name: 'Domaines',
    icon: Globe,
    gradient: 'linear-gradient(160deg,#7ef0c4,#14a37f 75%)',
    size: { w: 1120, h: 680 },
    singleton: true,
    dock: true,
    description: 'Vhosts nginx, sous-domaines, certificats SSL',
    component: lazy(() => import('./Domains')),
  },
  {
    id: 'hosting',
    name: 'Hébergement',
    icon: Rocket,
    gradient: 'linear-gradient(160deg,#ffb86b,#e8466c 75%)',
    size: { w: 1200, h: 720 },
    singleton: true,
    dock: true,
    description: 'Serveurs de jeu (Minecraft, Garry’s Mod, BeamMP…), TeamSpeak, bots Discord, conteneurs et sites web',
    component: lazy(() => import('./Hosting')),
  },
  {
    id: 'backup',
    name: 'Sauvegarde',
    icon: DatabaseBackup,
    gradient: 'linear-gradient(160deg,#8be9fd,#0f766e 75%)',
    size: { w: 1120, h: 680 },
    singleton: true,
    dock: true,
    description: 'Plans Backrest et instantanés restic : créer, lancer, restaurer',
    component: lazy(() => import('./Backup')),
  },
  {
    id: 'monitor',
    name: 'Moniteur',
    icon: Activity,
    gradient: 'linear-gradient(160deg,#a6ff7a,#1f9e3a 75%)',
    size: { w: 980, h: 640 },
    singleton: true,
    dock: true,
    description: 'CPU, mémoire, disque, réseau et processus',
    component: lazy(() => import('./Monitor')),
  },
  {
    id: 'console',
    name: 'Console',
    icon: ScrollText,
    gradient: 'linear-gradient(160deg,#ffd38a,#e2781a 75%)',
    size: { w: 1000, h: 600 },
    dock: true,
    description: 'Logs en direct : conteneurs, services, nginx',
    component: lazy(() => import('./Console')),
  },
  {
    id: 'doctor',
    name: 'Doctor',
    icon: Stethoscope,
    gradient: 'linear-gradient(160deg,#ff8fa3,#d6245a 75%)',
    size: { w: 860, h: 640 },
    singleton: true,
    dock: true,
    description: 'Diagnostic : fantômes, vhosts cassés, exposition, ressources',
    component: lazy(() => import('./Doctor')),
  },
  {
    id: 'services',
    name: 'Services',
    icon: Cog,
    gradient: 'linear-gradient(160deg,#c5cad6,#5d6575 75%)',
    size: { w: 960, h: 620 },
    singleton: true,
    dock: true,
    description: 'systemd, timers et tâches cron',
    component: lazy(() => import('./Services')),
  },
  {
    id: 'shield',
    name: 'Bouclier',
    icon: ShieldCheck,
    gradient: 'linear-gradient(160deg,#c49bff,#6a2fe0 75%)',
    size: { w: 1000, h: 640 },
    singleton: true,
    dock: true,
    description: 'Pare-feu, ports exposés, CrowdSec, fail2ban, mises à jour',
    component: lazy(() => import('./Shield')),
  },
  {
    id: 'servers',
    name: 'Serveurs',
    icon: ServerCog,
    gradient: 'linear-gradient(160deg,#79e1ff,#3653d6 75%)',
    size: { w: 820, h: 560 },
    singleton: true,
    dock: true,
    description: 'Gérer les serveurs connectés en SSH',
    component: lazy(() => import('./Servers')),
  },
  {
    id: 'journal',
    name: 'Journal',
    icon: BookText,
    gradient: 'linear-gradient(160deg,#ffe08a,#c99a12 75%)',
    size: { w: 880, h: 560 },
    singleton: true,
    dock: true,
    description: 'Historique des actions faites dans OrbitOS',
    component: lazy(() => import('./Journal')),
  },
  {
    id: 'editor',
    name: 'Éditeur',
    icon: FileCode2,
    gradient: 'linear-gradient(160deg,#8aa8ff,#4b3fd6 75%)',
    size: { w: 920, h: 640 },
    description: 'Éditeur de code',
    component: lazy(() => import('./Editor')),
  },
  {
    id: 'about',
    name: 'À propos',
    icon: Info,
    gradient: 'linear-gradient(160deg,#5ac8fa,#7d5cff 75%)',
    size: { w: 460, h: 400 },
    singleton: true,
    description: 'À propos d’OrbitOS',
    component: lazy(() => import('./About')),
  },
];

export const appById = (id: string) => APPS.find((a) => a.id === id);

export function AppIcon({ app, size = 50 }: { app: AppDef; size?: number }) {
  const Icon = app.icon;
  return (
    <div className="app-icon" style={{ background: app.gradient, width: size, height: size }}>
      <Icon size={size * 0.5} strokeWidth={1.9} />
    </div>
  );
}
