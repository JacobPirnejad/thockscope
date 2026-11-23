# ThockScope engine API

The app is split so a new visual design can be dropped on top without touching the audio code:

| File | Role |
|---|---|
| `js/fft.js` | `window.ThockFFT` — FFT + windowing + log-bin helpers (pure math) |
| `js/engine.js` | `window.ThockEngine` — mic/file input, live frames, keystroke detection, reports |
| `js/content.js` | `window.ThockContent` — all the words: lessons, keyboard parts, recipes, diagnosis text |
| `js/ui.js` | the current UI: draws canvases, renders content, wires buttons (**replace/restyle this**) |
| `css/app.css` | the current look (**replace this**) |

All files are classic `<script>`s (no modules, no build) so `index.html` works when double-clicked from disk.

## Starting / stopping

```js
const E = ThockEngine;
await E.startMic();            // must be called from a click; asks for mic permission
const report = await E.loadFile(fileFromInput);   // decodes + analyses the whole file offline
E.playFile();                  // plays the loaded file through the live visualisers
E.pauseFile();
E.stop();                      // stops mic or playback
E.setSensitivity(0.5);         // 0..1 keystroke detection sensitivity
E.getSessionSummary();         // Summary of everything heard live since last reset
E.resetSession();
E.state                        // 'idle' | 'mic' | 'file-playing' | 'file-paused'
```

## Events

```js
E.on('state', (state) => {});        // state changed
E.on('frame', (frame) => {});        // ~60x per second while mic/file is running
E.on('keystroke', (hit) => {});      // a key press was detected and analysed (live)
E.on('file', (report) => {});        // a file finished loading + analysing
E.on('ended', () => {});             // file playback finished
E.on('session-reset', () => {});
```

### `frame` (live, arrays are reused — copy if you keep them)

| field | type | meaning |
|---|---|---|
| `waveform` | Float32Array(4096) | raw sound wave, -1..1 (≈85 ms) |
| `freqDb` | Float32Array(2048) | full-resolution spectrum, dB, bin k = k × `binHz` |
| `binHz` | number | Hz per `freqDb` bin |
| `binsHz` | Float32Array(96) | centre frequency of each display bar, log spaced 40 Hz – 16 kHz |
| `binsDb` | Float32Array(96) | bar heights in dB (≈ -110 quiet … -10 loud) |
| `curveDb` | Float32Array(96) | smoothed version of `binsDb` — the "frequency curve" |
| `rms`, `levelDb` | number | loudness right now |
| `features` | Features | see below, for this frame |
| `playhead` | number\|null | seconds into the file when playing a file |

### Features (used by frames and keystrokes)

| field | meaning |
|---|---|
| `centroid` | "brightness" in Hz — the balance point of the spectrum |
| `peakHz` | main pitch — loudest frequency |
| `bands` | `{low, mid, high}` energy fractions (sum ≈ 1). Zones are in `E.BANDS` |
| `thockScore` | 0 (sharp clack) … 100 (deep thock) |
| `profile` | id from `E.PROFILES`: `deep-thock`, `thock`, `creamy`, `clack`, `sharp-clack` |

`E.BANDS` = Low 80–700 Hz "THOCK zone", Mid 700–2500 Hz "Body zone", High 2500–12000 Hz "CLACK zone".

### `keystroke` (hit)

All Features fields plus:

| field | meaning |
|---|---|
| `time` | seconds (stream time) |
| `decayMs` | how long the sound takes to fade 20 dB — short = crisp, long = hollow/echoey |
| `ringy`, `ringHz` | metal ring / spring ping detected (and its pitch) |
| `peakDb` | loudness of the hit, dBFS |
| `clipped` | the mic was overloaded |
| `binsDb` | Float32Array(96) spectrum of this key press (same axis as frames) |
| `snippet` | Float32Array(256) — first 60 ms of the wave, for drawing the hit's shape |

### Summary (`getSessionSummary()`, `report.summary`)

`count, thockScore, profile, profileName, consistency (0–100), centroid, peakHz, bands, decayMs, ringFraction, peakDb, clipped, binsHz, binsDb, curveDb, scores[], diagnosis[]`

`diagnosis` ids: `too-few-hits, clipping, too-quiet, very-bright, bright, balanced, deep, ringy, hollow, inconsistent` → text + recommended recipe ids in `ThockContent.diagnosis`.

### File report (`loadFile` result / `file` event)

`{ name, duration, sampleRate, hits[], summary, overview }` — `overview` is Float32Array(2400) of min/max pairs for drawing the whole recording.

## Fourier demo

```js
E.demoMix([{hz:150, amp:1}, {hz:400, amp:0.6}, {hz:900, amp:0.4}])
// -> { wave, waveMs, spectrum, binHz, maxHz, sampleRate }
```
Mix simple sine waves ("fruits"), get the blended wave ("smoothie") and its spectrum (the un-mixed fruits).

## Content

`ThockContent.lessons[]`, `.parts[]`, `.recipes[]`, `.profiles{}`, `.diagnosis{}`, `.recordingTips[]`, `.glossary[]` — see `js/content.js`.
