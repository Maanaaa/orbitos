// Domaines & vhosts nginx : inventaire, santé des upstreams, certificats, assistant de création,
// activation/désactivation et édition sûre (sauvegarde → nginx -t → rollback automatique → reload).
import dns from 'node:dns/promises';
import net from 'node:net';
import { conn, run, runPriv, getServer, privPrefix } from '../ssh.js';
import { q, domain as vDomain, bad, absPath, HttpError } from '../util.js';
import { action, log } from '../journal.js';
import { backup, writeRaw, trash } from './files.js';

const AVAIL = '/etc/nginx/sites-available';
const ENABLED = '/etc/nginx/sites-enabled';

const SCAN = `cd /etc/nginx 2>/dev/null || exit 0
for f in sites-available/* sites-enabled/* conf.d/*.conf; do
  [ -e "$f" ] || continue
  if [ -L "$f" ]; then echo "@@LINK /etc/nginx/$f $(readlink -f "$f")"
  elif [ -f "$f" ]; then echo "@@FILE /etc/nginx/$f"; cat "$f"; echo; fi
done
echo "@@CERTS"
for d in /etc/letsencrypt/live/*/; do
  [ -f "$d/cert.pem" ] || continue
  n=$(basename "$d")
  e=$(openssl x509 -enddate -noout -in "$d/cert.pem" 2>/dev/null | cut -d= -f2)
  s=$(openssl x509 -noout -ext subjectAltName -in "$d/cert.pem" 2>/dev/null | tail -n +2 | tr -d ' ' | sed 's/DNS://g')
  echo "$n|$e|$s"
done
echo "@@PORTS"
ss -tlnH 2>/dev/null | awk '{print $4}'
echo "@@NGINX"
systemctl is-active nginx 2>/dev/null
`;

function stripComments(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/(^|[^\\$])#.*$/, '$1'))
    .join('\n');
}

function parseVhost(file, text) {
  const t = stripComments(text);
  const names = new Set();
  for (const m of t.matchAll(/server_name\s+([^;]+);/g)) for (const n of m[1].trim().split(/\s+/)) if (n && n !== '_' && n !== '""') names.add(n);
  const upstreams = [];
  for (const m of t.matchAll(/proxy_pass\s+(https?):\/\/([^;\s/]+)([^;\s]*)\s*;/g)) {
    const [host, port] = m[2].includes(':') ? m[2].split(':') : [m[2], m[1] === 'https' ? '443' : '80'];
    if (/outpost\.goauthentik\.io/.test(m[3])) continue;
    upstreams.push({ scheme: m[1], host, port: Number(port) || null, raw: m[2] });
  }
  const roots = [...t.matchAll(/^\s*root\s+([^;]+);/gm)].map((m) => m[1].trim());
  const certs = [...t.matchAll(/ssl_certificate\s+\/etc\/letsencrypt\/live\/([^/]+)\//g)].map((m) => m[1]);
  const redirects = [...t.matchAll(/return\s+30[12]\s+([^;]+);/g)].map((m) => m[1].trim()).filter((r) => !r.startsWith('https://$host') && !r.startsWith('/outpost'));
  const authentikOutpost = (t.match(/proxy_pass\s+(https?:\/\/[^;\s]+)\/outpost\.goauthentik\.io/) || [])[1] || null;
  const php = /fastcgi_pass/.test(t);
  let kind = 'other';
  if (upstreams.length) kind = 'proxy';
  else if (php) kind = 'php';
  else if (redirects.length) kind = 'redirect';
  else if (roots.length) kind = 'static';
  return {
    file,
    name: file.split('/').pop(),
    serverNames: [...names],
    ssl: /listen\s+[^;]*443[^;]*ssl/.test(t) || certs.length > 0,
    certNames: [...new Set(certs)],
    upstreams: upstreams.filter((u, i, a) => a.findIndex((x) => x.raw === u.raw) === i),
    roots: [...new Set(roots)],
    redirects,
    kind,
    noindex: /include\s+snippets\/noindex\.conf/.test(t),
    authentik: !!authentikOutpost,
    authentikOutpost,
    defaultServer: /default_server/.test(t),
    microcache: /proxy_cache\s+\w+/.test(t) && !/proxy_cache\s+off/.test(t),
  };
}

export async function scan(id) {
  const p = await privPrefix(id);
  const out = await run(id, `${p}sh -c ${q(SCAN)}`, { timeout: 60000 });
  const [filesPart, rest] = out.split('@@CERTS');
  const [certPart, rest2] = (rest || '').split('@@PORTS');
  const [portsPart, nginxPart] = (rest2 || '').split('@@NGINX');

  const files = new Map(); // chemin réel -> contenu
  const links = []; // [lien, cible]
  const chunks = filesPart.split(/^@@/m).filter(Boolean);
  for (const ch of chunks) {
    const nl = ch.indexOf('\n');
    const head = nl === -1 ? ch : ch.slice(0, nl);
    if (head.startsWith('LINK ')) {
      const [, l, target] = head.split(' ');
      links.push([l, target]);
    } else if (head.startsWith('FILE ')) {
      files.set(head.slice(5).trim(), nl === -1 ? '' : ch.slice(nl + 1));
    }
  }
  const enabledTargets = new Set(links.map(([, t]) => t));

  const listening = new Set(
    (portsPart || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((a) => Number(a.slice(a.lastIndexOf(':') + 1))),
  );

  const now = Date.now();
  const certs = (certPart || '')
    .split('\n')
    .filter((l) => l.includes('|'))
    .map((l) => {
      const [name, end, sans] = l.split('|');
      const expires = end ? new Date(end).getTime() : null;
      return { name, expires, daysLeft: expires ? Math.floor((expires - now) / 86400000) : null, domains: (sans || '').split(',').filter(Boolean) };
    });
  const certByName = Object.fromEntries(certs.map((c) => [c.name, c]));

  const vhosts = [];
  for (const [file, text] of files) {
    // Fichiers sans bloc server (zones de cache, maps…) : pas des vhosts
    if (!/\bserver\s*\{/.test(stripComments(text))) continue;
    if (file.startsWith(ENABLED + '/') || file.startsWith('/etc/nginx/conf.d/')) {
      // fichier réel dans sites-enabled ou conf.d : actif
      vhosts.push({ ...parseVhost(file, text), enabled: true, inEnabledDir: true });
    } else {
      vhosts.push({ ...parseVhost(file, text), enabled: enabledTargets.has(file), inEnabledDir: false });
    }
  }
  // Liens cassés
  const broken = links.filter(([, t]) => !files.has(t)).map(([l, t]) => ({ link: l, target: t }));

  for (const v of vhosts) {
    for (const u of v.upstreams) {
      const local = ['127.0.0.1', 'localhost', '0.0.0.0', '[::1]'].includes(u.host);
      u.local = local;
      u.up = local ? listening.has(u.port) : null;
    }
    v.certs = v.certNames.map((n) => certByName[n] || { name: n, missing: true });
    v.minCertDays = v.certs.reduce((m, c) => (c.daysLeft != null && (m == null || c.daysLeft < m) ? c.daysLeft : m), null);
    v.health = !v.enabled ? 'disabled' : v.upstreams.some((u) => u.local && u.up === false) ? 'down' : v.minCertDays != null && v.minCertDays < 15 ? 'warn' : 'ok';
  }
  vhosts.sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.serverNames[0] || a.name).localeCompare(b.serverNames[0] || b.name));

  const usedCerts = new Set(vhosts.flatMap((v) => v.certNames));
  return {
    nginx: (nginxPart || '').trim() || 'unknown',
    vhosts,
    certs: certs.map((c) => ({ ...c, used: usedCerts.has(c.name) })).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999)),
    brokenLinks: broken,
    authentikOutpost: vhosts.find((v) => v.authentikOutpost)?.authentikOutpost || null,
  };
}

// ───────── Vérification externe (DNS + HTTP) depuis OrbitOS ─────────

async function serverIps(id) {
  const s = getServer(id);
  if (net.isIP(s.host)) return [s.host];
  try {
    return (await dns.lookup(s.host, { all: true })).map((a) => a.address);
  } catch {
    return [];
  }
}

export async function check(id, name) {
  const d = vDomain(name);
  const expected = await serverIps(id);
  let a = [];
  let aaaa = [];
  try {
    a = await dns.resolve4(d);
  } catch {
    /* pas d'A */
  }
  try {
    aaaa = await dns.resolve6(d);
  } catch {
    /* pas d'AAAA */
  }
  const probe = async (url) => {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
      return { status: r.status, ms: Date.now() - t0, location: r.headers.get('location'), server: r.headers.get('server') };
    } catch (e) {
      return { error: e.cause?.code || e.name || e.message, ms: Date.now() - t0 };
    }
  };
  const [http, https] = a.length || aaaa.length ? await Promise.all([probe(`http://${d}/`), probe(`https://${d}/`)]) : [null, null];
  return { name: d, dns: { a, aaaa }, expected, pointsHere: a.some((x) => expected.includes(x)), http, https };
}

// ───────── Opérations sûres ─────────

async function nginxTest(id) {
  const p = await privPrefix(id);
  const r = await conn(id).exec(`${p}nginx -t 2>&1`, { timeout: 30000 });
  return { ok: r.code === 0, output: (r.stdout + r.stderr).trim() };
}

async function reload(id) {
  await runPriv(id, 'systemctl reload nginx', { timeout: 30000 });
}

export async function testAndReload(id, doReload) {
  const t = await nginxTest(id);
  if (t.ok && doReload) await action(id, 'nginx.reload', 'nginx', () => reload(id));
  return t;
}

/** Sauvegarde, écrit, teste ; restaure si le test échoue ; recharge sinon. */
export async function saveConfig(id, rawPath, content) {
  const p = absPath(rawPath);
  if (!p.startsWith('/etc/nginx/')) throw bad('Seuls les fichiers sous /etc/nginx passent par cette route');
  return action(id, 'nginx.save', p, async () => {
    const bak = await backup(id, p);
    await writeRaw(id, p, Buffer.from(content, 'utf8'));
    const t = await nginxTest(id);
    if (!t.ok) {
      if (bak) await runPriv(id, `cp -a ${q(bak)} ${q(p)}`);
      throw new HttpError(422, 'nginx -t a échoué : modification annulée, fichier restauré.', { output: t.output, backup: bak });
    }
    await reload(id);
    return { backup: bak, test: t.output };
  });
}

export async function setEnabled(id, name, enabled) {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw bad('Nom de vhost invalide');
  const src = `${AVAIL}/${name}`;
  const link = `${ENABLED}/${name}`;
  return action(id, enabled ? 'vhost.enable' : 'vhost.disable', name, async () => {
    if (enabled) {
      await runPriv(id, `[ -f ${q(src)} ] && [ ! -e ${q(link)} ] && ln -s ${q(src)} ${q(link)}`);
    } else {
      await runPriv(id, `[ -L ${q(link)} ] || { echo "Pas un lien symbolique : désactivation manuelle requise" >&2; exit 1; }; rm ${q(link)}`);
    }
    const t = await nginxTest(id);
    if (!t.ok) {
      // rollback
      if (enabled) await runPriv(id, `rm -f ${q(link)}`);
      else await runPriv(id, `ln -s ${q(src)} ${q(link)}`);
      throw new HttpError(422, 'nginx -t a échoué : changement annulé.', { output: t.output });
    }
    await reload(id);
    return { ok: true };
  });
}

export async function remove(id, name) {
  if (!/^[a-zA-Z0-9._-]+$/.test(name) || name === '00-default' || name === 'default') throw bad('Vhost protégé ou invalide');
  return action(id, 'vhost.remove', name, async () => {
    const link = `${ENABLED}/${name}`;
    await runPriv(id, `[ -L ${q(link)} ] && rm ${q(link)} || true`);
    const t = await nginxTest(id);
    if (!t.ok) {
      await runPriv(id, `[ -f ${q(`${AVAIL}/${name}`)} ] && ln -sf ${q(`${AVAIL}/${name}`)} ${q(link)}`);
      throw new HttpError(422, 'nginx -t a échoué : suppression annulée.', { output: t.output });
    }
    await reload(id);
    const r = await trash(id, `${AVAIL}/${name}`);
    return r;
  });
}

// ───────── Assistant de création ─────────

const PROXY_HEADERS = `        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;`;

const AUTHENTIK_LOCATIONS = (outpost) => `    # Forward-auth Authentik (outpost embarqué)
    proxy_buffers 8 16k;
    proxy_buffer_size 32k;

    location /outpost.goauthentik.io {
        proxy_pass ${outpost}/outpost.goauthentik.io;
        proxy_set_header Host $host;
        proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
    }

    location @goauthentik_proxy_signin {
        return 302 /outpost.goauthentik.io/start?rd=$scheme://$http_host$request_uri;
    }
`;

const AUTHENTIK_GUARD = `        auth_request /outpost.goauthentik.io/auth/nginx;
        error_page 401 = @goauthentik_proxy_signin;
        auth_request_set $auth_cookie $upstream_http_set_cookie;
        add_header Set-Cookie $auth_cookie;
        auth_request_set $authentik_username $upstream_http_x_authentik_username;
        auth_request_set $authentik_email $upstream_http_x_authentik_email;
        proxy_set_header X-authentik-username $authentik_username;
        proxy_set_header X-authentik-email $authentik_email;
`;

export function renderVhost(o) {
  const lines = [];
  lines.push(`# ${o.domain} — généré par OrbitOS le ${new Date().toISOString().slice(0, 10)}`);
  lines.push('server {');
  lines.push('    listen 80;');
  lines.push('    listen [::]:80;');
  lines.push(`    server_name ${o.domain};`);
  if (o.noindex) lines.push('    include snippets/noindex.conf;');
  lines.push(`    client_max_body_size ${o.maxBody}M;`);
  lines.push('');
  if (o.authentik && o.type !== 'redirect') lines.push(AUTHENTIK_LOCATIONS(o.outpost));
  const guard = o.authentik && o.type !== 'redirect' ? AUTHENTIK_GUARD : '';
  if (o.type === 'proxy') {
    lines.push('    location / {');
    if (guard) lines.push(guard);
    lines.push(`        proxy_pass ${o.scheme}://${o.host}:${o.port};`);
    lines.push(PROXY_HEADERS);
    if (o.scheme === 'https') lines.push('        proxy_ssl_server_name on;');
    lines.push('    }');
  } else if (o.type === 'static') {
    lines.push(`    root ${o.root};`);
    lines.push('    index index.html index.htm;');
    lines.push('');
    lines.push('    location / {');
    if (guard) lines.push(guard);
    lines.push(o.spa ? '        try_files $uri $uri/ /index.html;' : '        try_files $uri $uri/ =404;');
    lines.push('    }');
    if (!guard) {
    lines.push('');
    lines.push('    location ~* \\.(css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?)$ {');
    lines.push('        expires 30d;');
    lines.push('        add_header Cache-Control "public, max-age=2592000";');
    lines.push('        access_log off;');
    lines.push('    }');
    }
  } else if (o.type === 'redirect') {
    lines.push(`    return ${o.permanent ? 301 : 302} ${o.target}${o.keepPath ? '$request_uri' : ''};`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

function placeholderPage(d) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${d}</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:radial-gradient(1200px 600px at 30% 20%,#1d2b64 0,#0b0f1a 60%);color:#e6ebff;font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif}
.c{text-align:center}.o{width:72px;height:72px;margin:0 auto 20px;border-radius:50%;border:2px solid #5ac8fa;box-shadow:0 0 40px #5ac8fa66;position:relative}.o:after{content:"";position:absolute;width:14px;height:14px;border-radius:50%;background:#5ac8fa;top:-7px;left:29px}
h1{font-weight:600;letter-spacing:-.02em;margin:0 0 6px}p{opacity:.6;margin:0}</style></head>
<body><div class="c"><div class="o"></div><h1>${d}</h1><p>Site en ligne — déployé avec OrbitOS</p></div></body></html>`;
}

export function normalizeCreate(id, body, ctx) {
  const o = {
    domain: vDomain(body.domain),
    type: body.type,
    noindex: !!body.noindex,
    ssl: body.ssl !== false,
    authentik: !!body.authentik,
    outpost: ctx.authentikOutpost,
    maxBody: Math.min(2048, Math.max(1, Number(body.maxBody) || 50)),
  };
  if (!['proxy', 'static', 'redirect'].includes(o.type)) throw bad('Type invalide');
  if (o.authentik && !o.outpost) throw bad('Aucun outpost Authentik détecté sur ce serveur');
  if (o.type === 'proxy') {
    o.scheme = body.scheme === 'https' ? 'https' : 'http';
    o.host = String(body.host || '127.0.0.1').trim();
    if (!/^[a-zA-Z0-9._-]{1,253}$/.test(o.host)) throw bad('Hôte cible invalide');
    o.port = Number(body.port);
    if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw bad('Port cible invalide');
  }
  if (o.type === 'static') {
    o.root = absPath(body.root || `/var/www/${o.domain}`);
    if (!o.root.startsWith('/var/www/') && !o.root.startsWith('/srv/') && !o.root.startsWith('/opt/')) throw bad('Racine statique : /var/www, /srv ou /opt uniquement');
    o.spa = !!body.spa;
  }
  if (o.type === 'redirect') {
    const t = String(body.target || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?(\/[^\s;'"{}]*)?$/.test(t)) throw bad('URL de redirection invalide');
    o.target = t;
    o.keepPath = body.keepPath !== false;
    o.permanent = body.permanent !== false;
  }
  return o;
}

const scanCache = new Map();
async function cachedScan(id) {
  const c = scanCache.get(id);
  if (c && Date.now() - c.at < 30000) return c.data;
  const data = await scan(id);
  scanCache.set(id, { at: Date.now(), data });
  return data;
}

export async function preview(id, body) {
  const ctx = await cachedScan(id);
  const o = normalizeCreate(id, body, ctx);
  return { config: renderVhost(o), file: `${AVAIL}/${o.domain}`, options: o };
}

export async function create(id, body) {
  const ctx = await scan(id);
  const o = normalizeCreate(id, body, ctx);
  const steps = [];
  const step = (label, ok = true, detail = '') => steps.push({ label, ok, detail });
  const file = `${AVAIL}/${o.domain}`;
  const link = `${ENABLED}/${o.domain}`;

  if (ctx.vhosts.some((v) => v.serverNames.includes(o.domain) && v.enabled)) throw bad(`${o.domain} est déjà servi par un vhost actif`);
  const exists = await conn(id).exec(`[ -e ${q(file)} ] || [ -e ${q(link)} ]`);
  if (exists.code === 0) throw bad(`${file} existe déjà`);

  try {
    if (o.type === 'static') {
      const pre = await privPrefix(id);
      const r = await conn(id).exec(`${pre}sh -c ${q(`[ -d ${q(o.root)} ] && echo EXISTS || mkdir -p ${q(o.root)}`)}`);
      if (r.code !== 0) throw new Error(r.stderr);
      if (!r.stdout.includes('EXISTS')) {
        await writeRaw(id, `${o.root}/index.html`, Buffer.from(placeholderPage(o.domain)));
        await runPriv(id, `chown -R www-data:www-data ${q(o.root)} 2>/dev/null || true`);
        step(`Dossier ${o.root} créé avec une page d’accueil`);
      } else step(`Dossier ${o.root} existant conservé`);
    }

    await writeRaw(id, file, Buffer.from(renderVhost(o)));
    step(`Vhost écrit : ${file}`);
    await runPriv(id, `ln -s ${q(file)} ${q(link)}`);
    step('Vhost activé (sites-enabled)');

    const t = await nginxTest(id);
    if (!t.ok) {
      await runPriv(id, `rm -f ${q(link)}`);
      await trash(id, file).catch(() => {});
      step('nginx -t', false, t.output);
      log({ server: id, kind: 'vhost.create', target: o.domain, ok: false, error: 'nginx -t' });
      return { ok: false, steps };
    }
    step('nginx -t : configuration valide');
    await reload(id);
    step('nginx rechargé');

    if (o.ssl) {
      const c = await check(id, o.domain);
      if (!c.pointsHere) {
        step(
          'Certificat SSL',
          false,
          `DNS : ${o.domain} → ${c.dns.a.join(', ') || 'aucun enregistrement A'} ; attendu ${c.expected.join(', ')}. Crée l’enregistrement A puis relance « Activer HTTPS ».`,
        );
      } else {
        const r = await conn(id).exec(
          `${await privPrefix(id)}certbot --nginx -d ${q(o.domain)} --non-interactive --agree-tos --redirect 2>&1 | tail -n 15`,
          { timeout: 180000 },
        );
        const okCert = /Successfully deployed|Congratulations|Certificate not yet due/i.test(r.stdout);
        step(okCert ? 'Certificat Let’s Encrypt installé + redirection HTTPS' : 'Certificat SSL', okCert, okCert ? '' : r.stdout);
      }
    }
    log({ server: id, kind: 'vhost.create', target: o.domain, ok: true, detail: o.type });
    return { ok: true, steps, url: `${o.ssl ? 'https' : 'http'}://${o.domain}` };
  } catch (e) {
    step('Erreur', false, e.message);
    log({ server: id, kind: 'vhost.create', target: o.domain, ok: false, error: e.message });
    return { ok: false, steps };
  }
}

export async function enableSsl(id, name) {
  const d = vDomain(name);
  const c = await check(id, d);
  if (!c.pointsHere) throw bad(`Le DNS de ${d} ne pointe pas vers ce serveur (${c.dns.a.join(', ') || 'aucun A'})`);
  return action(id, 'vhost.ssl', d, async () => {
    const r = await conn(id).exec(`${await privPrefix(id)}certbot --nginx -d ${q(d)} --non-interactive --agree-tos --redirect 2>&1 | tail -n 15`, {
      timeout: 180000,
    });
    if (!/Successfully deployed|Congratulations|Certificate not yet due/i.test(r.stdout)) throw new HttpError(502, 'Certbot a échoué', { output: r.stdout });
    return { output: r.stdout };
  });
}

export async function renewCert(id, name) {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw bad('Nom de certificat invalide');
  return action(id, 'cert.renew', name, async () => {
    const r = await conn(id).exec(`${await privPrefix(id)}certbot renew --cert-name ${q(name)} --non-interactive 2>&1 | tail -n 12`, { timeout: 180000 });
    if (r.code !== 0) throw new HttpError(502, 'Renouvellement échoué', { output: r.stdout });
    return { output: r.stdout };
  });
}
