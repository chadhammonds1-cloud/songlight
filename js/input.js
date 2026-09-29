'use strict';
// All note input funnels through here: MIDI keyboards, the computer keyboard, and on-screen keys.
const Input = (() => {
  const subs = { down: new Set(), up: new Set(), pedal: new Set() };
  let pedal = false;
  const held = new Map(); // midi -> source
  let midiState = 'Not connected yet';
  let midiConnected = false;
  const listeners = new Set();

  // Tracker-style layout: bottom row = C3..E4, top row = C4..G5.
  const KEYMAP = {
    z: 48, s: 49, x: 50, d: 51, c: 52, v: 53, g: 54, b: 55, h: 56, n: 57, j: 58, m: 59,
    ',': 60, l: 61, '.': 62, ';': 63, '/': 64,
    q: 60, 2: 61, w: 62, 3: 63, e: 64, r: 65, 5: 66, t: 67, 6: 68, y: 69, 7: 70, u: 71,
    i: 72, 9: 73, o: 74, 0: 75, p: 76, '[': 77, '=': 78, ']': 79,
  };
  // Holding Shift (the pedal) changes what some keys type; map them back.
  const UNSHIFT = { '@': '2', '#': '3', '%': '5', '^': '6', '&': '7', '(': '9', ')': '0', '<': ',', '>': '.', ':': ';', '?': '/', '{': '[', '}': ']', '+': '=' };
  const noteFor = e => KEYMAP[UNSHIFT[e.key] || e.key.toLowerCase()];
  const REVERSE = {};
  for (const [k, m] of Object.entries(KEYMAP)) if (!(m in REVERSE) || m >= 60) REVERSE[m] = k.toUpperCase();

  const on = (type, fn) => { subs[type].add(fn); return () => subs[type].delete(fn); };

  function down(m, vel = 0.7, src = 'screen') {
    if (held.has(m)) return;
    held.set(m, src);
    Sound.noteOn(m, vel);
    subs.down.forEach(fn => fn(m, vel, src));
  }
  // Damper pedal: MIDI controller 64, or Shift on the computer keyboard.
  function setPedal(on, src = 'keys') {
    if (on === pedal) return;
    pedal = on;
    Sound.setPedal(on);
    subs.pedal.forEach(fn => fn(on, src));
  }
  function up(m, src = 'screen') {
    if (!held.has(m)) return;
    held.delete(m);
    Sound.noteOff(m);
    subs.up.forEach(fn => fn(m, src));
  }

  const typing = e => {
    const t = e.target;
    return t && ((t.tagName === 'INPUT' && !['range', 'checkbox', 'radio'].includes(t.type)) || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };
  window.addEventListener('keydown', e => {
    if (e.key === 'Shift' && !typing(e)) { setPedal(true, 'keys'); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
    const m = noteFor(e);
    if (m === undefined) return;
    e.preventDefault();
    if (e.repeat) return;
    Sound.init();
    down(m, 0.7, 'keys');
  });
  window.addEventListener('keyup', e => {
    if (e.key === 'Shift') { setPedal(false, 'keys'); return; }
    const m = noteFor(e);
    if (m !== undefined) up(m, 'keys');
  });
  window.addEventListener('blur', () => { for (const [m, src] of [...held]) if (src !== 'midi') up(m, src); setPedal(false); });

  function notify() { listeners.forEach(fn => fn()); }
  function initMidi() {
    if (!navigator.requestMIDIAccess) { midiState = 'This browser has no MIDI support (try Chrome or Edge)'; notify(); return; }
    navigator.requestMIDIAccess().then(access => {
      const bind = () => {
        const names = [];
        access.inputs.forEach(inp => { names.push(inp.name); inp.onmidimessage = onMidi; });
        midiConnected = names.length > 0;
        midiState = names.length ? 'Connected: ' + names.join(', ') : 'No MIDI keyboard found — plug one in any time';
        notify();
      };
      access.onstatechange = bind;
      bind();
    }).catch(() => { midiState = 'MIDI access was blocked on this page'; notify(); });
  }
  function onMidi(e) {
    const [st, n, v] = e.data;
    const cmd = st & 0xf0;
    if (cmd === 0x90 && v > 0) { Sound.init(); down(n, v / 127, 'midi'); }
    else if (cmd === 0x80 || (cmd === 0x90 && v === 0)) up(n, 'midi');
    else if (cmd === 0xb0 && n === 64) setPedal(v >= 64, 'midi');
  }

  return {
    on, down, up, initMidi, setPedal,
    get pedal() { return pedal; },
    onStatus: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    get midiState() { return midiState; },
    get midiConnected() { return midiConnected; },
    keyFor: m => REVERSE[m] || '',
    isHeld: m => held.has(m),
  };
})();
