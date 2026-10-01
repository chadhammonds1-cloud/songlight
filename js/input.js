'use strict';
// All note input funnels through here: MIDI keyboards, the microphone, the computer keyboard, and on-screen keys.
const Input = (() => {
  const subs = { down: new Set(), up: new Set(), pedal: new Set() };
  let pedal = false;
  const held = new Map(); // midi -> source
  const heldPort = new Map(); // midi -> id of the MIDI port holding it
  let midiAccess = null, pedalPort = null;
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

  // lag: seconds between when the note was really played and now (the microphone hears late).
  function down(m, vel = 0.7, src = 'screen', lag = 0) {
    if (held.has(m)) return;
    held.set(m, src);
    if (src !== 'mic') Sound.noteOn(m, vel); // an acoustic piano makes its own sound
    subs.down.forEach(fn => fn(m, vel, src, lag));
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
  const embedded = (() => { try { return window.top !== window; } catch (e) { return true; } })();
  function initMidi() {
    if (!navigator.requestMIDIAccess) { midiState = 'This browser has no MIDI support. Try Chrome or Edge.'; notify(); return; }
    if (midiAccess) { bindPorts(); return; }
    navigator.requestMIDIAccess().then(access => {
      midiAccess = access;
      access.onstatechange = bindPorts; // keyboards can be plugged in or out at any time
      bindPorts();
    }).catch(() => {
      midiState = embedded
        ? 'MIDI is blocked inside this embedded page. Download Songlight and open the file directly to use a keyboard.'
        : 'MIDI access was blocked. Allow MIDI devices for this page in your browser\'s site settings, then try again.';
      notify();
    });
  }
  function bindPorts() {
    const names = [], live = new Set();
    midiAccess.inputs.forEach(inp => {
      if (inp.state === 'disconnected') return;
      live.add(inp.id); names.push(inp.name);
      inp.onmidimessage = e => onMidi(e, inp.id);
    });
    // A keyboard unplugged mid-note can't send its note-offs: release them so nothing sticks.
    for (const [m, port] of [...heldPort]) if (!live.has(port)) { heldPort.delete(m); up(m, 'midi'); }
    if (pedalPort && !live.has(pedalPort)) { pedalPort = null; setPedal(false, 'midi'); }
    midiConnected = names.length > 0;
    midiState = names.length ? 'Connected: ' + names.join(', ') : 'No MIDI keyboard found. Plug one in any time.';
    notify();
  }
  function releaseMidi() {
    for (const m of [...heldPort.keys()]) { heldPort.delete(m); up(m, 'midi'); }
    setPedal(false, 'midi');
  }
  function onMidi(e, port) {
    const [st, n, v = 0] = e.data;
    const cmd = st & 0xf0;
    if (cmd === 0x90 && v > 0) {
      Sound.init();
      // A note-on for a key we think is still down means a note-off was lost: re-strike it.
      if (held.has(n)) { heldPort.delete(n); up(n, held.get(n)); }
      heldPort.set(n, port);
      down(n, Math.max(0.08, v / 127), 'midi');
    } else if (cmd === 0x80 || (cmd === 0x90 && v === 0)) {
      if (heldPort.has(n) && heldPort.get(n) !== port) return; // another keyboard still holds it
      heldPort.delete(n); up(n, 'midi');
    } else if (cmd === 0xb0) {
      if (n === 64) { pedalPort = v >= 64 ? port : null; setPedal(v >= 64, 'midi'); }
      else if (n === 120 || n === 123) releaseMidi(); // all sound off / all notes off
    }
  }

  return {
    on, down, up, initMidi, setPedal,
    get pedal() { return pedal; },
    onStatus: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    get midiState() { return midiState; },
    get midiConnected() { return midiConnected; },
    get embedded() { return embedded; },
    keyFor: m => REVERSE[m] || '',
    isHeld: m => held.has(m),
  };
})();
