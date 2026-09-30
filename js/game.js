'use strict';
const Save = (() => {
  const KEY = 'songlight.v1';
  const fresh = () => ({
    done: {}, meter: {}, guided: {}, teach: {}, seen: {}, pos: {}, realm: 0,
    settings: { letters: true, computer: false, volume: 0.8, strict: 'standard' },
  });
  let d = fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const p = JSON.parse(raw); d = { ...d, ...p, settings: { ...d.settings, ...(p.settings || {}) } }; }
  } catch (e) { /* storage unavailable: play without saving */ }
  return {
    get data() { return d; },
    save() { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* ignore */ } },
    reset() { d = fresh(); try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } },
  };
})();

// Lumo's speech bubble. Lines advance on click, Enter/↑, or Middle C.
const Lumo = (() => {
  let el, textEl, actEl, queue = [], onDone = null, hideT;
  function init() {
    el = document.getElementById('lumo');
    textEl = el.querySelector('.lumo-text p');
    actEl = el.querySelector('.lumo-actions');
    el.addEventListener('click', e => { if (!e.target.closest('.lumo-actions button')) advance(); });
  }
  function say(lines, o = {}) {
    queue = lines.filter(Boolean).slice();
    onDone = o.onDone || null;
    actEl.innerHTML = '';
    (o.actions || []).forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn primary small'; b.textContent = a.label;
      b.onclick = () => { hide(); a.fn(); };
      actEl.appendChild(b);
    });
    actEl.hidden = true;
    show();
  }
  function show() {
    clearTimeout(hideT);
    const line = queue.shift();
    if (line === undefined) return;
    el.hidden = false;
    el.classList.remove('fade');
    textEl.innerHTML = line;
    textEl.classList.remove('in'); void textEl.offsetWidth; textEl.classList.add('in');
    el.classList.toggle('more', queue.length > 0);
    if (!queue.length) {
      actEl.hidden = !actEl.children.length;
      const cb = onDone; onDone = null; cb?.();
      if (!actEl.children.length) hideT = setTimeout(() => el.classList.add('fade'), 14000);
    }
  }
  function advance() {
    if (queue.length) show();
    else hide();
  }
  function hide() { clearTimeout(hideT); el.hidden = true; }
  return { init, say, advance, hide, busy: () => !!(el && !el.hidden && queue.length) };
})();

const Game = (() => {
  let realmIdx = 0, realm = null, wrongVisits = 0;
  const compiled = new Map();
  const $ = s => document.querySelector(s);
  const songOf = l => { if (!compiled.has(l.id)) compiled.set(l.id, Music.compile(l.song)); return compiled.get(l.id); };
  const isDone = id => !!Save.data.done[id];
  const nextLesson = r => (r || realm).lessons.find(l => !isDone(l.id));
  const realmComplete = r => r.lessons.length > 0 && r.lessons.every(l => isDone(l.id));
  const realmOpen = i => i === 0 || (CURRICULUM.realms[i].lessons.length > 0 && realmComplete(CURRICULUM.realms[i - 1]));

  let pitchCache = null;
  function learnedPitches() {
    if (pitchCache) return pitchCache;
    const set = new Set();
    CURRICULUM.realms.forEach(r => r.lessons.forEach(l => { if (isDone(l.id)) songOf(l).notes.forEach(n => set.add(n.midi)); }));
    return (pitchCache = [...set]);
  }

  function boot() {
    Lumo.init();
    LessonUI.init();
    World.init($('#world'), {
      isDone, songOf, learnedPitches,
      onLandmark,
      onAction: () => { if (Lumo.busy()) { Lumo.advance(); return true; } return false; },
    });
    applySettings();
    realmIdx = Math.min(Save.data.realm || 0, CURRICULUM.realms.length - 1);
    if (!realmOpen(realmIdx)) realmIdx = 0;
    realm = CURRICULUM.realms[realmIdx];
    World.load(realm, { x: Save.data.pos[realm.id] });
    World.setEnabled(false);
    World.start();
    const started = Object.keys(Save.data.seen).length > 0;
    $('#btn-begin').textContent = started ? 'Continue' : 'Begin';
    $('#btn-begin').onclick = begin;
    $('#btn-map').onclick = openMap;
    $('#btn-settings').onclick = openSettings;
    $('.clue-chip').onclick = () => { const n = nextLesson(); Lumo.say([n ? n.clue : realmDoneLine()]); };
    document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => closeOverlay(b.closest('.overlay')));
    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const o = document.querySelector('#map:not([hidden]), #settings:not([hidden])');
      if (o) closeOverlay(o);
    });
    Input.onStatus(updateMidiStatus);
    setInterval(savePos, 4000);
    window.addEventListener('pagehide', savePos);
  }

  function savePos() { if (realm) { Save.data.pos[realm.id] = Math.round(World.x); Save.save(); } }

  function begin() {
    Sound.init();
    Input.initMidi();
    $('#title').hidden = true;
    $('.hud').hidden = false;
    enterRealm(realmIdx);
  }

  function enterRealm(i) {
    savePos();
    realmIdx = i; realm = CURRICULUM.realms[i];
    Save.data.realm = i; Save.save();
    World.load(realm, { x: Save.data.pos[realm.id] });
    World.setHint(null); World.setEnabled(true);
    wrongVisits = 0;
    hud();
    const n = nextLesson();
    if (!Save.data.seen[realm.id]) {
      Save.data.seen[realm.id] = true; Save.save();
      Lumo.say([...realm.intro, n ? n.clue : realmDoneLine()]);
    } else Lumo.say([n ? n.clue : realmDoneLine()]);
  }

  function realmDoneLine() {
    const nr = CURRICULUM.realms[realmIdx + 1];
    if (nr && realmOpen(realmIdx + 1)) return `The whole ${realm.name} is awake! Open the <b>map</b> to travel to ${nr.name}.`;
    if (!nr && CURRICULUM.realms.every(realmComplete)) return `Every realm is awake. The <b>Great Song</b> is whole again, and you brought it back, one song at a time. Every place you woke will play its song for you whenever you visit.`;
    return `The whole ${realm.name} is awake! The path beyond is still forming… more songs are on their way. You can visit any place here to play its song again.`;
  }

  function hud() {
    $('.realm-name').textContent = realm.name;
    $('.realm-level').textContent = realm.level;
    $('.progress-dots').innerHTML = realm.lessons.map(l => `<span class="${isDone(l.id) ? 'on' : ''}" title="${l.title}"></span>`).join('');
    const n = nextLesson();
    $('.clue-chip').innerHTML = `<span aria-hidden="true">✦</span> ${n ? n.clueShort : 'Everything here is awake.'}`;
  }

  function onLandmark(l) {
    if (LessonUI.isOpen) return;
    const n = nextLesson();
    if (isDone(l.id)) { openLesson(l, true); return; }
    if (n && l.id === n.id) { openLesson(l, false); return; }
    wrongVisits++;
    const lines = [`${l.early || 'This place is still asleep.'} It isn't the one we're looking for yet.`];
    if (n && wrongVisits >= 2) {
      World.setHint(n);
      lines.push(`Here's a hint: ${n.clueShort} It's ${n.landmark.x < World.x ? 'back to the <b>left</b>' : 'further to the <b>right</b>'}. I'll make it sparkle!`);
    } else if (n) lines.push(n.clue);
    Lumo.say(lines);
  }

  function openLesson(l, replay) {
    savePos();
    World.setEnabled(false);
    Lumo.hide();
    $('.hud').hidden = true;
    LessonUI.open(l, {
      replay, realmName: realm.name,
      onClose: res => {
        $('.hud').hidden = false;
        World.setEnabled(true);
        if (res.completed) afterComplete(l);
        else if (!replay && !isDone(l.id)) Lumo.say([`The ${l.title} will wait for you. Come back any time.`]);
      },
    });
  }

  function afterComplete(l) {
    pitchCache = null;
    World.refresh(); World.setHint(null);
    wrongVisits = 0;
    hud();
    const n = nextLesson();
    if (n) { Lumo.say([l.done, n.clue]); return; }
    const hasNext = CURRICULUM.realms[realmIdx + 1] && realmOpen(realmIdx + 1);
    Lumo.say([l.done, realmDoneLine()], hasNext ? { actions: [{ label: 'Open the map', fn: openMap }] } : {});
  }

  // ---------------------------------------------------------------- Map
  const ISLES = [
    { x: 150, y: 400, color: '#39c18e' }, { x: 330, y: 235, color: '#17a38a' }, { x: 520, y: 390, color: '#7b5cff' },
    { x: 690, y: 215, color: '#3fb7ff' }, { x: 850, y: 380, color: '#ff7a45' }, { x: 880, y: 120, color: '#ffc233' },
  ];
  function blob(cx, cy, r, seed) {
    let d = '';
    for (let i = 0; i <= 24; i++) {
      const a = i / 24 * Math.PI * 2;
      const rr = r * (1 + 0.14 * Math.sin(a * 3 + seed) + 0.08 * Math.sin(a * 5 + seed * 2));
      d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rr * 1.35).toFixed(1) + ' ' + (cy + Math.sin(a) * rr * 0.8).toFixed(1);
    }
    return d + 'Z';
  }
  function openMap() {
    Lumo.hide();
    World.setEnabled(false);
    const svg = $('#map-svg');
    const path = ISLES.map(p => `${p.x},${p.y}`).join(' ');
    svg.innerHTML = `<defs><radialGradient id="sea" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#58b8ff"/><stop offset="1" stop-color="#2a4fbf"/></radialGradient></defs>
      <rect width="1000" height="540" rx="28" fill="url(#sea)"/>
      <polyline points="${path}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="4" stroke-dasharray="2 12" stroke-linecap="round"/>
      ${CURRICULUM.realms.map((r, i) => {
        const p = ISLES[i], open = realmOpen(i), here = i === realmIdx;
        const fill = open ? p.color : '#9a98b3';
        const done = r.lessons.filter(l => isDone(l.id)).length;
        return `<g class="isle${open ? ' open' : ' locked'}${here ? ' here' : ''}" data-i="${i}" tabindex="0" role="button" aria-label="${r.name}${open ? '' : ' (still in the mist)'}">
          <path d="${blob(p.x, p.y + 8, 62, i + 1)}" fill="rgba(0,0,40,.25)"/>
          <path d="${blob(p.x, p.y, 62, i + 1)}" fill="${fill}" stroke="#fff" stroke-width="3"/>
          ${open ? '' : `<path d="${blob(p.x, p.y, 70, i + 7)}" fill="rgba(235,235,250,.65)"/>`}
          ${here ? `<circle cx="${p.x}" cy="${p.y - 10}" r="9" fill="#ffc233" stroke="#fff" stroke-width="3"/>` : ''}
          <text x="${p.x}" y="${p.y + 76}" text-anchor="middle" class="isle-name">${r.name}</text>
          <text x="${p.x}" y="${p.y + 96}" text-anchor="middle" class="isle-sub">${r.level}${r.lessons.length ? ` · ${done}/${r.lessons.length}` : ''}</text>
        </g>`;
      }).join('')}`;
    svg.querySelectorAll('.isle').forEach(g => {
      const pick = () => realmCard(+g.dataset.i);
      g.onclick = pick;
      g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    });
    realmCard(realmIdx);
    $('#map').hidden = false;
  }

  function realmCard(i) {
    const r = CURRICULUM.realms[i], open = realmOpen(i);
    document.querySelectorAll('#map-svg .isle').forEach(g => g.classList.toggle('sel', +g.dataset.i === i));
    const card = $('.realm-card');
    if (!open) {
      card.innerHTML = `<p class="kicker">${r.level}</p><h3>${r.name}</h3>
        <p>${r.lessons.length ? `The mist will lift when ${CURRICULUM.realms[i - 1].name} is fully awake.` : 'The mist hasn\'t lifted here yet. This land is still being written.'}</p>
        ${r.planned ? `<p class="small"><b>You'll learn:</b> ${r.planned.join(' · ')}</p>` : ''}
        ${r.plannedSongs ? `<p class="small"><b>Songs you'll play:</b> ${r.plannedSongs.join(' · ')}</p>` : ''}`;
      return;
    }
    const n = nextLesson(r);
    card.innerHTML = `<p class="kicker">${r.level}</p><h3>${r.name}</h3>
      <ol class="lesson-list">${r.lessons.map(l => {
        const d = isDone(l.id), cur = n && n.id === l.id;
        return `<li class="${d ? 'done' : cur ? 'cur' : 'later'}"><span class="ll-mark" aria-hidden="true">${d ? '✓' : cur ? '✦' : '·'}</span>
          <span class="ll-title">${d || cur ? l.title : '???'}</span><span class="ll-concept">${d || cur ? l.concept : ''}</span>
          ${d ? `<button class="chip-btn" data-play="${l.id}">Play</button>` : ''}</li>`;
      }).join('')}</ol>
      ${r.planned ? `<p class="small">Still to come here: ${r.planned.join(' · ')}</p>` : ''}
      <button class="btn primary travel">${i === realmIdx ? 'Back to exploring' : `Travel to ${r.name}`}</button>`;
    card.querySelector('.travel').onclick = () => { $('#map').hidden = true; if (i === realmIdx) { World.setEnabled(true); hud(); } else enterRealm(i); };
    card.querySelectorAll('[data-play]').forEach(b => b.onclick = () => {
      const l = r.lessons.find(x => x.id === b.dataset.play);
      $('#map').hidden = true;
      if (i !== realmIdx) enterRealm(i);
      openLesson(l, true);
    });
  }

  function closeOverlay(o) {
    o.hidden = true;
    if (!LessonUI.isOpen && $('#title').hidden) World.setEnabled(true);
  }

  // ---------------------------------------------------------------- Settings
  function openSettings() {
    World.setEnabled(false);
    const s = Save.data.settings;
    $('#set-letters').checked = s.letters;
    $('#set-computer').checked = s.computer;
    $('#set-volume').value = Math.round(s.volume * 100);
    document.querySelectorAll('[name="strict"]').forEach(r => { r.checked = r.value === s.strict; });
    const reset = $('#set-reset');
    reset.textContent = 'Start over'; reset.dataset.armed = '';
    updateMidiStatus();
    $('#settings').hidden = false;
  }
  function applySettings() {
    const s = Save.data.settings;
    Sound.setVolume(s.volume);
  }
  function updateMidiStatus() {
    const el = $('#midi-status');
    if (!el) return;
    el.textContent = Input.midiState;
    el.classList.toggle('ok', Input.midiConnected);
    $('.hud .midi-dot')?.classList.toggle('ok', Input.midiConnected);
  }
  function bindSettings() {
    const s = () => Save.data.settings;
    $('#set-letters').onchange = e => { s().letters = e.target.checked; Save.save(); };
    $('#set-computer').onchange = e => { s().computer = e.target.checked; Save.save(); };
    $('#set-volume').oninput = e => { s().volume = e.target.value / 100; Sound.setVolume(s().volume); Save.save(); };
    document.querySelectorAll('[name="strict"]').forEach(r => r.onchange = () => { s().strict = r.value; Save.save(); });
    $('#set-midi').onclick = () => Input.initMidi();
    $('#set-reset').onclick = e => {
      const b = e.currentTarget;
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to erase all progress'; return; }
      Save.reset(); pitchCache = null;
      $('#settings').hidden = true;
      enterRealm(0);
    };
  }

  return { boot: () => { boot(); bindSettings(); } };
})();

Game.boot();
