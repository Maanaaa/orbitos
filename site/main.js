/* OrbitOS — site vitrine. Vanilla JS, aucune dépendance. */
(() => {
  'use strict';

  const root = document.documentElement;
  root.classList.add('js');

  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = mqReduce.matches;
  const motionListeners = [];
  const onMotionChange = (e) => {
    reduced = e.matches;
    motionListeners.forEach((fn) => fn());
  };
  if (mqReduce.addEventListener) mqReduce.addEventListener('change', onMotionChange);
  else if (mqReduce.addListener) mqReduce.addListener(onMotionChange);

  let pageVisible = !document.hidden;
  const visListeners = [];
  document.addEventListener('visibilitychange', () => {
    pageVisible = !document.hidden;
    visListeners.forEach((fn) => fn());
  });

  const hasIO = 'IntersectionObserver' in window;
  const watch = (el, cb, rootMargin = '80px') => {
    if (!hasIO) { cb(true); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => cb(e.isIntersecting)), { rootMargin });
    io.observe(el);
  };

  /* Petit contrôleur : actif seulement si visible, onglet affiché et mouvement autorisé. */
  const gate = (el, onChange) => {
    const state = { inView: false, running: false };
    const update = () => {
      const should = state.inView && pageVisible && !reduced;
      el.classList.toggle('paused', !should);
      if (should !== state.running) {
        state.running = should;
        if (onChange) onChange(should);
      }
    };
    watch(el, (v) => { state.inView = v; update(); });
    visListeners.push(update);
    motionListeners.push(update);
    return state;
  };

  /* ---------- Header ---------- */
  const nav = document.querySelector('[data-nav]');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- Révélations au défilement ---------- */
  const reveals = document.querySelectorAll('.reveal');
  if (reduced || !hasIO) {
    reveals.forEach((el) => el.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
  }

  /* ---------- Animations CSS génériques : pause hors écran ---------- */
  document.querySelectorAll('[data-anim]:not([data-orbit]):not([data-desk])').forEach((el) => gate(el));

  /* ---------- Scène orbitale ---------- */
  const scene = document.querySelector('[data-orbit]');
  if (scene) {
    const svg = scene.querySelector('svg');
    const NS = 'http://www.w3.org/2000/svg';
    const CX = 320, CY = 240;
    const PHI = -10 * Math.PI / 180, cosP = Math.cos(PHI), sinP = Math.sin(PHI);
    const RINGS = [[132, 60], [198, 90], [262, 120]];
    const CORE_R = 48, NODE_R = 40;

    // Étoiles déterministes
    const back = svg.querySelector('#l-back');
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 46; i++) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', (24 + rnd() * 592).toFixed(1));
      c.setAttribute('cy', (86 + rnd() * 324).toFixed(1));
      c.setAttribute('r', (0.5 + rnd() * 1.1).toFixed(2));
      c.setAttribute('opacity', (0.2 + rnd() * 0.5).toFixed(2));
      if (i % 4 === 0) {
        c.setAttribute('class', 'tw');
        c.style.animationDelay = (-rnd() * 4).toFixed(2) + 's';
      }
      back.appendChild(c);
    }

    const layers = {
      back,
      rings: svg.querySelector('#l-rings'),
      world: svg.querySelector('#l-world'),
      behind: svg.querySelector('#l-behind'),
      front: svg.querySelector('#l-front'),
    };

    const nodes = [...svg.querySelectorAll('.node')].map((g, i) => ({
      g,
      ring: RINGS[Number(g.dataset.ring)],
      phase: Number(g.dataset.phase),
      speed: Number(g.dataset.speed),
      behind: false,
      link: svg.querySelector(`[data-link="${i}"]`),
      packets: [...svg.querySelectorAll(`[data-packet="${i}"]`)].map((c, k) => ({
        c, off: k * 0.5 + i * 0.17, dir: k % 2 ? -1 : 1, speed: 0.32 + (i % 3) * 0.06,
      })),
    }));

    const place = (time) => {
      for (const n of nodes) {
        const a = n.phase + n.speed * time;
        const ex = n.ring[0] * Math.cos(a), ey = n.ring[1] * Math.sin(a);
        const x = CX + ex * cosP - ey * sinP;
        const y = CY + ex * sinP + ey * cosP;
        const depth = (Math.sin(a) + 1) / 2; // 0 = derrière, 1 = devant
        const s = 0.82 + depth * 0.28;
        n.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${s.toFixed(3)})`);
        n.g.style.opacity = (0.6 + depth * 0.4).toFixed(2);

        const isBehind = depth < 0.32;
        if (isBehind !== n.behind) {
          n.behind = isBehind;
          (isBehind ? layers.behind : layers.front).appendChild(n.g);
        }

        n.link.setAttribute('x2', x.toFixed(1));
        n.link.setAttribute('y2', y.toFixed(1));

        const dx = x - CX, dy = y - CY;
        const len = Math.hypot(dx, dy) || 1;
        const f0 = Math.min(CORE_R / len, 0.45), f1 = Math.max(1 - NODE_R / len, 0.55);
        for (const p of n.packets) {
          let f = (time * p.speed + p.off) % 1;
          if (p.dir < 0) f = 1 - f;
          const ff = f0 + (f1 - f0) * f;
          p.c.setAttribute('cx', (CX + dx * ff).toFixed(1));
          p.c.setAttribute('cy', (CY + dy * ff).toFixed(1));
          p.c.style.opacity = (Math.sin(Math.PI * f) * 0.95).toFixed(2);
        }
      }
    };

    // Parallaxe au pointeur
    const ptr = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
    const fine = window.matchMedia('(pointer: fine)').matches;
    if (fine) {
      window.addEventListener('pointermove', (e) => {
        ptr.x = (e.clientX / window.innerWidth - 0.5) * 2;
        ptr.y = (e.clientY / window.innerHeight - 0.5) * 2;
      }, { passive: true });
    }

    let elapsed = 0, last = null, raf = 0;
    const frame = (now) => {
      if (last === null) last = now;
      elapsed += Math.min(now - last, 64) / 1000;
      last = now;
      cur.x += (ptr.x - cur.x) * 0.06;
      cur.y += (ptr.y - cur.y) * 0.06;
      place(elapsed);
      layers.back.setAttribute('transform', `translate(${(-cur.x * 16).toFixed(2)} ${(-cur.y * 12).toFixed(2)})`);
      layers.rings.setAttribute('transform', `translate(${(cur.x * 5).toFixed(2)} ${(cur.y * 4).toFixed(2)})`);
      layers.world.setAttribute('transform', `translate(${(cur.x * 9).toFixed(2)} ${(cur.y * 7).toFixed(2)})`);
      raf = requestAnimationFrame(frame);
    };

    place(0);
    gate(scene, (run) => {
      if (run) { last = null; raf = requestAnimationFrame(frame); }
      else { cancelAnimationFrame(raf); }
    });
  }

  /* ---------- Faux bureau ---------- */
  const desk = document.querySelector('[data-desk]');
  if (desk && !reduced) {
    const term = desk.querySelector('[data-term]');
    const cons = desk.querySelector('[data-console]');
    const spot = desk.querySelector('[data-spot]');
    const spotQ = desk.querySelector('[data-spot-q]');
    const dockConsole = desk.querySelector('[data-dock-console]');
    const st = gate(desk);

    // Attente qui ne s'écoule que lorsque l'animation tourne (hors écran = figé).
    const wait = (ms) => new Promise((resolve) => {
      let left = ms, prev = performance.now();
      const tick = (now) => {
        if (st.running) left -= Math.min(now - prev, 100);
        prev = now;
        if (left <= 0) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const el = (cls, html) => {
      const d = document.createElement('div');
      if (cls) d.className = cls;
      if (html) d.innerHTML = html;
      return d;
    };
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const PROMPT = 'admin@prod:~$ ';
    const session = [
      { cmd: "docker ps --format '{{.Names}}'", out: ['minecraft', 'teamspeak', 'nginx', 'backrest'] },
      { cmd: 'uptime', out: [' 14:02:11 up 41 days, load average: 0.21, 0.18, 0.15'] },
    ];
    const logs = [
      ['14:02:31', 'Starting minecraft server version 1.21.4'],
      ['14:02:33', 'Preparing level "world"'],
      ['14:02:36', 'Done (3.1s)! For help, type "help"'],
      ['14:02:41', 'Steve joined the game'],
      ['14:02:44', 'Alex joined the game'],
      ['14:02:58', '<Steve> salut !'],
    ];
    const QUERY = 'Logs de minecraft';

    const typeInto = async (node, text, speed) => {
      for (let i = 1; i <= text.length; i++) {
        node.textContent = text.slice(0, i);
        await wait(speed + Math.random() * speed * 0.8);
      }
    };

    const run = async () => {
      for (;;) {
        // Réinitialisation
        desk.classList.remove('console-open', 'spot-open');
        spot.classList.remove('has-res', 'enter');
        dockConsole.classList.remove('on', 'bounce');
        term.innerHTML = '';
        cons.innerHTML = '';
        spotQ.textContent = '';
        await wait(700);

        // 1. Le terminal tape ses commandes
        for (const step of session) {
          const line = el('', `<span class="pr">${PROMPT}</span>`);
          const cmd = document.createElement('span');
          cmd.className = 'cur';
          line.appendChild(cmd);
          term.appendChild(line);
          await wait(350);
          await typeInto(cmd, step.cmd, 45);
          await wait(260);
          cmd.className = '';
          for (const o of step.out) {
            term.appendChild(el('out', esc(o)));
            await wait(90);
          }
          await wait(600);
        }
        const idle = el('', `<span class="pr">${PROMPT}</span><span class="cur"></span>`);
        term.appendChild(idle);
        await wait(900);

        // 2. Spotlight
        desk.classList.add('spot-open');
        await wait(450);
        for (let i = 1; i <= QUERY.length; i++) {
          spotQ.textContent = QUERY.slice(0, i);
          if (i === 4) spot.classList.add('has-res');
          await wait(70 + Math.random() * 60);
        }
        await wait(900);
        spot.classList.add('enter');
        await wait(320);
        desk.classList.remove('spot-open');

        // 3. La console s'ouvre et diffuse les logs
        dockConsole.classList.add('on', 'bounce');
        await wait(250);
        desk.classList.add('console-open');
        await wait(500);
        for (const [ts, msg] of logs) {
          cons.appendChild(el('', `<span class="ts">${ts}</span> <span class="lv">INFO</span> ${esc(msg)}`));
          await wait(550 + Math.random() * 500);
        }
        dockConsole.classList.remove('bounce');
        await wait(4200);
      }
    };
    run();
  }

  /* ---------- Marquee du catalogue ---------- */
  const marquee = document.querySelector('.marquee');
  if (marquee) {
    const track = marquee.querySelector('.marquee-track');
    const setup = () => {
      const loop = !reduced;
      marquee.classList.toggle('looping', loop);
      const clones = track.querySelectorAll('[data-clone]');
      if (loop && !clones.length) {
        [...track.children].forEach((li) => {
          const c = li.cloneNode(true);
          c.setAttribute('aria-hidden', 'true');
          c.setAttribute('data-clone', '');
          track.appendChild(c);
        });
      } else if (!loop) {
        clones.forEach((c) => c.remove());
      }
    };
    setup();
    motionListeners.push(setup);
  }

  /* ---------- Interrupteurs de modules ---------- */
  document.querySelectorAll('.switch[role="switch"]').forEach((sw) => {
    sw.addEventListener('click', () => {
      sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    });
  });

  /* ---------- Bouton copier ---------- */
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    const target = document.getElementById(btn.dataset.copy);
    const label = btn.querySelector('.copy-label');
    const status = document.getElementById(btn.getAttribute('aria-describedby'));
    let timer = 0;
    btn.addEventListener('click', async () => {
      const text = target.innerText.trim() + '\n';
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch (__) { ok = false; }
        ta.remove();
      }
      btn.classList.toggle('copied', ok);
      label.textContent = ok ? 'Copié' : 'Échec';
      if (status) status.textContent = ok ? 'Commandes copiées dans le presse-papiers.' : 'La copie a échoué.';
      clearTimeout(timer);
      timer = setTimeout(() => {
        btn.classList.remove('copied');
        label.textContent = 'Copier';
        if (status) status.textContent = '';
      }, 2000);
    });
  });
})();
