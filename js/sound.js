'use strict';
// A small Web Audio synth: a bell-like piano voice, metronome clicks, chimes and ambient pads.
const Sound = (() => {
  let ctx = null, master, bus, volume = 0.8;
  const held = new Map();
  let scheduled = [];

  function init() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master = ctx.createGain(); master.gain.value = volume;
      bus = ctx.createGain();
      const verb = ctx.createConvolver(); verb.buffer = impulse(2.4);
      const wet = ctx.createGain(); wet.gain.value = 0.26;
      bus.connect(master); bus.connect(verb); verb.connect(wet); wet.connect(master);
      master.connect(comp); comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function impulse(sec) {
    const len = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }

  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  function voice(m, vel, t, opts = {}) {
    const f = hz(m);
    const out = ctx.createGain(); out.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = Math.min(14000, f * (2.5 + vel * 7)); lp.Q.value = 0.3;
    const parts = opts.soft
      ? [[1, 'sine', 1], [2, 'sine', 0.12]]
      : [[1, 'triangle', 1], [2, 'sine', 0.4], [3, 'sine', 0.14], [4, 'sine', 0.06], [5, 'sine', 0.03]];
    const oscs = parts.map(([mul, type, amp]) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mul;
      o.detune.value = (Math.random() - 0.5) * 5;
      const g = ctx.createGain(); g.gain.value = amp;
      o.connect(g); g.connect(lp); o.start(t);
      return o;
    });
    lp.connect(out); out.connect(bus);
    const peak = (opts.soft ? 0.05 : 0.14) + (opts.soft ? 0.08 : 0.22) * vel;
    const life = opts.soft ? 4.5 : (m < 55 ? 3.6 : m < 72 ? 2.8 : 2);
    const a = opts.soft ? 0.6 : 0.005;
    const tau = opts.soft ? 0.7 : 0.07;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(peak, t + a);
    if (!opts.soft) out.gain.exponentialRampToValueAtTime(peak * 0.32, t + a + 0.3);
    out.gain.exponentialRampToValueAtTime(0.0005, t + life);
    oscs.forEach(o => o.stop(t + life + 0.1));
    return {
      release(at) {
        const r = Math.max(at ?? ctx.currentTime, ctx.currentTime);
        if (out.gain.cancelAndHoldAtTime) out.gain.cancelAndHoldAtTime(r);
        else out.gain.cancelScheduledValues(r);
        out.gain.setTargetAtTime(0, r, tau);
        oscs.forEach(o => { try { o.stop(r + tau * 8); } catch (e) { /* already stopped */ } });
      },
    };
  }

  function noteOn(m, vel = 0.7) {
    if (!init()) return;
    noteOff(m);
    held.set(m, voice(m, vel, ctx.currentTime));
  }
  function noteOff(m) {
    const v = held.get(m);
    if (v) { v.release(); held.delete(m); }
  }
  function play(m, when, dur, vel = 0.6, opts) {
    if (!init()) return null;
    const v = voice(m, vel, when, opts);
    v.release(when + dur);
    scheduled.push(v);
    return v;
  }
  function click(when, accent) {
    if (!init()) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(accent ? 0.32 : 0.18, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0005, when + 0.06);
    o.connect(g); g.connect(master); o.start(when); o.stop(when + 0.08);
    scheduled.push({ release() { try { o.stop(); } catch (e) { /* done */ } } });
  }
  function stopScheduled() { scheduled.forEach(v => v.release()); scheduled = []; }

  function chime(kind = 'up') {
    if (!init()) return;
    const t = ctx.currentTime + 0.02;
    const seqs = { up: [72, 76, 79, 84], big: [60, 64, 67, 72, 76, 79, 84, 88, 91, 96], soft: [79, 84], no: [64, 60] };
    const step = kind === 'big' ? 0.07 : 0.09;
    (seqs[kind] || seqs.up).forEach((m, i) => voice(m, kind === 'no' ? 0.3 : 0.5, t + i * step).release(t + i * step + 0.6));
  }
  function pad(m) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    voice(m, 0.4, t, { soft: true }).release(t + 1.8);
  }
  function setVolume(v) { volume = v; if (master) master.gain.value = v; }

  return { init, noteOn, noteOff, play, click, stopScheduled, chime, pad, setVolume, get ctx() { return ctx; } };
})();
