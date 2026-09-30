'use strict';
// The side-scrolling realm: parallax landscape, the wanderer, Lumo, landmarks and the lifting fog.
const World = (() => {
  let canvas, g, W = 0, H = 0, S = 1, dpr = 1;
  let realm = null, lessons = [], hooks = {};
  let px = 0, vx = 0, facing = 1, cam = 0, walkT = 0;
  let lumo = { x: 0, y: 0 };
  let hold = { left: false, right: false }, noteHold = new Set(), autoTarget = null;
  let running = false, raf = 0, lastTs = 0, time = 0;
  let frontier = 1e9, minX = 120, progress = 0;
  let near = null, hintTarget = null;
  let motes = [];
  let ambientAt = 0, sung = {};
  let enabled = true;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = s => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t).toString(16).padStart(2, '0');
    return '#' + ch(16) + ch(8) + ch(0);
  }
  function desat(hex, amt = 0.7) {
    const p = parseInt(hex.slice(1), 16);
    const r = (p >> 16) & 255, gg = (p >> 8) & 255, b = p & 255, l = 0.3 * r + 0.59 * gg + 0.11 * b;
    const f = v => Math.round(lerp(v, l * 0.9 + 20, amt)).toString(16).padStart(2, '0');
    return '#' + f(r) + f(gg) + f(b);
  }
  const c = (hex, lit) => mix(desat(hex), hex, lit); // colour that wakes up as a landmark is restored

  const sx = x => W / 2 + (x - cam) * S;
  const wx = s => cam + (s - W / 2) / S;
  const groundY = x => H * 0.76 + (Math.sin(x * 0.0021) * 14 + Math.sin(x * 0.0057 + 1) * 6) * S;

  function init(el, h) {
    canvas = el; g = canvas.getContext('2d'); hooks = h;
    resize();
    window.addEventListener('resize', resize);
    for (let i = 0; i < 60; i++) motes.push({ x: Math.random(), y: Math.random(), s: Math.random() * 0.6 + 0.4, p: Math.random() * 6 });
    window.addEventListener('keydown', e => {
      if (!enabled || !running) return;
      if (e.key === 'ArrowLeft') { hold.left = true; autoTarget = null; e.preventDefault(); }
      if (e.key === 'ArrowRight') { hold.right = true; autoTarget = null; e.preventDefault(); }
      if ((e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); interact(); }
    });
    window.addEventListener('keyup', e => {
      if (e.key === 'ArrowLeft') hold.left = false;
      if (e.key === 'ArrowRight') hold.right = false;
    });
    Input.on('down', m => {
      if (!enabled || !running) return;
      if (m === 60) { interact(); return; }
      noteHold.add(m); autoTarget = null;
    });
    Input.on('up', m => noteHold.delete(m));
    let pid = null;
    canvas.addEventListener('pointerdown', e => {
      if (!enabled) return;
      Sound.init();
      const x = wx(e.clientX);
      const lm = visibleLessons().find(l => Math.abs(l.landmark.x - x) < 110 && e.clientY < groundY(l.landmark.x) + 30 * S);
      if (lm) { autoTarget = { x: lm.landmark.x, lesson: lm }; return; }
      pid = e.pointerId; autoTarget = null;
      if (e.clientX < sx(px)) hold.left = true; else hold.right = true;
    });
    const end = e => { if (e.pointerId === pid) { hold.left = hold.right = false; pid = null; } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    S = clamp(H / 760, 0.55, 1.4);
  }

  function load(r, state) {
    realm = r; lessons = r.lessons;
    px = state.x ?? r.start; cam = px; vx = 0; facing = 1;
    lumo = { x: px - 40, y: groundY(px) - 110 * S };
    sung = {}; hintTarget = null;
    refresh();
  }

  // Recompute fog and brightness from progress.
  function refresh() {
    const done = hooks.isDone;
    const idx = lessons.findIndex(l => !done(l.id));
    const count = lessons.filter(l => done(l.id)).length;
    progress = lessons.length ? count / lessons.length : 0;
    if (idx === -1) frontier = realm.length - 100;
    else {
      const after = lessons[idx + 1];
      frontier = after ? after.landmark.x + 380 : Math.min(realm.length - 100, lessons[idx].landmark.x + 700);
    }
    frontier = Math.max(frontier, realm.start + 600);
    px = clamp(px, minX, frontier - 60);
  }

  const visibleLessons = () => lessons.filter(l => l.landmark.x < frontier + 60);
  function interact() {
    if (hooks.onAction?.()) return;
    if (near) hooks.onLandmark(near);
  }
  function setHint(lesson) { hintTarget = lesson; }
  function setEnabled(v) { enabled = v; if (!v) { hold.left = hold.right = false; noteHold.clear(); autoTarget = null; } }
  function start() { if (running) return; running = true; lastTs = performance.now(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); }

  function frame(ts) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - lastTs) / 1000); lastTs = ts; time += dt;
    update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function update(dt) {
    let dir = 0;
    if (enabled) {
      if (hold.left) dir -= 1;
      if (hold.right) dir += 1;
      for (const m of noteHold) dir += m < 60 ? -1 : 1;
      dir = clamp(dir, -1, 1);
      if (autoTarget) {
        const d = autoTarget.x - px;
        if (Math.abs(d) < 12) { const l = autoTarget.lesson; autoTarget = null; near = l; hooks.onLandmark(l); }
        else dir = Math.sign(d);
      }
    }
    const speed = 300;
    vx = lerp(vx, dir * speed, Math.min(1, dt * 10));
    px = clamp(px + vx * dt, minX, frontier - 60);
    if (Math.abs(vx) > 5) { facing = Math.sign(vx); walkT += dt * Math.abs(vx) / 60; }
    const camMin = W / 2 / S - 200, camMax = realm.length - W / 2 / S + 200;
    cam = lerp(cam, clamp(px + facing * 60, camMin, Math.max(camMin, camMax)), Math.min(1, dt * 3));
    lumo.x = lerp(lumo.x, px - facing * 46, Math.min(1, dt * 2.2));
    lumo.y = lerp(lumo.y, groundY(px) - (104 + Math.sin(time * 2.1) * 8) * S, Math.min(1, dt * 3));

    const prevNear = near;
    near = visibleLessons().find(l => Math.abs(l.landmark.x - px) < 90) || null;
    if (near && near !== prevNear) hooks.onNear?.(near);
    if (!near && prevNear) hooks.onNear?.(null);

    // Restored landmarks sing a snippet of their song when you pass by.
    for (const l of lessons) {
      if (!hooks.isDone(l.id)) continue;
      const d = Math.abs(l.landmark.x - px);
      if (d < 260 && !sung[l.id]) { sung[l.id] = true; singSnippet(l); }
      if (d > 600) sung[l.id] = false;
    }
    if (time > ambientAt) {
      ambientAt = time + 3 + Math.random() * 4;
      const pool = hooks.learnedPitches();
      if (pool.length) Sound.pad(pool[Math.floor(Math.random() * pool.length)] + 12);
    }
  }

  function singSnippet(l) {
    const ctx = Sound.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const song = hooks.songOf(l);
    const spb = song.spq * 1.3, t0 = ctx.currentTime + 0.1;
    song.notes.filter(n => n.beat < song.beatsPerMeasure * 2).forEach(n => {
      const v = Sound.play(n.midi + 12, t0 + n.beat * spb, n.dur * spb, 0.35, { soft: true });
      return v;
    });
  }

  // ---------- drawing
  function pal() {
    const p = realm.palette, t = Math.min(1, progress * 1.15);
    const o = {};
    for (const k in p.awake) o[k] = mix(p.silent[k], p.awake[k], t);
    return o;
  }

  function ridge(par, base, amp, f1, f2, color, ph = 0) {
    const off = cam * par;
    g.fillStyle = color;
    g.beginPath(); g.moveTo(0, H);
    for (let s = 0; s <= W + 8; s += 8) {
      const x = (s - W / 2) / S + off;
      const y = base + (Math.sin(x * f1 + ph) * amp + Math.sin(x * f2 + ph * 2) * amp * 0.45) * S;
      g.lineTo(s, y);
    }
    g.lineTo(W, H); g.closePath(); g.fill();
  }

  function draw() {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = pal();
    const sky = g.createLinearGradient(0, 0, 0, H * 0.8);
    sky.addColorStop(0, P.skyTop); sky.addColorStop(1, P.skyBot);
    g.fillStyle = sky; g.fillRect(0, 0, W, H);

    // sun rises as the realm wakes
    const sunY = lerp(H * 0.62, H * 0.2, progress), sunX = W * 0.72 - cam * 0.02 % W;
    const sg = g.createRadialGradient(sunX, sunY, 0, sunX, sunY, 180 * S);
    sg.addColorStop(0, `rgba(255,236,170,${0.35 + progress * 0.55})`); sg.addColorStop(1, 'rgba(255,236,170,0)');
    g.fillStyle = sg; g.fillRect(0, 0, W, H);
    g.fillStyle = `rgba(255,245,210,${0.5 + progress * 0.5})`;
    g.beginPath(); g.arc(sunX, sunY, 38 * S, 0, Math.PI * 2); g.fill();

    // clouds (a cave gets a ceiling of stalactites instead)
    g.fillStyle = 'rgba(255,255,255,0.55)';
    if (realm.decor === 'cave') ceiling(P);
    else if (realm.decor === 'citadel') starfield();
    else for (let i = 0; i < 6; i++) {
      const span = W + 600;
      const cx = (((i * 520 + time * 8 - cam * 0.12) * S) % span + span) % span - 300;
      const cy = H * (0.12 + (i % 3) * 0.07);
      cloud(cx, cy, (0.7 + (i % 2) * 0.4) * S);
    }

    ridge(0.18, H * 0.5, 60, 0.0016, 0.0041, P.far, 1);
    if (realm.decor === 'wood') treeLine(0.4, H * 0.62, P.mid);
    else if (realm.decor === 'cave') spires(0.4, H * 0.64, P.mid);
    else if (realm.decor === 'harbor') sea(0.4, H * 0.6, P.mid);
    else if (realm.decor === 'peaks') crags(0.4, H * 0.66, P.mid);
    else if (realm.decor === 'citadel') towers(0.4, H * 0.64, P.mid);
    else ridge(0.42, H * 0.62, 36, 0.0023, 0.006, P.mid, 3);
    ridge(0.7, H * 0.7, 20, 0.003, 0.008, mix(P.mid, P.near, 0.5), 5);

    // ground
    g.fillStyle = P.near;
    g.beginPath(); g.moveTo(0, H);
    for (let s = 0; s <= W + 6; s += 6) g.lineTo(s, groundY(wx(s)));
    g.lineTo(W, H); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 3 * S;
    g.beginPath();
    for (let s = 0; s <= W + 6; s += 6) g.lineTo(s, groundY(wx(s)) + 14 * S);
    g.stroke();
    decor(P);

    for (const l of lessons) {
      const x = sx(l.landmark.x);
      if (x < -300 * S || x > W + 300 * S) continue;
      const lit = hooks.isDone(l.id) ? 1 : 0;
      g.save(); g.translate(x, groundY(l.landmark.x)); g.scale(S, S);
      (LANDMARKS[l.landmark.type] || LANDMARKS.stone)(lit, time, l);
      g.restore();
      if (hintTarget === l) sparkle(x, groundY(l.landmark.x) - 190 * S);
    }

    drawLumo();
    drawPlayer();
    drawMotes();
    drawFog(P);

    if (near && enabled) label(near);
    // vignette
    const vg = g.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.8);
    vg.addColorStop(0, 'rgba(20,16,50,0)'); vg.addColorStop(1, 'rgba(20,16,50,0.35)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }

  function cloud(x, y, s) {
    g.beginPath();
    g.ellipse(x, y, 60 * s, 18 * s, 0, 0, Math.PI * 2);
    g.ellipse(x + 30 * s, y - 10 * s, 36 * s, 16 * s, 0, 0, Math.PI * 2);
    g.ellipse(x - 26 * s, y - 6 * s, 30 * s, 13 * s, 0, 0, Math.PI * 2);
    g.fill();
  }

  function treeLine(par, base, color) {
    g.fillStyle = color;
    const off = cam * par, step = 70;
    const first = Math.floor((off - W / 2 / S) / step) - 1, last = Math.ceil((off + W / 2 / S) / step) + 1;
    for (let i = first; i <= last; i++) {
      const h = 90 + ((i * 7919) % 60);
      const x = W / 2 + (i * step - off) * S, y = base + Math.sin(i) * 8 * S;
      g.beginPath(); g.moveTo(x - 30 * S, y + 40 * S); g.lineTo(x, y - h * S); g.lineTo(x + 30 * S, y + 40 * S); g.fill();
    }
    g.fillRect(0, base + 20 * S, W, H);
  }

  // Two layers of stalactites hanging from the top of the screen.
  function ceiling(P) {
    [[0.1, P.far, 0.16, 90], [0.3, mix(P.far, P.skyTop, 0.5), 0.1, 60]].forEach(([par, color, depth, step]) => {
      const off = cam * par;
      g.fillStyle = color;
      g.beginPath(); g.moveTo(0, 0);
      const first = Math.floor((off - W / 2 / S) / step) - 1, last = Math.ceil((off + W / 2 / S) / step) + 1;
      for (let i = first; i <= last; i++) {
        const x = W / 2 + (i * step - off) * S, len = H * depth * (0.5 + ((i * 7919) % 100) / 100);
        g.lineTo(x - step * 0.45 * S, H * 0.04); g.lineTo(x, H * 0.04 + len); g.lineTo(x + step * 0.45 * S, H * 0.04);
      }
      g.lineTo(W, 0); g.closePath(); g.fill();
    });
    // crystals in the ceiling glow as the realm wakes
    for (let i = 0; i < 18; i++) {
      const span = W + 200, x = (((i * 173 - cam * 0.1) * S) % span + span) % span - 100, y = H * (0.03 + ((i * 37) % 10) / 100);
      halo(x, y, 40 * S, i % 2 ? '#7ff0ff' : '#c9a8ff', 0.15 + progress * 0.6);
    }
  }

  // Open water: a flat sea with drifting wave lines, glinting as the realm wakes.
  function sea(par, base, color) {
    g.fillStyle = color; g.fillRect(0, base, W, H);
    g.strokeStyle = `rgba(255,255,255,${0.18 + progress * 0.3})`; g.lineWidth = 2 * S;
    const off = cam * par;
    for (let row = 0; row < 6; row++) {
      const y = base + (8 + row * row * 5) * S, step = 120 - row * 10;
      const first = Math.floor((off - W / S) / step), last = Math.ceil((off + W / S) / step);
      for (let i = first; i <= last; i++) {
        const x = W / 2 + (i * step - off + Math.sin(time * 0.8 + i + row) * 10) * S + (row % 2) * 40 * S;
        g.beginPath(); g.moveTo(x - 14 * S, y); g.quadraticCurveTo(x, y - 4 * S, x + 14 * S, y); g.stroke();
      }
    }
    const sunX = W * 0.72 - cam * 0.02 % W;
    g.fillStyle = `rgba(255,236,170,${0.15 + progress * 0.35})`;
    for (let k = 0; k < 6; k++) g.fillRect(sunX - (40 - k * 5) * S, base + (6 + k * 9) * S, (80 - k * 10) * S, 3 * S);
  }

  // The stars come back as the citadel wakes: a few at first, then the whole sky.
  function starfield() {
    const n = Math.floor(30 + progress * 170);
    for (let i = 0; i < n; i++) {
      const span = W + 100, x = (((i * 97.3 - cam * 0.05) * S) % span + span) % span - 50;
      const y = H * 0.55 * ((i * 61.7) % 100) / 100;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(time * (0.5 + (i % 7) * 0.2) + i));
      g.fillStyle = `rgba(255,248,220,${tw * (0.25 + progress * 0.75)})`;
      if (i % 11 === 0) star4(x, y, 1.6 * S); else { g.beginPath(); g.arc(x, y, (0.8 + (i % 3) * 0.4) * S, 0, 7); g.fill(); }
    }
    if (progress > 0.3) {
      const k = (time * 0.25) % 1, sx0 = W * (0.2 + ((Math.floor(time * 0.25) * 37) % 60) / 100);
      g.strokeStyle = `rgba(255,248,220,${(1 - k) * 0.7})`; g.lineWidth = 2 * S;
      g.beginPath(); g.moveTo(sx0 + k * 180 * S, H * 0.08 + k * 90 * S); g.lineTo(sx0 + k * 180 * S - 50 * S, H * 0.08 + k * 90 * S - 25 * S); g.stroke();
    }
  }

  // A skyline of slender towers with glowing windows.
  function towers(par, base, color) {
    const off = cam * par, step = 120;
    const first = Math.floor((off - W / 2 / S) / step) - 1, last = Math.ceil((off + W / 2 / S) / step) + 1;
    for (let i = first; i <= last; i++) {
      const h = 110 + ((i * 7919) % 130), w = 22 + ((i * 31) % 18);
      const x = W / 2 + (i * step - off) * S, y = base + 30 * S;
      g.fillStyle = color;
      g.fillRect(x - w * S, y - h * S, w * 2 * S, h * S);
      g.beginPath(); g.moveTo(x - (w + 6) * S, y - h * S); g.lineTo(x, y - (h + 50) * S); g.lineTo(x + (w + 6) * S, y - h * S); g.fill();
      if (progress > 0) { g.fillStyle = `rgba(255,214,110,${progress * 0.8})`; for (let k = 0; k < 3; k++) g.fillRect(x - 3 * S, y - (h - 20 - k * 30) * S, 6 * S, 10 * S); }
    }
    g.fillStyle = color; g.fillRect(0, base + 20 * S, W, H);
  }

  // Jagged peaks with lava seams that glow as the realm wakes.
  function crags(par, base, color) {
    const off = cam * par, step = 150;
    const first = Math.floor((off - W / 2 / S) / step) - 1, last = Math.ceil((off + W / 2 / S) / step) + 1;
    for (let i = first; i <= last; i++) {
      const h = 150 + ((i * 7919) % 120), w = 110 + ((i * 31) % 50), lean = ((i * 13) % 40) - 20;
      const x = W / 2 + (i * step - off) * S, y = base + 30 * S;
      g.fillStyle = color;
      g.beginPath(); g.moveTo(x - w * S, y); g.lineTo(x + lean * S, y - h * S); g.lineTo(x + w * S, y); g.fill();
      if (progress > 0) {
        g.strokeStyle = `rgba(255,${140 + (i % 3) * 30},60,${progress * 0.8})`; g.lineWidth = 3 * S;
        g.beginPath(); g.moveTo(x + lean * S, y - h * S); g.lineTo(x + (lean * 0.3 - 10) * S, y - h * 0.55 * S); g.lineTo(x + 8 * S, y - h * 0.25 * S); g.stroke();
      }
    }
    g.fillStyle = color; g.fillRect(0, base + 20 * S, W, H);
  }

  function spires(par, base, color) {
    g.fillStyle = color;
    const off = cam * par, step = 90;
    const first = Math.floor((off - W / 2 / S) / step) - 1, last = Math.ceil((off + W / 2 / S) / step) + 1;
    for (let i = first; i <= last; i++) {
      const h = 70 + ((i * 7919) % 90), w = 18 + ((i * 31) % 16);
      const x = W / 2 + (i * step - off) * S, y = base + Math.sin(i) * 8 * S;
      g.beginPath(); g.moveTo(x - w * S, y + 40 * S); g.lineTo(x - w * 0.4 * S, y - h * S); g.lineTo(x + w * 0.2 * S, y - h * 1.08 * S); g.lineTo(x + w * S, y + 40 * S); g.fill();
    }
    g.fillRect(0, base + 20 * S, W, H);
  }

  function decor(P) {
    // flowers wake with progress; grass tufts always
    const step = 46;
    const first = Math.floor(wx(0) / step) - 1, last = Math.ceil(wx(W) / step) + 1;
    for (let i = first; i <= last; i++) {
      const x = i * step + ((i * 37) % 23), s = sx(x), y = groundY(x);
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2 * S;
      g.beginPath(); g.moveTo(s, y + 2); g.lineTo(s - 4 * S, y - 12 * S); g.moveTo(s, y + 2); g.lineTo(s + 3 * S, y - 10 * S); g.stroke();
      const bloomAt = ((i * 131) % 100) / 100;
      if (bloomAt < progress * 0.9) {
        const cols = realm.decor === 'citadel' ? ['#fff4c2', '#c9a8ff', '#7fd3ff'] : realm.decor === 'peaks' ? ['#ff8a4c', '#ffc233', '#ff5d73'] : realm.decor === 'harbor' ? ['#ffffff', '#ffd23f', '#ff8fa0'] : realm.decor === 'wood' ? ['#ff8fc2', '#ffd23f', '#ffffff'] : realm.decor === 'cave' ? ['#7ff0ff', '#c9a8ff', '#ffffff'] : ['#ff5d73', '#ffd23f', '#ffffff', '#7b5cff'];
        g.fillStyle = cols[Math.abs(i) % cols.length];
        if (realm.decor === 'cave') { g.beginPath(); g.moveTo(s - 4 * S, y - 20 * S); g.lineTo(s - 1 * S, y - 4 * S); g.lineTo(s - 7 * S, y - 4 * S); g.closePath(); g.fill(); }
        else { g.beginPath(); g.arc(s - 4 * S, y - 13 * S, 3.2 * S, 0, Math.PI * 2); g.fill(); }
      }
    }
  }

  function drawPlayer() {
    const x = sx(px), y = groundY(px);
    const moving = Math.abs(vx) > 20;
    g.save(); g.translate(x, y); g.scale(S * facing, S);
    const sw = moving ? Math.sin(walkT * 2.2) : 0;
    const bob = moving ? Math.abs(Math.sin(walkT * 2.2)) * 3 : Math.sin(time * 2) * 0.8;
    const ink = '#241d52';
    g.strokeStyle = ink; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-4, -16); g.lineTo(-4 + sw * 7, 0); g.moveTo(5, -16); g.lineTo(5 - sw * 7, 0); g.stroke();
    g.translate(0, -bob);
    // scarf streams behind
    g.strokeStyle = '#ffc233'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(2, -52);
    for (let i = 1; i <= 7; i++) g.lineTo(-i * 7, -52 + Math.sin(time * 7 + i * 0.9) * (2 + i * 0.6) + i * 1.2 + (moving ? -i * 0.6 : i * 1.2));
    g.stroke();
    g.fillStyle = ink;
    g.beginPath(); g.moveTo(-15, -14); g.quadraticCurveTo(-17, -46, 0, -56); g.quadraticCurveTo(17, -46, 15, -14); g.closePath(); g.fill();
    g.beginPath(); g.arc(1, -66, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffc233'; g.beginPath(); g.roundRect(-9, -57, 20, 7, 3); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(6, -67, 2.4, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function drawLumo() {
    const x = sx(lumo.x), y = lumo.y, r = 34 * S;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.25, 'rgba(255,214,110,0.9)'); gr.addColorStop(1, 'rgba(255,194,51,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 4; i++) {
      const a = time * 2 + i * 1.6, rr = (14 + i * 3) * S;
      g.fillStyle = 'rgba(255,240,190,0.8)';
      g.beginPath(); g.arc(x + Math.cos(a) * rr, y + Math.sin(a * 1.3) * rr * 0.6, 1.8 * S, 0, Math.PI * 2); g.fill();
    }
  }

  function drawMotes() {
    const n = Math.floor(10 + progress * 50);
    for (let i = 0; i < n; i++) {
      const m = motes[i];
      const x = ((m.x * W - cam * 0.3 * m.s * S) % W + W) % W;
      const y = ((m.y * H - time * 12 * m.s) % H + H) % H;
      const ember = realm.decor === 'peaks';
      g.fillStyle = `rgba(255,${ember ? 150 : 236},${ember ? 80 : 170},${(0.3 + 0.4 * Math.sin(time * 2 + m.p)) * (0.4 + progress * 0.6)})`;
      g.beginPath(); g.arc(x, y, 2 * m.s * S, 0, Math.PI * 2); g.fill();
    }
  }

  function drawFog(P) {
    const f0 = sx(frontier - 320), f1 = sx(frontier + 40);
    if (f0 < W) {
      const fg = g.createLinearGradient(f0, 0, f1, 0);
      fg.addColorStop(0, 'rgba(255,255,255,0)'); fg.addColorStop(1, P.fog);
      g.fillStyle = fg; g.fillRect(f0, 0, W - f0, H);
      g.fillStyle = P.fog; if (f1 < W) g.fillRect(f1, 0, W - f1, H);
    }
    const l1 = sx(minX - 40);
    if (l1 > 0) {
      const fg = g.createLinearGradient(l1 - 200 * S, 0, l1 + 60 * S, 0);
      fg.addColorStop(0, P.fog); fg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = fg; g.fillRect(0, 0, l1 + 60 * S, H);
    }
  }

  function sparkle(x, y) {
    for (let i = 0; i < 5; i++) {
      const a = time * 3 + i * 1.25, r = (16 + Math.sin(time * 4 + i) * 6) * S;
      g.fillStyle = '#fff4c2';
      star4(x + Math.cos(a) * r, y + Math.sin(a) * r, 4 * S);
    }
  }
  function star4(x, y, r) {
    g.beginPath(); g.moveTo(x, y - r * 2); g.lineTo(x + r * 0.5, y - r * 0.5); g.lineTo(x + r * 2, y); g.lineTo(x + r * 0.5, y + r * 0.5);
    g.lineTo(x, y + r * 2); g.lineTo(x - r * 0.5, y + r * 0.5); g.lineTo(x - r * 2, y); g.lineTo(x - r * 0.5, y - r * 0.5); g.fill();
  }

  function label(l) {
    const x = sx(l.landmark.x), y = groundY(l.landmark.x) - (LANDMARK_H[l.landmark.type] || 200) * S - 26 * S;
    const txt = l.title, sub = hooks.isDone(l.id) ? 'Play again  ↑' : 'Look closer  ↑';
    g.font = `700 ${Math.round(17 * S)}px Grandstander, system-ui, sans-serif`;
    const w1 = g.measureText(txt).width;
    g.font = `700 ${Math.round(12 * S)}px Nunito, system-ui, sans-serif`;
    const w2 = g.measureText(sub).width;
    const w = Math.max(w1, w2) + 28 * S, h = 50 * S;
    g.fillStyle = 'rgba(28,23,69,0.82)';
    g.beginPath(); g.roundRect(x - w / 2, y - h, w, h, 14 * S); g.fill();
    g.beginPath(); g.moveTo(x - 8 * S, y); g.lineTo(x, y + 8 * S); g.lineTo(x + 8 * S, y); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center';
    g.font = `700 ${Math.round(17 * S)}px Grandstander, system-ui, sans-serif`;
    g.fillText(txt, x, y - h + 22 * S);
    g.fillStyle = '#ffc233'; g.font = `700 ${Math.round(12 * S)}px Nunito, system-ui, sans-serif`;
    g.fillText(sub, x, y - 12 * S);
    g.textAlign = 'start';
  }

  // ---------- landmarks (unit coords, origin on the ground, y up is negative)
  function halo(x, y, r, color, a) {
    if (a <= 0) return;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalAlpha = a; g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  }
  const GOLD = '#ffc233', TEAL_C = '#19c3b3', VIOLET_C = '#7b5cff';
  const LANDMARK_H = { stone: 200, pools: 70, lanterns: 150, cottage: 190, gate: 200, lake: 70, bridge: 150, tower: 290, glade: 220, canyon: 230, stairs: 150, crystal: 260, belltree: 240, hall: 200, windmill: 250, bellarch: 200,
    pines: 250, boat: 90, swing: 230, woodpecker: 260, willow: 250, cairn: 170, oak: 300,
    stalactites: 240, minecart: 150, geode: 170, pillars: 230, bats: 240, seam: 200, starlake: 110,
    lighthouse: 300, tidepools: 80, foghorn: 200, rowboats: 110, buoy: 170, arch: 200, chapel: 280,
    embersteps: 200, crookedbridge: 130, mountainhall: 250, harpfalls: 280, cadencegates: 190, forge: 190, pavilion: 250,
    starcompass: 150, moonwell: 170, eclipsetower: 320, nightingale: 300, clockwork: 250, prismharp: 270, throne: 300 };

  const LANDMARKS = {
    stone(lit, t) {
      halo(0, -100, 150, GOLD, lit * 0.5);
      g.fillStyle = c('#6b5bd6', lit);
      g.beginPath(); g.moveTo(-40, 4); g.quadraticCurveTo(-50, -150, -8, -192); g.quadraticCurveTo(34, -200, 42, -140); g.lineTo(38, 4); g.closePath(); g.fill();
      for (let i = 0; i < 5; i++) {
        const y = -160 + i * 30;
        if (lit) halo(0, y, 18, GOLD, 0.7 + 0.3 * Math.sin(t * 3 + i));
        g.fillStyle = lit ? '#fff4c2' : '#5a5570';
        g.font = '700 16px Grandstander, sans-serif'; g.textAlign = 'center'; g.fillText(String(i + 1), 0, y + 6); g.textAlign = 'start';
      }
    },
    pools(lit, t) {
      for (const x of [-62, 62]) {
        halo(x, 0, 80, '#7ff0ff', lit * 0.5);
        g.fillStyle = c('#1bb8d6', lit); g.beginPath(); g.ellipse(x, 6, 54, 13, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = `rgba(255,255,255,${0.2 + lit * 0.4})`; g.lineWidth = 2;
        g.beginPath(); g.ellipse(x, 6, 30 + Math.sin(t * 2) * 6, 6, 0, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = c('#1f9e6e', lit); g.lineWidth = 3;
        g.beginPath(); g.moveTo(x + 48, 2); g.lineTo(x + 52, -30); g.moveTo(x + 54, 2); g.lineTo(x + 62, -22); g.stroke();
        if (lit) { g.fillStyle = '#ff8fa0'; g.beginPath(); g.arc(x - 10, 2, 5, 0, 7); g.fill(); }
      }
    },
    lanterns(lit, t) {
      [-60, 0, 60].forEach((x, i) => {
        const h = i === 1 ? 140 : 118;
        g.strokeStyle = c('#3a3470', lit); g.lineWidth = 5; g.beginPath(); g.moveTo(x, 4); g.lineTo(x, -h); g.stroke();
        halo(x, -h + 16, 50, GOLD, lit * (0.8 + 0.2 * Math.sin(t * 5 + i)));
        g.fillStyle = lit ? '#ffd66b' : '#6d6a80'; g.beginPath(); g.roundRect(x - 11, -h, 22, 30, 6); g.fill();
        g.fillStyle = c('#3a3470', lit); g.fillRect(x - 14, -h - 5, 28, 6);
      });
    },
    cottage(lit, t) {
      halo(0, -60, 160, GOLD, lit * 0.35);
      g.fillStyle = c('#f28b5b', lit); g.fillRect(-80, -110, 160, 114);
      g.fillStyle = c('#7b5cff', lit); g.beginPath(); g.moveTo(-96, -106); g.lineTo(0, -178); g.lineTo(96, -106); g.closePath(); g.fill();
      g.fillStyle = c('#8a5a2b', lit); g.fillRect(-18, -64, 36, 68);
      g.fillStyle = lit ? '#ffe28a' : '#4b4860'; g.fillRect(-64, -80, 28, 26); g.fillRect(36, -80, 28, 26);
      g.fillStyle = '#fffaf0'; g.beginPath(); g.roundRect(-44, -106, 88, 30, 6); g.fill();
      g.fillStyle = '#241d52'; g.font = '800 20px Grandstander, sans-serif'; g.textAlign = 'center'; g.fillText('CAFE', 0, -84); g.textAlign = 'start';
      if (lit) for (let i = 0; i < 3; i++) { const k = (t * 0.4 + i / 3) % 1; g.fillStyle = `rgba(255,255,255,${0.5 * (1 - k)})`; g.beginPath(); g.arc(50 + k * 20, -170 - k * 60, 8 + k * 10, 0, 7); g.fill(); }
      g.fillStyle = c('#6c4a2b', lit); g.fillRect(40, -170, 16, 40);
    },
    gate(lit, t, l) {
      halo(0, -100, 170, GOLD, lit * 0.4);
      g.fillStyle = c('#8d86b8', lit); g.fillRect(-92, -190, 32, 194); g.fillRect(60, -190, 32, 194);
      g.fillStyle = c('#6b5bd6', lit); g.fillRect(-100, -205, 200, 22);
      g.fillStyle = c('#ff5d73', lit); g.beginPath(); g.moveTo(-26, -183); g.lineTo(26, -183); g.lineTo(26, -118); g.lineTo(0, -132); g.lineTo(-26, -118); g.closePath(); g.fill();
      g.fillStyle = '#fff'; g.font = '800 38px Grandstander, sans-serif'; g.textAlign = 'center'; g.fillText(l.landmark.letter || 'F', 0, -142); g.textAlign = 'start';
      const lift = lit ? 110 : 0;
      g.strokeStyle = c('#3a3470', lit); g.lineWidth = 5;
      for (let x = -48; x <= 48; x += 16) { g.beginPath(); g.moveTo(x, -112 - lift); g.lineTo(x, 4 - lift); g.stroke(); }
    },
    lake(lit, t) {
      halo(0, 0, 200, '#bff6ff', lit * 0.45);
      g.fillStyle = c('#3fb7ff', lit); g.beginPath(); g.ellipse(0, 8, 170, 20, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(255,255,255,${0.25 + lit * 0.5})`; g.lineWidth = 2;
      for (let i = 0; i < 4; i++) { const w = 30 + ((t * 20 + i * 40) % 110); g.beginPath(); g.moveTo(-w, 6 + i * 3); g.lineTo(w, 6 + i * 3); g.stroke(); }
      if (lit) [-80, 0, 70].forEach((x, i) => { g.fillStyle = '#ff8fc2'; g.beginPath(); g.ellipse(x, 4, 10, 5, 0, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, 0, 4 + Math.sin(t * 2 + i), 0, 7); g.fill(); });
    },
    bridge(lit, t) {
      g.fillStyle = c('#5b4a8a', lit); g.fillRect(-120, -140, 22, 144); g.fillRect(98, -140, 22, 144);
      g.fillStyle = c('#3fb7ff', lit); g.globalAlpha = 0.6; g.fillRect(-98, 10, 196, 30); g.globalAlpha = 1;
      g.save(); g.translate(-98, -6); g.rotate(lit ? 0 : -1.2);
      g.fillStyle = c('#c9884a', lit); g.fillRect(0, 0, 196, 12);
      g.restore();
      g.strokeStyle = c('#8d86b8', lit); g.lineWidth = 3; g.setLineDash([5, 4]);
      const ex = -98 + Math.cos(lit ? 0 : -1.2) * 196, ey = -6 + Math.sin(lit ? 0 : -1.2) * 196;
      g.beginPath(); g.moveTo(-88, -136); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
    },
    tower(lit, t) {
      halo(0, -270, 150, '#fff4c2', lit * 0.5);
      g.fillStyle = c('#8d86b8', lit); g.beginPath(); g.moveTo(-40, 4); g.lineTo(-30, -230); g.lineTo(30, -230); g.lineTo(40, 4); g.fill();
      g.fillStyle = c('#3d8bff', lit); g.beginPath(); g.arc(0, -230, 42, Math.PI, 0); g.fill();
      g.fillStyle = lit ? '#ffe28a' : '#4b4860'; g.fillRect(-8, -170, 16, 30); g.fillRect(-8, -100, 16, 30);
      if (lit) for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i - 2.5) * 0.35; g.strokeStyle = 'rgba(255,244,194,.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -250); g.lineTo(Math.cos(a) * 160, -250 + Math.sin(a) * 160); g.stroke(); }
    },
    glade(lit, t) {
      g.fillStyle = c('#7a4f2a', lit); g.fillRect(-12, -110, 24, 114);
      g.fillStyle = c('#2bbf7a', lit);
      [[-50, -140, 60], [40, -150, 64], [0, -190, 70]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); });
      const n = lit ? 22 : 4;
      for (let i = 0; i < n; i++) {
        const x = Math.sin(t * 0.7 + i * 2.1) * 120, y = -80 - ((i * 37) % 140) + Math.cos(t + i) * 10;
        const on = (Math.floor(t * 3 + i) % 3 === 0) || lit;
        halo(x, y, 12, '#fff4a8', on ? 0.9 : 0.2);
      }
      if (lit) for (let i = 0; i < 8; i++) { g.fillStyle = '#ff8fc2'; g.beginPath(); g.arc(-80 + i * 22, -150 + Math.sin(i * 3) * 40, 5, 0, 7); g.fill(); }
    },
    canyon(lit, t) {
      g.fillStyle = c('#d0784c', lit);
      g.beginPath(); g.moveTo(-150, 4); g.lineTo(-120, -220); g.lineTo(-70, -200); g.lineTo(-50, 4); g.fill();
      g.beginPath(); g.moveTo(50, 4); g.lineTo(80, -230); g.lineTo(126, -190); g.lineTo(150, 4); g.fill();
      if (lit) for (let i = 0; i < 3; i++) { const k = (t * 0.6 + i / 3) % 1; g.strokeStyle = `rgba(255,244,194,${0.8 * (1 - k)})`; g.lineWidth = 4; g.beginPath(); g.arc(0, -110, 20 + k * 60, 0, Math.PI * 2); g.stroke(); }
    },
    stairs(lit, t) {
      for (let i = 0; i < 6; i++) {
        const on = lit ? 0.6 + 0.4 * Math.sin(t * 3 - i * 0.7) : 0;
        g.fillStyle = c('#a39cc8', lit); g.fillRect(-120 + i * 40, -20 - i * 24, 44, 24 + i * 24);
        if (on) { g.fillStyle = `rgba(255,214,110,${on})`; g.fillRect(-120 + i * 40, -20 - i * 24, 44, 6); }
      }
    },
    crystal(lit, t) {
      halo(0, -140, 240, GOLD, lit * (0.6 + 0.2 * Math.sin(t * 2)));
      g.fillStyle = c('#8d86b8', lit); g.fillRect(-50, -40, 100, 44);
      const pts = [[0, -260], [46, -150], [30, -40], [-30, -40], [-46, -150]];
      g.fillStyle = c('#19c3b3', lit);
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
      g.strokeStyle = `rgba(255,255,255,${0.3 + lit * 0.6})`; g.lineWidth = 3; g.stroke();
      g.beginPath(); g.moveTo(0, -260); g.lineTo(0, -40); g.moveTo(-46, -150); g.lineTo(0, -120); g.lineTo(46, -150); g.stroke();
      if (lit) for (let i = 0; i < 8; i++) { const a = t * 0.3 + i * Math.PI / 4; g.strokeStyle = 'rgba(255,244,194,.35)'; g.lineWidth = 6; g.beginPath(); g.moveTo(Math.cos(a) * 70, -150 + Math.sin(a) * 70); g.lineTo(Math.cos(a) * 200, -150 + Math.sin(a) * 200); g.stroke(); }
    },
    belltree(lit, t) {
      g.fillStyle = c('#6b4424', lit); g.fillRect(-14, -150, 28, 154);
      g.fillStyle = c('#17a38a', lit);
      [[-60, -170, 64], [60, -175, 66], [0, -225, 76]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); });
      [-70, 0, 70].forEach((x, i) => {
        const sw = lit ? Math.sin(t * 3 + i) * 0.25 : 0;
        g.save(); g.translate(x, -130); g.rotate(sw);
        g.strokeStyle = '#3a3470'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 22); g.stroke();
        halo(0, 34, 30, GOLD, lit * 0.6);
        g.fillStyle = lit ? GOLD : '#77738c'; g.beginPath(); g.moveTo(-12, 42); g.quadraticCurveTo(-12, 20, 0, 20); g.quadraticCurveTo(12, 20, 12, 42); g.closePath(); g.fill();
        g.restore();
      });
    },
    hall(lit, t) {
      halo(0, -100, 180, GOLD, lit * 0.4);
      g.fillStyle = c('#e9e4ff', lit); g.fillRect(-130, -10, 260, 14);
      for (let i = 0; i < 5; i++) g.fillRect(-120 + i * 56, -150, 18, 142);
      g.fillStyle = c('#7b5cff', lit); g.beginPath(); g.moveTo(-145, -150); g.lineTo(0, -205); g.lineTo(145, -150); g.closePath(); g.fill();
      g.fillStyle = lit ? '#ffe28a' : '#4b4860'; g.fillRect(-26, -120, 52, 110);
    },
    windmill(lit, t) {
      g.fillStyle = c('#f2e6d0', lit); g.beginPath(); g.moveTo(-40, 4); g.lineTo(-24, -170); g.lineTo(24, -170); g.lineTo(40, 4); g.fill();
      g.fillStyle = c('#ff5d73', lit); g.beginPath(); g.moveTo(-32, -168); g.lineTo(0, -200); g.lineTo(32, -168); g.fill();
      g.save(); g.translate(0, -175); g.rotate(lit ? t * 1.6 : 0.3);
      g.fillStyle = c('#7b5cff', lit);
      for (let i = 0; i < 4; i++) { g.rotate(Math.PI / 2); g.fillRect(4, -9, 92, 18); }
      g.fillStyle = '#241d52'; g.beginPath(); g.arc(0, 0, 8, 0, 7); g.fill();
      g.restore();
    },
    bellarch(lit, t) {
      halo(0, -120, 170, '#e8f6ff', lit * 0.5);
      g.strokeStyle = c('#8d86b8', lit); g.lineWidth = 22;
      g.beginPath(); g.moveTo(-100, 4); g.lineTo(-100, -110); g.arc(0, -110, 100, Math.PI, 0); g.lineTo(100, 4); g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.beginPath(); g.arc(0, -110, 108, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      [-50, 0, 50].forEach((x, i) => {
        const sw = lit ? Math.sin(t * 4 + i) * 0.3 : 0;
        g.save(); g.translate(x, -190 + Math.abs(x) * 0.5); g.rotate(sw);
        g.fillStyle = lit ? GOLD : '#77738c'; g.beginPath(); g.moveTo(-14, 34); g.quadraticCurveTo(-14, 8, 0, 8); g.quadraticCurveTo(14, 8, 14, 34); g.closePath(); g.fill();
        g.restore();
      });
    },
    // Four pines, each one interval farther up the ladder: 2nd, 3rd, 4th, 5th.
    pines(lit, t) {
      [[-120, 110], [-40, 150], [40, 190], [120, 230]].forEach(([x, h], i) => {
        g.fillStyle = c('#6b4424', lit); g.fillRect(x - 6, -24, 12, 28);
        g.fillStyle = c('#0f7f6a', lit);
        for (let k = 0; k < 3; k++) {
          const top = -h + k * h * 0.26, base = -24 - (2 - k) * h * 0.2, w = 22 + k * 10 + h * 0.06;
          g.beginPath(); g.moveTo(x, top); g.lineTo(x + w, base); g.lineTo(x - w, base); g.closePath(); g.fill();
        }
        halo(x, -h - 10, 34, GOLD, lit * (0.7 + 0.3 * Math.sin(t * 3 + i)));
        g.fillStyle = lit ? '#fff4c2' : '#5a5570';
        g.font = '800 18px Grandstander, sans-serif'; g.textAlign = 'center'; g.fillText(String(i + 2), x, -h - 4); g.textAlign = 'start';
      });
    },
    boat(lit, t) {
      halo(0, 0, 190, '#bff6ff', lit * 0.4);
      g.fillStyle = c('#3fb7ff', lit); g.beginPath(); g.ellipse(0, 10, 190, 18, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(255,255,255,${0.2 + lit * 0.45})`; g.lineWidth = 2;
      for (let i = 0; i < 3; i++) { const k = ((t * 0.5 + i / 3) % 1); g.beginPath(); g.moveTo(-160 + k * 320, 8 + i * 4); g.lineTo(-130 + k * 320, 8 + i * 4); g.stroke(); }
      const drift = lit ? Math.sin(t * 0.8) * 40 : 0, bob = lit ? Math.sin(t * 2) * 2 : 0;
      g.save(); g.translate(drift, bob);
      g.fillStyle = c('#c9884a', lit); g.beginPath(); g.moveTo(-54, -4); g.lineTo(54, -4); g.lineTo(38, 12); g.lineTo(-38, 12); g.closePath(); g.fill();
      g.strokeStyle = c('#6c4a2b', lit); g.lineWidth = 3;
      const row = lit ? Math.sin(t * 2.4) * 0.5 : 0.3;
      g.beginPath(); g.moveTo(0, -6); g.lineTo(Math.cos(row) * 60, 10 + Math.sin(row) * 6); g.stroke();
      g.restore();
      if (lit) [-140, -90, 100, 150].forEach((x, i) => { g.fillStyle = '#ff8fc2'; g.beginPath(); g.ellipse(x, 8, 11, 5, 0, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, 4, 4 + Math.sin(t * 2 + i), 0, 7); g.fill(); });
    },
    swing(lit, t) {
      g.fillStyle = c('#6b4424', lit); g.fillRect(-120, -220, 30, 224);
      g.fillRect(-100, -212, 190, 16);
      g.fillStyle = c('#17a38a', lit); [[-110, -220, 60], [-40, -236, 50], [40, -230, 54]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); });
      const ang = lit ? Math.sin(t * 1.9) * 0.45 : 0;
      g.save(); g.translate(20, -198); g.rotate(ang);
      g.strokeStyle = c('#e9d7b0', lit); g.lineWidth = 3;
      g.beginPath(); g.moveTo(-26, 0); g.lineTo(-26, 150); g.moveTo(26, 0); g.lineTo(26, 150); g.stroke();
      g.fillStyle = c('#c9884a', lit); g.fillRect(-34, 148, 68, 10);
      g.restore();
      if (lit) [-60, 0, 60].forEach((x, i) => halo(x, -186, 24, GOLD, 0.7 + 0.3 * Math.sin(t * 4 + i)));
    },
    woodpecker(lit, t) {
      g.fillStyle = c('#7a4f2a', lit); g.fillRect(-26, -230, 52, 234);
      g.fillStyle = c('#17a38a', lit); [[-50, -240, 56], [50, -246, 52], [0, -280, 58]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); });
      g.fillStyle = '#241d52'; g.beginPath(); g.ellipse(0, -150, 11, 14, 0, 0, Math.PI * 2); g.fill();
      if (!lit) return;
      const peck = Math.max(0, Math.sin(t * 16)) * (Math.floor(t * 2) % 2 ? 1 : 0);
      g.save(); g.translate(40 - peck * 6, -120);
      g.fillStyle = '#241d52'; g.beginPath(); g.ellipse(0, 0, 11, 20, 0.2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ff5d73'; g.beginPath(); g.arc(-2, -20, 8, Math.PI, 0); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(-3, -16, 6, 0, 7); g.fill();
      g.fillStyle = '#ffc233'; g.beginPath(); g.moveTo(-8, -16); g.lineTo(-22, -13); g.lineTo(-8, -11); g.fill();
      g.restore();
      if (peck > 0.6) { g.fillStyle = '#fff4c2'; star4(16, -134, 3); }
    },
    willow(lit, t) {
      const moonA = 0.25 + lit * 0.75;
      halo(90, -250, 110, '#e8f0ff', moonA * 0.7);
      g.fillStyle = `rgba(245,248,255,${moonA})`; g.beginPath(); g.arc(90, -250, 28, 0, Math.PI * 2); g.fill();
      g.fillStyle = c('#6b4424', lit); g.beginPath(); g.moveTo(-18, 4); g.lineTo(-10, -170); g.lineTo(10, -170); g.lineTo(18, 4); g.fill();
      g.fillStyle = c('#39c18e', lit); g.beginPath(); g.ellipse(0, -190, 110, 50, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = c('#1f9e6e', lit); g.lineWidth = 4; g.lineCap = 'round';
      for (let i = 0; i < 11; i++) {
        const x = -100 + i * 20, sw = Math.sin(t * 1.2 + i * 0.7) * (lit ? 8 : 2), len = 90 + ((i * 29) % 40);
        g.beginPath(); g.moveTo(x, -170); g.quadraticCurveTo(x + sw, -170 + len * 0.6, x + sw * 1.6, -170 + len); g.stroke();
      }
      g.lineCap = 'butt';
      if (lit) for (let i = 0; i < 6; i++) halo(Math.sin(t * 0.6 + i * 2) * 120, -60 - ((i * 43) % 90), 10, '#fff4a8', 0.8);
    },
    // Three stones stacked like the notes of a chord.
    cairn(lit, t) {
      halo(0, -80, 150, GOLD, lit * 0.4);
      [[0, -18, 62, 22, TEAL_C], [4, -64, 48, 20, VIOLET_C], [-2, -104, 34, 18, GOLD]].forEach(([x, y, rx, ry, col], i) => {
        g.fillStyle = c('#8d86b8', lit); g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
        if (lit) { g.globalAlpha = 0.55 + 0.35 * Math.sin(t * 2.5 - i * 0.8); g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx * 0.8, ry * 0.45, 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
      });
      g.fillStyle = lit ? '#fff4c2' : '#5a5570'; g.font = '800 14px Grandstander, sans-serif'; g.textAlign = 'center';
      ['C', 'E', 'G'].forEach((ch, i) => g.fillText(ch, [0, 4, -2][i], [-13, -59, -99][i]));
      g.textAlign = 'start';
    },
    oak(lit, t) {
      halo(0, -150, 260, GOLD, lit * (0.45 + 0.15 * Math.sin(t * 2)));
      g.fillStyle = c('#6b4424', lit);
      g.beginPath(); g.moveTo(-70, 4); g.quadraticCurveTo(-50, -80, -44, -190); g.lineTo(44, -190); g.quadraticCurveTo(50, -80, 70, 4); g.closePath(); g.fill();
      g.fillStyle = c('#0f7f6a', lit);
      [[-120, -220, 80], [120, -220, 80], [-60, -270, 90], [60, -270, 90], [0, -300, 90]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); });
      g.fillStyle = lit ? '#ffe28a' : '#3a2a1a'; g.beginPath(); g.moveTo(-24, 4); g.lineTo(-24, -60); g.arc(0, -60, 24, Math.PI, 0); g.lineTo(24, 4); g.fill();
      if (lit) for (let i = 0; i < 14; i++) { const x = Math.sin(i * 2.3) * 170, y = -200 - Math.cos(i * 1.7) * 90; halo(x, y, 12, '#fff4c2', 0.5 + 0.5 * Math.sin(t * 3 + i)); }
    },
    // Twelve stars in a ring, the circle of fifths.
    starcompass(lit, t) {
      g.fillStyle = c('#3d3d56', lit); g.beginPath(); g.ellipse(0, -2, 150, 22, 0, 0, Math.PI * 2); g.fill();
      const keys = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'D♭', 'A♭', 'E♭', 'B♭', 'F'];
      g.strokeStyle = c('#8d86b8', lit); g.lineWidth = 3; g.beginPath(); g.arc(0, -80, 60, 0, Math.PI * 2); g.stroke();
      keys.forEach((k, i) => {
        const a = -Math.PI / 2 + i * Math.PI / 6 + (lit ? t * 0.1 : 0), x = Math.cos(a) * 60, y = -80 + Math.sin(a) * 60;
        if (lit) halo(x, y, 16, GOLD, 0.6 + 0.4 * Math.sin(t * 3 + i));
        g.fillStyle = lit ? '#fff4c2' : '#5a5570'; star4(x, y, 3.5);
        g.font = '800 11px Grandstander, sans-serif'; g.textAlign = 'center'; g.fillText(k, Math.cos(a) * 80, -80 + Math.sin(a) * 80 + 4); g.textAlign = 'start';
      });
    },
    moonwell(lit, t) {
      if (lit) halo(0, -120, 120, '#e8f0ff', 0.6);
      g.fillStyle = c('#8d86b8', lit); g.fillRect(-60, -60, 120, 64);
      g.fillStyle = c('#1b2a6b', lit); g.beginPath(); g.ellipse(0, -60, 60, 14, 0, 0, Math.PI * 2); g.fill();
      if (lit) { g.fillStyle = '#f5f8ff'; g.beginPath(); g.ellipse(0, -60, 14, 5, 0, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = c('#6b4424', lit); g.fillRect(-56, -150, 10, 92); g.fillRect(46, -150, 10, 92); g.fillRect(-64, -160, 128, 12);
      const beam = lit ? 0.35 + 0.1 * Math.sin(t * 2) : 0;
      if (beam) { g.fillStyle = `rgba(232,240,255,${beam})`; g.beginPath(); g.moveTo(-40, -62); g.lineTo(40, -62); g.lineTo(18, -300); g.lineTo(-18, -300); g.closePath(); g.fill(); }
    },
    eclipsetower(lit, t) {
      g.fillStyle = c('#3a2a8f', lit); g.fillRect(-30, -240, 60, 244);
      g.beginPath(); g.moveTo(-40, -240); g.lineTo(0, -280); g.lineTo(40, -240); g.fill();
      const sep = lit ? 46 + Math.sin(t) * 6 : 0;
      halo(-sep / 2, -310, 60, GOLD, 0.5 + lit * 0.4);
      g.fillStyle = lit ? GOLD : '#ffe28a'; g.beginPath(); g.arc(-sep / 2, -310, 26, 0, 7); g.fill();
      g.fillStyle = lit ? '#e8f0ff' : '#171040'; g.beginPath(); g.arc(sep / 2, -310, 26, 0, 7); g.fill();
      g.fillStyle = lit ? '#ffe28a' : '#4b4860'; for (let k = 0; k < 4; k++) g.fillRect(-7, -200 + k * 44, 14, 22);
    },
    nightingale(lit, t) {
      g.fillStyle = c('#e9e4ff', lit); g.beginPath(); g.moveTo(-26, 4); g.lineTo(-10, -250); g.lineTo(10, -250); g.lineTo(26, 4); g.closePath(); g.fill();
      g.fillStyle = c('#7b5cff', lit); g.beginPath(); g.moveTo(-18, -250); g.lineTo(0, -290); g.lineTo(18, -250); g.fill();
      const hop = lit ? Math.abs(Math.sin(t * 5)) * 4 : 0;
      g.save(); g.translate(4, -298 - hop);
      g.fillStyle = lit ? '#b98a5c' : '#77738c'; g.beginPath(); g.ellipse(0, 0, 12, 8, -0.2, 0, 7); g.fill();
      g.beginPath(); g.arc(9, -6, 5, 0, 7); g.fill();
      g.fillStyle = '#ffc233'; g.beginPath(); g.moveTo(13, -7); g.lineTo(20, -6); g.lineTo(13, -4); g.fill();
      g.restore();
      if (lit) for (let i = 0; i < 4; i++) { const k = (t * 0.6 + i / 4) % 1; g.fillStyle = `rgba(255,244,194,${1 - k})`; g.font = '700 16px Noto Music, serif'; g.fillText(i % 2 ? '♪' : '♫', 24 + k * 60, -300 - k * 60 + Math.sin(k * 9) * 6); }
    },
    clockwork(lit, t) {
      const rot = lit ? t * 0.5 : 0;
      [[-80, -60, 36, 10], [80, -70, 30, 8]].forEach(([x, y, r, teeth], i) => {
        g.save(); g.translate(x, y); g.rotate((i ? -1 : 1) * rot);
        g.fillStyle = c('#c9884a', lit); g.beginPath();
        for (let k = 0; k < teeth * 2; k++) { const a = k * Math.PI / teeth, rr = k % 2 ? r : r + 8; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        g.closePath(); g.fill(); g.fillStyle = '#241d52'; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill(); g.restore();
      });
      if (lit) halo(0, -150, 100, GOLD, 0.4);
      g.fillStyle = c('#e9e4ff', lit); g.beginPath(); g.arc(0, -150, 70, 0, Math.PI * 2); g.fill();
      g.strokeStyle = c('#3a2a8f', lit); g.lineWidth = 6; g.stroke();
      g.fillStyle = c('#3a2a8f', lit);
      for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; g.fillRect(Math.cos(a) * 56 - 3, -150 + Math.sin(a) * 56 - 3, 6, 6); }
      g.strokeStyle = '#241d52'; g.lineWidth = 5; g.lineCap = 'round';
      const hA = lit ? t * 0.3 : -2.2, mA = lit ? t * 2 : -1.2;
      g.beginPath(); g.moveTo(0, -150); g.lineTo(Math.cos(hA) * 34, -150 + Math.sin(hA) * 34); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.moveTo(0, -150); g.lineTo(Math.cos(mA) * 52, -150 + Math.sin(mA) * 52); g.stroke();
      g.lineCap = 'butt';
    },
    prismharp(lit, t) {
      g.strokeStyle = c('#ffc233', lit); g.lineWidth = 12; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-80, 0); g.lineTo(-80, -230); g.quadraticCurveTo(20, -280, 90, -170); g.lineTo(-80, 0); g.stroke();
      g.lineCap = 'butt';
      const cols = ['#ff5d73', '#ff9f1c', '#ffd23f', '#39c18e', '#3fb7ff', '#7b5cff', '#c77dff'];
      for (let i = 0; i < 7; i++) {
        const x = -58 + i * 20, top = -228 + i * 7 + (i > 3 ? (i - 3) * 12 : 0), bot = -20 - i * 22;
        g.strokeStyle = lit ? cols[i] : '#5a5570'; g.lineWidth = lit ? 3 : 1.5;
        g.globalAlpha = lit ? 0.7 + 0.3 * Math.sin(t * 4 + i) : 1;
        g.beginPath(); g.moveTo(x, top); g.lineTo(x + (lit ? Math.sin(t * 12 + i) : 0), bot); g.stroke();
      }
      g.globalAlpha = 1;
      if (lit) halo(0, -120, 150, '#c9a8ff', 0.35);
    },
    throne(lit, t) {
      if (lit) { halo(0, -170, 260, GOLD, 0.5 + 0.2 * Math.sin(t * 2)); for (let i = 0; i < 10; i++) { const a = t * 0.2 + i * Math.PI / 5; g.strokeStyle = 'rgba(255,244,194,.3)'; g.lineWidth = 5; g.beginPath(); g.moveTo(Math.cos(a) * 90, -170 + Math.sin(a) * 90); g.lineTo(Math.cos(a) * 240, -170 + Math.sin(a) * 240); g.stroke(); } }
      g.fillStyle = c('#3a2a8f', lit); g.fillRect(-120, -30, 240, 34); g.fillRect(-90, -54, 180, 26);
      g.fillStyle = c('#19c3b3', lit);
      g.beginPath(); g.moveTo(-60, -54); g.lineTo(-60, -220); g.lineTo(-30, -260); g.lineTo(0, -230); g.lineTo(30, -260); g.lineTo(60, -220); g.lineTo(60, -54); g.closePath(); g.fill();
      g.fillStyle = c('#171040', lit); g.fillRect(-40, -150, 80, 90);
      g.fillStyle = lit ? GOLD : '#5a5570'; star4(0, -290, 10);
      if (lit) for (let i = 0; i < 12; i++) { const k = (t * 0.3 + i / 12) % 1; g.fillStyle = `rgba(255,244,194,${1 - k})`; star4(Math.sin(i * 2.4) * 200, -400 + k * 380, 2.5); }
    },
    embersteps(lit, t) {
      for (let i = 0; i < 7; i++) {
        const x = -150 + i * 44, top = -16 - i * 24;
        g.fillStyle = c('#6e6874', lit); g.fillRect(x, top, 48, -top + 4);
        const glow = lit ? 0.55 + 0.45 * Math.sin(t * 4 - i * 0.9) : 0.12;
        g.fillStyle = `rgba(255,${120 + i * 12},60,${glow})`; g.fillRect(x + 4, top + 2, 40, 5);
        if (lit && Math.sin(t * 3 + i * 2) > 0.7) { g.fillStyle = '#ffd66b'; star4(x + 24, top - 12 - ((t * 40 + i * 10) % 30), 2.5); }
      }
    },
    crookedbridge(lit, t) {
      g.fillStyle = c('#3f3a44', lit); g.fillRect(-190, -10, 50, 16); g.fillRect(140, -10, 50, 16);
      g.fillStyle = '#1a1020'; g.fillRect(-140, -2, 280, 80);
      g.strokeStyle = c('#c9884a', lit); g.lineWidth = 3;
      g.beginPath(); g.moveTo(-140, -60); g.quadraticCurveTo(0, -30, 140, -60); g.stroke();
      for (let i = 0; i < 9; i++) {
        const x = -130 + i * 32, y = -8 + (lit ? Math.sin(t * 2 + i) * 2 : (i % 2 ? 14 : -6)), rot = lit ? 0 : (i % 3 - 1) * 0.3;
        if (!lit && i === 4) continue;
        g.save(); g.translate(x, y); g.rotate(rot);
        g.fillStyle = c('#8a5a2b', lit); g.fillRect(-12, -4, 26, 8);
        g.restore();
        g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x, -60 + 30 * (1 - Math.pow((x / 140), 2)) * 0.8); g.stroke();
      }
    },
    mountainhall(lit, t) {
      g.fillStyle = c('#5c5660', lit); g.beginPath(); g.moveTo(-190, 4); g.lineTo(-60, -250); g.lineTo(40, -220); g.lineTo(190, 4); g.closePath(); g.fill();
      const open = lit ? 1 : 0;
      halo(0, -60, 120, '#ff8a4c', lit * 0.6);
      g.fillStyle = lit ? '#ffb347' : '#241d2c'; g.beginPath(); g.moveTo(-50, 4); g.lineTo(-50, -80); g.arc(0, -80, 50, Math.PI, 0); g.lineTo(50, 4); g.fill();
      g.fillStyle = c('#6b4424', lit);
      g.fillRect(-50 - open * 40, -130, 50, 134); g.fillRect(0 + open * 40, -130, 50, 134);
      if (lit) for (let i = 0; i < 4; i++) { const x = -30 + i * 20, hop = Math.abs(Math.sin(t * 6 + i)) * 10; g.fillStyle = '#3a1a28'; g.beginPath(); g.arc(x, -14 - hop, 8, 0, 7); g.fill(); g.fillRect(x - 6, -12 - hop, 12, 12); }
    },
    harpfalls(lit, t) {
      g.fillStyle = c('#5c5660', lit); g.fillRect(-140, -280, 40, 284); g.fillRect(100, -280, 40, 284);
      g.fillStyle = c('#6e6874', lit); g.fillRect(-150, -290, 300, 22);
      for (let i = 0; i < 9; i++) {
        const x = -90 + i * 22;
        g.strokeStyle = lit ? `rgba(255,${150 + i * 10},70,${0.6 + 0.4 * Math.sin(t * 5 + i)})` : '#3f3a44';
        g.lineWidth = lit ? 4 : 2;
        g.beginPath(); g.moveTo(x, -268);
        for (let y = -268; y <= 0; y += 24) g.lineTo(x + (lit ? Math.sin(t * 8 + y * 0.05 + i) * 3 : 0), y);
        g.stroke();
      }
      if (lit) halo(0, -10, 150, '#ff8a4c', 0.5);
    },
    cadencegates(lit, t) {
      ['V–I', 'I–V', 'IV–I'].forEach((label, i) => {
        const x = (i - 1) * 110;
        g.fillStyle = c('#6e6874', lit); g.fillRect(x - 42, -170, 14, 174); g.fillRect(x + 28, -170, 14, 174); g.fillRect(x - 48, -184, 96, 18);
        const open = lit ? 1 : 0;
        g.fillStyle = c('#8a5a2b', lit); g.fillRect(x - 28, -166, 28 - open * 20, 170); g.fillRect(x + open * 20, -166, 28 - open * 20, 170);
        if (lit) halo(x, -90, 60, GOLD, 0.35 + 0.15 * Math.sin(t * 2 + i));
        g.fillStyle = lit ? '#fff4c2' : '#9a94a0'; g.font = '800 15px Grandstander, sans-serif'; g.textAlign = 'center'; g.fillText(label, x, -190); g.textAlign = 'start';
      });
    },
    forge(lit, t) {
      g.fillStyle = c('#4a3a44', lit); g.fillRect(40, -170, 70, 174); g.fillRect(30, -190, 90, 24);
      halo(75, -60, 90, '#ff6a2a', lit * (0.7 + 0.2 * Math.sin(t * 7)));
      g.fillStyle = lit ? '#ff9a3c' : '#2a2030'; g.beginPath(); g.arc(75, -40, 26, Math.PI, 0); g.lineTo(101, 4); g.lineTo(49, 4); g.fill();
      g.fillStyle = c('#3a3a48', lit);
      g.beginPath(); g.moveTo(-110, -60); g.lineTo(-20, -60); g.lineTo(-30, -44); g.lineTo(-50, -44); g.lineTo(-50, -10); g.lineTo(-30, 4); g.lineTo(-100, 4); g.lineTo(-80, -10); g.lineTo(-80, -44); g.lineTo(-100, -44); g.closePath(); g.fill();
      if (lit) {
        const swing = Math.max(0, Math.sin(t * 5));
        g.save(); g.translate(-40, -120); g.rotate(-0.9 + swing * 1.1);
        g.fillStyle = '#6b4424'; g.fillRect(-4, 0, 8, 60); g.fillStyle = '#8d86b8'; g.fillRect(-16, 56, 32, 16);
        g.restore();
        if (swing > 0.95) for (let i = 0; i < 6; i++) { g.fillStyle = '#ffd66b'; star4(-60 + i * 8, -70 - (i % 3) * 10, 2.5); }
      }
    },
    pavilion(lit, t) {
      g.fillStyle = c('#e9e4ff', lit); g.fillRect(-150, -14, 300, 18);
      [-130, -65, 0, 65, 130].forEach(x => g.fillRect(x - 7, -170, 14, 158));
      g.fillStyle = c('#ffc233', lit); g.beginPath(); g.moveTo(-170, -168); g.quadraticCurveTo(0, -250, 170, -168); g.closePath(); g.fill();
      if (lit) for (let i = 0; i < 6; i++) {
        const a = t * 1.2 + i * Math.PI / 3, x = Math.cos(a) * 80, y = -70 + Math.sin(a * 2) * 20;
        halo(x, y, 22, i % 2 ? '#ffd66b' : '#ff8fc2', 0.9);
      }
    },
    lighthouse(lit, t) {
      g.fillStyle = c('#8a8f9c', lit); g.fillRect(-60, -20, 120, 24);
      g.fillStyle = c('#fffaf0', lit); g.beginPath(); g.moveTo(-34, -20); g.lineTo(-22, -240); g.lineTo(22, -240); g.lineTo(34, -20); g.closePath(); g.fill();
      g.fillStyle = c('#ff5d73', lit); [[-31, -70, 62], [-27, -150, 54]].forEach(([x, y, w]) => g.fillRect(x, y, w, 26));
      g.fillStyle = c('#241d52', lit); g.fillRect(-28, -248, 56, 10); g.fillRect(-18, -290, 36, 42);
      g.fillStyle = c('#ff5d73', lit); g.beginPath(); g.moveTo(-24, -290); g.lineTo(0, -318); g.lineTo(24, -290); g.fill();
      g.fillStyle = lit ? '#fff4c2' : '#4b4860'; g.fillRect(-12, -284, 24, 30);
      if (lit) {
        halo(0, -270, 90, '#fff4c2', 0.9);
        const a = t * 0.9;
        g.fillStyle = 'rgba(255,244,194,0.22)';
        [a, a + Math.PI].forEach(ang => { const dx = Math.cos(ang); g.beginPath(); g.moveTo(0, -270); g.lineTo(dx * 600, -330); g.lineTo(dx * 600, -210); g.closePath(); g.fill(); });
      }
    },
    tidepools(lit, t) {
      g.fillStyle = c('#7a7f8c', lit); g.beginPath(); g.ellipse(0, 4, 170, 26, 0, Math.PI, 0); g.fill();
      [[-80, 30], [10, 36], [95, 26]].forEach(([x, r], i) => {
        g.fillStyle = c('#1f8fd6', lit); g.beginPath(); g.ellipse(x, -6, r, 9, 0, 0, Math.PI * 2); g.fill();
        for (let k = 0; k < 3; k++) {
          const ax = x - r * 0.5 + k * r * 0.5, open = lit ? 1 : 0.3;
          g.strokeStyle = c(k % 2 ? '#ff8fc2' : '#ffb347', lit); g.lineWidth = 3;
          for (let a = -2; a <= 2; a++) { g.beginPath(); g.moveTo(ax, -8); g.lineTo(ax + a * 4 * open + Math.sin(t * 2 + a + i) * 2 * open, -8 - 14 * open); g.stroke(); }
        }
      });
    },
    foghorn(lit, t) {
      g.fillStyle = c('#6b4424', lit); g.fillRect(-8, -140, 16, 144);
      g.save(); g.translate(0, -150); g.rotate(-0.25);
      g.fillStyle = c('#d9a441', lit); g.beginPath(); g.moveTo(-10, -12); g.lineTo(70, -40); g.lineTo(70, 40); g.lineTo(-10, 12); g.closePath(); g.fill();
      g.fillStyle = c('#8a5a2b', lit); g.beginPath(); g.ellipse(70, 0, 8, 40, 0, 0, Math.PI * 2); g.fill();
      g.restore();
      if (lit) for (let i = 0; i < 3; i++) { const k = (t * 0.4 + i / 3) % 1; g.strokeStyle = `rgba(255,244,194,${0.7 * (1 - k)})`; g.lineWidth = 4; g.beginPath(); g.arc(70, -168, 30 + k * 90, -0.9, 0.5); g.stroke(); }
      else { g.fillStyle = 'rgba(220,224,232,0.6)'; [[-60, -120, 60], [50, -170, 70], [0, -60, 80]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }); }
    },
    rowboats(lit, t) {
      g.fillStyle = c('#8a5a2b', lit); g.fillRect(-200, -34, 110, 12); [-190, -120].forEach(x => g.fillRect(x, -34, 10, 40));
      [-30, 60, 150].forEach((x0, i) => {
        const x = x0 + (lit ? Math.sin(t * 0.9 + i) * 26 : 0), y = lit ? Math.sin(t * 2.4 + i * 1.3) * 5 : 0;
        g.save(); g.translate(x, y - 6);
        g.fillStyle = c(['#ff5d73', '#3fb7ff', '#ffc233'][i], lit);
        g.beginPath(); g.moveTo(-40, -14); g.lineTo(40, -14); g.lineTo(28, 4); g.lineTo(-28, 4); g.closePath(); g.fill();
        g.strokeStyle = c('#6c4a2b', lit); g.lineWidth = 3;
        const row = lit ? Math.sin(t * 2.4 + i * 1.3) * 0.6 : 0.2;
        g.beginPath(); g.moveTo(0, -14); g.lineTo(Math.cos(row) * 46, 2 + Math.sin(row) * 6); g.stroke();
        g.restore();
      });
    },
    buoy(lit, t) {
      const rock = lit ? Math.sin(t * 2.2) * 0.22 : 0.05;
      g.save(); g.translate(0, 0); g.rotate(rock);
      g.fillStyle = c('#ff5d73', lit); g.beginPath(); g.moveTo(-40, 0); g.lineTo(-24, -70); g.lineTo(24, -70); g.lineTo(40, 0); g.closePath(); g.fill();
      g.fillStyle = c('#fffaf0', lit); g.fillRect(-30, -44, 60, 12);
      g.strokeStyle = c('#3a3470', lit); g.lineWidth = 4; g.beginPath(); g.moveTo(-18, -70); g.lineTo(0, -140); g.lineTo(18, -70); g.stroke();
      if (lit) halo(0, -112, 40, GOLD, 0.7);
      g.fillStyle = lit ? GOLD : '#77738c'; g.beginPath(); g.moveTo(-14, -98); g.quadraticCurveTo(-14, -126, 0, -126); g.quadraticCurveTo(14, -126, 14, -98); g.closePath(); g.fill();
      g.restore();
      if (lit) for (let i = 0; i < 3; i++) { const k = (t * 0.7 + i / 3) % 1; g.strokeStyle = `rgba(255,244,194,${0.7 * (1 - k)})`; g.lineWidth = 3; g.beginPath(); g.arc(0, -112, 24 + k * 50, 0, Math.PI * 2); g.stroke(); }
    },
    arch(lit, t) {
      const rise = lit ? 0 : 110;
      g.save(); g.beginPath(); g.rect(-400, -700, 800, 706); g.clip(); // nothing shows below the waterline
      g.translate(0, rise);
      g.strokeStyle = c('#a39cc8', lit); g.lineWidth = 26;
      g.beginPath(); g.moveTo(-100, 10); g.lineTo(-100, -100); g.arc(0, -100, 100, Math.PI, 0); g.lineTo(100, 10); g.stroke();
      g.strokeStyle = c('#39c18e', lit); g.lineWidth = 5;
      for (let i = 0; i < 6; i++) { const a = Math.PI + i * 0.55; g.beginPath(); g.moveTo(Math.cos(a) * 100, -100 + Math.sin(a) * 100); g.lineTo(Math.cos(a) * 100, -100 + Math.sin(a) * 100 + 30 + Math.sin(t + i) * 4); g.stroke(); }
      g.restore();
      if (!lit) { g.fillStyle = c('#1f8fd6', lit); g.globalAlpha = 0.7; g.fillRect(-150, -6, 300, 14); g.globalAlpha = 1; }
      else halo(0, -100, 110, '#bff6ff', 0.35);
    },
    chapel(lit, t) {
      const rise = lit ? 0 : 150;
      g.save(); g.beginPath(); g.rect(-400, -700, 800, 706); g.clip();
      g.translate(0, rise);
      g.fillStyle = c('#e9e4ff', lit); g.fillRect(-90, -120, 120, 124); g.fillRect(20, -220, 50, 224);
      g.fillStyle = c('#7b5cff', lit);
      g.beginPath(); g.moveTo(-100, -118); g.lineTo(-30, -170); g.lineTo(40, -118); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(14, -218); g.lineTo(45, -270); g.lineTo(76, -218); g.closePath(); g.fill();
      g.fillStyle = lit ? '#ffe28a' : '#4b4860'; g.beginPath(); g.moveTo(-40, 4); g.lineTo(-40, -50); g.arc(-30, -50, 10, Math.PI, 0); g.lineTo(-20, 4); g.fill();
      g.fillRect(-72, -90, 18, 26);
      const sw = lit ? Math.sin(t * 3) * 0.35 : 0;
      g.save(); g.translate(45, -196); g.rotate(sw);
      if (lit) halo(0, 12, 34, GOLD, 0.8);
      g.fillStyle = lit ? GOLD : '#77738c'; g.beginPath(); g.moveTo(-12, 22); g.quadraticCurveTo(-12, 0, 0, 0); g.quadraticCurveTo(12, 0, 12, 22); g.closePath(); g.fill();
      g.restore();
      g.restore();
      if (!lit) { g.fillStyle = c('#1f8fd6', lit); g.globalAlpha = 0.85; g.fillRect(-140, -30, 280, 36); g.globalAlpha = 1; }
    },
    // Eight crystals hanging from a stone arch, short to long: a scale.
    stalactites(lit, t) {
      g.fillStyle = c('#5b4a8a', lit); g.fillRect(-150, -240, 300, 26);
      g.fillRect(-150, -214, 20, 218); g.fillRect(130, -214, 20, 218);
      for (let i = 0; i < 8; i++) {
        const x = -105 + i * 30, len = 40 + i * 14;
        const on = lit ? 0.6 + 0.4 * Math.sin(t * 3 - i * 0.6) : 0;
        halo(x, -214 + len * 0.7, 26, '#9ff3ff', on * 0.8);
        g.fillStyle = c('#19c3b3', lit); g.beginPath(); g.moveTo(x - 10, -214); g.lineTo(x, -214 + len); g.lineTo(x + 10, -214); g.closePath(); g.fill();
      }
    },
    minecart(lit, t) {
      g.strokeStyle = c('#8d86b8', lit); g.lineWidth = 5;
      g.beginPath(); g.moveTo(-200, 0); g.lineTo(200, 0); g.stroke();
      g.fillStyle = c('#6b4424', lit);
      for (let x = -190; x <= 190; x += 30) if (lit || Math.abs(x) > 60) g.fillRect(x - 4, -2, 8, 10);
      if (!lit) { g.fillStyle = '#1c1a2c'; g.fillRect(-60, -2, 120, 60); }
      const roll = lit ? Math.sin(t * 0.7) * 120 : -110;
      g.save(); g.translate(roll, 0);
      g.fillStyle = c('#c9884a', lit); g.beginPath(); g.moveTo(-46, -80); g.lineTo(46, -80); g.lineTo(36, -18); g.lineTo(-36, -18); g.closePath(); g.fill();
      g.fillStyle = c('#7b5cff', lit); [[-20, -86], [0, -94], [18, -86]].forEach(([x, y]) => { g.beginPath(); g.moveTo(x, y - 14); g.lineTo(x + 8, y + 6); g.lineTo(x - 8, y + 6); g.fill(); });
      if (lit) halo(0, -90, 50, '#c9a8ff', 0.6);
      g.fillStyle = '#241d52'; [-24, 24].forEach(x => { g.beginPath(); g.arc(x, -12, 10, 0, 7); g.fill(); });
      g.restore();
    },
    geode(lit, t) {
      halo(0, -70, 150, '#ffd6f0', lit * 0.45);
      g.fillStyle = c('#7a6a8f', lit); g.beginPath(); g.ellipse(0, -70, 90, 74, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = c('#3a2a60', lit); g.beginPath(); g.ellipse(0, -70, 70, 56, 0, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2, x = Math.cos(a) * 58, y = -70 + Math.sin(a) * 45;
        g.fillStyle = c(i % 2 ? '#ff8fc2' : '#c9a8ff', lit);
        // each crystal grows from the rim toward the middle
        const px = -Math.sin(a) * 7, py = Math.cos(a) * 7;
        g.beginPath(); g.moveTo(x + px, y + py); g.lineTo(x * 0.5, -70 + (y + 70) * 0.5); g.lineTo(x - px, y - py); g.closePath(); g.fill();
      }
      [-30, 0, 30].forEach((x, i) => {
        g.fillStyle = c('#fffaf0', lit); g.fillRect(x - 4, -86, 8, 26);
        if (lit) { halo(x, -94, 22, GOLD, 0.8 + 0.2 * Math.sin(t * 6 + i)); g.fillStyle = GOLD; g.beginPath(); g.ellipse(x, -93, 3.5, 7 + Math.sin(t * 9 + i), 0, 0, 7); g.fill(); }
      });
    },
    pillars(lit, t) {
      ['I', 'IV', 'V'].forEach((n, i) => {
        const x = (i - 1) * 90, h = 200;
        const on = lit ? 0.7 + 0.3 * Math.sin(t * 2 + i) : 0;
        halo(x, -h + 30, 70, GOLD, on * 0.6);
        g.fillStyle = c('#8d86b8', lit); g.fillRect(x - 24, -h, 48, h + 4);
        g.fillStyle = c('#6b5bd6', lit); g.fillRect(x - 32, -h - 14, 64, 16); g.fillRect(x - 32, -8, 64, 12);
        g.fillStyle = lit ? '#fff4c2' : '#5a5570'; g.font = '800 26px Grandstander, sans-serif'; g.textAlign = 'center'; g.fillText(n + (n === 'V' ? '7' : ''), x, -h / 2); g.textAlign = 'start';
      });
    },
    bats(lit, t) {
      g.fillStyle = c('#5b4a8a', lit); g.fillRect(-150, -240, 300, 18);
      for (let i = 0; i < 5; i++) {
        const x0 = -110 + i * 55;
        if (!lit) {
          g.strokeStyle = '#3a3470'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, -222); g.lineTo(x0, -212); g.stroke();
          g.fillStyle = '#2a2448'; g.beginPath(); g.ellipse(x0, -196, 9, 16, 0, 0, Math.PI * 2); g.fill();
          continue;
        }
        const a = t * 1.3 + i * 1.3, x = x0 + Math.sin(a) * 40, y = -150 + Math.cos(a * 1.4) * 50, flap = Math.sin(t * 14 + i) * 10;
        halo(x, y, 26, '#c9a8ff', 0.5);
        g.fillStyle = '#2a2448';
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - 24, y - flap); g.lineTo(x - 12, y + 4); g.lineTo(x, y + 2); g.lineTo(x + 12, y + 4); g.lineTo(x + 24, y - flap); g.closePath(); g.fill();
        g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
      }
      if (lit) { halo(0, -60, 40, GOLD, 0.6); g.fillStyle = GOLD; g.beginPath(); g.moveTo(-14, -40); g.quadraticCurveTo(-14, -72, 0, -72); g.quadraticCurveTo(14, -72, 14, -40); g.closePath(); g.fill(); }
    },
    seam(lit, t) {
      g.fillStyle = c('#4a4862', lit); g.beginPath(); g.moveTo(-130, 4); g.lineTo(-110, -170); g.lineTo(-20, -200); g.lineTo(90, -180); g.lineTo(130, 4); g.closePath(); g.fill();
      g.strokeStyle = c('#3fb7ff', lit); g.lineWidth = 12; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(-100, -20); g.lineTo(-60, -80); g.lineTo(-20, -60); g.lineTo(30, -130); g.lineTo(70, -110); g.lineTo(100, -170); g.stroke();
      if (lit) {
        g.strokeStyle = `rgba(200,240,255,${0.5 + 0.4 * Math.sin(t * 3)})`; g.lineWidth = 4; g.stroke();
        [[-60, -80], [30, -130], [100, -170]].forEach(([x, y], i) => halo(x, y, 40, '#7fd3ff', 0.6 + 0.3 * Math.sin(t * 4 + i)));
      }
      g.lineJoin = 'miter';
      g.fillStyle = lit ? '#fff4c2' : '#5a5570'; g.font = '800 22px Grandstander, sans-serif'; g.textAlign = 'center'; g.fillText('G', -2, -150); g.textAlign = 'start';
    },
    starlake(lit, t) {
      halo(0, 0, 220, '#bff6ff', lit * 0.4);
      g.fillStyle = c('#1b2a6b', lit); g.beginPath(); g.ellipse(0, 12, 220, 26, 0, 0, Math.PI * 2); g.fill();
      const n = lit ? 26 : 3;
      for (let i = 0; i < n; i++) {
        const x = Math.sin(i * 12.9898) * 190, y = 6 + Math.cos(i * 4.1) * 14;
        g.fillStyle = `rgba(255,248,210,${lit ? 0.5 + 0.5 * Math.sin(t * 2 + i) : 0.25})`;
        star4(x, y, 1.6 + (i % 3) * 0.6);
      }
      g.strokeStyle = `rgba(255,255,255,${0.15 + lit * 0.35})`; g.lineWidth = 2;
      for (let i = 0; i < 3; i++) { const w = 40 + ((t * 18 + i * 60) % 160); g.beginPath(); g.ellipse(0, 12, w, w * 0.12, 0, 0, Math.PI * 2); g.stroke(); }
    },
  };

  return {
    init, load, refresh, start, stop, setEnabled, setHint,
    get x() { return px; },
    get near() { return near; },
  };
})();
