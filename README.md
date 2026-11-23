# ThockScope

**See what your keyboard sounds like.** ThockScope listens to your custom mechanical keyboard (live from the mic, or from a recording), breaks the sound apart with a Fourier transform, and shows you:

- **Wave** – the sound as wiggles
- **Spectrum** – which pitches are inside it (bars + a smooth frequency curve), split into the THOCK, Body and CLACK zones
- **Spectrogram** – pitches over time; every key press is a stripe
- **Sound profile** – a THOCK ↔ CLACK meter for every key you press, plus pitch, brightness and fade time
- **Report card** – an average of all your key presses, with plain-English diagnosis ("sounds hollow", "spring ping detected") and links to fixes
- **Before / after compare** – save a result, mod your board, record again, see the difference
- **How it works** – short lessons and a hands-on "smoothie machine" that shows the Fourier transform un-mixing sounds
- **Sound recipes** – "I want a deeper thock → do this to the keycaps, plate, foam…" and fixes for ping, rattle and hollowness

It's written for curious middle-schoolers: short sentences, no math needed.

## Use it

**Option 1 – one file (easiest):** download [`dist/ThockScope.html`](dist/ThockScope.html) and double-click it. It works offline and nothing is uploaded anywhere.

**Option 2 – from the source:** download/clone this repo and open `index.html` in Chrome, Edge, Firefox or Safari.

**Option 3 – local server:** `npm start` then open http://localhost:8080.

Then press **Start Mic** and type, or **Upload Recording** (wav, mp3, m4a, ogg…).

Tips: put the mic about 30 cm (1 ft) from the keyboard, turn off music/fans, and wear headphones so the app doesn't hear itself. Scores depend on the mic, so compare boards using the same mic in the same spot.

## How it works (for developers)

Plain HTML/CSS/JS, no dependencies, no build needed to run.

| File | What it does |
|---|---|
| `js/fft.js` | Radix-2 FFT, windows, log-frequency bins |
| `js/engine.js` | Web Audio input (mic/file), live frames, keystroke detection & analysis, reports |
| `js/content.js` | All the words: lessons, keyboard parts, recipes, diagnosis text |
| `js/ui.js` | Draws the canvases and wires the page (themeable via CSS variables) |
| `css/app.css` | The look |
| `docs/ENGINE_API.md` | The data contract between engine and UI |

How a key press is analysed: the engine tracks loudness in 5 ms steps, spots sudden jumps (a key press), grabs the next ~85 ms of sound, runs an FFT, then measures brightness (spectral centroid), main pitch, how the energy splits across the Low / Mid / High zones, how fast the sound fades, and whether something keeps ringing afterwards (spring ping). Those numbers become the 0–100 thock score and the report card.

```
npm test        # engine checks on synthetic thock / clack / ping sounds
npm run build   # bundle everything into dist/ThockScope.html
```

## License

MIT
