'use strict';
// The object each lesson restores: it advances one stage per successful performance (0..3).
const Reward = (() => {
  const GOLD = '#ffc233', TEAL = '#19c3b3', CORAL = '#ff5d73', VIOLET = '#7b5cff', DIM = '#8d88ad';

  function glow(g, x, y, r, color, a) {
    if (a <= 0) return;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalAlpha = a; g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  }
  const stage = (p, i) => Math.max(0, Math.min(1, p - i)); // how lit stage i is

  const draw = {
    crystal(g, p, t) {
      glow(g, 0, -10, 70, GOLD, p / 3 * (0.8 + 0.2 * Math.sin(t * 3)));
      const pts = [[0, -62], [26, -22], [18, 34], [-18, 34], [-26, -22]];
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
      g.fillStyle = '#5a5480'; g.fill();
      g.save(); g.clip();
      const bands = [[34, 8, TEAL], [8, -22, VIOLET], [-22, -64, GOLD]];
      bands.forEach(([y1, y2, c], i) => { g.globalAlpha = stage(p, i); g.fillStyle = c; g.fillRect(-30, y2, 60, y1 - y2); });
      g.restore(); g.globalAlpha = 1;
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.moveTo(0, -62); g.lineTo(0, 0); g.lineTo(-18, 34); g.moveTo(0, 0); g.lineTo(18, 34); g.moveTo(-26, -22); g.lineTo(0, 0); g.lineTo(26, -22); g.stroke();
    },
    bridge(g, p, t) {
      const ang = -1.25 * (1 - p / 3);
      g.fillStyle = '#3a3470'; g.fillRect(-70, -10, 14, 60); g.fillRect(56, -10, 14, 60);
      g.fillStyle = '#7fd3ff'; g.globalAlpha = 0.5; g.fillRect(-56, 30, 112, 20); g.globalAlpha = 1;
      g.save(); g.translate(-56, -4); g.rotate(ang);
      g.fillStyle = '#c9884a'; g.fillRect(0, 0, 112, 10);
      g.fillStyle = '#9e6532'; for (let i = 1; i < 7; i++) g.fillRect(i * 16, 0, 2, 10);
      g.restore();
      const ex = -56 + Math.cos(ang) * 112, ey = -4 + Math.sin(ang) * 112;
      g.strokeStyle = '#6c6892'; g.lineWidth = 2; g.setLineDash([4, 3]);
      g.beginPath(); g.moveTo(63, -10); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
      g.save(); g.translate(63, -22); g.rotate(p * 2.1 + t * 0.2 * (p < 3 ? 0 : 1));
      g.fillStyle = GOLD; g.beginPath();
      for (let i = 0; i < 16; i++) { const r = i % 2 ? 14 : 10; const a = i / 16 * Math.PI * 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fill(); g.fillStyle = '#3a3470'; g.beginPath(); g.arc(0, 0, 4, 0, 7); g.fill();
      g.restore();
    },
    lanterns(g, p, t) {
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 44, a = stage(p, i);
        g.strokeStyle = '#3a3470'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, 50); g.lineTo(x, -20); g.stroke();
        glow(g, x, -32, 34, GOLD, a * (0.85 + 0.15 * Math.sin(t * 5 + i)));
        g.fillStyle = a > 0 ? mix(DIM, '#ffd66b', a) : DIM;
        g.beginPath(); g.roundRect(x - 10, -46, 20, 26, 5); g.fill();
        g.fillStyle = '#3a3470'; g.fillRect(x - 12, -50, 24, 5);
      }
    },
    flower(g, p, t) {
      g.strokeStyle = '#1f9e6e'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, 55); g.quadraticCurveTo(-8, 20, 0, -5); g.stroke();
      const open = p / 3;
      glow(g, 0, -20, 60, CORAL, open * 0.6);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2 + t * 0.15;
        g.save(); g.translate(0, -18); g.rotate(a);
        g.fillStyle = i % 2 ? CORAL : '#ff8fa0';
        g.beginPath(); g.ellipse(0, -8 - 14 * open, 7 + 5 * open, 10 + 10 * open, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      g.fillStyle = GOLD; g.beginPath(); g.arc(0, -18, 7 + 3 * open, 0, 7); g.fill();
    },
    door(g, p, t) {
      glow(g, 0, -5, 70, GOLD, p / 3 * 0.7);
      g.fillStyle = '#3a3470'; g.beginPath(); g.moveTo(-40, 50); g.lineTo(-40, -30); g.arc(0, -30, 40, Math.PI, 0); g.lineTo(40, 50); g.fill();
      g.fillStyle = '#fff3c4'; g.beginPath(); g.moveTo(-30, 50); g.lineTo(-30, -28); g.arc(0, -28, 30, Math.PI, 0); g.lineTo(30, 50); g.fill();
      const w = 60 * (1 - p / 3 * 0.85);
      g.fillStyle = '#c9884a'; g.beginPath(); g.moveTo(-30, 50); g.lineTo(-30, -28); g.arc(0, -28, 30, Math.PI, 0); g.lineTo(30, 50); g.closePath(); g.save(); g.clip();
      g.fillRect(-30, -60, w, 110); g.fillStyle = '#9e6532'; g.fillRect(-30 + w - 4, -60, 4, 110);
      g.fillStyle = GOLD; g.beginPath(); g.arc(-30 + w - 10, 10, 3, 0, 7); g.fill(); g.restore();
    },
    stars(g, p, t) {
      const pts = [[-44, 20], [0, -34], [44, 14]];
      g.strokeStyle = 'rgba(255,194,51,.7)'; g.lineWidth = 2;
      if (p > 1) { g.beginPath(); g.moveTo(...pts[0]); g.lineTo(pts[1][0] * 1, pts[1][1]); g.globalAlpha = stage(p, 1); g.stroke(); g.globalAlpha = 1; }
      if (p > 2) { g.beginPath(); g.moveTo(...pts[1]); g.lineTo(...pts[2]); g.globalAlpha = stage(p, 2); g.stroke(); g.globalAlpha = 1; }
      pts.forEach(([x, y], i) => {
        const a = stage(p, i);
        glow(g, x, y, 30, GOLD, a * (0.8 + 0.2 * Math.sin(t * 4 + i)));
        star(g, x, y, 12, a > 0 ? mix(DIM, GOLD, a) : DIM);
      });
    },
  };

  function star(g, x, y, r, c) {
    g.fillStyle = c; g.beginPath();
    for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.45 : r; const a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.closePath(); g.fill();
  }
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = s => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  // Animated widget bound to a canvas.
  function mount(canvas, type) {
    const g = canvas.getContext('2d');
    let shown = 0, target = 0, raf = 0, alive = true;
    const fn = draw[type] || draw.crystal;
    const frame = ts => {
      if (!alive) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      shown += (target - shown) * 0.06;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const s = Math.min(w / 180, h / 130);
      g.translate(w / 2, h / 2); g.scale(s, s);
      fn(g, shown, ts / 1000);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return { set(v, instant) { target = v; if (instant) shown = v; }, destroy() { alive = false; cancelAnimationFrame(raf); } };
  }

  return { mount, mix };
})();
