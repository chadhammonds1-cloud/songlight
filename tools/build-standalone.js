#!/usr/bin/env node
'use strict';
// Packs the game into one self-contained file, songlight.html, that runs by double-clicking it.
// Opening the file directly (not inside another page) lets the browser use a MIDI keyboard and the microphone.
// Usage: node tools/build-standalone.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

html = html.replace(/<link rel="stylesheet" href="([^"]+\.css)">/g, (_, f) => `<style>\n${read(f)}\n</style>`);
// "</script" inside the code would end the inline script early.
html = html.replace(/<script src="([^"]+\.js)"><\/script>/g, (_, f) => `<script>\n${read(f).replace(/<\/script/gi, '<\\/script')}\n</script>`);

const left = html.match(/<(script|link)[^>]+(src|href)="(?!https?:)[^"]+"/g);
if (left) { console.error('Not inlined:', left); process.exit(1); }
fs.writeFileSync(path.join(root, 'songlight.html'), html);
console.log(`songlight.html written (${Math.round(html.length / 1024)} KB)`);
