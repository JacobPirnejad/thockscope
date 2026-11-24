# ThockScope

**See what your keyboard sounds like.** ThockScope listens to your custom mechanical keyboard (live from the mic, or from a recording), breaks the sound apart with a Fourier transform, and shows you:

- **Wave** – the sound as wiggles
- **Spectrum** – which pitches are inside it (bars + a smooth frequency curve), split into the THOCK, Body and CLACK zones
- **Spectrogram** – pitches over time; every key press is a stripe
- **Sound profile** – a THOCK ↔ CLACK meter for every key you press, plus pitch and brightness
- **Real example keyboards** – no keyboard handy? Try six real recordings: linear, clicky, tactile, a vintage Alps board, and the same board from two mic spots
- **Report card** – an average of all your key presses, with plain-English diagnosis ("sounds hollow", "spring ping detected") and links to fixes
- **Before / after compare** – save a result, mod your board, record again, see the difference
- **How it works** – short lessons and a hands-on "smoothie machine" that shows the Fourier transform un-mixing sounds
- **Sound recipes** – "I want a deeper thock → do this to the keycaps, plate, foam…" and fixes for ping, rattle and hollowness

It's written for curious middle-schoolers: short sentences, no math needed.

## Use it

**▶ Try it online: https://jacobpirnejad.github.io/thockscope/**

**Download it – one file:** download [`dist/ThockScope.html`](dist/ThockScope.html) and double-click it. It works offline and nothing is uploaded anywhere.

**Or from the source:** download/clone this repo and open `index.html` in Chrome, Edge, Firefox or Safari.

**Or with a local server:** `npm start` then open http://localhost:8080.

Then press **Start Mic** and type, **Upload Recording** (wav, mp3, m4a, ogg…), or pick one of the example keyboards.

Tips: put the mic about 30 cm (1 ft) from the keyboard, turn off music/fans, and wear headphones so the app doesn't hear itself. Scores depend on the mic, so compare boards using the same mic in the same spot.

## How it works (for developers)

Plain HTML/CSS/JS, no dependencies, no build needed to run.

| File | What it does |
|---|---|
| `js/fft.js` | Radix-2 FFT, windows, log-frequency bins |
| `js/engine.js` | Web Audio input (mic/file), live frames, keystroke detection & analysis, reports |
| `js/content.js` | All the words: lessons, keyboard parts, recipes, diagnosis text |
| `js/ui.js` | Draws the canvases and wires the page (themeable via CSS variables) |
| `css/app.css` | The look (Neon Noir comic theme) |
| `examples/` | The example recordings + `examples.json` (titles, credits) |
| `js/examples.js`, `js/examples/*.js` | Generated from `examples/` by `npm run examples` (works even when opened from disk) |
| `docs/ENGINE_API.md` | The data contract between engine and UI |

How a key press is analysed: the engine tracks loudness in 5 ms steps, spots sudden jumps (a key press), grabs the next ~85 ms of sound, runs an FFT, then measures brightness (spectral centroid), main pitch, how the energy splits across the Low / Mid / High zones, how fast the sound fades, and whether something keeps ringing afterwards (spring ping). Those numbers become the 0–100 thock score and the report card. The score scale was calibrated on the real example recordings: brightness around 1 kHz scores as a very deep thock, around 6 kHz as a clicky switch.

```
npm test        # engine checks on synthetic thock / clack / ping sounds
npm run examples  # rebuild js/examples*.js after changing examples/
npm run build   # bundle everything (examples included) into dist/ThockScope.html
```

## Example sound credits

The example recordings are 10-second clips (mono, volume-normalized) of recordings shared on [Freesound](https://freesound.org) under **CC0** (public domain). Credit isn't required, but thank you to:

| Example | Recording | By |
|---|---|---|
| Linear | [keyboard2.wav](https://freesound.org/people/samchitto/sounds/696040/) | samchitto |
| Clicky (Cherry MX Blue) | [Typing on a keyboard](https://freesound.org/people/SamsterBirdies/sounds/489424/) | SamsterBirdies |
| Tactile (Hako Violet, WhiteFox) | [Keyboard Typing 10 (WhiteFox, Mechanical)](https://freesound.org/people/grcekh/sounds/546167/) | grcekh |
| Vintage Alps (Omnikey 101) | [Keyboard typing sounds: modded Omnikey 101](https://freesound.org/people/zrrion/sounds/685984/) | zrrion |
| Mic spot A (Leopold FC660M) | [Mechanical Keyboard Typing (Bass Version)](https://freesound.org/people/stu556/sounds/450281/) | stu556 |
| Mic spot B (Leopold FC660M) | [Mechanical Keyboard Typing (Treble Version)](https://freesound.org/people/stu556/sounds/450282/) | stu556 |

## License

Code: MIT. Example recordings: CC0 (see above).
