'use strict';
// Plays, guides and judges a song against live input.
class Performer {
  constructor({ song, piano, score }) {
    this.song = song; this.piano = piano; this.score = score;
    this.offs = []; this.raf = 0; this.active = false;
  }

  // A tied note lights up every notehead it spans.
  mark(n, cls) { this.score?.mark(n.glyph, cls); n.tied?.forEach(gl => this.score?.mark(gl, cls)); }
  static sounding(n) { return n.ring || n.dur * (n.stacc ? 0.4 : 0.92); }
  // Schedule one note; a trill alternates quickly with the note above.
  static schedule(n, t0, spb, vel) {
    if (!n.trill) { Sound.play(n.midi, t0 + n.beat * spb, Performer.sounding(n) * spb, vel); return; }
    const start = t0 + n.beat * spb, end = start + n.dur * spb * 0.92, step = Math.max(0.07, spb / 8);
    for (let t = start, k = 0; t < end - 0.02; t += step, k++) Sound.play(k % 2 ? n.trill : n.midi, t, step * 1.1, vel * (k ? 0.85 : 1));
  }

  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.offs.forEach(f => f());
    this.offs = [];
    Sound.stopScheduled();
    if (this.piano) { this.piano.clearHints(); this.piano.setLit(new Set()); }
    this.score?.setCursor(null);
  }

  // Demo: the song plays itself while the cursor and keys follow.
  listen({ tempoScale = 1, onEnd } = {}) {
    this.stop();
    const ctx = Sound.init();
    if (!ctx) return;
    this.active = true;
    this.score?.clear();
    const spb = this.song.spq / tempoScale;
    const t0 = ctx.currentTime + 0.3, p0 = performance.now() + 300;
    this.song.notes.forEach(n => Performer.schedule(n, t0, spb, n.vel ?? 0.6));
    const loop = () => {
      if (!this.active) return;
      const b = (performance.now() - p0) / 1000 / spb;
      this.score?.setCursor(Math.max(0, b));
      this.piano?.setLit(new Set(this.song.notes.filter(n => b >= n.beat && b < n.beat + Performer.sounding(n)).map(n => n.midi)));
      if (b > this.song.totalBeats + 0.3) { this.stop(); onEnd?.(); return; }
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  // Wait mode: highlights the next key(s) and waits, no clock.
  guided({ hands = 'both', onStep, onEnd } = {}) {
    this.stop();
    this.active = true;
    this.score?.clear();
    const notes = this.song.notes.filter(n => hands === 'both' || n.hand === hands);
    const groups = Music.groups(notes);
    let gi = 0, got = new Set();
    const show = () => {
      const g = groups[gi];
      if (gi > 0 && g.notes[0].pass !== groups[gi - 1].notes[0].pass) this.score?.clearMarks();
      got = new Set();
      this.piano.clearHints();
      this.piano.hint(g.notes);
      this.score?.setCursor(g.beat);
      g.notes.forEach(n => this.mark(n, 'now'));
      onStep?.(gi, groups.length);
    };
    this.offs.push(Input.on('down', m => {
      if (!this.active) return;
      const g = groups[gi];
      if (!g.notes.some(n => n.midi === m)) { this.piano.flash(m, 'bad'); onStep?.(gi, groups.length, 'wrong', g); return; }
      got.add(m);
      this.piano.flash(m, 'good');
      this.piano.unhint(m);
      if (g.notes.every(n => got.has(n.midi))) {
        g.notes.forEach(n => this.mark(n, 'hit'));
        gi++;
        if (gi >= groups.length) { this.stop(); onEnd?.(); return; }
        show();
      }
    }));
    show();
  }

  // Timed play with count-in. Judges onsets against the beat grid.
  timed({ tempoScale = 1, hands = 'both', hints = false, metronome = true, anyKey = false, windowScale = 1, onCount, onEnd } = {}) {
    this.stop();
    const ctx = Sound.init();
    if (!ctx) return;
    this.active = true;
    this.score?.clear();
    const song = this.song;
    const spb = song.spq / tempoScale, bpm = song.beatsPerMeasure, pulse = song.pulse, off = song.offset;
    const perBar = Math.round(bpm / pulse);
    const lead = 0.35, count = bpm + off; // one full bar, plus the rest of the pickup bar
    const tA = ctx.currentTime + lead + count * spb;
    const tP = performance.now() + (lead + count * spb) * 1000;
    const endBeat = song.totalBeats;
    // Clicks fall on the pulse of the bar grid (u), which a pickup shifts against song time (b).
    for (let k = -perBar; ; k++) {
      const u = k * pulse, b = u - off;
      if (b >= (metronome ? endBeat : 0) - 1e-6) break;
      Sound.click(tA + b * spb, ((k % perBar) + perBar) % perBar === 0);
    }
    const req = [], auto = [];
    song.notes.forEach(n => (hands === 'both' || n.hand === hands ? req : auto).push(n));
    auto.forEach(n => Performer.schedule(n, tA, spb, (n.vel ?? 0.6) * 0.7));
    // Close notes (eighths) get a narrower window so one press can't claim its neighbour.
    let gap = 1;
    for (let i = 1; i < req.length; i++) { const d = req[i].beat - req[i - 1].beat; if (d > 1e-6 && d < gap) gap = d; }
    const win = Math.min(0.38, Math.max(0.16, spb * 0.42), Math.max(0.11, gap * spb * 0.48)) * windowScale;
    const state = req.map(() => 'pending');
    let wrong = 0, perfect = 0, lastCount = null;
    const now = () => (performance.now() - tP) / 1000;

    this.offs.push(Input.on('down', m => {
      if (!this.active) return;
      const t = now();
      if (t < -win) return; // playing along with the count-in isn't a mistake
      let best = -1, bd = 1e9;
      req.forEach((n, i) => {
        if (state[i] !== 'pending' || (!anyKey && n.midi !== m)) return;
        const d = Math.abs(n.beat * spb - t);
        if (d <= win && d < bd) { bd = d; best = i; }
      });
      if (best >= 0) {
        state[best] = 'hit';
        if (bd < 0.1) perfect++;
        this.piano?.flash(m, 'good');
        this.mark(req[best], 'hit');
      } else if (req.some(n => n.trill && (m === n.midi || m === n.trill) && t >= n.beat * spb - win && t <= (n.beat + n.dur) * spb)) {
        this.piano?.flash(m, 'good'); // the alternating notes of a trill are never mistakes
      } else {
        wrong++;
        this.piano?.flash(m, 'bad');
      }
    }));

    const lastT = req.length ? req[req.length - 1].beat * spb + win : 0;
    const loop = () => {
      if (!this.active) return;
      const t = now(), b = t / spb;
      if (b < 0) {
        const k = Math.floor((b + off) / pulse + 1e-6);
        if (k !== lastCount) { lastCount = k; onCount?.(((k % perBar) + perBar) % perBar + 1, perBar * 2); }
      } else if (lastCount !== 'go') { lastCount = 'go'; onCount?.(0, perBar * 2); }
      this.score?.setCursor(Math.max(0, b));
      req.forEach((n, i) => {
        if (state[i] === 'pending' && n.beat * spb + win < t) { state[i] = 'miss'; this.mark(n, 'miss'); }
      });
      if (req.length && song.repeat && b >= song.length && b < song.length + 0.05) this.score?.clearMarks();
      if (hints && this.piano) {
        const next = req.filter((n, i) => state[i] === 'pending' && n.beat * spb >= t - win);
        const nb = next.length ? next[0].beat : null;
        this.piano.setHints(nb !== null && nb - b < 1.6 ? next.filter(n => n.beat === nb) : []);
      }
      if (this.piano && auto.length) this.piano.setLit(new Set(auto.filter(n => b >= n.beat && b < n.beat + Performer.sounding(n)).map(n => n.midi)));
      if (b > endBeat + 0.15 && t > lastT) {
        const hits = state.filter(s => s === 'hit').length;
        this.stop();
        onEnd?.({ total: req.length, hits, wrong, perfect, misses: req.length - hits });
        return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }
}
