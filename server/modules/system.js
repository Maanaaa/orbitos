// Système : métriques hôte, services systemd, timers, cron, pare-feu & sécurité.
import { conn, run, runPriv, privPrefix } from '../ssh.js';
import { q, unit, ip, bad } from '../util.js';
import { action } from '../journal.js';

const SEP = '@@ORBIT@@';
const lastCpu = new Map(); // serveur -> { total, idle, per: [...] , net, at }

const METRICS_CMD = [
  'cat /proc/stat | grep "^cpu"',
  `echo ${SEP}`,
  'cat /proc/meminfo',
  `echo ${SEP}`,
  'cat /proc/loadavg',
  `echo ${SEP}`,
  'df -P -B1 -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null | tail -n +2',
  `echo ${SEP}`,
  'cat /proc/net/dev | tail -n +3',
  `echo ${SEP}`,
  'cat /proc/uptime',
  `echo ${SEP}`,
  'hostname; (. /etc/os-release && echo "$PRETTY_NAME"); uname -r; nproc',
].join('; ');

function parseCpu(lines) {
  return lines.map((l) => {
    const [name, ...v] = l.trim().split(/\s+/);
    const n = v.map(Number);
    const idle = n[3] + (n[4] || 0);
    const total = n.reduce((a, b) => a + b, 0);
    return { name, idle, total };
  });
}

export async function metrics(id) {
  const out = await run(id, METRICS_CMD, { timeout: 15000 });
  const [cpuS, memS, loadS, dfS, netS, upS, infoS] = out.split(SEP).map((s) => s.trim());
  const cpus = parseCpu(cpuS.split('\n'));
  const now = Date.now();
  const prev = lastCpu.get(id);
  const pct = (cur, old) => {
    if (!old) return null;
    const dt = cur.total - old.total;
    return dt > 0 ? Math.round((1000 * (dt - (cur.idle - old.idle))) / dt) / 10 : 0;
  };
  const cpu = pct(cpus[0], prev?.cpus?.[0]);
  const perCore = cpus.slice(1).map((c, i) => pct(c, prev?.cpus?.[i + 1]));

  const mem = {};
  for (const l of memS.split('\n')) {
    const m = l.match(/^(\w+):\s+(\d+)/);
    if (m) mem[m[1]] = Number(m[2]) * 1024;
  }
  const [l1, l5, l15, procs] = loadS.split(/\s+/);

  const disks = dfS
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [fs, size, used, avail, , mount] = l.split(/\s+/);
      return { fs, size: +size, used: +used, avail: +avail, mount };
    })
    .filter((d) => d.size > 1e9 && !d.mount.startsWith('/boot'));

  const nets = netS
    .split('\n')
    .map((l) => {
      const [name, rest] = l.split(':');
      const v = rest.trim().split(/\s+/).map(Number);
      return { name: name.trim(), rx: v[0], tx: v[8] };
    })
    .filter((n) => !/^(lo|veth|br-|docker)/.test(n.name));
  const rx = nets.reduce((a, n) => a + n.rx, 0);
  const tx = nets.reduce((a, n) => a + n.tx, 0);
  let net = null;
  if (prev?.net) {
    const dt = (now - prev.at) / 1000;
    net = { rx: Math.max(0, (rx - prev.net.rx) / dt), tx: Math.max(0, (tx - prev.net.tx) / dt) };
  }
  lastCpu.set(id, { cpus, net: { rx, tx }, at: now });

  const [hostname, os, kernel, cores] = infoS.split('\n');
  return {
    at: now,
    cpu,
    perCore,
    load: [+l1, +l5, +l15],
    procs,
    mem: {
      total: mem.MemTotal,
      available: mem.MemAvailable,
      used: mem.MemTotal - mem.MemAvailable,
      cached: (mem.Cached || 0) + (mem.Buffers || 0),
      swapTotal: mem.SwapTotal,
      swapUsed: mem.SwapTotal - mem.SwapFree,
    },
    disks,
    net,
    uptime: Number(upS.split(' ')[0]),
    info: { hostname, os, kernel, cores: Number(cores) },
  };
}

export async function processes(id) {
  const out = await run(id, 'ps -eo pid,user,pcpu,pmem,rss,etimes,comm,args --sort=-pcpu --no-headers | head -n 60');
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const m = l.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      if (!m) return null;
      return { pid: +m[1], user: m[2], cpu: +m[3], mem: +m[4], rss: +m[5] * 1024, elapsed: +m[6], comm: m[7], args: m[8].slice(0, 300) };
    })
    .filter(Boolean);
}

// ───────── systemd ─────────

export async function services(id) {
  const p = await privPrefix(id);
  const out = await run(id, `${p}systemctl list-units --type=service --all --no-pager --no-legend --plain`);
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [name, load, active, sub, ...desc] = l.trim().split(/\s+/);
      return { name, load, active, sub, description: desc.join(' ') };
    })
    .filter((s) => s.load !== 'not-found');
}

export async function serviceAction(id, name, act) {
  unit(name);
  if (!['start', 'stop', 'restart', 'reload'].includes(act)) throw bad('Action invalide');
  return action(id, `service.${act}`, name, () => runPriv(id, `systemctl ${act} ${q(name)}`, { timeout: 60000 }));
}

export async function timers(id) {
  const out = await run(id, 'systemctl list-timers --all --no-pager --no-legend --plain 2>/dev/null || true');
  // NEXT(4 champs+) LEFT LAST PASSED UNIT ACTIVATES : on récupère les deux derniers tokens
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const t = l.trim().split(/\s+/);
      const activates = t.at(-1);
      const unitName = t.at(-2);
      const next = l.match(/^(\w{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \w+)/)?.[1] || null;
      return { unit: unitName, activates, next, raw: l.trim() };
    });
}

export async function crontabs(id) {
  const p = await privPrefix(id);
  const out = await conn(id).exec(
    `${p}sh -c 'echo "## crontab $(id -un)"; crontab -l 2>/dev/null; for f in /etc/crontab /etc/cron.d/*; do [ -f "$f" ] && echo "## $f" && grep -v "^\\s*#" "$f" | grep -v "^\\s*$"; done'`,
  );
  const blocks = [];
  let cur = null;
  for (const line of out.stdout.split('\n')) {
    if (line.startsWith('## ')) {
      cur = { source: line.slice(3), entries: [] };
      blocks.push(cur);
    } else if (cur && line.trim() && !line.trim().startsWith('#')) {
      cur.entries.push(line);
    }
  }
  return blocks;
}

// ───────── Pare-feu & sécurité ─────────

export async function security(id) {
  const p = await privPrefix(id);
  const c = conn(id);
  const [ufw, ports, f2b, cs, ssh, apt] = await Promise.all([
    c.exec(`${p}ufw status numbered 2>/dev/null`),
    c.exec(`${p}ss -tulnpH 2>/dev/null`),
    c.exec(
      `${p}sh -c 'command -v fail2ban-client >/dev/null && for j in $(fail2ban-client status | sed -n "s/.*Jail list:\\s*//p" | tr "," " "); do echo "@@JAIL $j"; fail2ban-client status $j; done'`,
    ),
    c.exec(`${p}sh -c 'command -v cscli >/dev/null && cscli decisions list -o json 2>/dev/null'`),
    c.exec(`${p}sh -c "sshd -T 2>/dev/null | grep -Ei '^(permitrootlogin|passwordauthentication|port) '"`),
    c.exec(`apt list --upgradable 2>/dev/null | tail -n +2`, { timeout: 30000 }),
  ]);

  const ufwRules = ufw.stdout
    .split('\n')
    .map((l) => l.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(ALLOW|DENY|REJECT|LIMIT)(?: IN| OUT)?\s+(.+?)(?:\s+#\s*(.*))?$/))
    .filter(Boolean)
    .map((m) => ({ n: +m[1], to: m[2].trim(), action: m[3], from: m[4].trim(), comment: m[5] || '' }));

  const listening = ports.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const t = l.trim().split(/\s+/);
      const local = t[4] || '';
      const idx = local.lastIndexOf(':');
      return {
        proto: t[0],
        address: local.slice(0, idx),
        port: Number(local.slice(idx + 1)),
        process: (l.match(/users:\(\("([^"]+)"/) || [])[1] || '',
      };
    })
    .filter((x) => x.port);

  const jails = [];
  for (const block of f2b.stdout.split('@@JAIL ').slice(1)) {
    const name = block.split('\n')[0].trim();
    const banned = (block.match(/Banned IP list:\s*(.*)/) || [])[1]?.trim().split(/\s+/).filter(Boolean) || [];
    const total = Number((block.match(/Total banned:\s*(\d+)/) || [])[1] || 0);
    const failed = Number((block.match(/Currently failed:\s*(\d+)/) || [])[1] || 0);
    jails.push({ name, banned, total, failed });
  }

  let decisions = [];
  try {
    const arr = JSON.parse(cs.stdout || '[]') || [];
    decisions = arr.flatMap((a) =>
      (a.decisions || []).map((d) => ({
        id: d.id,
        value: d.value,
        scope: d.scope,
        type: d.type,
        reason: d.scenario,
        duration: d.duration,
        country: a.source?.cn || '',
        as: a.source?.as_name || '',
      })),
    );
  } catch {
    /* cscli absent */
  }

  const sshd = Object.fromEntries(
    ssh.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => l.trim().split(/\s+/)),
  );

  return {
    ufw: { active: /Status: active/.test(ufw.stdout), rules: ufwRules, available: ufw.code === 0 },
    listening,
    fail2ban: jails,
    crowdsec: { available: cs.code === 0, decisions },
    sshd,
    upgrades: apt.stdout.split('\n').filter(Boolean).map((l) => l.split('/')[0]),
  };
}

export async function unban(id, { source, value, jail }) {
  ip(value);
  if (source === 'crowdsec') return action(id, 'security.unban', value, () => runPriv(id, `cscli decisions delete --ip ${q(value)}`));
  if (source === 'fail2ban') {
    unit(jail);
    return action(id, 'security.unban', `${jail}:${value}`, () => runPriv(id, `fail2ban-client set ${q(jail)} unbanip ${q(value)}`));
  }
  throw bad('Source inconnue');
}
