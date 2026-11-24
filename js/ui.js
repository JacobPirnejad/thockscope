/*
 * ThockScope — ui.js  (Neon Noir front end)
 * Draws the charts exactly the way the chosen Neon Noir mockup does, but from real
 * engine data: a scrolling waveform of the last 1.6 s, hatched glowing spectrum bars
 * with a smooth curve, and a cell spectrogram of the last 4 s.
 * Colors come from the CSS variables in css/app.css. Requires fft.js, engine.js, content.js.
 */
(function () {
  'use strict';
  const E = window.ThockEngine, C = window.ThockContent, F = window.ThockFFT;
  const root = document.documentElement;
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const nowS = () => performance.now() / 1000;

  // ------------------------------------------------------------ colors
  let col = {};
  let pats = {};
  function readColors() {
    const cs = getComputedStyle(root), v = (n) => cs.getPropertyValue(n).trim();
    col = {
      pink: v('--pink'), violet: v('--violet'), cyan: v('--cyan'), chalk: v('--chalk'), dim: v('--chalk-dim'),
      edge: v('--edge'), grid: v('--grid'), well: v('--well') || '#070912', caption: v('--caption'), ink: v('--ink') || '#000',
      ramp: ['--s0', '--s1', '--s2', '--s3', '--s4'].map(v),
      fruits: [v('--fruit-a'), v('--fruit-b'), v('--fruit-c')],
      font: v('--font-data') || 'sans-serif',
    };
    col.zones = [col.pink, col.violet, col.cyan];
    pats = {};
  }
  const font = (px, w) => `${w || 600} ${Math.round(px * DPR)}px ${col.font}`;

  function ctxFor(c) {
    const r = c.getBoundingClientRect();
    const w = Math.max(2, Math.round(r.width * DPR)), h = Math.max(2, Math.round(r.height * DPR));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); g.shadowBlur = 0; g.setLineDash([]);
    return g;
  }
  /** Diagonal ink hatching, like the mockup's bars. */
  function hatch(g, color) {
    const id = g.canvas.id + color;
    if (pats[id]) return pats[id];
    const s = Math.round(7 * DPR), p = document.createElement('canvas'); p.width = p.height = s;
    const q = p.getContext('2d'); q.strokeStyle = color; q.lineWidth = Math.max(1, s * 0.16);
    q.beginPath(); q.moveTo(-1, s + 1); q.lineTo(s + 1, -1); q.moveTo(-1, 1); q.lineTo(1, -1); q.moveTo(s - 1, s + 1); q.lineTo(s + 1, s - 1); q.stroke();
    return (pats[id] = g.createPattern(p, 'repeat'));
  }

  // ------------------------------------------------------------ frequency axis (same as the mockup)
  const FMIN = 60, FMAX = 12000, LR = Math.log(FMAX / FMIN);
  const fx = (f) => Math.log(f / FMIN) / LR;
  const xf = (x) => FMIN * Math.exp(x * LR);
  const ZONES = [E.BANDS[0].to, E.BANDS[1].to];
  const zoneOf = (f) => (f < ZONES[0] ? 0 : f < ZONES[1] ? 1 : 2);
  const NB = 36; // bars (and spectrogram rows)

  // Map the engine's 96 log bins onto the 36 bars.
  const binsHz = E.summarize([]).binsHz;
  const barMap = [];
  for (let i = 0; i < NB; i++) {
    const lo = xf(i / NB), hi = xf((i + 1) / NB), idx = [];
    for (let b = 0; b < binsHz.length; b++) if (binsHz[b] >= lo && binsHz[b] < hi) idx.push(b);
    if (!idx.length) { let best = 0; for (let b = 1; b < binsHz.length; b++) if (Math.abs(Math.log(binsHz[b] / xf((i + 0.5) / NB))) < Math.abs(Math.log(binsHz[best] / xf((i + 0.5) / NB)))) best = b; idx.push(best); }
    barMap.push(idx);
  }
  function toBars(binsDb, out) {
    out = out || new Float32Array(NB);
    for (let i = 0; i < NB; i++) {
      let p = 0; for (const b of barMap[i]) p += Math.pow(10, binsDb[b] / 10);
      out[i] = 10 * Math.log10(p / barMap[i].length + 1e-20);
    }
    return out;
  }

  // ------------------------------------------------------------ live display state
  const WAVE_WIN = 1.6, SG_WIN = 4.0, WAVE_COL = 0.004; // seconds
  let waveCols = [];            // {t, top, bot}
  let waveRef = 0.02;           // loudest recent wiggle (auto-zoom)
  let specCols = [];            // {t, v: Float32Array(NB) 0..1}
  const holdDb = new Float32Array(NB).fill(-160);
  let topDb = -60;              // auto-range top for bars (loudest recent level)
  let noiseDb = null;           // room noise level, so silence stays dark
  let lastFrameT = 0;
  let warm = 0;
  let viewT = nowS();           // the "NOW" edge of the scrolling charts

  function resetDisplay() {
    waveCols = []; specCols = []; holdDb.fill(-160); topDb = -60; noiseDb = null; waveRef = 0.02; lastFrameT = 0; waveClock = 0; warm = 0;
  }
  function normDb(db) {
    const lo = Math.max(topDb - 50, (noiseDb == null ? -200 : noiseDb + 12));
    return clamp((db - lo) / (topDb + 3 - lo), 0, 1);
  }

  /** Waveform: split a block of raw samples (starting at time t0) into 4 ms columns. */
  function pushWave(samples, t0, sr) {
    const per = Math.max(1, Math.round(sr * WAVE_COL));
    for (let s = 0; s < samples.length; s += per) {
      let mx = 0, mn = 0;
      for (let i = s; i < Math.min(samples.length, s + per); i++) { const x = samples[i]; if (x > mx) mx = x; if (x < mn) mn = x; }
      waveCols.push({ t: t0 + s / sr, top: mx, bot: -mn });
      waveRef = Math.max(waveRef, mx, -mn);
    }
    const dur = samples.length / sr;
    waveRef = Math.max(0.02, waveRef * Math.exp(-dur / 4));
    while (waveCols.length && waveCols[0].t < t0 + dur - WAVE_WIN - 0.1) waveCols.shift();
  }
  let waveClock = 0;
  E.on('samples', ({ data, sampleRate }) => {
    const dur = data.length / sampleRate, t = nowS();
    // keep blocks back-to-back so the scrolling wave never has holes
    const start = waveClock && Math.abs(t - (waveClock + dur)) < 0.15 ? waveClock : t - dur;
    pushWave(data, start, sampleRate);
    waveClock = start + dur;
  });

  /** Spectrum + spectrogram: feed one analyser frame into the histories. */
  function ingest(t, binsDb, dt) {
    // spectrum: bars with a peak-hold that slowly falls, and an auto-ranging top
    const cur = toBars(binsDb);
    let mx = -200;
    for (let i = 0; i < NB; i++) { holdDb[i] = Math.max(cur[i], holdDb[i] - 40 * dt); if (cur[i] > mx) mx = cur[i]; }
    // noise floor = typical (median) level, falling fast and rising slowly
    const med = Array.from(cur).sort((a, b) => a - b)[NB >> 1];
    noiseDb = noiseDb == null ? med : med < noiseDb ? med : noiseDb + (med - noiseDb) * Math.min(1, dt * 0.15);
    topDb = Math.max(mx, topDb - 5 * dt, noiseDb + 35);
    const v = new Float32Array(NB);
    for (let i = 0; i < NB; i++) v[i] = normDb(cur[i]);
    if (++warm > 4) specCols.push({ t, v }); // skip the first frames while the scale settles
    while (specCols.length && specCols[0].t < t - SG_WIN - 0.2) specCols.shift();
  }

  // ------------------------------------------------------------ drawing: waveform (mockup "line" mode)
  function drawWave() {
    const c = $('#cv-wave'); const g = ctxFor(c), W = c.width, H = c.height, mid = H / 2, amp = H * 0.44;
    g.strokeStyle = col.edge; g.lineWidth = 1.5 * DPR;
    g.beginPath(); g.moveTo(0, mid); g.lineTo(W, mid); g.stroke();
    if (!waveCols.length) return;
    const colW = (W * WAVE_COL) / WAVE_WIN, t0 = viewT - WAVE_WIN;
    g.strokeStyle = col.cyan; g.lineWidth = Math.max(1, colW * 0.7);
    g.shadowColor = col.cyan; g.shadowBlur = 10 * DPR;
    g.beginPath();
    for (const w of waveCols) {
      if (w.t < t0) continue;
      const x = ((w.t - t0) / WAVE_WIN) * W;
      const top = Math.max(0.02, w.top / waveRef), bot = Math.max(0.02, w.bot / waveRef);
      g.moveTo(x, mid - Math.min(1, top) * amp); g.lineTo(x, mid + Math.min(1, bot) * amp);
    }
    g.stroke(); g.shadowBlur = 0;
  }

  // ------------------------------------------------------------ drawing: spectrum (mockup hatch bars + glow curve)
  /**
   * @param canvas
   * @param vals   Float32Array(NB) 0..1 bar heights
   * @param opts   { pin: Float32Array 0..1 (dashed "Before" curve), peakWrap: element to position the PEAK tag }
   */
  function drawBars(canvas, vals, opts = {}) {
    const g = ctxFor(canvas), W = canvas.width, H = canvas.height, lw = 2 * DPR;
    const padB = 24 * DPR, padT = 18 * DPR, ch = H - padB - padT;
    g.strokeStyle = col.grid; g.lineWidth = DPR; g.setLineDash([4 * DPR, 4 * DPR]);
    for (let k = 1; k < 4; k++) { const gy = Math.round(padT + (ch * k) / 4) + 0.5; g.beginPath(); g.moveTo(0, gy); g.lineTo(W, gy); g.stroke(); }
    g.strokeStyle = col.dim; g.lineWidth = 1.5 * DPR; g.setLineDash([6 * DPR, 4 * DPR]);
    ZONES.forEach((f) => { const x = Math.round(fx(f) * W) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H - padB); g.stroke(); });
    g.setLineDash([]);

    const slot = W / NB, gap = slot * 0.24, bw = slot - gap;
    if (vals) {
      for (let i = 0; i < NB; i++) {
        const z = zoneOf(xf((i + 0.5) / NB)), h = Math.max(3 * DPR, vals[i] * ch);
        const x = i * slot + gap / 2, y = padT + ch - h;
        g.shadowColor = g.fillStyle = col.zones[z]; g.shadowBlur = 12 * DPR;
        g.fillRect(x, y, bw, h); g.shadowBlur = 0;
        g.fillStyle = hatch(g, 'rgba(0,0,0,.45)'); g.fillRect(x, y, bw, h);
        g.strokeStyle = col.ink; g.lineWidth = lw; g.strokeRect(x, y, bw, h);
      }
    }
    const curve = (arr, color, dash) => {
      const lift = 7 * DPR;
      const pts = Array.from(arr, (v, n) => [(n + 0.5) * slot, padT + ch - v * ch - lift]);
      g.lineJoin = g.lineCap = 'round';
      g.shadowColor = color; g.shadowBlur = dash ? 0 : 14 * DPR;
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let n = 0; n < pts.length - 1; n++) {
        const p0 = pts[n - 1] || pts[n], p1 = pts[n], p2 = pts[n + 1], p3 = pts[n + 2] || p2;
        g.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
      }
      g.strokeStyle = color; g.lineWidth = 3 * DPR; g.setLineDash(dash ? [8 * DPR, 6 * DPR] : []);
      g.stroke(); g.setLineDash([]); g.shadowBlur = 0;
    };
    if (opts.pin) curve(opts.pin, col.caption, true);
    if (vals) curve(vals, col.chalk, false);

    g.fillStyle = col.dim; g.font = font(11); g.textBaseline = 'bottom'; g.textAlign = 'center';
    [[100, '100'], [250, '250'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k Hz']].forEach(([f, label]) => {
      const tw = g.measureText(label).width, x = Math.min(W - tw / 2 - 2 * DPR, Math.max(tw / 2 + 2 * DPR, fx(f) * W));
      g.fillText(label, x, H - 4 * DPR);
    });
  }
  function drawSpectrum() {
    const has = holdDb[0] > -150;
    const vals = has ? Float32Array.from(holdDb, normDb) : null;
    drawBars($('#cv-spectrum'), vals);
  }

  // ------------------------------------------------------------ drawing: spectrogram (mockup "cells" mode)
  function drawSpectro() {
    const c = $('#cv-spectrogram'); const g = ctxFor(c), W = c.width, H = c.height;
    const ramp = col.ramp, L = ramp.length, rows = NB;
    const cols = Math.max(20, Math.round(((rows * W) / H) * 0.6));
    const dt = SG_WIN / cols, cw = W / cols, rh = H / rows, t0 = viewT - SG_WIN;
    g.fillStyle = ramp[0]; g.fillRect(0, 0, W, H);
    const cell = new Float32Array(rows);
    let k = 0, lastT = -Infinity;
    for (let j = 0; j < cols; j++) {
      const a = t0 + j * dt, b = a + dt;
      let any = false;
      while (k < specCols.length && specCols[k].t < a) k++;
      for (let m = k; m < specCols.length && specCols[m].t < b; m++) {
        if (!any) cell.fill(0);
        any = true; lastT = specCols[m].t;
        const v = specCols[m].v; for (let r = 0; r < rows; r++) if (v[r] > cell[r]) cell[r] = v[r];
      }
      // no frame landed in this column (the browser skipped one): repeat the last column if it's recent
      if (!any && !(a - lastT < 0.06 && lastT > -Infinity)) continue;
      const x = j * cw;
      for (let r = 0; r < rows; r++) {
        const lv = Math.min(L - 1, Math.floor(Math.pow(cell[r], 0.7) * L));
        if (lv > 0) { g.fillStyle = ramp[lv]; g.fillRect(Math.floor(x), Math.floor(H - (r + 1) * rh), Math.ceil(cw) + 1, Math.ceil(rh) + 1); }
      }
    }
    g.strokeStyle = 'rgba(236,233,245,.3)'; g.lineWidth = 1.5 * DPR; g.setLineDash([6 * DPR, 5 * DPR]);
    ZONES.forEach((f) => { const y = Math.round(H - fx(f) * H) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); });
    g.setLineDash([]);
  }

  function drawLive() { drawWave(); drawSpectrum(); drawSpectro(); }

  // ------------------------------------------------------------ profile card
  function setStatus(msg, isError) {
    const s = $('#status-text'); s.textContent = msg || '';
    $('.status').classList.toggle('error', !!isError);
  }
  function showPeak(hz) {
    const tag = $('#peak-tag');
    if (!hz) { tag.hidden = true; return; }
    $('#spectrum-wrap').style.setProperty('--peak-x', clamp(fx(hz) * 100, 7, 93).toFixed(1) + '%');
    $('#peak-hz').textContent = Math.round(hz) + ' Hz';
    tag.hidden = false;
  }
  function showProfile(f) {
    const p = C.profiles[f.profile] || {};
    $('#prof-word').textContent = p.word || p.name || '?';
    $('#prof-says').textContent = p.says || '';
    const clackiness = clamp(100 - f.thockScore, 3, 97); // keep the needle visible at the ends
    const meter = $('#meter');
    meter.style.setProperty('--pos', clackiness + '%');
    meter.setAttribute('aria-valuenow', String(clackiness));
    $('#st-pitch').textContent = Math.round(f.peakHz);
    $('#st-bright').textContent = C.brightnessWord(f.centroid);
    $('#st-centroid').textContent = Math.round(f.centroid / 10) * 10 >= 1000 ? (Math.round(f.centroid / 10) * 10).toLocaleString('en-US') : Math.round(f.centroid);
    root.setAttribute('data-profile', f.profile === 'clack' || f.profile === 'sharp-clack' ? 'clacky' : 'thocky');
    showPeak(f.peakHz);
  }
  function clearProfile() {
    $('#prof-word').textContent = '?';
    $('#prof-says').textContent = C.ui.idle;
    $('#meter').style.setProperty('--pos', '50%');
    $('#st-pitch').textContent = '—'; $('#st-bright').textContent = '—'; $('#st-centroid').textContent = '—';
    root.removeAttribute('data-profile');
    showPeak(0);
  }

  // ------------------------------------------------------------ report card
  let currentSummary = null;
  let pinned = null;
  try { pinned = JSON.parse(localStorage.getItem('thockscope.before') || 'null'); } catch (_) { pinned = null; }
  if (pinned && (!pinned.bars || pinned.bars.length !== NB)) pinned = null; // older saved format

  function summaryBars(sum) {
    const db = toBars(sum.binsDb);
    let mx = -200; for (const v of db) mx = Math.max(mx, v);
    return Float32Array.from(db, (v) => clamp((v - (mx - 38)) / 40, 0, 1)); // 40 dB view: faint spill-over stays small
  }
  function renderReport(sum, source) {
    currentSummary = sum;
    const head = $('#rep-headline'), bands = $('#rep-bands'), list = $('#rep-diagnosis'), cmp = $('#rep-compare');
    list.innerHTML = ''; bands.innerHTML = '';
    if (!sum || !sum.count) {
      head.textContent = source === 'file' ? 'No key presses found in this recording. Try sliding Sensitivity up.' : 'Type some keys to get your report.';
      cmp.hidden = true;
      drawBars($('#cv-report'), null, { pin: pinned && Float32Array.from(pinned.bars) });
      return;
    }
    head.textContent = `${sum.profileName} · ${sum.thockScore}/100 thock · ${sum.count} keys · pitch ${sum.peakHz} Hz`;
    const pct = (v) => Math.round(v * 100);
    [['low', 'band-low', 'LOW'], ['mid', 'band-mid', 'MID'], ['high', 'band-high', 'HIGH']].forEach(([k, cls, name]) => {
      const s = el('span', cls, pct(sum.bands[k]) >= 14 ? `${name} ${pct(sum.bands[k])}%` : '');
      s.style.width = Math.max(3, pct(sum.bands[k])) + '%';
      s.title = `${name}: ${pct(sum.bands[k])}% of the sound energy`;
      bands.appendChild(s);
    });
    if (pinned) {
      const d = sum.thockScore - pinned.thockScore;
      cmp.hidden = false;
      cmp.textContent = d === 0 ? `Same score as "Before" (${pinned.thockScore}).`
        : `${Math.abs(d)} points ${d > 0 ? 'deeper (more thock)' : 'brighter (more clack)'} than "Before" (${pinned.thockScore}, ${pinned.profileName}).`;
    } else cmp.hidden = true;
    for (const id of sum.diagnosis) {
      const d = C.diagnosis[id]; if (!d) continue;
      const li = el('li', d.kind);
      li.appendChild(el('strong', null, d.title));
      li.appendChild(el('span', null, d.text + ' '));
      if (d.recipes.length) {
        const wrap = el('div');
        d.recipes.forEach((rid) => {
          const r = C.recipes.find((x) => x.id === rid); if (!r) return;
          const b = el('button', 'recipe-link', 'Recipe: ' + r.goal); b.type = 'button';
          b.addEventListener('click', () => showRecipe(rid));
          wrap.appendChild(b);
        });
        li.appendChild(wrap);
      }
      list.appendChild(li);
    }
    drawBars($('#cv-report'), summaryBars(sum), { pin: pinned && Float32Array.from(pinned.bars) });
  }
  function pinCurrent() {
    if (!currentSummary || !currentSummary.count) { setStatus('Record or load some typing first, then save it as "Before".'); return; }
    pinned = { bars: Array.from(summaryBars(currentSummary)), thockScore: currentSummary.thockScore, profileName: currentSummary.profileName };
    try { localStorage.setItem('thockscope.before', JSON.stringify(pinned)); } catch (_) {}
    $('#btn-unpin').hidden = false;
    setStatus('Saved as "Before" (yellow dashed line). Make one change, then record again to compare.');
    renderReport(currentSummary);
  }
  function unpin() {
    pinned = null;
    try { localStorage.removeItem('thockscope.before'); } catch (_) {}
    $('#btn-unpin').hidden = true;
    renderReport(currentSummary);
  }

  // ------------------------------------------------------------ recording overview
  function drawOverview() {
    if (!E.file) return;
    const c = $('#cv-overview'); const g = ctxFor(c), W = c.width, H = c.height;
    const rep = E.file.report, ov = rep.overview, n = ov.length / 2;
    let mx = 1e-4; for (const v of ov) mx = Math.max(mx, Math.abs(v));
    g.fillStyle = col.cyan; g.shadowColor = col.cyan; g.shadowBlur = 6 * DPR;
    for (let i = 0; i < n; i++) {
      const x = (i / n) * W, y0 = H / 2 - (ov[i * 2 + 1] / mx) * (H / 2 - 4 * DPR), y1 = H / 2 - (ov[i * 2] / mx) * (H / 2 - 4 * DPR);
      g.fillRect(x, y0, Math.max(DPR, W / n), Math.max(DPR, y1 - y0));
    }
    g.shadowBlur = 0; g.fillStyle = col.pink;
    for (const hit of rep.hits) g.fillRect((hit.time / rep.duration) * W - DPR, 0, 2 * DPR, 10 * DPR);
    const ph = E.state.startsWith('file') ? E._playhead() : E.file.offset;
    if (ph > 0) { g.fillStyle = col.caption; g.fillRect((ph / rep.duration) * W - DPR, 0, 2 * DPR, H); }
  }

  // ------------------------------------------------------------ engine events
  let liveHits = 0;
  E.on('frame', (fr) => {
    const t = nowS();
    const dt = lastFrameT ? Math.min(0.1, t - lastFrameT) : 1 / 60;
    lastFrameT = t; viewT = t;
    ingest(t, fr.binsDb, dt);
    drawLive();
    if (fr.playhead != null) drawOverview();
  });
  E.on('keystroke', (hit) => {
    liveHits++;
    showProfile(hit);
    if (E.state === 'mic') {
      setStatus(`Listening… ${liveHits} key${liveHits === 1 ? '' : 's'} heard.`);
      if (liveHits % 3 === 0 || liveHits < 10) renderReport(E.getSessionSummary(), 'live');
    }
  });
  E.on('state', (s) => {
    const live = s === 'mic' || s === 'file-playing';
    root.setAttribute('data-live', live ? 'on' : 'off');
    $('#mic-text').textContent = s === 'mic' ? 'Stop Mic' : 'Start Mic';
    const play = $('#btn-play');
    play.hidden = !E.file;
    $('#play-text').textContent = s === 'file-playing' ? 'Pause' : 'Play';
    $('#play-icon').setAttribute('d', s === 'file-playing' ? 'M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z' : 'M7 4.5v15l12-7.5z');
    if (s === 'mic') setStatus('Listening… type on your keyboard! (Headphones on, so the app doesn\'t hear itself.)');
    else if (s === 'file-playing') setStatus('Playing your recording…');
    else if (s === 'file-paused') setStatus(`Paused at ${E.file.offset.toFixed(1)} s. Press Play to keep going.`);
    else if (s === 'idle' && !E.file && liveHits) setStatus(`Stopped. ${liveHits} key${liveHits === 1 ? '' : 's'} heard.`);
  });
  E.on('ended', () => { setStatus('Finished playing.'); drawOverview(); });
  E.on('file', (rep) => {
    $('#file-panel').hidden = false;
    $('#file-name').textContent = rep.name;
    renderReport(rep.summary, 'file');
    if (rep.summary.count) {
      showProfile(rep.summary);
      holdDb.set(toBars(rep.summary.binsDb)); topDb = Math.max(...holdDb);
    } else {
      clearProfile(); holdDb.fill(-160);
    }
    $('#btn-play').hidden = false;
    requestAnimationFrame(() => { drawOverview(); drawSpectrum(); });
  });

  // ------------------------------------------------------------ controls
  $('#btn-mic').addEventListener('click', async () => {
    if (E.state === 'mic') { E.stop(); return; }
    try {
      setStatus('Asking for the microphone…');
      await E.startMic();
      liveHits = 0; E.resetSession(); resetDisplay(); clearProfile();
    } catch (err) {
      const msg = err && err.name === 'NotAllowedError' ? 'Microphone permission was blocked. Allow it in your browser\'s address bar and try again.'
        : err && err.name === 'NotFoundError' ? 'No microphone found. Plug one in, or upload a recording instead.'
        : (err && err.message) || 'Could not start the microphone.';
      setStatus(msg, true);
    }
  });
  $('#file-input').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      setStatus(`Analysing ${f.name}…`);
      resetDisplay();
      const rep = await E.loadFile(f);
      setStatus(rep.summary.count ? `Found ${rep.summary.count} key presses in ${rep.duration.toFixed(1)} s. Press Play to watch it live.` : 'No key presses found. Try sliding Sensitivity up.');
    } catch (err) {
      setStatus('Could not read that file. Try a .wav, .mp3, .m4a or .ogg recording.', true);
      console.warn('ThockScope could not decode the file:', err);
    }
    e.target.value = '';
  });
  $('#btn-play').addEventListener('click', () => {
    if (E.state === 'file-playing') E.pauseFile();
    else { if (E.state === 'mic') E.stop(); resetDisplay(); E.playFile(); }
  });
  let sensTimer;
  $('#sens').addEventListener('input', (e) => {
    E.setSensitivity(parseFloat(e.target.value));
    // re-check a loaded recording with the new setting (not while it's playing)
    clearTimeout(sensTimer);
    sensTimer = setTimeout(() => {
      if (!E.file || E.state === 'file-playing') return;
      const rep = E.reanalyzeFile();
      setStatus(rep.summary.count ? `Sensitivity changed: found ${rep.summary.count} key presses.` : 'Still no key presses found. Try sliding Sensitivity higher.');
      drawSpectrum();
    }, 250);
  });
  $('#btn-reset').addEventListener('click', () => {
    E.stop(); E.unloadFile();
    $('#file-panel').hidden = true; $('#btn-play').hidden = true;
    E.resetSession(); liveHits = 0;
    renderReport(null); resetDisplay(); clearProfile(); drawLive();
    setStatus(C.ui.idle);
  });
  $('#btn-pin').addEventListener('click', pinCurrent);
  $('#btn-unpin').addEventListener('click', unpin);
  $('#btn-unpin').hidden = !pinned;
  $('#cv-overview').addEventListener('click', (e) => {
    if (!E.file) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (E.state === 'mic') E.stop();
    resetDisplay();
    E.playFile(((e.clientX - r.left) / r.width) * E.file.report.duration);
  });

  // ------------------------------------------------------------ sample key presses (so the page isn't empty)
  /** Synthesizes ~4 s of thocky typing and runs it through the real analysis. */
  function showSample() {
    const sr = 48000, dur = 4, len = sr * dur, d = new Float32Array(len);
    let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < len; i++) d[i] = rnd() * 0.0006;
    const press = (t0, a, low, body) => {
      const s0 = Math.floor(t0 * sr);
      for (let i = 0; i < sr * 0.16 && s0 + i < len; i++) {
        const t = i / sr;
        d[s0 + i] += a * (Math.exp(-t / 0.014) * (Math.sin(2 * Math.PI * low * t) + 0.55 * Math.sin(2 * Math.PI * body * t) + 0.2 * Math.sin(2 * Math.PI * 3800 * t))
          + 0.25 * rnd() * Math.exp(-t / 0.0015));
      }
    };
    let t = 0.3;
    while (t < dur - 0.25) {
      const low = 230 + rnd() * 25;
      press(t, 0.35 + rnd() * 0.06, low, low * 4.6);           // key going down
      press(t + 0.1, 0.12, low * 1.3, low * 5.5);                 // smaller one coming back up
      t += 0.45 + Math.abs(rnd()) * 0.3;
    }
    const buf = { sampleRate: sr, length: len, numberOfChannels: 1, duration: dur, getChannelData: () => d };
    const rep = E.analyzeBuffer(buf);

    // Replay it through the same drawing pipeline, ending "now".
    const axis = F.logAxis(40, 16000, E.DISPLAY_BINS), N = 4096, step = Math.round(sr / 60), end = nowS();
    const frames = [];
    for (let s = N; s <= len; s += step) frames.push([s, F.toLogBins(F.magnitudes(d.subarray(s - N, s), F.hann(N)), sr / N, axis)]);
    // settle the auto-range on the whole sample first, so the oldest columns are scaled right
    for (const [, b] of frames) { const bars = toBars(b); topDb = Math.max(topDb, ...bars); noiseDb = Math.min(noiseDb == null ? 0 : noiseDb, Array.from(bars).sort((x, y) => x - y)[NB >> 1]); }
    for (const [s, b] of frames) ingest(end - (len - s) / sr, b, 1 / 60);
    pushWave(d.subarray(len - Math.ceil(sr * (WAVE_WIN + 0.1))), end - (WAVE_WIN + 0.1), sr);
    viewT = end;
    if (rep.hits.length) {
      const hit = rep.hits[rep.hits.length - 1];
      showProfile(hit);
      holdDb.set(toBars(hit.binsDb)); topDb = Math.max(...holdDb);
    }
    setStatus(C.ui.sample);
  }

  // ------------------------------------------------------------ Fourier smoothie demo
  const fruits = [
    { name: 'Banana', role: 'low thump', hz: 150, amp: 1 },
    { name: 'Strawberry', role: 'middle body', hz: 500, amp: 0.55 },
    { name: 'Blueberry', role: 'high click', hz: 1400, amp: 0.3 },
  ];
  function renderDemoControls() {
    const box = $('#demo-controls');
    fruits.forEach((f, i) => {
      const lab = el('label', 'fruit');
      const dot = el('span', 'fruit-dot'); dot.style.background = col.fruits[i]; dot.style.boxShadow = `0 0 8px ${col.fruits[i]}`;
      const range = el('input'); range.type = 'range'; range.min = 0; range.max = 1; range.step = 0.05; range.value = f.amp;
      range.setAttribute('aria-label', `${f.name} amount`);
      range.addEventListener('input', () => { f.amp = parseFloat(range.value); drawDemo(); });
      lab.append(dot, el('span', null, `${f.name} · ${f.hz} Hz (${f.role})`), range);
      box.appendChild(lab);
    });
  }
  function drawDemo() {
    const mix = E.demoMix(fruits.map((f) => ({ hz: f.hz, amp: f.amp })), { waveMs: 20 });
    const cw = $('#cv-demo-wave'); const g = ctxFor(cw), W = cw.width, H = cw.height, mid = H / 2, amp = (H * 0.42) / Math.max(1, fruits.reduce((t, f) => t + f.amp, 0));
    g.strokeStyle = col.edge; g.lineWidth = 1.5 * DPR; g.beginPath(); g.moveTo(0, mid); g.lineTo(W, mid); g.stroke();
    const line = (wave, color, width, alpha, glow) => {
      g.save(); g.globalAlpha = alpha; g.strokeStyle = g.shadowColor = color; g.shadowBlur = glow ? 10 * DPR : 0; g.lineWidth = width * DPR; g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i < wave.length; i++) { const x = (i / (wave.length - 1)) * W, y = mid - wave[i] * amp; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke(); g.restore();
    };
    fruits.forEach((f, i) => { if (f.amp) line(E.demoMix([{ hz: f.hz, amp: f.amp }], { waveMs: 20 }).wave, col.fruits[i], 1.5, 0.75, false); });
    line(mix.wave, col.chalk, 3, 1, true);

    const cs = $('#cv-demo-spec'); const q = ctxFor(cs), SW = cs.width, SH = cs.height, maxHz = 2000, padB = 18 * DPR;
    q.font = font(11); q.textBaseline = 'bottom';
    q.strokeStyle = col.grid; q.lineWidth = DPR; q.setLineDash([4 * DPR, 4 * DPR]);
    for (let f = 250; f < maxHz; f += 250) { const x = Math.round((f / maxHz) * SW) + 0.5; q.beginPath(); q.moveTo(x, 0); q.lineTo(x, SH - padB); q.stroke(); }
    q.setLineDash([]);
    q.fillStyle = col.dim;
    [0, 500, 1000, 1500, 2000].forEach((f) => { q.textAlign = f === 0 ? 'left' : f === maxHz ? 'right' : 'center'; q.fillText(f ? f + (f === maxHz ? ' Hz' : '') : '0', (f / maxHz) * SW + (f === 0 ? 3 * DPR : f === maxHz ? -3 * DPR : 0), SH - 3 * DPR); });
    const spec = mix.spectrum, n = Math.floor(maxHz / mix.binHz), bw = Math.max(3 * DPR, SW / n * 0.9);
    for (let k = 1; k < n; k++) {
      const hz = k * mix.binHz;
      const bh = Math.min(1, spec[k]) * (SH - padB - 8 * DPR);
      if (bh < 1) continue;
      let ci = -1; fruits.forEach((f, i) => { if (Math.abs(f.hz - hz) < 40) ci = i; });
      q.fillStyle = q.shadowColor = ci >= 0 ? col.fruits[ci] : col.violet; q.shadowBlur = 10 * DPR;
      q.fillRect((hz / maxHz) * SW - bw / 2, SH - padB - bh, bw, bh);
    }
    q.shadowBlur = 0;
  }

  // ------------------------------------------------------------ static content
  function renderContent() {
    document.querySelectorAll('[data-text]').forEach((n) => {
      let v = C; for (const k of n.getAttribute('data-text').split('.')) v = v && v[k];
      if (typeof v === 'string') n.textContent = v;
    });

    // zone legend widths follow the real zone boundaries on the chart
    const z = [0, fx(ZONES[0]), fx(ZONES[1]), 1];
    $('#zones').style.gridTemplateColumns = [0, 1, 2].map((i) => `${((z[i + 1] - z[i]) * 100).toFixed(1)}fr`).join(' ');

    const lessons = $('#lessons');
    C.lessons.forEach((l) => {
      const card = el('article', 'card lesson');
      card.appendChild(el('h3', null, l.title));
      card.appendChild(el('p', 'short', l.short));
      const d = el('details'); d.appendChild(el('summary', null, 'Tell me more')); d.appendChild(el('p', null, l.body));
      card.appendChild(d);
      lessons.appendChild(card);
    });

    const filters = [['all', 'All'], ['thock', 'Thock'], ['clack', 'Clack'], ['creamy', 'Creamy'], ['quiet', 'Quiet'], ['fix', 'Fix a problem'], ['budget', 'Cheap mods']];
    const chipBox = $('#recipe-filters');
    filters.forEach(([tag, label], i) => {
      const b = el('button', 'chip' + (i === 0 ? ' is-active' : ''), label); b.type = 'button'; b.dataset.tag = tag;
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
      b.addEventListener('click', () => {
        chipBox.querySelectorAll('.chip').forEach((c) => { c.classList.toggle('is-active', c === b); c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
        document.querySelectorAll('.recipe').forEach((card) => { card.hidden = tag !== 'all' && !card.dataset.tags.split(' ').includes(tag); });
      });
      chipBox.appendChild(b);
    });

    const partName = (id) => (C.parts.find((p) => p.id === id) || { name: id }).name;
    const list = $('#recipe-list');
    C.recipes.forEach((r) => {
      const card = el('article', 'recipe'); card.id = 'recipe-' + r.id; card.dataset.tags = (r.cost === 1 && !r.tags.includes('budget') ? r.tags.concat('budget') : r.tags).join(' ');
      card.appendChild(el('h3', 'recipe-goal', r.want.replace(/^I want (my keyboard )?/, 'I want ').replace(/\.$/, '')));
      const ul = el('ul', 'recipe-steps');
      r.steps.forEach((s) => {
        const li = el('li');
        li.appendChild(el('b', null, partName(s.part)));
        li.appendChild(document.createTextNode(s.do));
        li.appendChild(el('span', 'why', s.why));
        ul.appendChild(li);
      });
      card.appendChild(ul);
      card.appendChild(el('p', 'recipe-graph', 'On the graph: ' + r.graph));
      card.appendChild(el('p', 'recipe-meta', `Cost ${'$'.repeat(r.cost)} · ${['', 'Easy', 'Medium', 'Big project'][r.effort]}`));
      list.appendChild(card);
    });

    const parts = $('#part-list');
    C.parts.forEach((p) => {
      const card = el('article', 'card part');
      card.appendChild(el('h3', null, p.name));
      card.appendChild(el('p', 'short', p.what));
      card.appendChild(el('p', null, p.sound));
      card.appendChild(el('p', 'dim', 'Tip: ' + p.tip));
      parts.appendChild(card);
    });

    const tips = $('#tips'); C.recordingTips.forEach((t) => tips.appendChild(el('li', null, t)));
    const gl = $('#glossary'); C.glossary.forEach((x) => { gl.appendChild(el('dt', null, x.term)); gl.appendChild(el('dd', null, x.def)); });
  }

  function showRecipe(id) {
    $('#recipe-filters .chip[data-tag="all"]').click();
    const card = document.getElementById('recipe-' + id); if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('is-highlight'); setTimeout(() => card.classList.remove('is-highlight'), 2500);
  }

  // ------------------------------------------------------------ redraw on resize / font load
  function redrawStatic() {
    if (E.state === 'mic' || E.state === 'file-playing') { renderReport(currentSummary); drawDemo(); return; }
    drawLive(); drawOverview(); drawDemo(); renderReport(currentSummary);
  }
  let rt;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(redrawStatic, 80); };
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(onResize);
    document.querySelectorAll('.chart canvas').forEach((c) => ro.observe(c));
  } else window.addEventListener('resize', onResize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawStatic);

  // ------------------------------------------------------------ start
  readColors();
  renderContent();
  renderDemoControls();
  renderReport(null);
  try { showSample(); } catch (e) { console.error(e); clearProfile(); setStatus(C.ui.idle); }
  drawLive();
  drawDemo();
  if (!(window.AudioContext || window.webkitAudioContext)) setStatus('This browser can\'t do live audio. Try Chrome, Edge, Firefox or Safari.', true);

  window.ThockUI = { readColors, redraw: redrawStatic, showRecipe, renderReport };
})();
