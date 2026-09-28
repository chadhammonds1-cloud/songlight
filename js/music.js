'use strict';
// Song parsing. Voice strings are tokens of  pitch:duration[:finger[:dynamic]]
//   pitch    C4, F#3, Bb4, chords as C3+G3, rest as r
//   duration w h. h q. q e
//   finger   3, or L3 / R2 to set the hand for that note, chords as L5+1
//   "|" marks bar lines for readability only.
const Music = (() => {
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const DUR = { w: 4, 'h.': 3, h: 2, 'q.': 1.5, q: 1, e: 0.5 };
  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

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
      const [p, d, f = '', dyn = ''] = tok.split(':');
      if (!(d in DUR)) throw new Error('Bad duration in ' + tok);
      let h = hand, ff = f;
      if (/^[LR]/.test(ff)) { h = ff[0]; ff = ff.slice(1); }
      const rest = p === 'r';
      const pitches = rest ? [] : p.split('+').map(parsePitch);
      if (!h) h = pitches.length && pitches[0].midi < 60 ? 'L' : 'R';
      events.push({ beat, dur: DUR[d], code: d, rest, pitches, fingers: ff ? ff.split('+').map(Number) : [], hand: h, dyn });
      beat += DUR[d];
    }
    return { events, length: beat };
  }

  function compile(def) {
    const voices = def.voices.map(v => ({ hand: v.hand, ...parseVoice(v.notes, v.hand) }));
    const length = Math.max(...voices.map(v => v.length));
    const passes = def.repeat ? 2 : 1;
    const notes = [];
    voices.forEach((v, vi) => v.events.forEach((e, ei) => {
      if (e.rest) return;
      for (let pass = 0; pass < passes; pass++) {
        e.pitches.forEach((p, pi) => notes.push({
          beat: e.beat + pass * length, dur: e.dur, midi: p.midi, hand: e.hand,
          finger: e.fingers[pi] ?? e.fingers[0], glyph: vi + ':' + ei, pass,
        }));
      }
    }));
    notes.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
    const mids = notes.map(n => n.midi);
    return {
      tempo: 80, time: [4, 4], notation: 'prestaff', ...def,
      beatsPerMeasure: (def.time || [4, 4])[0], voices, length, totalBeats: length * passes, notes,
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

  return { parsePitch, midi, isBlack, letterOf, nameOf, compile, groups, DUR, pc };
})();
