'use strict';
// Listens to an acoustic piano through the microphone.
//
// Two jobs:
//  1. Find each key strike (a jump in loudness) and guess its pitch with the YIN method. This turns
//     into an ordinary note press, used by the lessons' exercises and the world.
//  2. For songs, where the game knows which note should come next, check whether that note was
//     just struck: compare the strength of its frequencies (and overtones) right after the strike
//     with just before. This "score-informed" check copes with chords, both hands and ringing notes,
//     which a single pitch guess cannot.
const Mic = (() => {
  const HIST = 8192;           // samples kept (~170 ms), enough to look before and after a strike
  const WIN = 1024;            // YIN compares two windows of this size (~21 ms)
  const SEG = 2048;            // window for the before/after strength check (~43 ms)
  // A1 to C♯6: the range the songs use. The metronome clicks (D6, A6) sit above it.
  const LO = 33, HI = 85;
  let ctx = null, analyser = null, stream = null, node = null, timer = 0, buf = null, yin = null;
  let active = false, status = 'Off';
  let floor = 0.003, lastRms = 0, lastOnset = -1e9, pending = null, cur = null, change = null;
  let level = 0, heard = '', trace = null;
  const listeners = new Set(), strikeSubs = new Set();
  const notify = () => listeners.forEach(fn => fn());

  async function start() {
    if (active) return true;
    if (!navigator.mediaDevices?.getUserMedia) { status = 'This browser can\'t use a microphone here.'; notify(); return false; }
    stop(true); // clear any earlier session before asking for a new stream
    ctx = Sound.init();
    status = 'Asking for the microphone…'; notify();
    try {
      // Echo cancellation removes the game's own sounds; noise suppression would eat piano notes.
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      status = Input.embedded
        ? 'The microphone is blocked inside this embedded page. Download Songlight and open the file directly to use it.'
        : 'Microphone access was blocked. Allow it for this page in your browser\'s site settings, then try again.';
      notify();
      return false;
    }
    attach(ctx.createMediaStreamSource(stream));
    return true;
  }

  // Analyse any audio node instead of the microphone (tests use this with recorded piano notes).
  function listen(src) {
    stop(true);
    attach(src);
  }
  function attach(src) {
    ctx = src.context;
    node = src;
    analyser = ctx.createAnalyser();
    analyser.fftSize = HIST;
    src.connect(analyser);
    buf = new Float32Array(HIST);
    yin = new Float32Array(WIN);
    floor = 0.003; lastRms = 0; pending = null; cur = null; change = null;
    active = true;
    status = 'Listening. Play a key!';
    timer = setInterval(tick, 20);
    notify();
  }

  function stop(quiet) {
    clearInterval(timer); timer = 0;
    if (cur) release();
    try { node?.disconnect(analyser); } catch (e) { /* already disconnected */ }
    stream?.getTracks().forEach(t => t.stop());
    stream = null; node = null; analyser = null; active = false; level = 0; heard = '';
    if (!quiet) { status = 'Off'; notify(); }
  }

  // YIN pitch guess on the newest samples. Returns { midi, clarity } or null.
  function pitch() {
    const sr = ctx.sampleRate, o = HIST - 2 * WIN;
    // Search from well above the piano range, so a too-high sound (a click, a whistle) is
    // recognised and rejected instead of being heard an octave lower.
    const tauLo = Math.floor(sr / 5000), tauMin = Math.floor(sr / 1450), tauMax = Math.min(WIN - 1, Math.ceil(sr / 50));
    yin[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let d = 0;
      for (let j = 0; j < WIN; j++) { const x = buf[o + j] - buf[o + j + tau]; d += x * x; }
      run += d;
      yin[tau] = run ? d * tau / run : 1;
    }
    let tau = -1;
    for (let t = tauLo; t < tauMax; t++) {
      if (yin[t] < 0.15) { while (t + 1 < tauMax && yin[t + 1] < yin[t]) t++; tau = t; break; }
    }
    if (tau >= 0 && tau < tauMin) return null; // higher than any note we listen for
    if (tau < 0) { // no clear dip: accept the best one if it is reasonably clear
      let best = tauMin;
      for (let t = tauMin; t < tauMax; t++) if (yin[t] < yin[best]) best = t;
      if (yin[best] > 0.3) return null;
      tau = best;
    }
    // Octave check: if a half, third or quarter of the period fits nearly as well, the real note
    // is that higher one (low partials can make a note look one or two octaves too low).
    for (const k of [4, 3, 2]) {
      const t0 = Math.round(tau / k);
      if (t0 < tauMin) continue;
      let t = t0;
      for (let u = t0 - 2; u <= t0 + 2; u++) if (u >= tauMin && yin[u] < yin[t]) t = u;
      if (yin[t] < Math.max(0.2, yin[tau] + 0.08)) { tau = t; break; }
    }
    const a = yin[tau - 1], b = yin[tau], c = yin[tau + 1] ?? b;
    const shift = (a - 2 * b + c) ? 0.5 * (a - c) / (a - 2 * b + c) : 0;
    const f = sr / (tau + shift);
    const exact = 69 + 12 * Math.log2(f / 440), m = Math.round(exact);
    if (Math.abs(exact - m) > 0.4 || m < LO || m > HI) return null;
    return { midi: m, clarity: 1 - b };
  }

  // Strength of one frequency in x[start..start+len) (Goertzel), with a Hann window.
  function power(x, start, len, f) {
    const w = 2 * Math.cos(2 * Math.PI * f / ctx.sampleRate);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < len; i++) {
      const s = x[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / len)) + w * s1 - s2;
      s2 = s1; s1 = s;
    }
    return s1 * s1 + s2 * s2 - w * s1 * s2;
  }
  // A note's strength: its fundamental plus its first overtones (pianos stretch them slightly).
  function strength(x, start, len, midi) {
    const f0 = 440 * Math.pow(2, (midi - 69) / 12);
    let sum = 0;
    for (let k = 1; k <= 4; k++) {
      const f = k * f0 * Math.sqrt(1 + 0.0004 * k * k);
      if (f > ctx.sampleRate / 2.5) break;
      sum += power(x, start, len, f) / k;
    }
    return sum;
  }

  // A snapshot taken ~60 ms after a strike: can answer "was this note just struck?"
  function snapshot(onsetAgoMs) {
    const x = Float32Array.from(buf), sr = ctx.sampleRate;
    const at = HIST - Math.round(onsetAgoMs / 1000 * sr); // where the attack is in x
    const post = Math.min(HIST - SEG, at + Math.round(0.006 * sr)), pre = Math.max(0, at - SEG - Math.round(0.004 * sr));
    const memo = new Map();
    return midi => {
      if (memo.has(midi)) return memo.get(midi);
      const now = strength(x, post, SEG, midi), before = strength(x, pre, SEG, midi);
      // compare with the semitones either side: a real note peaks exactly on its own frequencies
      const side = (strength(x, post, SEG, midi - 1) + strength(x, post, SEG, midi + 1)) / 2;
      const ok = now > before * 1.8 && now > side * 2.2 && now > 1e-4;
      memo.set(midi, ok);
      return ok;
    };
  }

  function tick() {
    if (!analyser) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = HIST - WIN; i < HIST; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / WIN), now = performance.now();
    level = rms;
    // The noise floor drifts down quickly in quiet moments and creeps up slowly in noisy rooms.
    if (rms < floor * 2) floor = floor * 0.95 + rms * 0.05; else if (!cur && !pending) floor *= 1.002;
    floor = Math.max(floor, 0.0008);
    const thresh = Math.max(floor * 5, 0.006);

    // A new key strike: loudness jumps.
    if (rms > thresh && rms > lastRms * 1.25 + floor && now - lastOnset > 70) {
      lastOnset = now;
      pending = { t: now, peak: rms, votes: [], sent: false, struck: false };
      trace?.push(['onset', Math.round(now), +rms.toFixed(4)]);
    }
    if (pending) {
      pending.peak = Math.max(pending.peak, rms);
      const age = now - pending.t;
      if (!pending.struck && age >= 15) {
        const p = pitch();
        trace?.push(['pitch', Math.round(now), p && p.midi, p && +p.clarity.toFixed(2)]);
        if (p) {
          const v = pending.votes;
          v.push(p.midi);
          // two readings in a row that agree, or one very clear one
          if ((v.length >= 2 && v[v.length - 1] === v[v.length - 2]) || p.clarity > 0.95) strike(p.midi, now);
        }
      }
      // ~60 ms after the strike there is enough sound to check which notes it contained.
      if (!pending.sent && age >= 60) {
        pending.sent = true;
        const has = snapshot(age + 20);
        const info = { lag: (age + 20) / 1000, midi: pending.midi ?? null, has };
        strikeSubs.forEach(fn => fn(info));
      }
      if (age > 200) pending = null; // done listening to this strike
    }
    // Fast or smooth (legato) playing barely changes the loudness, so also watch for the pitch
    // moving to a new note and staying there.
    if (cur && !pending && rms > thresh) {
      const p = pitch();
      if (p && p.midi !== cur.m && p.clarity > 0.85 && Math.abs(p.midi - cur.m) <= 19) {
        if (change && change.m === p.midi) {
          pending = { t: change.t, peak: rms, votes: [], sent: false, struck: false };
          strike(p.midi, now);
          change = null;
          trace?.push(['legato', Math.round(now), p.midi]);
        } else change = { m: p.midi, t: now - 20 };
      } else change = null;
    }
    if (cur) {
      cur.peak = Math.max(cur.peak, rms);
      if (rms < Math.max(cur.peak * 0.1, floor * 3)) release();
    }
    lastRms = rms;
  }

  function strike(m, now) {
    if (cur) release();
    const vel = Math.max(0.15, Math.min(1, pending.peak / 0.2));
    const lag = (now - pending.t) / 1000 + 0.02; // when the attack really happened
    pending.struck = true; pending.midi = m;
    cur = { m, peak: pending.peak };
    heard = Music.nameOf(m);
    Input.down(m, vel, 'mic', lag);
    notify();
  }
  function release() {
    const m = cur.m;
    cur = null;
    Input.up(m, 'mic');
  }

  return {
    start, stop, listen,
    get active() { return active; },
    get status() { return status; },
    get level() { return level; },
    get heard() { return heard; },
    onStatus: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    // Every strike, ~60 ms later: { lag, midi (the pitch guess, or null), has(midi) }.
    onStrike: fn => { strikeSubs.add(fn); return () => strikeSubs.delete(fn); },
    traceTo(arr) { trace = arr; }, // for debugging: records strikes and pitch readings
  };
})();
