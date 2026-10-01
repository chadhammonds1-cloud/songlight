# Songlight

A piano adventure game. You explore six realms that have lost their music and wake each place by learning and playing its song. The lessons follow the order of a traditional piano method, from finger numbers to Bach and Beethoven.

## Playing

**Easiest:** download `songlight.html` and open it in **Chrome** or **Edge** (double-click it). Everything is inside that one file. You only need an internet connection for the fonts.

**From this folder:** serve it with any local web server and open the address it prints, for example:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Progress is saved in your browser, separately for each way of opening the game.

## Ways to play

| Input | How |
|---|---|
| **MIDI keyboard** | Plug it in (USB, or Bluetooth paired to the computer), then press **Begin**. The browser asks once for permission. You can also plug it in later: open **Settings → Look for a MIDI keyboard**. The sustain pedal works too. |
| **Acoustic piano** | **Settings → Listen with the microphone.** Put the device near the piano and wear headphones, so the microphone only hears your playing. It follows one note at a time, so it scores the melody and trusts you with chords. |
| **Computer keyboard** | Bottom row `Z`–`/` plays C3–E4, top row `Q`–`]` plays C4–G5, and the rows above them play the black keys. Hold **Shift** for the pedal. |
| **Touch / mouse** | Tap the on-screen keys. |

### If the keyboard or microphone doesn't work

- Use **Chrome** or **Edge** for a MIDI keyboard. Safari doesn't support MIDI in web pages, and Firefox asks you to add an extra site permission first.
- The published preview on claude.ai runs inside another page, and browsers may block MIDI and the microphone there. Download `songlight.html` and open it directly instead.
- If you said "Block" to the permission question, allow MIDI devices or the microphone again in your browser's site settings (the icon to the left of the address bar).

## For developers

Plain HTML and JavaScript with no build step. Files load in the order listed in `index.html`.

- `js/curriculum.js`: every realm, lesson, teaching step and song. The song format is described at the top of `js/music.js`.
- `node tools/check-songs.js`: checks every song for bar lengths, fingerings, ties, slurs, pedal marks and quiz answers. Run it after editing songs.
- `node tools/build-standalone.js`: rebuilds `songlight.html` from the source files. Run it before committing.
