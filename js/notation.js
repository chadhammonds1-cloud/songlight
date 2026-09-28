'use strict';
// Draws a compiled song as SVG: Alfred-style "pre-staff" notation for the first lessons,
// then a real grand staff. Returns handles for a moving cursor and per-note marks.
const Notation = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const E = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const T = (txt, attrs, parent) => { const n = E('text', attrs, parent); n.textContent = txt; return n; };
  const ACC = { '#': '♯', b: '♭' };

  function render(host, song, opts = {}) {
    host.innerHTML = '';
    const W = Math.max(260, Math.floor(opts.width || host.clientWidth || 640));
    const staff = song.notation === 'staff';
    const sp = (opts.sp || (W < 480 ? 7 : W < 760 ? 8.5 : 9.5)) * (staff ? 1 : 1.2);
    const bpm = song.beatsPerMeasure;
    const nM = Math.max(1, Math.ceil(song.length / bpm - 1e-6));
    const eighths = song.voices.some(v => v.events.some(e => e.dur < 1));
    const beatW = sp * (eighths ? 5.4 : 4.3);
    const pad = sp * 1.9;
    const mW0 = bpm * beatW + pad * 1.4;
    const showTime = !opts.hideTime;
    const clefW = staff ? sp * 4.4 : sp * 1;
    const headFirst = clefW + (showTime ? sp * 2.8 : 0);
    const maxPer = opts.maxPerLine || 4;

    let per = Math.max(1, Math.min(maxPer, Math.floor((W - headFirst - 4) / mW0)));
    const lineCount = Math.ceil(nM / per);
    per = Math.ceil(nM / lineCount);
    const systems = [];
    for (let s = 0, m = 0; m < nM; s++) {
      const count = Math.min(per, nM - m);
      const head = s ? clefW : headFirst;
      systems.push({ start: m, count, head, mW: Math.min((W - head - 4) / per, mW0 * 1.8) });
      m += count;
    }
    const sysH = staff ? sp * 23 : sp * 17;
    const H = systems.length * sysH + sp;
    const svg = E('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'score-svg ' + (staff ? 'is-staff' : 'is-prestaff') }, host);
    const gStatic = E('g', {}, svg);
    const cursor = E('rect', { class: 'cursor', x: 0, y: 0, width: sp * 2.4, height: sysH - sp * 0.6, rx: sp * 0.8, opacity: 0 }, svg);
    const gNotes = E('g', {}, svg);
    const glyphs = {};

    const sysIndex = m => systems.findIndex(s => m >= s.start && m < s.start + s.count);
    function beatX(b) {
      const m = Math.min(nM - 1, Math.floor(b / bpm + 1e-6));
      const si = sysIndex(m), s = systems[si];
      const x0 = s.head + (m - s.start) * s.mW;
      return { x: x0 + pad + (b - m * bpm) * ((s.mW - pad * 1.6) / bpm), si, s };
    }

    // --- staves, clefs, bar lines
    systems.forEach((s, si) => {
      const y0 = si * sysH + sp * 0.5;
      s.y0 = y0;
      const xEnd = s.head + s.count * s.mW;
      let ya, yb;
      if (staff) {
        s.tt = y0 + sp * 4.5; s.bt = s.tt + sp * 10;
        for (const top of [s.tt, s.bt]) for (let i = 0; i < 5; i++) E('line', { x1: 2, x2: xEnd, y1: top + i * sp, y2: top + i * sp, class: 'sl' }, gStatic);
        E('line', { x1: 2, x2: 2, y1: s.tt, y2: s.bt + 4 * sp, class: 'bl' }, gStatic);
        T('𝄞', { x: sp * 0.5, y: s.tt + sp * 3, class: 'clef', 'font-size': sp * 4 }, gStatic);
        T('𝄢', { x: sp * 0.6, y: s.bt + sp * 1, class: 'clef', 'font-size': sp * 4 }, gStatic);
        if (si === 0 && showTime) {
          for (const top of [s.tt, s.bt]) {
            T(bpm, { x: clefW + sp * 1.2, y: top + sp * 1.9, class: 'ts', 'font-size': sp * 2.5, 'text-anchor': 'middle' }, gStatic);
            T(song.time[1], { x: clefW + sp * 1.2, y: top + sp * 3.9, class: 'ts', 'font-size': sp * 2.5, 'text-anchor': 'middle' }, gStatic);
          }
        }
        ya = s.tt; yb = s.bt + 4 * sp;
      } else {
        s.mid = y0 + sp * 8.5;
        E('line', { x1: s.head - sp * 0.4, x2: xEnd, y1: s.mid, y2: s.mid, class: 'midline' }, gStatic);
        if (si === 0 && showTime) {
          T(bpm, { x: sp * 1.9, y: s.mid - sp * 0.5, class: 'ts', 'font-size': sp * 2.5, 'text-anchor': 'middle' }, gStatic);
          T(song.time[1], { x: sp * 1.9, y: s.mid + sp * 2.1, class: 'ts', 'font-size': sp * 2.5, 'text-anchor': 'middle' }, gStatic);
        }
        ya = s.mid - sp * 6.5; yb = s.mid + sp * 6.5;
      }
      for (let k = 1; k <= s.count; k++) {
        const x = s.head + k * s.mW;
        if (s.start + k === nM) {
          E('line', { x1: x - sp * 0.8, x2: x - sp * 0.8, y1: ya, y2: yb, class: 'bl' }, gStatic);
          E('rect', { x: x - sp * 0.45, y: ya, width: sp * 0.45, height: yb - ya, class: 'bl-thick' }, gStatic);
          if (song.repeat) {
            const dots = staff ? [s.tt + 1.5 * sp, s.tt + 2.5 * sp, s.bt + 1.5 * sp, s.bt + 2.5 * sp] : [s.mid - sp, s.mid + sp];
            dots.forEach(y => E('circle', { cx: x - sp * 1.5, cy: y, r: sp * 0.28, class: 'rdot' }, gStatic));
          }
        } else {
          E('line', { x1: x, x2: x, y1: ya, y2: yb, class: 'bl' }, gStatic);
        }
      }
    });

    // --- notes
    const rx = staff ? sp * 0.62 : sp * 0.9, ry = staff ? sp * 0.46 : sp * 0.68;
    const bottomDia = hand => (hand === 'L' ? 18 : 30);
    const staffY = (s, dia, hand) => (hand === 'L' ? s.bt : s.tt) + 4 * sp - (dia - bottomDia(hand)) * sp / 2;
    const preY = (s, midi, hand) => {
      const c = hand === 'L' ? 50 : 64;
      const base = hand === 'L' ? s.mid + sp * 3 : s.mid - sp * 3;
      return base - Math.max(-sp * 1.3, Math.min(sp * 1.3, (midi - c) * sp * 0.3));
    };
    const onLine = (dia, hand) => ((dia - bottomDia(hand)) % 2 + 2) % 2 === 0;

    function ledgers(s, dia, hand, x) {
      const b = bottomDia(hand), top = b + 8;
      const line = d => { const y = staffY(s, d, hand); E('line', { x1: x - rx * 1.7, x2: x + rx * 1.7, y1: y, y2: y, class: 'ledger' }, gStatic); };
      for (let d = b - 2; d >= dia; d -= 2) line(d);
      for (let d = top + 2; d <= dia; d += 2) line(d);
    }

    function rest(g, s, e, x) {
      const top = e.hand === 'L' ? s.bt : s.tt;
      if (e.dur >= 4) E('rect', { x: x - sp * 0.6, y: top + sp, width: sp * 1.2, height: sp * 0.5, class: 'restg' }, g);
      else if (e.dur >= 2) E('rect', { x: x - sp * 0.6, y: top + sp * 1.5, width: sp * 1.2, height: sp * 0.5, class: 'restg' }, g);
      else if (e.dur >= 1) E('path', { d: `M${x - sp * 0.3} ${top + sp * 0.6} l${sp * 0.7} ${sp * 0.9} l${-sp * 0.55} ${sp * 0.7} l${sp * 0.6} ${sp * 0.8} q${-sp * 1} ${-sp * 0.3} ${-sp * 0.2} ${sp * 1}`, class: 'restq' }, g);
      else { E('circle', { cx: x - sp * 0.2, cy: top + sp * 1.6, r: sp * 0.3, class: 'restg' }, g); E('line', { x1: x - sp * 0.1, y1: top + sp * 1.7, x2: x + sp * 0.4, y2: top + sp * 1.5, class: 'stem' }, g); E('line', { x1: x + sp * 0.4, y1: top + sp * 1.5, x2: x - sp * 0.1, y2: top + sp * 3, class: 'stem' }, g); }
    }

    const stemLen = staff ? sp * 3.4 : sp * 2.8;
    song.voices.forEach((v, vi) => {
      const evs = v.events;
      // Beam pairs of eighth notes that share a beat.
      const beams = [];
      for (let i = 0; i < evs.length - 1; i++) {
        const a = evs[i], b = evs[i + 1];
        if (a.dur === 0.5 && b.dur === 0.5 && !a.rest && !b.rest && a.hand === b.hand && Math.abs(a.beat % 1) < 1e-6 && Math.abs(b.beat - a.beat - 0.5) < 1e-6) {
          const all = [...a.pitches, ...b.pitches];
          const up = staff ? all.reduce((t, p) => t + p.dia, 0) / all.length < (a.hand === 'L' ? 22 : 34) : a.hand !== 'L';
          a.beamDir = b.beamDir = up; a.beamed = b.beamed = true;
          beams.push([a, b]);
          i++;
        }
      }
      evs.forEach((e, ei) => {
        const { x, s } = beatX(e.beat);
        const g = E('g', { class: 'note' + (e.rest ? ' rest' : '') }, gNotes);
        glyphs[vi + ':' + ei] = g;
        if (e.rest) { if (staff) rest(g, s, e, x); return; }
        const hand = e.hand;
        const ys = e.pitches.map(p => (staff ? staffY(s, p.dia, hand) : preY(s, p.midi, hand)));
        if (staff) e.pitches.forEach(p => ledgers(s, p.dia, hand, x));
        let up;
        if (e.beamDir !== undefined) up = e.beamDir;
        else if (staff) up = e.pitches.reduce((t, p) => t + p.dia, 0) / e.pitches.length < (hand === 'L' ? 22 : 34);
        else up = hand !== 'L';
        const hollow = e.dur >= 2;
        e.pitches.forEach((p, i) => {
          const y = ys[i];
          E('ellipse', { cx: x, cy: y, rx, ry, transform: `rotate(-18 ${x} ${y})`, class: 'head' + (hollow ? ' hollow' : '') }, g);
          if (p.acc) T(ACC[p.acc], { x: x - rx - sp * 0.8, y: y + sp * 0.55, class: 'acc', 'font-size': sp * 2, 'text-anchor': 'middle' }, g);
          if (e.code.endsWith('.')) {
            const dy = staff && onLine(p.dia, hand) ? -sp / 2 : 0;
            E('circle', { cx: x + rx + sp * 0.6, cy: y + dy, r: sp * (staff ? 0.22 : 0.28), class: 'dot' }, g);
          }
          if (!staff && song.labels === 'letters') {
            T(p.letter + (ACC[p.acc] || ''), { x, y: y + sp * 0.38, class: 'inlbl' + (hollow ? '' : ' onfill'), 'font-size': sp * 1.05, 'text-anchor': 'middle' }, g);
          }
        });
        const yTop = Math.min(...ys), yBot = Math.max(...ys);
        if (e.dur < 4) {
          const sx = up ? x + rx * 0.92 : x - rx * 0.92;
          const y2 = up ? yTop - stemLen : yBot + stemLen;
          e._stemEl = E('line', { x1: sx, x2: sx, y1: up ? yBot : yTop, y2, class: 'stem' }, g);
          e._stem = { x: sx, y: y2, up };
          if (e.dur === 0.5 && !e.beamed) {
            const d = up ? `M${sx} ${y2} q${sp * 0.3} ${sp * 1.4} ${sp * 1.3} ${sp * 1.9} q${sp * 0.6} ${sp * 0.6} ${sp * 0.1} ${sp * 1.5}` : `M${sx} ${y2} q${sp * 0.3} ${-sp * 1.4} ${sp * 1.3} ${-sp * 1.9} q${sp * 0.6} ${-sp * 0.6} ${sp * 0.1} ${-sp * 1.5}`;
            E('path', { d, class: 'flag' }, g);
          }
        }
        if (e.fingers.length) {
          const reach = e.dur < 4 ? stemLen : 0;
          e.fingers.forEach((f, i) => {
            let fy;
            if (hand === 'L') fy = Math.max(yBot + (up ? ry : reach), staff ? s.bt + 4 * sp : 0) + sp * (1.8 + i * 1.5);
            else fy = Math.min(yTop - (up ? reach : ry), staff ? s.tt : 1e9) - sp * (0.8 + i * 1.5);
            T(f, { x, y: fy, class: 'finger', fill: FINGER_COLORS[f] || '#6c6892', 'font-size': sp * 1.45, 'text-anchor': 'middle' }, g);
          });
        }
        if (e.dyn) {
          const dy = staff ? s.tt + sp * 7.6 : s.mid + sp * 0.6;
          T(e.dyn, { x: x - rx * 2.2, y: dy, class: 'dyn', 'font-size': sp * 1.9, 'text-anchor': 'end' }, gStatic);
        }
      });
      for (const [a, b] of beams) {
        if (!a._stem || !b._stem) continue;
        const up = a._stem.up;
        const yb = up ? Math.min(a._stem.y, b._stem.y) : Math.max(a._stem.y, b._stem.y);
        a._stemEl.setAttribute('y2', yb); b._stemEl.setAttribute('y2', yb);
        const th = sp * 0.5 * (up ? 1 : -1);
        E('polygon', { points: `${a._stem.x},${yb} ${b._stem.x},${yb} ${b._stem.x},${yb + th} ${a._stem.x},${yb + th}`, class: 'beam' }, gNotes);
      }
    });

    let curSys = -1;
    const api = {
      height: H,
      setCursor(b) {
        if (b == null) { cursor.setAttribute('opacity', 0); return; }
        const bb = ((b % song.length) + song.length) % song.length;
        const { x, si } = beatX(Math.min(bb, song.length - 1e-3));
        const s = systems[si];
        cursor.setAttribute('x', x - sp * 1.2);
        cursor.setAttribute('y', s.y0);
        cursor.setAttribute('opacity', 1);
        if (si !== curSys) {
          curSys = si;
          if (host.scrollHeight > host.clientHeight + 4) host.scrollTo({ top: Math.max(0, s.y0 - sp), behavior: 'smooth' });
        }
      },
      mark(glyph, cls) {
        const g = glyphs[glyph];
        if (!g) return;
        g.classList.remove('hit', 'miss', 'now');
        if (cls) g.classList.add(cls);
      },
      clearMarks() { Object.values(glyphs).forEach(g => g.classList.remove('hit', 'miss', 'now')); },
      clear() { api.clearMarks(); cursor.setAttribute('opacity', 0); curSys = -1; host.scrollTop = 0; },
    };
    return api;
  }

  return { render };
})();
