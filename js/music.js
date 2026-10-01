'use strict';
// Song parsing. Voice strings are tokens of  pitch:duration[:finger[:marks]]
//   pitch    C4, F#3, Bb4, chords as C3+G3, rest as r
//   duration w h. h q. q e. e s, and t for one note of an eighth-note triplet (⅓ beat)
//   finger   3, or L3 / R2 to set the hand for that note, chords as L5+1
//   marks    comma-separated: a dynamic (pp p mp mf f), . staccato, ~ tie to the next note,
//            ( slur start, ) slur end, < crescendo start, > diminuendo start, / hairpin end,
//            P pedal down (or change) at this note, * pedal up when this note ends,
//            tr trill with the next note up in the key
// A song may start with a pickup: { pickup: 1 } means the first bar holds only 1 beat.
// Beats are always counted in quarter notes, so a 6/8 bar is 3 beats long. Its tempo counts
// the dotted-quarter pulse, the way musicians feel 6/8.
// { key: 'G' } draws a key signature; notes written F#4 then need no sign of their own.
//   "|" marks bar lines for readability only.
const Music = (() => {
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const DUR = { w: 4, 'h.': 3, h: 2, 'q.': 1.5, q: 1, 'e.': 0.75, e: 0.5, t: 1 / 3, s: 0.25 };
  // sharps (+) or flats (−) in each key signature
  const KEYS = { C: 0, G: 1, D: 2, A: 3, E: 4, F: -1, Bb: -2, Eb: -3, Am: 0, Em: 1, Bm: 2, Dm: -1, Gm: -2, Cm: -3 };
  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const DYN = { pp: 0.3, p: 0.4, mp: 0.5, mf: 0.62, f: 0.76, ff: 0.88 };
  const MARKS = new Set(['.', '~', '(', ')', '<', '>', '/', 'P', '*', 'tr']);

  function parsePitch(p) {
    const m = /^([A-G])(#|b)?(\d)$/.exec(p);
    if (!m) throw new Error('Bad pitch: ' + p);
    const letter = m[1], acc = m[2] || '', oct = +m[3];
    const alter = acc === '#' ? 1 : acc === 'b' ? -1 : 0;
    return { name: p, letter, acc, oct, midi: 12 * (oct + 1) + SEMI[letter] + alter, dia: oct * 7 + LETTERS.indexOf(letter) };
  }
  const midi = p => parsePitch(p).midi;
  const pc = m => ((m % 12) + 12) % 12;
  const isBlack = m => [1, 3, 6, 8, 10].includes(pc(m));
  const letterOf = m => NAMES[pc(m)];
  const nameOf = m => NAMES[pc(m)] + (Math.floor(m / 12) - 1);

  function parseVoice(str, hand) {
    const events = [];
    let beat = 0;
    for (const tok of str.trim().split(/\s+/)) {
      if (!tok || tok === '|') continue;
      const [p, d, f = '', mk = ''] = tok.split(':');
      if (!(d in DUR)) throw new Error('Bad duration in ' + tok);
      const marks = mk ? mk.split(',') : [];
      const dyn = marks.find(m => m in DYN) || '';
      const bad = marks.find(m => !(m in DYN) && !MARKS.has(m));
      if (bad) throw new Error('Bad mark in ' + tok);
      let h = hand, ff = f;
      if (/^[LR]/.test(ff)) { h = ff[0]; ff = ff.slice(1); }
      const rest = p === 'r';
      const pitches = rest ? [] : p.split('+').map(parsePitch);
      if (!h) h = pitches.length && pitches[0].midi < 60 ? 'L' : 'R';
      events.push({
        beat, dur: DUR[d], code: d, rest, pitches, fingers: ff ? ff.split('+').map(Number) : [], hand: h, dyn,
        stacc: marks.includes('.'), tie: marks.includes('~'), slur: marks.includes('(') ? 'start' : marks.includes(')') ? 'end' : '',
        hairpin: marks.includes('<') ? 'cresc' : marks.includes('>') ? 'dim' : marks.includes('/') ? 'end' : '',
        pedal: marks.includes('P') ? 'down' : '', pedalUp: marks.includes('*'), trill: marks.includes('tr'),
      });
      beat += DUR[d];
    }
    return { events, length: beat };
  }

  // Loudness of each event: the last dynamic mark, sliding through hairpins.
  function loudness(events) {
    let level = DYN.mf, pin = null;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.dyn) level = DYN[e.dyn];
      if (e.hairpin === 'cresc' || e.hairpin === 'dim') {
        let j = i + 1;
        while (j < events.length && events[j].hairpin !== 'end') j++;
        const to = events.slice(i + 1, j + 1).find(x => x.dyn);
        const target = to ? DYN[to.dyn] : level + (e.hairpin === 'cresc' ? 0.22 : -0.22);
        pin = { from: level, to: target, b0: e.beat, b1: j < events.length ? events[j].beat : e.beat + 4 };
      }
      e.vel = pin && e.beat <= pin.b1 ? pin.from + (pin.to - pin.from) * Math.min(1, (e.beat - pin.b0) / Math.max(1e-6, pin.b1 - pin.b0)) : level;
      if (e.hairpin === 'end' || (pin && e.beat >= pin.b1)) { if (pin) level = e.dyn ? DYN[e.dyn] : pin.to; pin = null; }
      e.vel = Math.max(0.2, Math.min(0.95, e.vel));
    }
  }

  // The note a step above p in the key (for trills): next letter, with the key's sharp or flat.
  function upperNeighbor(p, keySig) {
    const li = LETTERS.indexOf(p.letter), letter = LETTERS[(li + 1) % 7], oct = p.oct + (li === 6 ? 1 : 0);
    const acc = keyAccidentals(keySig)[letter] || '';
    return parsePitch(letter + acc + oct).midi;
  }

  function compile(def) {
    const keySig = KEYS[def.key] || 0;
    const voices = def.voices.map(v => ({ hand: v.hand, ...parseVoice(v.notes, v.hand) }));
    const length = Math.max(...voices.map(v => v.length));
    const passes = def.repeat ? 2 : 1;
    const notes = [];
    voices.forEach((v, vi) => {
      loudness(v.events);
      // A tie joins a note to the same pitch in the next event: one key press, held longer.
      const heldBy = {};
      v.events.forEach((e, ei) => {
        if (e.rest) return;
        e.pitches.forEach((p, pi) => {
          const key = ei + ':' + p.midi;
          if (heldBy[key]) { heldBy[key].forEach(n => { n.dur += e.dur; n.tied.push(vi + ':' + ei); }); if (e.tie) heldBy[(ei + 1) + ':' + p.midi] = heldBy[key]; return; }
          const made = [];
          for (let pass = 0; pass < passes; pass++) {
            const n = {
              beat: e.beat + pass * length, dur: e.dur, midi: p.midi, hand: e.hand,
              finger: e.fingers[pi] ?? e.fingers[0], glyph: vi + ':' + ei, tied: [], pass,
              vel: e.vel, stacc: e.stacc,
              voice: vi, chord: e.pitches.map(q => q.midi), // for the microphone, which hears chords as one note
            };
            if (e.trill) n.trill = upperNeighbor(p, keySig);
            notes.push(n); made.push(n);
          }
          if (e.tie) heldBy[(ei + 1) + ':' + p.midi] = made;
        });
      });
    });
    // The damper pedal keeps every note ringing until it is lifted (or changed).
    const pedals = [];
    voices.forEach(v => {
      let from = null;
      v.events.forEach(e => {
        if (e.pedal) { if (from !== null) pedals.push([from, e.beat]); from = e.beat; }
        if (e.pedalUp && from !== null) { pedals.push([from, e.beat + e.dur]); from = null; }
      });
      if (from !== null) pedals.push([from, v.length]);
    });
    if (pedals.length) {
      for (let pass = 1; pass < passes; pass++) pedals.slice().forEach(([a, b]) => pedals.push([a + pass * length, b + pass * length]));
      notes.forEach(n => {
        const p = pedals.find(([a, b]) => n.beat >= a - 1e-6 && n.beat < b - 1e-6);
        if (p && p[1] > n.beat + n.dur) n.ring = p[1] - n.beat;
      });
    }
    notes.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
    const mids = notes.map(n => n.midi);
    const [top, bottom] = def.time || [4, 4];
    const bar = top * 4 / bottom;
    // felt beat, in quarter notes: a dotted quarter in 6/8, 9/8, 12/8; an eighth in 3/8
    const pulse = bottom === 8 && top % 3 === 0 && top >= 6 ? 1.5 : 4 / bottom;
    const beamUnit = bottom === 8 && top % 3 === 0 ? 1.5 : 1;
    const tempo = def.tempo || 80;
    if (def.key && !(def.key in KEYS)) throw new Error('Unknown key ' + def.key);
    return {
      tempo: 80, time: [4, 4], notation: 'prestaff', ...def,
      beatsPerMeasure: bar, pulse, beamUnit, spq: 60 / (tempo * pulse), keySig,
      voices, length, totalBeats: length * passes, notes, pedals,
      // beats of silence before the pickup, so bar lines and the count-in line up
      offset: def.pickup ? bar - def.pickup : 0,
      lo: mids.length ? Math.min(...mids) : 60, hi: mids.length ? Math.max(...mids) : 72,
      hands: [...new Set(notes.map(n => n.hand))],
    };
  }

  // Notes that start on the same beat form one step in guided practice.
  function groups(notes) {
    const out = [];
    for (const n of notes) {
      const g = out[out.length - 1];
      if (g && Math.abs(g.beat - n.beat) < 1e-6) g.notes.push(n);
      else out.push({ beat: n.beat, notes: [n] });
    }
    return out;
  }

    // Which letters a key signature alters: { F: '#' } for G major.
  function keyAccidentals(n) {
    const out = {};
    if (n > 0) 'FCGDAEB'.slice(0, n).split('').forEach(l => { out[l] = '#'; });
    if (n < 0) 'BEADGCF'.slice(0, -n).split('').forEach(l => { out[l] = 'b'; });
    return out;
  }

  return { parsePitch, midi, isBlack, letterOf, nameOf, compile, groups, keyAccidentals, DUR, DYN, KEYS, pc };
})();
