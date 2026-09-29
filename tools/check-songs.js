#!/usr/bin/env node
'use strict';
// Validates every song and teaching snippet in js/curriculum.js:
// bar lengths, finger counts, ties, slurs, hairpins, and the pitches used by theory tasks.
// Usage: node tools/check-songs.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = {};
vm.createContext(ctx);
for (const f of ['js/music.js', 'js/curriculum.js']) {
  // const declarations stay local to a script, so expose them explicitly.
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8') + '\n;this.Music = typeof Music !== "undefined" ? Music : this.Music; this.CURRICULUM = typeof CURRICULUM !== "undefined" ? CURRICULUM : this.CURRICULUM;', ctx, { filename: f });
}
const { Music, CURRICULUM } = ctx;

let errors = 0, songs = 0;
const fail = (where, msg) => { errors++; console.log(`✗ ${where}: ${msg}`); };

function checkSong(where, def, { partialOk = false } = {}) {
  songs++;
  let song;
  try { song = Music.compile(def); } catch (e) { fail(where, e.message); return; }
  const bpm = song.beatsPerMeasure;
  def.voices.forEach((v, vi) => {
    const bars = v.notes.split('|').map(b => b.trim()).filter(Boolean);
    bars.forEach((bar, bi) => {
      const beats = bar.split(/\s+/).reduce((t, tok) => t + Music.DUR[tok.split(':')[1]], 0);
      const last = bi === bars.length - 1;
      // A pickup bar is short, and the last bar gives those beats back.
      let want = bpm;
      if (def.pickup && bi === 0) want = def.pickup;
      else if (def.pickup && last) want = bpm - def.pickup;
      if (Math.abs(beats - want) > 1e-6 && !(partialOk && last && beats < want)) fail(where, `voice ${vi + 1}, bar ${bi + 1} has ${beats} beats (expected ${want})`);
    });
    const evs = song.voices[vi].events;
    let slurOpen = false, pinOpen = false;
    evs.forEach((e, ei) => {
      const at = `${where}, voice ${vi + 1}, note ${ei + 1}`;
      if (e.fingers.length && e.fingers.length !== e.pitches.length) fail(at, `${e.pitches.length} pitch(es) but ${e.fingers.length} finger(s)`);
      if (e.fingers.some(f => !(f >= 1 && f <= 5))) fail(at, 'finger numbers must be 1–5');
      if (e.tie) {
        const nx = evs[ei + 1];
        if (!nx || nx.rest || !e.pitches.some(p => nx.pitches.some(q => q.midi === p.midi))) fail(at, 'tie does not lead to the same pitch');
      }
      if (e.slur === 'start') { if (slurOpen) fail(at, 'slur starts inside another slur'); slurOpen = true; }
      if (e.slur === 'end') { if (!slurOpen) fail(at, 'slur ends without starting'); slurOpen = false; }
      if (e.hairpin === 'cresc' || e.hairpin === 'dim') { if (pinOpen) fail(at, 'hairpin starts inside another'); pinOpen = true; }
      if (e.hairpin === 'end') { if (!pinOpen) fail(at, 'hairpin ends without starting'); pinOpen = false; }
    });
    if (slurOpen) fail(where, `voice ${vi + 1} has an unclosed slur`);
    if (pinOpen) fail(where, `voice ${vi + 1} has an unclosed hairpin`);
  });
  if (!song.notes.length) fail(where, 'no notes');
}

const pitchOk = (where, p) => { try { Music.parsePitch(p); } catch (e) { fail(where, e.message); } };

const ids = new Set();
for (const realm of CURRICULUM.realms) {
  let lastX = -Infinity;
  for (const l of realm.lessons) {
    const where = `${realm.id}/${l.id}`;
    if (ids.has(l.id)) fail(where, 'duplicate lesson id');
    ids.add(l.id);
    for (const k of ['title', 'concept', 'clue', 'clueShort', 'done', 'meter', 'reward']) if (!l[k]) fail(where, `missing ${k}`);
    if (l.landmark.x <= lastX) fail(where, 'landmarks must be in left-to-right order');
    if (l.landmark.x >= realm.length) fail(where, 'landmark is past the end of the realm');
    lastX = l.landmark.x;
    checkSong(`${where} song "${l.song.title}"`, l.song);
    l.teach.forEach((st, si) => {
      const w = `${where} teach step ${si + 1}`;
      if (st.show?.type === 'score') checkSong(w + ' snippet', st.show.song, { partialOk: true });
      if (st.show?.type === 'keys') st.show.keys.forEach(k => pitchOk(w, k));
      if (st.task === 'tap') st.targets.forEach(k => pitchOk(w, k));
      if (st.task === 'together') st.notes.forEach(k => pitchOk(w, k));
      if (st.task === 'touch') st.notes.forEach(k => pitchOk(w, k));
      if (st.task === 'read') st.notes.forEach(([k]) => pitchOk(w, k));
      if (st.task === 'ear') st.items.forEach(it => { (it.chords || [it.notes]).flat().forEach(k => pitchOk(w, k)); if (!st.choices.some(([v]) => v === it.answer)) fail(w, `answer "${it.answer}" is not a choice`); });
      if (st.task === 'interval') st.pairs.forEach(([a, b, ans]) => {
        pitchOk(w, a); pitchOk(w, b);
        if (st.choices && !st.choices.some(([v]) => v === ans)) fail(w, `answer "${ans}" is not one of the choices`);
        if (st.choices) {
          const d = Math.abs(Music.parsePitch(a).dia - Music.parsePitch(b).dia) + 1;
          if (ans !== ['', 'unison', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'][d]) fail(w, `${a}–${b} is a ${d}, not "${ans}"`);
        }
      });
      if (st.task === 'quiz' && !(st.answer >= 0 && st.answer < st.options.length)) fail(w, 'quiz answer out of range');
      if (st.task === 'rhythm') {
        const bars = st.rhythm.split('|').map(b => b.trim()).join(' | ').replace(/(\S+)/g, t => (t === '|' ? t : t[0] === 'r' ? `r:${t.slice(1)}` : t.endsWith('~') ? `E4:${t.slice(0, -1)}::~` : 'E4:' + t));
        checkSong(w + ' rhythm', { time: st.time, tempo: st.tempo, voices: [{ hand: 'R', notes: bars }] });
      }
    });
  }
}

console.log(errors ? `\n${errors} problem(s) in ${songs} songs and snippets.` : `✓ ${songs} songs and snippets check out.`);
process.exit(errors ? 1 : 0);
