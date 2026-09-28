'use strict';
const FINGER_COLORS = [null, '#ff5d73', '#ff9f1c', '#f2b705', '#14b8a6', '#7b5cff'];

class Piano {
  constructor(el) {
    this.el = el;
    this.keys = new Map();
    this.opts = { letters: true, computer: false };
    this.pointers = new Map();
    this.hinted = '';
    Input.on('down', m => this.keys.get(m)?.classList.add('down'));
    Input.on('up', m => this.keys.get(m)?.classList.remove('down'));
    el.addEventListener('pointerdown', e => {
      const k = e.target.closest('.key');
      if (!k) return;
      e.preventDefault();
      Sound.init();
      const m = +k.dataset.m;
      this.pointers.set(e.pointerId, m);
      Input.down(m, 0.75, 'screen');
    });
    const end = e => {
      const m = this.pointers.get(e.pointerId);
      if (m === undefined) return;
      this.pointers.delete(e.pointerId);
      Input.up(m, 'screen');
    };
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => el.addEventListener(t, end));
  }

  setRange(lo, hi) {
    while (Music.isBlack(lo)) lo--;
    while (Music.isBlack(hi)) hi++;
    if (lo === this.lo && hi === this.hi) return;
    this.lo = lo; this.hi = hi;
    this.render();
  }

  setOptions(o) { Object.assign(this.opts, o); if (this.lo !== undefined) this.render(); }

  render() {
    const { el, lo, hi } = this;
    el.innerHTML = '';
    this.keys.clear();
    const whites = [];
    for (let m = lo; m <= hi; m++) if (!Music.isBlack(m)) whites.push(m);
    const ww = 100 / whites.length;
    const make = (m, cls, left, width) => {
      const k = document.createElement('div');
      k.className = 'key ' + cls + (m === 60 ? ' middle-c' : '');
      k.dataset.m = m;
      k.style.left = left + '%';
      k.style.width = width + '%';
      const letter = Music.letterOf(m);
      const lbl = !Music.isBlack(m) && (this.opts.letters || letter === 'C') ? letter : '';
      const comp = this.opts.computer ? Input.keyFor(m) : '';
      k.innerHTML = `<span class="badge"></span><span class="lbl">${lbl}</span>${comp ? `<span class="ck">${comp}</span>` : ''}`;
      k.setAttribute('aria-label', Music.nameOf(m));
      el.appendChild(k);
      this.keys.set(m, k);
      if (Input.isHeld(m)) k.classList.add('down');
    };
    whites.forEach((m, i) => make(m, 'white', i * ww, ww));
    for (let m = lo; m <= hi; m++) {
      if (!Music.isBlack(m)) continue;
      const i = whites.indexOf(m - 1);
      make(m, 'black', (i + 1) * ww - ww * 0.31, ww * 0.62);
    }
  }

  // list: [{midi, finger, hand}]
  hint(list) {
    for (const n of list) {
      const k = this.keys.get(n.midi);
      if (!k) continue;
      k.classList.add('hint');
      k.classList.toggle('lh', n.hand === 'L');
      k.style.setProperty('--fc', FINGER_COLORS[n.finger] || '#ffc233');
      k.querySelector('.badge').textContent = n.finger || '';
    }
  }
  unhint(m) {
    const k = this.keys.get(m);
    if (!k) return;
    k.classList.remove('hint', 'lh');
    k.querySelector('.badge').textContent = '';
  }
  clearHints() {
    this.hinted = '';
    this.keys.forEach(k => { k.classList.remove('hint', 'lh'); k.querySelector('.badge').textContent = ''; });
  }
  // Only rewrites hints when they change (called every frame during timed play).
  setHints(list) {
    const sig = list.map(n => n.midi + ':' + n.finger).join(',');
    if (sig === this.hinted) return;
    this.clearHints();
    this.hint(list);
    this.hinted = sig;
  }
  glow(midis, cls = 'glow') { midis.forEach(m => this.keys.get(m)?.classList.add(cls)); }
  clearGlow() { this.keys.forEach(k => k.classList.remove('glow', 'glow2', 'glow3', 'found')); }
  setLit(set) { this.keys.forEach((k, m) => k.classList.toggle('lit', set.has(m))); }
  flash(m, cls) {
    const k = this.keys.get(m);
    if (!k) return;
    k.classList.remove('good', 'bad');
    void k.offsetWidth;
    k.classList.add(cls);
    clearTimeout(k._t);
    k._t = setTimeout(() => k.classList.remove(cls), 420);
  }
}
