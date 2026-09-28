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
    const spb = 60 / song.tempo * 1.3, t0 = ctx.currentTime + 0.1;
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

    // clouds
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 6; i++) {
      const span = W + 600;
      const cx = (((i * 520 + time * 8 - cam * 0.12) * S) % span + span) % span - 300;
      const cy = H * (0.12 + (i % 3) * 0.07);
      cloud(cx, cy, (0.7 + (i % 2) * 0.4) * S);
    }

    ridge(0.18, H * 0.5, 60, 0.0016, 0.0041, P.far, 1);
    if (realm.decor === 'wood') treeLine(0.4, H * 0.62, P.mid);
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
        const cols = realm.decor === 'wood' ? ['#ff8fc2', '#ffd23f', '#ffffff'] : ['#ff5d73', '#ffd23f', '#ffffff', '#7b5cff'];
        g.fillStyle = cols[Math.abs(i) % cols.length];
        g.beginPath(); g.arc(s - 4 * S, y - 13 * S, 3.2 * S, 0, Math.PI * 2); g.fill();
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
      g.fillStyle = `rgba(255,236,170,${(0.3 + 0.4 * Math.sin(time * 2 + m.p)) * (0.4 + progress * 0.6)})`;
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
  const GOLD = '#ffc233';
  const LANDMARK_H = { stone: 200, pools: 70, lanterns: 150, cottage: 190, gate: 200, lake: 70, bridge: 150, tower: 290, glade: 220, canyon: 230, stairs: 150, crystal: 260, belltree: 240, hall: 200, windmill: 250, bellarch: 200 };

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
  };

  return {
    init, load, refresh, start, stop, setEnabled, setHint,
    get x() { return px; },
    get near() { return near; },
  };
})();
