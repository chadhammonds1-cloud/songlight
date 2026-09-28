'use strict';
// Song parsing. Voice strings are tokens of  pitch:duration[:finger[:marks]]
//   pitch    C4, F#3, Bb4, chords as C3+G3, rest as r
//   duration w h. h q. q e
//   finger   3, or L3 / R2 to set the hand for that note, chords as L5+1
//   marks    comma-separated: a dynamic (pp p mp mf f), . staccato, ~ tie to the next note,
//            ( slur start, ) slur end, < crescendo start, > diminuendo start, / hairpin end
//   "|" marks bar lines for readability only.
const Music = (() => {
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const DUR = { w: 4, 'h.': 3, h: 2, 'q.': 1.5, q: 1, e: 0.5 };
  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const DYN = { pp: 0.3, p: 0.4, mp: 0.5, mf: 0.62, f: 0.76, ff: 0.88 };
  const MARKS = new Set(['.', '~', '(', ')', '<', '>', '/']);

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

  function compile(def) {
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
            };
            notes.push(n); made.push(n);
          }
          if (e.tie) heldBy[(ei + 1) + ':' + p.midi] = made;
        });
      });
    });
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

  return { parsePitch, midi, isBlack, letterOf, nameOf, compile, groups, DUR, DYN, pc };
})();
