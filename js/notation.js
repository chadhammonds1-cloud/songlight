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
    const off = song.offset || 0; // a pickup bar is drawn as a short first measure
    const nM = Math.max(1, Math.ceil((song.length + off) / bpm - 1e-6));
    const wt = m => (m === 0 && off ? Math.max(0.45, (bpm - off) / bpm + 0.2) : 1);
    // left edge of measure m within its system
    const left = (s, m) => { let x = s.head; for (let k = s.start; k < m; k++) x += wt(k) * s.mW; return x; };
    const eighths = song.voices.some(v => v.events.some(e => e.dur < 1));
    const beatW = sp * (eighths ? 5.4 : 4.3);
    const pad = sp * 1.9;
    const mW0 = bpm * beatW + pad * 1.4;
    const showTime = !opts.hideTime;
    const keyAcc = staff ? Music.keyAccidentals(song.keySig || 0) : {};
    const clefW = (staff ? sp * 4.4 : sp * 1) + (staff ? Math.abs(song.keySig || 0) * sp * 1.1 : 0);
    const headFirst = clefW + (showTime ? sp * 2.8 : 0);
    const maxPer = opts.maxPerLine || 4;

    let per = Math.max(1, Math.min(maxPer, Math.floor((W - headFirst - 4) / mW0)));
    const lineCount = Math.ceil(nM / per);
    per = Math.ceil(nM / lineCount);
    const systems = [];
    for (let s = 0, m = 0; m < nM; s++) {
      const count = Math.min(per, nM - m);
      const head = s ? clefW : headFirst;
      // A pickup bar is narrower: it only holds a beat or two.
      const units = per - (m === 0 ? 1 - wt(0) : 0);
      systems.push({ start: m, count, head, mW: Math.min((W - head - 4) / units, mW0 * 1.8 * per / units) });
      m += count;
    }
    const sysH = staff ? sp * 25 : sp * 17;
    const H = systems.length * sysH + sp;
    const svg = E('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'score-svg ' + (staff ? 'is-staff' : 'is-prestaff') }, host);
    const gStatic = E('g', {}, svg);
    const cursor = E('rect', { class: 'cursor', x: 0, y: 0, width: sp * 2.4, height: sysH - sp * 0.6, rx: sp * 0.8, opacity: 0 }, svg);
    const gNotes = E('g', {}, svg);
    const glyphs = {};

    const sysIndex = m => systems.findIndex(s => m >= s.start && m < s.start + s.count);
    function beatX(b) {
      const bb = b + off;
      const m = Math.min(nM - 1, Math.floor(bb / bpm + 1e-6));
      const si = sysIndex(m), s = systems[si];
      const x0 = left(s, m);
      if (m === 0 && off) return { x: x0 + pad + b * ((wt(0) * s.mW - pad * 1.6) / (bpm - off)), si, s };
      return { x: x0 + pad + (bb - m * bpm) * ((s.mW - pad * 1.6) / bpm), si, s };
    }

    // --- staves, clefs, bar lines
    systems.forEach((s, si) => {
      const y0 = si * sysH + sp * 0.5;
      s.y0 = y0;
      const xEnd = left(s, s.start + s.count);
      let ya, yb;
      if (staff) {
        s.tt = y0 + sp * 4.5; s.bt = s.tt + sp * 10;
        for (const top of [s.tt, s.bt]) for (let i = 0; i < 5; i++) E('line', { x1: 2, x2: xEnd, y1: top + i * sp, y2: top + i * sp, class: 'sl' }, gStatic);
        E('line', { x1: 2, x2: 2, y1: s.tt, y2: s.bt + 4 * sp, class: 'bl' }, gStatic);
        T('𝄞', { x: sp * 0.5, y: s.tt + sp * 3, class: 'clef', 'font-size': sp * 4 }, gStatic);
        T('𝄢', { x: sp * 0.6, y: s.bt + sp * 1, class: 'clef', 'font-size': sp * 4 }, gStatic);
        // key signature: sharps F C G D A E B, flats B E A D G C F, at their usual heights
        const ks = song.keySig || 0;
        const SHARP_T = [38, 35, 39, 36, 33, 37, 34], FLAT_T = [34, 37, 33, 36, 32, 35, 31];
        for (let i = 0; i < Math.abs(ks); i++) {
          const dT = (ks > 0 ? SHARP_T : FLAT_T)[i];
          [[s.tt, dT, 30], [s.bt, dT - 14, 18]].forEach(([top, dia, bottom]) => {
            const y = top + 4 * sp - (dia - bottom) * sp / 2;
            T(ks > 0 ? '♯' : '♭', { x: sp * 4.6 + i * sp * 1.1, y: y + sp * 0.6, class: 'acc keysig', 'font-size': sp * 2.1, 'text-anchor': 'middle' }, gStatic);
          });
        }
        if (si === 0 && showTime) {
          for (const top of [s.tt, s.bt]) {
            T(song.time[0], { x: clefW + sp * 1.2, y: top + sp * 1.9, class: 'ts', 'font-size': sp * 2.5, 'text-anchor': 'middle' }, gStatic);
            T(song.time[1], { x: clefW + sp * 1.2, y: top + sp * 3.9, class: 'ts', 'font-size': sp * 2.5, 'text-anchor': 'middle' }, gStatic);
          }
        }
        ya = s.tt; yb = s.bt + 4 * sp;
      } else {
        s.mid = y0 + sp * 8.5;
        E('line', { x1: s.head - sp * 0.4, x2: xEnd, y1: s.mid, y2: s.mid, class: 'midline' }, gStatic);
        if (si === 0 && showTime) {
          T(song.time[0], { x: sp * 1.9, y: s.mid - sp * 0.5, class: 'ts', 'font-size': sp * 2.5, 'text-anchor': 'middle' }, gStatic);
          T(song.time[1], { x: sp * 1.9, y: s.mid + sp * 2.1, class: 'ts', 'font-size': sp * 2.5, 'text-anchor': 'middle' }, gStatic);
        }
        ya = s.mid - sp * 6.5; yb = s.mid + sp * 6.5;
      }
      for (let k = 1; k <= s.count; k++) {
        const x = left(s, s.start + k);
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
      // Beam short notes that share a beat (a dotted-quarter pulse in 6/8), triplets in threes.
      const beams = [];
      const unit = song.beamUnit || 1;
      for (let i = 0; i < evs.length; i++) {
        const a = evs[i];
        if (a.rest || a.dur >= 1) continue;
        const cell = Math.floor((a.beat + (song.offset || 0)) / unit + 1e-6);
        const grp = [a];
        for (let j = i + 1; j < evs.length; j++) {
          const b = evs[j];
          if (b.rest || b.dur >= 1 || b.hand !== a.hand || Math.floor((b.beat + (song.offset || 0)) / unit + 1e-6) !== cell) break;
          grp.push(b);
        }
        if (grp.length < 2) continue;
        const all = grp.flatMap(e => e.pitches);
        const up = staff ? all.reduce((t, p) => t + p.dia, 0) / all.length < (a.hand === 'L' ? 22 : 34) : a.hand !== 'L';
        grp.forEach(e => { e.beamDir = up; e.beamed = true; });
        beams.push(grp);
        i += grp.length - 1;
      }
      evs.forEach((e, ei) => {
        const { x, s, si } = beatX(e.beat);
        e._x = x; e._s = s; e._si = si;
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
        e._ys = ys; e._up = up;
        const hollow = e.dur >= 2;
        // Notes a step apart in a chord can't share a spot: one moves to the other side of the stem.
        const dx = e.pitches.map(() => 0);
        if (staff && e.pitches.length > 1) {
          const order = e.pitches.map((p, i) => i).sort((a, b) => e.pitches[a].dia - e.pitches[b].dia);
          for (let k = 1; k < order.length; k++) {
            const lo = order[k - 1], hi = order[k];
            if (e.pitches[hi].dia - e.pitches[lo].dia === 1 && !dx[lo] && !dx[hi]) {
              if (up || e.dur >= 4) dx[hi] = rx * 1.84; else dx[lo] = -rx * 1.84;
            }
          }
        }
        e.pitches.forEach((p, i) => {
          const y = ys[i], x = e._x + dx[i];
          E('ellipse', { cx: x, cy: y, rx, ry, transform: `rotate(-18 ${x} ${y})`, class: 'head' + (hollow ? ' hollow' : '') }, g);
          const want = keyAcc[p.letter] || '';
          if (staff ? p.acc !== want : p.acc) T(p.acc ? ACC[p.acc] : '♮', { x: x - rx - sp * 0.8, y: y + sp * 0.55, class: 'acc', 'font-size': sp * 2, 'text-anchor': 'middle' }, g);
          if (e.code.endsWith('.')) {
            const dy = staff && onLine(p.dia, hand) ? -sp / 2 : 0;
            E('circle', { cx: x + rx + sp * 0.6, cy: y + dy, r: sp * (staff ? 0.22 : 0.28), class: 'dot' }, g);
          }
          if (!staff && song.labels === 'letters') {
            T(p.letter + (ACC[p.acc] || ''), { x, y: y + sp * 0.38, class: 'inlbl' + (hollow ? '' : ' onfill'), 'font-size': sp * 1.05, 'text-anchor': 'middle' }, g);
          }
        });
        const yTop = Math.min(...ys), yBot = Math.max(...ys);
        if (e.stacc) {
          const below = up && e.dur < 4;
          E('circle', { cx: x, cy: below ? yBot + sp * 1.25 : yTop - sp * 1.25, r: sp * 0.26, class: 'dot stacc' }, g);
        }
        if (e.dur < 4) {
          const sx = up ? x + rx * 0.92 : x - rx * 0.92;
          const y2 = up ? yTop - stemLen : yBot + stemLen;
          e._stemEl = E('line', { x1: sx, x2: sx, y1: up ? yBot : yTop, y2, class: 'stem' }, g);
          e._stem = { x: sx, y: y2, up };
          if (e.dur < 1 && !e.beamed) {
            // one flag for an eighth, two for a sixteenth
            for (let f = 0; f < (e.dur <= 0.25 + 1e-6 ? 2 : 1); f++) {
              const fy = y2 + (up ? 1 : -1) * f * sp * 1.1;
              const d = up ? `M${sx} ${fy} q${sp * 0.3} ${sp * 1.4} ${sp * 1.3} ${sp * 1.9} q${sp * 0.6} ${sp * 0.6} ${sp * 0.1} ${sp * 1.5}` : `M${sx} ${fy} q${sp * 0.3} ${-sp * 1.4} ${sp * 1.3} ${-sp * 1.9} q${sp * 0.6} ${-sp * 0.6} ${sp * 0.1} ${-sp * 1.5}`;
              E('path', { d, class: 'flag' }, g);
            }
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
        if (e.trill) {
          const above = Math.min(yTop - (up && e.dur < 4 ? stemLen : ry), staff ? s.tt : 1e9) - sp * (0.9 + (hand === 'L' ? 0 : e.fingers.length) * 1.5);
          T('tr', { x: x + sp * 0.2, y: above, class: 'trill', 'font-size': sp * 1.7, 'text-anchor': 'middle' }, g);
        }
        if (e.dyn) {
          const dy = staff ? s.tt + sp * 7.6 : s.mid + sp * 0.6;
          T(e.dyn, { x: x - rx * 2.2, y: dy, class: 'dyn', 'font-size': sp * 1.9, 'text-anchor': 'end' }, gStatic);
        }
      });
      for (const grp of beams) {
        if (grp.some(e => !e._stem)) continue;
        const a = grp[0], b = grp[grp.length - 1], up = a._stem.up;
        const yb = up ? Math.min(...grp.map(e => e._stem.y)) : Math.max(...grp.map(e => e._stem.y));
        grp.forEach(e => e._stemEl.setAttribute('y2', yb));
        const th = sp * 0.5 * (up ? 1 : -1);
        const bar = (x1, x2, y) => E('polygon', { points: `${x1},${y} ${x2},${y} ${x2},${y + th} ${x1},${y + th}`, class: 'beam' }, gNotes);
        bar(a._stem.x, b._stem.x, yb);
        // Sixteenths get a second beam: joined between neighbours, a short stub when alone.
        const y16 = yb + th * 1.7, is16 = e => e.dur <= 0.25 + 1e-6;
        grp.forEach((e, k) => {
          if (!is16(e)) return;
          const nx = grp[k + 1], pv = grp[k - 1];
          if (nx && is16(nx)) bar(e._stem.x, nx._stem.x, y16);
          else if (!(pv && is16(pv))) {
            const toward = nx ? 1 : -1, len = Math.min(sp * 1.3, Math.abs((nx || pv)._stem.x - e._stem.x) / 2);
            bar(e._stem.x, e._stem.x + toward * len, y16);
          }
        });
        // The triplet 3 goes on the notehead side, clear of the finger numbers above the beam.
        if (grp.some(e => e.code === 't')) {
          const heads = grp.flatMap(e => e._ys);
          const y = up ? Math.max(...heads) + sp * 2.3 : Math.min(...heads) - sp * 1.3;
          T('3', { x: (a._x + b._x) / 2, y, class: 'tuplet', 'font-size': sp * 1.4, 'text-anchor': 'middle' }, gNotes);
        }
      }
      curves(evs);
    });

    // A curved line from (x1,y) to (x2,y) bowing by `bow` (negative = upward).
    function arc(x1, y1, x2, y2, bow, cls) {
      const w = Math.max(sp * 0.9, x2 - x1), k = Math.min(sp * 1.4, w * 0.35);
      E('path', { d: `M${x1} ${y1} C${x1 + k} ${y1 + bow} ${x1 + w - k} ${y2 + bow} ${x1 + w} ${y2} C${x1 + w - k} ${y2 + bow * 0.72} ${x1 + k} ${y1 + bow * 0.72} ${x1} ${y1}Z`, class: cls }, gStatic);
    }
    function sysEnd(s) { return left(s, s.start + s.count) - sp * 0.6; }
    function sysStart(s) { return s.head + sp * 0.4; }
    // Split a span across line breaks: calls fn(x1, x2, s, isFirst, isLast) once per system.
    function span(a, b, fn) {
      for (let si = a._si; si <= b._si; si++) {
        const s = systems[si];
        fn(si === a._si ? a._x : sysStart(s), si === b._si ? b._x : sysEnd(s), s, si === a._si, si === b._si);
      }
    }
    function dynY(s) { return staff ? s.tt + sp * 7.6 : s.mid + sp * 0.6; }

    function curves(evs) {
      evs.forEach((e, i) => {
        if (e.rest || e._x === undefined) return;
        // ties: same pitch in the next event
        const nx = evs[i + 1];
        if (e.tie && nx && !nx.rest) {
          e.pitches.forEach((p, pi) => {
            const qi = nx.pitches.findIndex(q => q.midi === p.midi);
            if (qi < 0) return;
            const down = e._up && e.dur < 4, bow = (down ? 1 : -1) * sp * 1.1, off = (down ? 1 : -1) * ry * 1.4;
            span(e, nx, (x1, x2, s, first, last) => arc(first ? x1 + rx : x1, (first ? e._ys[pi] : nx._ys[qi]) + off, last ? x2 - rx : x2, (last ? nx._ys[qi] : e._ys[pi]) + off, bow, 'tie'));
          });
        }
        // slurs: from '(' to the next ')' in this voice
        if (e.slur === 'start') {
          let j = i + 1;
          while (j < evs.length && evs[j].slur !== 'end') j++;
          const end = evs[Math.min(j, evs.length - 1)];
          const inside = evs.slice(i, j + 1).filter(x => !x.rest && x._ys);
          const above = e.hand !== 'L';
          span(e, end, (x1, x2, s) => {
            const here = inside.filter(x => x._s === s);
            const edge = above
              ? Math.min(...here.map(x => Math.min(...x._ys) - (x._up && x.dur < 4 ? stemLen : 0))) - sp * 0.9
              : Math.max(...here.map(x => Math.max(...x._ys) + (!x._up && x.dur < 4 ? stemLen : 0))) + sp * 0.9;
            arc(x1, edge, x2, edge, (above ? -1 : 1) * sp * 1.3, 'slur');
          });
        }
        // hairpins: from '<' or '>' to the next '/'
        if (e.hairpin === 'cresc' || e.hairpin === 'dim') {
          let j = i + 1;
          while (j < evs.length && evs[j].hairpin !== 'end') j++;
          const end = evs[Math.min(j, evs.length - 1)];
          const open = sp * 0.75, cresc = e.hairpin === 'cresc';
          span(e, end, (x1, x2, s, first, last) => {
            const a = x1, b = last ? x2 - (end.dyn ? rx * 4.2 : 0) : x2;
            const y = dynY(s) - sp * 0.6;
            const w0 = cresc ? (first ? 0 : open * 0.5) : open, w1 = cresc ? open : (last ? 0 : open * 0.5);
            E('path', { d: `M${b} ${y - w1} L${a} ${y - w0} M${a} ${y + w0} L${b} ${y + w1}`, class: 'hairpin' }, gStatic);
          });
        }
      });
    }

    // Pedal marks: a bracket under the bass staff, notched where the pedal changes.
    (song.pedals || []).forEach(([a, b]) => {
      if (a >= song.length) return;
      const A = beatX(a), B = beatX(Math.min(b, song.length) - 1e-3);
      for (let si = A.si; si <= B.si; si++) {
        const s = systems[si];
        const y = staff ? s.bt + sp * 7.2 : s.mid + sp * 7.4;
        const x1 = si === A.si ? A.x - rx : sysStart(s), x2 = si === B.si ? (b >= song.length ? sysEnd(s) : beatX(b).x - rx * 1.6) : sysEnd(s);
        const d = `M${x1} ${y - sp * (si === A.si ? 1.2 : 0)} L${x1} ${y} L${x2} ${y}` + (si === B.si ? ` L${x2} ${y - sp * 1.2}` : '');
        E('path', { d, class: 'pedal' }, gStatic);
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
