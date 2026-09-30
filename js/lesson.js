'use strict';
// The lesson overlay: Learn (Lumo's explanations + theory tasks) → Practice → Perform ×3.
const LessonUI = (() => {
  let root, body, piano, lesson, song, perf, score, scoreHost, reward, opts;
  let offs = [], timers = [], extra = [], resizeT;
  const $ = (sel, el = root) => el.querySelector(sel);
  const STRICT = {
    gentle: { acc: 0.8, wrong: 4, win: 1.3 },
    standard: { acc: 0.9, wrong: 2, win: 1 },
    strict: { acc: 1, wrong: 0, win: 0.85 },
  };
  const PRAISE = ['Wonderful!', 'You got it!', 'Brilliant!', 'Yes!', 'Great ears!', 'Nice one!'];
  const praise = () => PRAISE[Math.floor(Math.random() * PRAISE.length)];
  const pips = (n, k) => Array.from({ length: n }, (_, i) => `<span class="pip${i < k ? ' on' : ''}"></span>`).join('');
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

  function init() {
    root = document.getElementById('lesson');
    body = $('.l-body');
    piano = new Piano($('#lesson-piano'));
    $('.l-close').onclick = () => close();
    window.addEventListener('keydown', e => { if (!root.hidden && e.key === 'Escape') close(); });
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => { if (!root.hidden && scoreHost && perf && !perf.active) renderScore(); }, 200);
    });
  }

  function cleanup() {
    offs.forEach(f => f()); offs = [];
    timers.forEach(clearTimeout); timers = [];
    extra.forEach(p => p.stop()); extra = [];
    perf?.stop(); perf = null; score = null; scoreHost = null;
    reward?.destroy(); reward = null;
    piano.clearHints(); piano.clearGlow(); piano.setLit(new Set());
  }
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const listen = (type, fn) => offs.push(Input.on(type, fn));
  function onKey(fn) { window.addEventListener('keydown', fn); offs.push(() => window.removeEventListener('keydown', fn)); }

  function open(ls, o = {}) {
    lesson = ls; opts = o; song = Music.compile(ls.song);
    root.hidden = false;
    $('.eyebrow').textContent = `${o.realmName} · ${ls.concept}`;
    $('.l-title').textContent = ls.title;
    piano.setOptions({ letters: Save.data.settings.letters, computer: Save.data.settings.computer });
    piano.setRange(Math.min(48, song.lo - Music.pc(song.lo)), Math.max(84, song.hi + 2));
    if (o.replay || Save.data.teach[ls.id]) showPractice(); else showTeach(0);
  }

  function close(result) {
    cleanup();
    root.hidden = true;
    const cb = opts?.onClose;
    opts = null;
    cb?.(result || {});
  }

  function stage(name) {
    root.querySelectorAll('.l-steps [data-s]').forEach(s => s.classList.toggle('on', s.dataset.s === name));
  }

  // ---------------------------------------------------------------- Learn
  function showTeach(i) {
    cleanup();
    stage('learn');
    const steps = lesson.teach, st = steps[i];
    body.innerHTML = `
      <div class="teach">
        <div class="say-row"><div class="orb" aria-hidden="true"></div><p class="say">${st.say || st.q || ''}</p></div>
        <div class="widget"></div>
        <div class="teach-nav">
          <button class="btn ghost prev" ${i ? '' : 'hidden'}>Back</button>
          <div class="dots" aria-label="Step ${i + 1} of ${steps.length}">${steps.map((_, k) => `<span class="${k < i ? 'd-done' : k === i ? 'd-now' : ''}"></span>`).join('')}</div>
          <button class="btn primary next">${i + 1 < steps.length ? 'Next' : 'Learn the song →'}</button>
        </div>
      </div>`;
    const w = $('.widget', body), next = $('.next', body);
    next.onclick = () => {
      if (i + 1 < steps.length) showTeach(i + 1);
      else { Save.data.teach[lesson.id] = true; Save.save(); showPractice(); }
    };
    $('.prev', body).onclick = () => showTeach(i - 1);
    if (st.show) renderShow(st.show, w);
    if (st.task) {
      next.disabled = true;
      TASKS[st.task](st, w, () => { next.disabled = false; next.classList.add('ready'); Sound.chime('up'); });
    }
  }

  const add = (w, html) => { w.insertAdjacentHTML('beforeend', html); return w.lastElementChild; };
  const feedback = w => { let f = $('.feedback', w); if (!f) f = add(w, '<p class="feedback" aria-live="polite"></p>'); return t => { f.innerHTML = t; }; };

  // [glyph, name, length, count-along, beats, the notes it plays]
  const VALUES = {
    q: ['♩', 'Quarter note', '1 beat', 'ta', 1],
    h: ['𝅗𝅥', 'Half note', '2 beats', 'ta – a', 2],
    'h.': ['𝅗𝅥.', 'Dotted half note', '3 beats', 'ta – a – a', 3],
    w: ['𝅝', 'Whole note', '4 beats', 'ta – a – a – a', 4],
    e: ['♪', 'Eighth note', '½ beat', 'ti', 1, [0.5]],
    ee: ['♫', 'Two eighth notes', '1 beat together', 'ti – ti', 1, [0.5, 0.5]],
    tie: ['𝅗𝅥‿♩', 'Tied notes', '2 + 1 = 3 beats', 'ta – a – a', 3, [3]],
    'q.': ['♩.', 'Dotted quarter note', '1½ beats', 'ta – a – (ti)', 2, [1.5]],
    'q.e': ['♩. ♪', 'Dotted quarter + eighth', '2 beats together', 'ta – a – ti', 2, [1.5, 0.5]],
    s: ['𝅘𝅥𝅯', 'Sixteenth note', '¼ beat', 'ti', 1, [0.25]],
    ssss: ['♬♬', 'Four sixteenth notes', '1 beat together', '1 – e – and – a', 1, [0.25, 0.25, 0.25, 0.25]],
    trip: ['♪♪♪³', 'Eighth-note triplet', '3 notes in 1 beat', 'tri – po – let', 1, [1 / 3, 1 / 3, 1 / 3]],
  };

  function renderShow(sh, w) {
    switch (sh.type) {
      case 'hands': add(w, handsSVG()); break;
      case 'lowhigh': {
        piano.glow(range(piano.lo, piano.lo + 11), 'glow2');
        piano.glow(range(piano.hi - 11, piano.hi), 'glow3');
        const el = add(w, `<div class="lowhigh"><button class="chip-btn low">◀ Hear low</button><button class="chip-btn high">Hear high ▶</button></div>`);
        const t = () => Sound.init().currentTime + 0.02;
        $('.low', el).onclick = () => { Sound.play(40, t(), 0.9, 0.8); Sound.play(43, t() + 0.35, 0.9, 0.8); };
        $('.high', el).onclick = () => { Sound.play(84, t(), 0.5, 0.7); Sound.play(88, t() + 0.2, 0.5, 0.7); };
        break;
      }
      case 'keys': {
        const list = sh.keys.map((k, j) => ({ midi: Music.midi(k), finger: sh.fingers?.[j], hand: sh.hands?.[j] || 'R' }));
        if (sh.fingers) piano.hint(list); else piano.glow(list.map(n => n.midi));
        add(w, `<p class="look">Look at the glowing keys below ↓ Try playing them!</p>`);
        break;
      }
      case 'groups': {
        const ms = range(piano.lo, piano.hi);
        piano.glow(ms.filter(m => [1, 3].includes(Music.pc(m))), 'glow2');
        piano.glow(ms.filter(m => [6, 8, 10].includes(Music.pc(m))), 'glow3');
        add(w, `<div class="legend"><span class="lg lg2">groups of two</span><span class="lg lg3">groups of three</span></div>`);
        break;
      }
      case 'letters':
        piano.glow(range(60, 71).filter(m => !Music.isBlack(m)));
        add(w, `<div class="alphabet">${'ABCDEFG'.split('').map(l => `<span>${l}</span>`).join('')}<span class="again">A…</span></div>`);
        break;
      case 'values': {
        const el = add(w, `<div class="values">${sh.values.map(v => `<button class="value" data-v="${v}"><span class="glyph">${VALUES[v][0]}</span><b>${VALUES[v][1]}</b><span>${VALUES[v][2]}</span><em>“${VALUES[v][3]}”</em></button>`).join('')}</div>`);
        el.querySelectorAll('.value').forEach(b => b.onclick = () => {
          const [, , , , beats, pat = [beats]] = VALUES[b.dataset.v], spb = 0.7, t = Sound.init().currentTime + 0.05;
          pat.reduce((at, d) => { Sound.play(72, t + at * spb, d * spb * 0.9, 0.6); return at + d; }, 0);
          for (let k = 0; k < beats; k++) Sound.click(t + k * spb, k === 0);
          b.classList.remove('playing'); void b.offsetWidth; b.classList.add('playing');
        });
        break;
      }
      case 'timesig':
        add(w, `<div class="timesig"><div class="ts-num"><span>${sh.top}</span><span>${sh.bottom}</span></div><div class="ts-key">${(sh.lines || [`<b>${sh.top}</b> beats in every measure`, 'a <b>quarter note</b> ♩ gets one beat']).map(l => `<p>${l}</p>`).join('')}</div></div>`);
        break;
      case 'score': {
        const el = add(w, `<div class="snippet"><div class="score mini"></div>${sh.play ? '<button class="chip-btn play">▶ Listen</button>' : ''}</div>`);
        const s = Music.compile(sh.song);
        const sc = Notation.render($('.score', el), s, { maxPerLine: 4 });
        if (sh.play) {
          const p = new Performer({ song: s, piano, score: sc });
          extra.push(p);
          $('.play', el).onclick = () => p.listen();
        }
        break;
      }
    }
  }

  function handsSVG() {
    const fingers = [[2, 46, 22], [3, 76, 10], [4, 106, 20], [5, 134, 42]];
    const hand = (mirror, label) => {
      const X = x => (mirror ? 180 - x : x);
      const shapes = `<g transform="${mirror ? 'translate(180 0) scale(-1 1)' : ''}">
        <rect x="28" y="88" width="122" height="92" rx="34" class="palm"/>
        ${fingers.map(([, cx, top]) => `<rect x="${cx - 12}" y="${top}" width="24" height="${108 - top}" rx="12" class="palm"/>`).join('')}
        <rect x="22" y="94" width="24" height="64" rx="12" class="palm" transform="rotate(-42 34 156)"/></g>`;
      const labels = [[1, 12, 118], ...fingers.map(([n, cx, top]) => [n, cx, top + 16])]
        .map(([n, x, y]) => `<circle cx="${X(x)}" cy="${y}" r="12" fill="${FINGER_COLORS[n]}"/><text x="${X(x)}" y="${y + 5}" text-anchor="middle" class="fnum">${n}</text>`).join('');
      return `<figure><svg viewBox="-12 0 204 190" role="img" aria-label="${label} with finger numbers">${shapes}${labels}</svg><figcaption>${label}</figcaption></figure>`;
    };
    return `<div class="hands">${hand(true, 'Left hand')}${hand(false, 'Right hand')}</div>`;
  }

  // Tasks call done() once the player has shown they understand.
  const TASKS = {
    quiz(st, w, done) {
      const el = add(w, `<div class="choices">${st.options.map((o, k) => `<button class="choice" data-k="${k}">${o}</button>`).join('')}</div>`);
      const fb = feedback(w);
      el.querySelectorAll('.choice').forEach(b => b.onclick = () => {
        if (+b.dataset.k === st.answer) {
          b.classList.add('right');
          el.querySelectorAll('.choice').forEach(x => { x.disabled = true; });
          fb(praise()); done();
        } else {
          b.classList.add('wrong'); b.disabled = true;
          fb('Not quite. Try another!'); Sound.chime('no');
        }
      });
    },

    highlow(st, w, done) {
      let round = 0, a = 0, b = 0, busy = false;
      const el = add(w, `<div class="hl"><button class="chip-btn again">▶ Hear the two notes</button>
        <div class="choices"><button class="choice" data-v="up">Higher ↑</button><button class="choice" data-v="down">Lower ↓</button></div>
        <div class="pips big">${pips(st.rounds, 0)}</div></div>`);
      const fb = feedback(w);
      const play = () => { const t = Sound.init().currentTime + 0.1; Sound.play(a, t, 0.55, 0.7); Sound.play(b, t + 0.8, 0.7, 0.7); };
      const fresh = () => { a = 52 + Math.floor(Math.random() * 16); do { b = 45 + Math.floor(Math.random() * 34); } while (Math.abs(b - a) < 5); busy = false; play(); };
      $('.again', el).onclick = play;
      el.querySelectorAll('.choice').forEach(btn => btn.onclick = () => {
        if (busy || round >= st.rounds) return;
        if ((b > a ? 'up' : 'down') === btn.dataset.v) {
          round++; busy = true;
          $('.pips', el).innerHTML = pips(st.rounds, round);
          if (round >= st.rounds) { fb('Great ears!'); done(); }
          else { fb(praise() + ' Here comes another…'); later(fresh, 1100); }
        } else { fb('Listen again…'); Sound.chime('no'); later(play, 500); }
      });
      later(fresh, 300);
    },

    range(st, w, done) {
      let n = 0;
      const el = add(w, `<div class="pips big">${pips(st.count, 0)}</div>`);
      const fb = feedback(w);
      listen('down', m => {
        if (n >= st.count) return;
        const ok = st.dir === 'low' ? m < 57 : m > 66;
        if (ok) {
          n++; piano.flash(m, 'good'); el.innerHTML = pips(st.count, n);
          if (n >= st.count) { fb(st.dir === 'low' ? 'Deep as a bear!' : 'Tiny as a bird!'); done(); }
        } else {
          piano.flash(m, 'bad');
          fb(st.dir === 'low' ? 'That one is too high. Go further <b>left</b>!' : 'That one is too low. Go further <b>right</b>!');
        }
      });
    },

    tap(st, w, done) {
      const targets = st.targets.map(Music.midi), found = new Set();
      let idx = 0;
      const el = add(w, `<div class="targets">${targets.map(m => `<span class="tchip">${Music.letterOf(m)}</span>`).join('')}</div>`);
      const chips = el.querySelectorAll('.tchip');
      const fb = feedback(w);
      const hintNext = () => { if (st.hint) piano.hint([{ midi: targets[idx], finger: st.fingers?.[idx], hand: st.hand || 'R' }]); };
      if (st.order) hintNext();
      listen('down', m => {
        if (found.size === targets.length) return;
        if (st.order) {
          if (m === targets[idx]) {
            found.add(m); chips[idx].classList.add('got'); piano.flash(m, 'good'); piano.unhint(m); piano.glow([m], 'found');
            idx++;
            if (idx === targets.length) { fb(praise()); done(); } else hintNext();
          } else { piano.flash(m, 'bad'); fb(st.hint ? 'Try the glowing key.' : `Next is <b>${Music.letterOf(targets[idx])}</b>.`); }
          return;
        }
        const k = targets.indexOf(m);
        if (k >= 0 && !found.has(m)) {
          found.add(m); chips[k].classList.add('got'); piano.glow([m], 'found'); piano.flash(m, 'good');
          if (found.size === targets.length) { fb(praise() + ' You found them all.'); done(); } else fb(`${found.size} of ${targets.length}…`);
        } else if (k < 0) { piano.flash(m, 'bad'); fb(`That's <b>${Music.letterOf(m)}</b>. Keep looking!`); }
      });
    },

    rhythm(st, w, done) {
      const toks = st.rhythm.split(/\s+/).filter(t => t && t !== '|');
      // tokens: q, h., e… ; "q~" ties into the next ; "rq" is a quarter rest (shown on a staff)
      const tok = d => (d[0] === 'r' ? `r:${d.slice(1)}` : d.endsWith('~') ? `E4:${d.slice(0, -1)}::~` : 'E4:' + d);
      const rs = Music.compile({ time: st.time, tempo: st.tempo, notation: toks.some(d => d[0] === 'r') ? 'staff' : 'prestaff', voices: [{ hand: 'R', notes: toks.map(tok).join(' ') }] });
      const el = add(w, `<div class="rhythm"><div class="score mini"></div><div class="countin" aria-live="polite"></div>
        <div class="rh-row"><button class="btn primary go">▶ Start</button><button class="pad" aria-label="Tap the beat">TAP</button></div>
        <p class="small">Tap the pad, press <kbd>Space</kbd>, or play any key.</p></div>`);
      const sc = Notation.render($('.score', el), rs, { maxPerLine: 4 });
      const p = new Performer({ song: rs, piano: null, score: sc });
      extra.push(p);
      const fb = feedback(w), cnt = $('.countin', el), go = $('.go', el);
      const tap = () => { Input.down(84, 0.5, 'tap'); setTimeout(() => Input.up(84, 'tap'), 90); };
      $('.pad', el).onpointerdown = e => { e.preventDefault(); tap(); };
      onKey(e => { if (e.key === ' ' && !e.repeat) { e.preventDefault(); tap(); } });
      go.onclick = () => {
        go.disabled = true; fb('');
        p.timed({
          anyKey: true, metronome: true,
          onCount: c => { cnt.textContent = c || ''; cnt.classList.toggle('on', !!c); },
          onEnd: r => {
            go.disabled = false; go.textContent = '↻ Again';
            if (r.hits / r.total >= 0.8 && r.wrong <= 2) { fb('Right on the beat! ' + praise()); done(); }
            else fb(`You caught <b>${r.hits} of ${r.total}</b> beats${r.wrong ? ` (and ${r.wrong} extra tap${r.wrong > 1 ? 's' : ''})` : ''}. Try again!`);
          },
        });
      };
    },

    read(st, w, done) {
      let k = 0;
      const el = add(w, `<div class="read"><div class="score mini read-score"></div><div class="pips big">${pips(st.notes.length, 0)}</div></div>`);
      const host = $('.read-score', el), fb = feedback(w);
      const show = () => {
        const [p, hand] = st.notes[k];
        Notation.render(host, Music.compile({ time: [4, 4], key: st.key, notation: 'staff', voices: [{ hand, notes: p + ':w' }] }), { hideTime: true, maxPerLine: 1, width: 260, sp: 11 });
      };
      listen('down', m => {
        if (k >= st.notes.length) return;
        if (m === Music.midi(st.notes[k][0])) {
          piano.flash(m, 'good'); k++;
          $('.pips', el).innerHTML = pips(st.notes.length, k);
          if (k >= st.notes.length) { fb('You read them all!'); done(); } else { fb(praise()); later(show, 300); }
        } else { piano.flash(m, 'bad'); fb(`That's <b>${Music.letterOf(m)}</b>. Look again: is the note on a line or in a space?`); }
      });
      show();
    },

    together(st, w, done) {
      const ms = st.notes.map(Music.midi), times = {};
      let n = 0;
      piano.hint(ms.map((m, i) => ({ midi: m, finger: st.fingers?.[i], hand: st.hands?.[i] || (m < 60 ? 'L' : 'R') })));
      const el = add(w, `<div class="pips big">${pips(st.count, 0)}</div>`);
      const fb = feedback(w);
      listen('down', m => {
        if (n >= st.count) return;
        if (!ms.includes(m)) { piano.flash(m, 'bad'); return; }
        times[m] = performance.now();
        const now = performance.now();
        if (ms.every(x => Input.isHeld(x) || now - (times[x] || 0) < 350)) {
          ms.forEach(x => { times[x] = 0; piano.flash(x, 'good'); });
          n++; el.innerHTML = pips(st.count, n);
          if (n >= st.count) { fb((st.praise || 'Both hands, together!') + ' ' + praise()); done(); } else fb('Again!');
        }
      });
    },

    // Legato: each key is still down (or only just up) when the next is pressed. Staccato: short, bouncy presses.
    touch(st, w, done) {
      const targets = st.notes.map(Music.midi);
      const rounds = st.rounds || ['legato', 'staccato'];
      let r = 0, idx = 0, lastUp = 0, downAt = {};
      const el = add(w, `<div class="dyn-row">${rounds.map(t => `<span class="dchip" data-t="${t}">${t === 'legato' ? '⌒ legato' : '• staccato'}</span>`).join('')}</div>
        <div class="targets">${targets.map(m => `<span class="tchip">${Music.letterOf(m)}</span>`).join('')}</div>`);
      const fb = feedback(w), chips = el.querySelectorAll('.tchip');
      const hintNext = () => piano.hint([{ midi: targets[idx], finger: st.fingers?.[idx], hand: 'R' }]);
      const restart = msg => { idx = 0; chips.forEach(c => c.classList.remove('got')); piano.clearHints(); hintNext(); fb(msg); };
      const say = () => fb(rounds[r] === 'legato'
        ? '<b>Legato</b>: smooth and connected. Keep each key down until the next one is pressed.'
        : '<b>Staccato</b>: short and bouncy. Let each key spring right back up.');
      const finish = () => {
        $(`[data-t="${rounds[r]}"]`, w).classList.add('got');
        r++; idx = 0; downAt = {};
        if (r >= rounds.length) { piano.clearHints(); fb(praise() + ' You can play smooth <i>and</i> bouncy.'); done(); return; }
        Sound.chime('soft'); fb(praise() + ' Smooth as water.');
        later(() => { chips.forEach(c => c.classList.remove('got')); hintNext(); say(); }, 900);
      };
      listen('down', m => {
        if (r >= rounds.length || idx >= targets.length) return;
        if (m !== targets[idx]) { piano.flash(m, 'bad'); return; }
        const now = performance.now();
        if (rounds[r] === 'legato' && idx > 0 && !Input.isHeld(targets[idx - 1]) && now - lastUp > 110) {
          piano.flash(m, 'bad'); restart('There was a little gap. Hold each key until the next one goes down. Start again from the first key.'); return;
        }
        downAt[m] = now; piano.flash(m, 'good'); piano.unhint(m); chips[idx].classList.add('got');
        idx++;
        if (idx < targets.length) hintNext();
        else if (rounds[r] === 'legato') finish();
      });
      listen('up', m => {
        if (r >= rounds.length) return;
        const now = performance.now();
        lastUp = now;
        if (rounds[r] !== 'staccato' || !downAt[m]) return;
        if (now - downAt[m] > 300) { restart('That one was held too long. Make every note a quick <b>bounce</b>. Start again!'); downAt = {}; return; }
        delete downAt[m];
        if (idx >= targets.length && !Object.keys(downAt).length) finish();
      });
      hintNext(); say();
    },

    // Pedal down, play the notes (they keep ringing), pedal up.
    pedal(st, w, done) {
      const targets = st.notes.map(Music.midi);
      let idx = 0, phase = 'down';
      const el = add(w, `<div class="dyn-row"><span class="dchip" data-p="down">⬇ pedal down</span><span class="dchip" data-p="play">play</span><span class="dchip" data-p="up">⬆ pedal up</span></div>
        <div class="targets">${targets.map(m => `<span class="tchip">${Music.letterOf(m)}</span>`).join('')}</div>`);
      const fb = feedback(w), chips = el.querySelectorAll('.tchip');
      const mark = p => $(`[data-p="${p}"]`, w).classList.add('got');
      const hintNext = () => piano.hint([{ midi: targets[idx], finger: st.fingers?.[idx], hand: st.hand || 'R' }]);
      fb('Press the pedal with your right foot, or hold <kbd>Shift</kbd> on the computer keyboard.');
      if (Input.pedal) { phase = 'play'; mark('down'); hintNext(); fb('The pedal is down. Now play the glowing keys and let go of each one.'); }
      offs.push(Input.on('pedal', on => {
        if (on && phase === 'down') { phase = 'play'; mark('down'); hintNext(); fb('Pedal down! Play the glowing keys, and let go of each one. Hear them keep ringing?'); }
        else if (!on && phase === 'play') { phase = 'down'; idx = 0; chips.forEach(c => c.classList.remove('got')); piano.clearHints(); $('[data-p="down"]', w).classList.remove('got'); fb('The pedal came up too soon. Press it down again and play all the notes first.'); }
        else if (!on && phase === 'up') { phase = 'done'; mark('up'); fb('Listen: the sound stops when the pedal lifts. ' + praise()); done(); }
      }));
      listen('down', m => {
        if (phase === 'down') { fb('Press the pedal first (or hold <kbd>Shift</kbd>).'); return; }
        if (phase !== 'play') return;
        if (m !== targets[idx]) { piano.flash(m, 'bad'); return; }
        piano.flash(m, 'good'); piano.unhint(m); chips[idx].classList.add('got'); idx++;
        if (idx < targets.length) hintNext();
        else { phase = 'up'; mark('play'); fb('Everything is ringing together. Now <b>lift</b> the pedal.'); }
      });
    },

    // Ear training: hear a chord or pair of notes and name it. items: [{ notes: [...], answer, broken? }]
    ear(st, w, done) {
      let k = 0, order = st.items.map((_, i) => i).sort(() => Math.random() - 0.5);
      const el = add(w, `<div class="hl"><button class="chip-btn again">▶ Hear it again</button>
        <div class="choices">${st.choices.map(([v, label]) => `<button class="choice" data-v="${v}">${label}</button>`).join('')}</div>
        <div class="pips big">${pips(st.items.length, 0)}</div></div>`);
      const fb = feedback(w);
      const play = () => {
        const it = st.items[order[k]], t = Sound.init().currentTime + 0.08;
        // an item is one chord (notes) or a progression of chords, played one after another
        (it.chords || [it.notes]).forEach((ch, ci) => ch.map(Music.midi).forEach((m, i) => {
          const at = t + ci * 0.95 + (it.broken || st.broken ? i * 0.28 : 0);
          Sound.play(m, at, it.chords ? 0.9 : 1.3, 0.6);
        }));
      };
      $('.again', el).onclick = play;
      el.querySelectorAll('.choice').forEach(btn => btn.onclick = () => {
        if (k >= st.items.length) return;
        if (btn.dataset.v === st.items[order[k]].answer) {
          k++; $('.pips', el).innerHTML = pips(st.items.length, k);
          if (k >= st.items.length) { fb(st.praise || 'Great ears!'); done(); } else { fb(praise() + ' Here comes another…'); later(play, 900); }
        } else { fb(st.hint || 'Listen again…'); Sound.chime('no'); later(play, 500); }
      });
      later(play, 300);
    },

    // Name the key from its signature. items: [{ key: 'D', answer: 'D' }], choices: [[value, label]]
    keysig(st, w, done) {
      let k = 0;
      const order = st.items.map((_, i) => i).sort(() => Math.random() - 0.5);
      const el = add(w, `<div class="read"><div class="score mini read-score"></div>
        <div class="choices">${st.choices.map(([v, label]) => `<button class="choice" data-v="${v}">${label}</button>`).join('')}</div>
        <div class="pips big">${pips(st.items.length, 0)}</div></div>`);
      const host = $('.read-score', el), fb = feedback(w);
      const show = () => Notation.render(host, Music.compile({ time: [4, 4], key: st.items[order[k]].key, notation: 'staff', voices: [{ hand: 'R', notes: 'r:w' }] }), { hideTime: true, maxPerLine: 1, width: 260, sp: 11 });
      el.querySelectorAll('.choice').forEach(btn => btn.onclick = () => {
        if (k >= st.items.length) return;
        if (btn.dataset.v === st.items[order[k]].answer) {
          k++; $('.pips', el).innerHTML = pips(st.items.length, k);
          if (k >= st.items.length) { fb('You can read key signatures!'); done(); } else { fb(praise()); show(); }
        } else { fb(st.hint || 'Count the sharps or flats.'); Sound.chime('no'); }
      });
      show();
    },

    // Alternate two neighbouring keys quickly and evenly: count alternations in a row.
    trill(st, w, done) {
      const [a, b] = st.notes.map(Music.midi);
      let run = 0, last = null, lastT = 0, finished = false;
      piano.hint([{ midi: a, finger: st.fingers?.[0], hand: 'R' }, { midi: b, finger: st.fingers?.[1], hand: 'R' }]);
      const el = add(w, `<div class="pips big">${pips(st.count, 0)}</div>`);
      const fb = feedback(w);
      listen('down', m => {
        if (finished) return;
        const now = performance.now();
        if (m !== a && m !== b) { piano.flash(m, 'bad'); return; }
        if (m === last || now - lastT > 320) run = 0; // must alternate, and keep it quick
        if (run === 0 && m !== a) { last = m; lastT = now; fb('Start on the <b>main</b> note, then alternate.'); return; }
        run++; last = m; lastT = now; piano.flash(m, 'good');
        el.innerHTML = pips(st.count, Math.min(run, st.count));
        if (run >= st.count) { finished = true; piano.clearHints(); fb('A real trill! ' + praise()); done(); }
        else if (run > 2) fb('Keep going, quick and even…');
      });
    },

    dyn(st, w, done) {
      let step = 0;
      const el = add(w, `<div class="dyn-row"><span class="dchip" data-d="f"><i>f</i> loud</span><span class="dchip" data-d="p"><i>p</i> soft</span></div><div class="vel"><span></span></div>`);
      const fb = feedback(w), bar = $('.vel span', el);
      const mark = d => $(`[data-d="${d}"]`, el).classList.add('got');
      listen('down', (m, vel, src) => {
        if (step >= 2) return;
        bar.style.width = Math.round(vel * 100) + '%';
        if (src !== 'midi') {
          mark(step === 0 ? 'f' : 'p'); step++;
          if (step >= 2) { fb('Your computer can\'t hear how hard you press, but a real piano can! Try loud and soft on one.'); done(); }
          else fb('Now pretend to play it very softly…');
          return;
        }
        if (step === 0) {
          if (vel > 0.6) { step = 1; mark('f'); fb('LOUD! Now a soft little echo…'); } else fb('A bit stronger! Press firmly for <i>forte</i>.');
        } else if (vel < 0.45) { step = 2; mark('p'); fb('A perfect echo.'); done(); } else fb('Softer… barely touch the key.');
      });
    },

    // pairs: [from, to, answer, 'harm'?]. Harmonic pairs are stacked and sound together.
    interval(st, w, done) {
      let k = 0;
      const choices = st.choices || [['step', 'Step (2nd)'], ['skip', 'Skip (3rd)']];
      const el = add(w, `<div class="read"><div class="score mini read-score"></div>
        <div class="choices">${choices.map(([v, label]) => `<button class="choice" data-v="${v}">${label}</button>`).join('')}</div>
        <button class="chip-btn hear">▶ Hear it</button><div class="pips big">${pips(st.pairs.length, 0)}</div></div>`);
      const host = $('.read-score', el), fb = feedback(w);
      const hear = () => {
        const [a, b, , harm] = st.pairs[k], t = Sound.init().currentTime + 0.05;
        Sound.play(Music.midi(a), t, harm ? 1.2 : 0.5); Sound.play(Music.midi(b), harm ? t : t + 0.55, harm ? 1.2 : 0.6);
      };
      const show = () => {
        const [a, b, , harm] = st.pairs[k];
        Notation.render(host, Music.compile({ time: [4, 4], notation: 'staff', voices: [{ hand: 'R', notes: harm ? `${a}+${b}:w` : `${a}:h ${b}:h` }] }), { hideTime: true, maxPerLine: 1, width: 260, sp: 11 });
      };
      $('.hear', el).onclick = hear;
      el.querySelectorAll('.choice').forEach(btn => btn.onclick = () => {
        if (k >= st.pairs.length) return;
        if (btn.dataset.v === st.pairs[k][2]) {
          k++; $('.pips', el).innerHTML = pips(st.pairs.length, k);
          if (k >= st.pairs.length) { fb(st.choices ? 'You can measure intervals!' : 'You can read steps and skips!'); done(); } else { fb(praise()); show(); }
        } else {
          const hintText = st.choices ? 'Count every line and space from the bottom note to the top note, <b>including both</b>.'
            : st.pairs[k][2] === 'skip' ? 'Look closer: line to line (or space to space) is a skip.' : 'Look closer: line to space is a step.';
          fb(hintText); Sound.chime('no');
        }
      });
      show();
    },
  };

  // ---------------------------------------------------------------- Practice & Perform
  const HELP = {
    listen: 'Hear how the song goes. Watch the notes and the keys light up.',
    guided: 'Take your time. Play each glowing key. The song waits for you.',
    beat: 'Play along with the click, a little slower. Keys still glow to help.',
    perform: 'The real thing: full speed, no glowing keys. Play it well to fill the meter.',
  };

  function renderScore() {
    score = Notation.render(scoreHost, song);
    if (perf) perf.score = score;
  }

  function showPractice() {
    cleanup();
    stage('practice');
    const id = lesson.id, completed = !!Save.data.done[id];
    let meter = completed ? 3 : Save.data.meter[id] || 0;
    let mode = Save.data.guided[id] || completed ? 'beat' : 'guided';
    let hands = 'both';
    const twoHands = song.hands.length > 1;
    body.innerHTML = `
      <div class="practice">
        <div class="p-top">
          <div class="song-meta">
            <p class="kicker">${song.by === 'Original' ? 'Original song' : song.by === 'Traditional' ? 'Traditional song' : 'Public domain · ' + song.by}</p>
            <h3>${song.title}</h3>
            <p class="meta">${song.time[0]}/${song.time[1]} time · ${song.pulse === 1.5 ? '♩.' : song.pulse === 0.5 ? '♪' : '♩'} = ${song.tempo}${song.repeat ? ' · play twice' : ''}</p>
          </div>
          <div class="reward-box">
            <canvas class="reward" aria-hidden="true"></canvas>
            <div class="reward-text"><div class="pips big meter">${pips(3, meter)}</div><p>${completed ? 'Mastered ✓' : lesson.meter}</p></div>
          </div>
        </div>
        <div class="modes" role="tablist">
          <button role="tab" data-mode="listen">Listen</button>
          <button role="tab" data-mode="guided">Guided</button>
          <button role="tab" data-mode="beat">With the beat</button>
          <button role="tab" data-mode="perform" class="perform-tab">Perform ✦</button>
        </div>
        <div class="opts">
          <div class="seg hands" ${twoHands ? '' : 'hidden'}>
            <button data-h="R">Right hand</button><button data-h="L">Left hand</button><button data-h="both">Both</button>
          </div>
          <label class="tempo" for="tempo-${id}">Speed <input type="range" id="tempo-${id}" min="50" max="100" step="5" value="70"><output>70%</output></label>
          <p class="mode-help"></p>
        </div>
        <div class="score-wrap">
          <div class="score"></div>
          <div class="countin" aria-live="polite"></div>
          <div class="result" hidden></div>
        </div>
        <div class="p-actions"><button class="btn primary go">▶ Start</button><p class="status" aria-live="polite"></p></div>
      </div>`;
    scoreHost = $('.score', body);
    renderScore();
    perf = new Performer({ song, piano, score });
    reward = Reward.mount($('canvas.reward', body), lesson.reward);
    reward.set(meter, true);

    const go = $('.go', body), status = $('.status', body), help = $('.mode-help', body);
    const cnt = $('.countin', body), resultEl = $('.result', body), tempo = $('.tempo input', body);
    const setStatus = t => { status.innerHTML = t; };
    const performUnlocked = () => !!(Save.data.guided[id] || Save.data.done[id]);

    const refresh = () => {
      body.querySelectorAll('.modes [data-mode]').forEach(b => {
        b.classList.toggle('on', b.dataset.mode === mode);
        b.setAttribute('aria-selected', b.dataset.mode === mode);
        if (b.dataset.mode === 'perform') b.classList.toggle('locked', !performUnlocked());
      });
      body.querySelectorAll('.hands [data-h]').forEach(b => {
        b.classList.toggle('on', b.dataset.h === (mode === 'perform' ? 'both' : hands));
        b.disabled = mode === 'perform';
      });
      $('.tempo', body).hidden = mode !== 'beat';
      help.innerHTML = mode === 'perform' && !performUnlocked() ? 'Finish one <b>Guided</b> practice first, then the performance opens.' : HELP[mode];
      stage(mode === 'perform' ? 'perform' : 'practice');
      go.textContent = '▶ ' + ({ listen: 'Listen', guided: 'Start guided', beat: 'Start', perform: 'Perform' })[mode];
      go.disabled = mode === 'perform' && !performUnlocked();
    };
    const stopRun = () => { perf.stop(); go.classList.remove('running'); cnt.textContent = ''; cnt.classList.remove('on'); refresh(); };
    body.querySelectorAll('.modes [data-mode]').forEach(b => b.onclick = () => { stopRun(); resultEl.hidden = true; mode = b.dataset.mode; refresh(); setStatus(''); });
    body.querySelectorAll('.hands [data-h]').forEach(b => b.onclick = () => { stopRun(); hands = b.dataset.h; refresh(); });
    tempo.oninput = () => { $('.tempo output', body).textContent = tempo.value + '%'; };

    const onCount = (c, total) => { cnt.textContent = c ? c : ''; cnt.classList.toggle('on', !!c); if (c === 1) setStatus('Count along with the clicks, then play.'); if (!c) setStatus(''); };

    go.onclick = () => {
      if (go.classList.contains('running')) { stopRun(); setStatus('Stopped.'); return; }
      resultEl.hidden = true;
      go.classList.add('running'); go.textContent = '■ Stop';
      const win = (STRICT[Save.data.settings.strict] || STRICT.standard).win;
      if (mode === 'listen') {
        setStatus('Listening…');
        perf.listen({ onEnd: () => { stopRun(); setStatus('Your turn! Try <b>Guided</b> practice.'); } });
      } else if (mode === 'guided') {
        perf.guided({
          hands,
          onStep: (i, n, wrong) => setStatus(wrong ? 'Oops! Find the glowing key.' : `Note ${i + 1} of ${n}`),
          onEnd: () => {
            stopRun();
            const first = !Save.data.guided[id];
            Save.data.guided[id] = true; Save.save(); refresh();
            Sound.chime('up');
            setStatus(first ? 'Guided practice complete ✓ The <b>Perform</b> tab is open. Try <b>With the beat</b> first!' : 'Guided practice complete ✓');
          },
        });
      } else if (mode === 'beat') {
        perf.timed({
          hands, hints: true, tempoScale: tempo.value / 100, windowScale: win * 1.15, onCount,
          onEnd: r => { stopRun(); showResult({ practice: true, r }); },
        });
      } else {
        setStatus('');
        perf.timed({ hands: 'both', hints: false, tempoScale: 1, windowScale: win, onCount, onEnd: r => { stopRun(); judge(r); } });
      }
    };

    function judge(r) {
      const S = STRICT[Save.data.settings.strict] || STRICT.standard;
      const pass = r.total > 0 && r.hits / r.total >= S.acc && r.wrong <= S.wrong;
      const wasDone = !!Save.data.done[id];
      if (pass && !wasDone) {
        meter = Math.min(3, meter + 1);
        Save.data.meter[id] = meter;
        if (meter >= 3) Save.data.done[id] = true;
        Save.save();
        reward.set(meter);
        $('.meter', body).innerHTML = pips(3, meter);
      }
      Sound.chime(pass ? (meter >= 3 && !wasDone ? 'big' : 'up') : 'soft');
      if (pass && meter >= 3 && !wasDone) showResult({ celebrate: true, r });
      else showResult({ pass, r, replay: wasDone });
    }

    function showResult({ practice, pass, celebrate, replay, r }) {
      const stats = `<b>${r.hits} of ${r.total}</b> notes on time${r.wrong ? ` · ${r.wrong} extra key${r.wrong > 1 ? 's' : ''}` : ''}`;
      let html;
      if (celebrate) {
        html = `<div class="card celebrate"><p class="kicker">${lesson.title}</p><h3>It's awake!</h3><p>${lesson.done}</p>
          <button class="btn primary big cont">Continue the quest →</button></div>`;
      } else if (practice) {
        const good = r.hits / r.total >= 0.9;
        html = `<div class="card"><h3>${good ? 'Sounding good!' : 'Nice practice'}</h3><p>${stats}</p>
          <p class="tip">${good ? (performUnlocked() ? 'You\'re ready. Try <b>Perform ✦</b> at full speed!' : 'Now finish a Guided run to open the performance.') : 'Try it again, or slow the speed down a little.'}</p>
          <div class="row"><button class="btn ghost again">↻ Again</button>${good && performUnlocked() ? '<button class="btn primary toperf">Perform ✦</button>' : ''}</div></div>`;
      } else if (pass) {
        html = `<div class="card pass"><h3>${replay ? 'Still got it!' : ['Beautiful!', 'Yes!', 'Magnificent!'][meter - 1] || 'Beautiful!'}</h3><p>${stats}</p>
          <p class="tip">${replay ? 'This place is already awake, and it loved hearing you again.' : `The meter fills: <b>${meter} of 3</b>. ${3 - meter} more to go!`}</p>
          <div class="row"><button class="btn primary again">Perform again ✦</button></div></div>`;
      } else {
        const tip = r.misses >= r.wrong ? 'Some notes slipped past. <b>With the beat</b> practice helps lock in the rhythm.' : 'A few extra keys snuck in. <b>Guided</b> practice helps your fingers find their spots.';
        html = `<div class="card fail"><h3>So close!</h3><p>${stats}</p><p class="tip">${tip}</p>
          <div class="row"><button class="btn ghost practice">Practice</button><button class="btn primary again">Try again ✦</button></div></div>`;
      }
      resultEl.innerHTML = html;
      resultEl.hidden = false;
      const q = s => resultEl.querySelector(s);
      if (q('.cont')) q('.cont').onclick = () => close({ completed: true });
      if (q('.again')) q('.again').onclick = () => { resultEl.hidden = true; go.click(); };
      if (q('.toperf')) q('.toperf').onclick = () => { resultEl.hidden = true; mode = 'perform'; refresh(); go.click(); };
      if (q('.practice')) q('.practice').onclick = () => { resultEl.hidden = true; mode = 'beat'; refresh(); };
      (q('.cont') || q('.again') || q('.btn'))?.focus();
    }

    refresh();
    setStatus(completed ? 'You\'ve mastered this one. Play it any time!' : meter ? `Meter: ${meter} of 3. Keep going!` : 'Start with <b>Listen</b>, then <b>Guided</b>.');
  }

  return { init, open, close, get isOpen() { return root && !root.hidden; } };
})();
