// Doctor : diagnostic transversal d'un serveur (fantômes, ports exposés, vhosts cassés,
// certificats, ressources). Chaque constat propose l'app OrbitOS où agir.
import { conn, dockerPrefix, privPrefix } from '../ssh.js';
import * as system from './system.js';
import * as docker from './docker.js';
import * as nginx from './nginx.js';

const cache = new Map();

function ageDays(status) {
  // "Exited (137) 7 weeks ago" → jours approximatifs
  const m = status.match(/(\d+|an?|About an?)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return 0;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  const mult = { second: 0, minute: 0, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 }[m[2].toLowerCase()];
  return n * mult;
}

const safe = (p) => p.then((v) => v, (e) => ({ __error: e.message }));

export async function run(id, { force = false } = {}) {
  const c = cache.get(id);
  if (!force && c && Date.now() - c.at < 120000) return c.data;

  const caps = await conn(id).capabilities();
  const [m, cs, vh, imgs, vols, sec, inspectOut] = await Promise.all([
    safe(system.metrics(id)),
    caps.hasDocker && (caps.docker || caps.sudo || caps.root) ? safe(docker.containers(id)) : [],
    safe(nginx.scan(id)),
    caps.hasDocker && (caps.docker || caps.sudo || caps.root) ? safe(docker.images(id)) : [],
    caps.hasDocker && (caps.docker || caps.sudo || caps.root) ? safe(docker.volumes(id)) : [],
    safe(system.security(id)),
    !caps.hasDocker ? '' : safe(
      (async () => {
        const p = await dockerPrefix(id);
        const r = await conn(id).exec(`${p}docker inspect -f '{{.Name}}|{{.RestartCount}}|{{.HostConfig.RestartPolicy.Name}}' $(${p}docker ps -aq) 2>/dev/null`);
        return r.stdout;
      })(),
    ),
  ]);

  const findings = [];
  const add = (f) => findings.push(f);

  // ── Ressources
  if (m && !m.__error) {
    const memPct = (m.mem.used / m.mem.total) * 100;
    const swapPct = m.mem.swapTotal ? (m.mem.swapUsed / m.mem.swapTotal) * 100 : 0;
    if (swapPct > 50)
      add({ id: 'swap', severity: 'warn', category: 'Ressources', title: `Swap utilisé à ${swapPct.toFixed(0)} %`, detail: `${fmtBytes(m.mem.swapUsed)} en swap : la RAM manque, les services ralentissent.`, app: 'monitor' });
    if (memPct > 90) add({ id: 'mem', severity: 'crit', category: 'Ressources', title: `RAM saturée (${memPct.toFixed(0)} %)`, app: 'monitor' });
    for (const d of m.disks) {
      const pct = (d.used / d.size) * 100;
      if (pct > 85) add({ id: `disk-${d.mount}`, severity: pct > 95 ? 'crit' : 'warn', category: 'Ressources', title: `Disque ${d.mount} à ${pct.toFixed(0)} %`, detail: `${fmtBytes(d.avail)} libres`, app: 'monitor' });
    }
    const loadPerCore = m.load[1] / (m.info.cores || 1);
    if (loadPerCore > 1) add({ id: 'load', severity: 'warn', category: 'Ressources', title: `Charge élevée (${m.load[1]} sur ${m.info.cores} cœurs)`, app: 'monitor' });
  }

  // ── Conteneurs
  if (Array.isArray(cs)) {
    for (const ct of cs) {
      if (ct.state === 'created')
        add({ id: `created-${ct.name}`, severity: 'warn', category: 'Fantômes', title: `${ct.name} créé mais jamais démarré`, detail: ct.image, app: 'docker', target: { tab: 'containers', name: ct.name } });
      else if (ct.state === 'exited') {
        const days = ageDays(ct.status);
        const code = ct.status.match(/Exited \((\d+)\)/)?.[1];
        add({
          id: `exited-${ct.name}`,
          severity: days > 7 ? 'info' : code !== '0' ? 'warn' : 'info',
          category: 'Fantômes',
          title: `${ct.name} arrêté ${ct.status.replace(/^Exited \(\d+\)\s*/, '')}`,
          detail: `Code de sortie ${code}${ct.project ? ` · stack ${ct.project}` : ''}`,
          app: 'docker',
          target: { tab: 'containers', name: ct.name },
        });
      } else if (ct.state === 'restarting')
        add({ id: `restarting-${ct.name}`, severity: 'crit', category: 'Conteneurs', title: `${ct.name} redémarre en boucle`, app: 'docker', target: { tab: 'containers', name: ct.name } });
      if (ct.health === 'unhealthy') add({ id: `unhealthy-${ct.name}`, severity: 'crit', category: 'Conteneurs', title: `${ct.name} : healthcheck en échec`, app: 'docker', target: { tab: 'containers', name: ct.name } });
      for (const p of ct.ports.filter((p) => p.public)) {
        add({
          id: `port-${ct.name}-${p.hostPort}`,
          severity: 'warn',
          category: 'Exposition',
          title: `${ct.name} publie ${p.hostPort}/${p.proto} sur Internet`,
          detail: 'Docker contourne UFW : ce port est joignable même sans règle de pare-feu. Lie-le à 127.0.0.1 si nginx le sert.',
          app: 'shield',
        });
      }
    }
    if (typeof inspectOut === 'string') {
      for (const line of inspectOut.split('\n').filter(Boolean)) {
        const [name, count] = line.replace(/^\//, '').split('|');
        if (Number(count) >= 5) add({ id: `restarts-${name}`, severity: 'warn', category: 'Conteneurs', title: `${name} a redémarré ${count} fois`, app: 'docker', target: { tab: 'containers', name } });
      }
    }
    const latest = cs.filter((c) => /:latest$/.test(c.image) || !c.image.includes(':')).length;
    if (latest > 5)
      add({ id: 'latest', severity: 'info', category: 'Hygiène', title: `${latest} conteneurs sur une image :latest ou non taguée`, detail: 'Mises à jour imprévisibles au prochain pull. Préfère des tags figés.', app: 'docker', target: { tab: 'images' } });
  }

  if (Array.isArray(imgs)) {
    const dangling = imgs.filter((i) => i.dangling);
    if (dangling.length)
      add({ id: 'dangling', severity: 'info', category: 'Fantômes', title: `${dangling.length} images orphelines (<none>)`, detail: 'Nettoyables sans risque.', app: 'docker', target: { tab: 'images' }, fix: 'prune-dangling' });
  }
  if (Array.isArray(vols)) {
    const orphans = vols.filter((v) => v.orphan);
    if (orphans.length)
      add({ id: 'orphan-volumes', severity: 'info', category: 'Fantômes', title: `${orphans.length} volumes non rattachés`, detail: orphans.slice(0, 4).map((v) => (v.name.length > 24 ? v.name.slice(0, 12) + '…' : v.name)).join(', ') + (orphans.length > 4 ? ` et ${orphans.length - 4} autres` : ''), app: 'docker', target: { tab: 'volumes' } });
  }

  // ── Web
  if (vh && !vh.__error) {
    if (vh.nginx !== 'active' && vh.vhosts.length) add({ id: 'nginx', severity: 'crit', category: 'Web', title: `nginx est ${vh.nginx}`, app: 'services' });
    for (const v of vh.vhosts.filter((v) => v.enabled)) {
      const down = v.upstreams.filter((u) => u.local && u.up === false);
      if (down.length)
        add({
          id: `vhost-down-${v.name}`,
          severity: 'warn',
          category: 'Web',
          title: `${v.serverNames[0] || v.name} → :${down.map((u) => u.port).join(', :')} ne répond pas`,
          detail: `Vhost ${v.name} actif mais aucun service n’écoute : les visiteurs reçoivent une 502.`,
          app: 'domains',
          target: { vhost: v.name },
        });
    }
    for (const c of vh.certs) {
      if (c.daysLeft != null && c.daysLeft < 15 && c.used)
        add({ id: `cert-${c.name}`, severity: c.daysLeft < 5 ? 'crit' : 'warn', category: 'Web', title: `Certificat ${c.name} expire dans ${c.daysLeft} j`, app: 'domains', target: { tab: 'certs' } });
      if (!c.used) add({ id: `cert-unused-${c.name}`, severity: 'info', category: 'Fantômes', title: `Certificat ${c.name} sans vhost`, detail: c.daysLeft != null ? `Expire dans ${c.daysLeft} j` : '', app: 'domains', target: { tab: 'certs' } });
    }
    for (const b of vh.brokenLinks) add({ id: `broken-${b.link}`, severity: 'warn', category: 'Web', title: `Lien cassé ${b.link}`, detail: `→ ${b.target}`, app: 'domains' });
  }

  // ── Sécurité
  if (sec && !sec.__error) {
    if (sec.upgrades.length) add({ id: 'apt', severity: sec.upgrades.length > 30 ? 'warn' : 'info', category: 'Sécurité', title: `${sec.upgrades.length} paquets à mettre à jour`, detail: sec.upgrades.slice(0, 8).join(', '), app: 'shield' });
    if (sec.sshd.passwordauthentication === 'yes') add({ id: 'ssh-pass', severity: 'warn', category: 'Sécurité', title: 'SSH accepte les mots de passe', detail: 'PasswordAuthentication yes : préfère les clés uniquement.', app: 'shield' });
    if (sec.ufw.available && !sec.ufw.active) add({ id: 'ufw', severity: 'warn', category: 'Sécurité', title: 'UFW inactif', app: 'shield' });
    const listeningPublic = new Set(sec.listening.filter((l) => !/^(127\.|\[::1\]|::1)/.test(l.address)).map((l) => l.port));
    const ruleOnly = sec.ufw.rules.filter((r) => /^\d+(\/\w+)?$/.test(r.to) && !listeningPublic.has(Number(r.to.split('/')[0])) && !/\(v6\)/.test(r.to));
    const uniq = [...new Set(ruleOnly.map((r) => r.to))];
    if (uniq.length) add({ id: 'ufw-unused', severity: 'info', category: 'Sécurité', title: `${uniq.length} ports ouverts dans UFW sans service à l’écoute`, detail: uniq.join(', '), app: 'shield' });
  }

  const order = { crit: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const data = {
    at: Date.now(),
    findings,
    summary: { crit: findings.filter((f) => f.severity === 'crit').length, warn: findings.filter((f) => f.severity === 'warn').length, info: findings.filter((f) => f.severity === 'info').length },
    errors: [m, cs, vh, imgs, vols, sec].filter((x) => x && x.__error).map((x) => x.__error),
  };
  cache.set(id, { at: Date.now(), data });
  return data;
}

function fmtBytes(n) {
  if (!n) return '0';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}

export { privPrefix };
