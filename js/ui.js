/*
 * ThockScope — ui.js
 * Baseline UI: draws the canvases, renders content, wires the buttons.
 * Colors come from CSS variables (--c-*, --spec-*) so a new design can restyle
 * everything from CSS alone. Requires fft.js, engine.js, content.js.
 */
(function () {
  'use strict';
  const E = window.ThockEngine;
  const C = window.ThockContent;
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // ------------------------------------------------------------ theme colors
  let col = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    col = {
      bg: v('--c-bg'), grid: v('--c-grid'), text: v('--c-text'), wave: v('--c-wave'), bar: v('--c-bar'),
      curve: v('--c-curve'), pin: v('--c-pin'), low: v('--c-low'), mid: v('--c-mid'), high: v('--c-high'),
      hit: v('--c-hit'), fruits: [v('--c-fruit-1'), v('--c-fruit-2'), v('--c-fruit-3')],
      spec: [v('--spec-0'), v('--spec-1'), v('--spec-2'), v('--spec-3'), v('--spec-4')],
      font: v('--font') || 'sans-serif',
    };
    buildSpecLUT();
  }

  // ------------------------------------------------------------ canvas setup
  const canvases = {};
  function canvas(id) {
    if (canvases[id]) return canvases[id];
    const cv = document.getElementById(id);
    const c = { cv, ctx: cv.getContext('2d'), w: 0, h: 0, dpr: 1 };
    canvases[id] = c;
    fit(c);
    return c;
  }
  function fit(c) {
    const r = c.cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === c.w && h === c.h && dpr === c.dpr) return false;
    c.cv.width = w * dpr; c.cv.height = h * dpr; c.w = w; c.h = h; c.dpr = dpr;
    c.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  // ------------------------------------------------------------ axes
  const LMIN = Math.log(40), LMAX = Math.log(16000);
  const xOfHz = (hz, w) => ((Math.log(hz) - LMIN) / (LMAX - LMIN)) * w;
  const TICKS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const fmtHz = (hz) => (hz >= 1000 ? (hz / 1000).toFixed(hz >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : Math.round(hz) + '');

  function drawFreqBackdrop(c, labels = true) {
    const { ctx, w, h } = c;
    ctx.fillStyle = col.bg; ctx.fillRect(0, 0, w, h);
    const zoneCol = { low: col.low, mid: col.mid, high: col.high };
    ctx.font = `600 10px ${col.font}`;
    for (const b of E.BANDS) {
      const x0 = xOfHz(b.from, w), x1 = xOfHz(b.to, w);
      ctx.fillStyle = zoneCol[b.id]; ctx.fillRect(x0, 0, x1 - x0, h);
      if (labels) { ctx.fillStyle = col.text; ctx.textAlign = 'center'; ctx.fillText(b.nick.toUpperCase(), (x0 + x1) / 2, 12); }
    }
    ctx.strokeStyle = col.grid; ctx.lineWidth = 1; ctx.fillStyle = col.text; ctx.textAlign = 'center';
    for (const t of TICKS) {
      const x = Math.round(xOfHz(t, w)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 18); ctx.lineTo(x, h - 14); ctx.stroke();
      if (labels) ctx.fillText(fmtHz(t) + (t === 50 ? ' Hz' : ''), x, h - 3);
    }
  }

  /** Bars + smooth curve on a log frequency axis. */
  function drawSpectrum(c, hz, barsDb, curveDb, opts = {}) {
    const { ctx, w, h } = c;
    const top = opts.top ?? -20, bottom = opts.bottom ?? -100;
    const y = (db) => 18 + (1 - Math.max(0, Math.min(1, (db - bottom) / (top - bottom)))) * (h - 34);
    drawFreqBackdrop(c, opts.labels !== false);
    if (barsDb) {
      ctx.fillStyle = col.bar;
      const n = hz.length, bw = w / n;
      for (let i = 0; i < n; i++) {
        const x = xOfHz(hz[i], w) - bw / 2, yy = y(barsDb[i]);
        ctx.fillRect(x + 0.5, yy, Math.max(1, bw - 1.5), h - 16 - yy);
      }
    }
    const line = (arr, color, dash, width) => {
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < hz.length; i++) { const x = xOfHz(hz[i], w), yy = y(arr[i]); i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }
      ctx.stroke(); ctx.restore();
    };
    if (opts.pinDb) line(opts.pinDb, col.pin, [6, 4], 2);
    if (curveDb) line(curveDb, col.curve, null, 3);
  }

  function autoRange(arr) {
    let mx = -Infinity;
    for (const v of arr) if (isFinite(v) && v > mx) mx = v;
    if (!isFinite(mx)) mx = -20;
    return { top: mx + 4, bottom: mx - 60 };
  }

  function drawWave(c, data, color, opts = {}) {
    const { ctx, w, h } = c;
    if (!opts.keep) { ctx.fillStyle = col.bg; ctx.fillRect(0, 0, w, h); }
    ctx.strokeStyle = col.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h / 2 + 0.5); ctx.lineTo(w, h / 2 + 0.5); ctx.stroke();
    if (!data) return;
    let gain = opts.gain || 1;
    if (opts.autoGain) { let m = 0; for (const v of data) m = Math.max(m, Math.abs(v)); gain = m > 1e-4 ? 0.9 / m : 1; }
    ctx.strokeStyle = color || col.wave; ctx.lineWidth = opts.width || 2; ctx.globalAlpha = opts.alpha || 1;
    ctx.beginPath();
    const n = data.length, step = Math.max(1, Math.floor(n / (w * 2)));
    for (let i = 0, j = 0; i < n; i += step, j++) {
      const x = (i / (n - 1)) * w, yy = h / 2 - data[i] * gain * (h / 2 - 4);
      j ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ spectrogram
  let specLUT = null;
  function hexToRgb(s) {
    const d = document.createElement('div'); d.style.color = s; document.body.appendChild(d);
    const m = getComputedStyle(d).color.match(/\d+(\.\d+)?/g) || [0, 0, 0]; d.remove();
    return m.slice(0, 3).map(Number);
  }
  function buildSpecLUT() {
    const stops = col.spec.map(hexToRgb);
    specLUT = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
      for (let ch = 0; ch < 3; ch++) specLUT[i * 3 + ch] = stops[k][ch] * (1 - f) + stops[k + 1][ch] * f;
    }
  }
  function clearSpectrogram() { const c = canvas('cv-spectrogram'); c.ctx.fillStyle = col.bg; c.ctx.fillRect(0, 0, c.w, c.h); }
  function pushSpectrogram(binsHz, binsDb) {
    const c = canvas('cv-spectrogram');
    const { ctx, cv } = c;
    const colW = 2 * c.dpr, H = cv.height;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cv, colW, 0, cv.width - colW, H, 0, 0, cv.width - colW, H);
    const img = ctx.createImageData(colW, H);
    const n = binsDb.length;
    for (let yy = 0; yy < H; yy++) {
      const b = Math.min(n - 1, Math.floor((1 - yy / H) * n));
      const t = Math.max(0, Math.min(255, Math.round(((binsDb[b] + 100) / 75) * 255)));
      for (let xx = 0; xx < colW; xx++) {
        const o = (yy * colW + xx) * 4;
        img.data[o] = specLUT[t * 3]; img.data[o + 1] = specLUT[t * 3 + 1]; img.data[o + 2] = specLUT[t * 3 + 2]; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, cv.width - colW, 0);
    ctx.restore();
  }
  let markHit = false;

  // ------------------------------------------------------------ state + status
  const status = (msg, isError) => { const s = $('#status'); s.textContent = msg || ''; s.classList.toggle('error', !!isError); };
  let liveHits = 0;
  let currentSummary = null;   // what the report shows
  let pinned = null;           // { label, curveDb, thockScore, profileName }
  try { pinned = JSON.parse(localStorage.getItem('thockscope.before') || 'null'); } catch (_) { pinned = null; }

  function setButtons(state) {
    const mic = $('#btn-mic');
    mic.textContent = state === 'mic' ? 'Listening…' : 'Start Mic';
    mic.classList.toggle('is-on', state === 'mic');
    $('#btn-stop').disabled = state === 'idle';
    const play = $('#btn-play');
    play.hidden = !E.file;
    play.textContent = state === 'file-playing' ? 'Pause' : 'Play recording';
  }

  // ------------------------------------------------------------ profile card
  function profileText(id) { return C.profiles[id] || { name: '—', text: '' }; }
  function showProfile(f, live) {
    const p = profileText(f.profile);
    $('#prof-name').textContent = p.name;
    $('#prof-desc').textContent = p.soundsLike ? `Sounds like ${p.soundsLike}.` : '';
    const needle = $('#meter-needle');
    needle.style.left = f.thockScore + '%';
    needle.classList.toggle('is-live', !!live);
    $('#st-pitch').textContent = Math.round(f.peakHz) + ' Hz';
    $('#st-bright').textContent = Math.round(f.centroid) + ' Hz';
    if (f.decayMs != null) $('#st-decay').textContent = f.decayMs + ' ms';
  }

  function onKeystroke(hit) {
    liveHits++;
    $('#st-count').textContent = liveHits;
    showProfile(hit, true);
    const card = $('.panel-profile'); card.classList.remove('hit-flash'); void card.offsetWidth; card.classList.add('hit-flash');
    const c = canvas('cv-hit');
    drawWave(c, hit.snippet, col.hit, { autoGain: true });
    markHit = true;
    // While a file plays, keep showing the file's full offline report.
    if (E.state === 'mic' && (liveHits % 3 === 0 || liveHits < 10)) renderReport(E.getSessionSummary(), 'live');
  }

  // ------------------------------------------------------------ report
  function renderReport(sum, source) {
    currentSummary = sum;
    const head = $('#rep-headline'), bands = $('#rep-bands'), list = $('#rep-diagnosis'), cmp = $('#rep-compare');
    list.innerHTML = ''; bands.innerHTML = '';
    if (!sum || !sum.count) {
      head.textContent = source === 'file' ? 'No key presses found in this recording. Try raising Sensitivity and loading it again.' : 'Type some keys to get your report.';
      cmp.hidden = true;
      drawReportCurve(null);
      return;
    }
    head.textContent = `${sum.profileName} · score ${sum.thockScore}/100 · ${sum.count} keys · main pitch ${sum.peakHz} Hz`;

    const pct = (v) => Math.round(v * 100);
    [['low', 'band-low', 'Low'], ['mid', 'band-mid', 'Mid'], ['high', 'band-high', 'High']].forEach(([k, cls, name]) => {
      const s = el('span', cls, pct(sum.bands[k]) >= 14 ? `${name} ${pct(sum.bands[k])}%` : '');
      s.style.width = Math.max(4, pct(sum.bands[k])) + '%';
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
    drawReportCurve(sum);
  }

  function drawReportCurve(sum) {
    const c = canvas('cv-report');
    if (!sum || !sum.count) { drawSpectrum(c, E.summarize([]).binsHz, null, null, { pinDb: pinned && pinned.curveDb }); return; }
    drawSpectrum(c, sum.binsHz, sum.binsDb, sum.curveDb, { ...autoRange(sum.curveDb), pinDb: pinned && pinned.curveDb });
  }

  function pinCurrent() {
    if (!currentSummary || !currentSummary.count) { status('Record or load some typing first, then save it as "Before".'); return; }
    pinned = { curveDb: Array.from(currentSummary.curveDb), thockScore: currentSummary.thockScore, profileName: currentSummary.profileName };
    try { localStorage.setItem('thockscope.before', JSON.stringify(pinned)); } catch (_) {}
    $('#btn-unpin').hidden = false;
    status('Saved as "Before" (dashed line). Now make a change and record again to compare.');
    renderReport(currentSummary);
  }
  function unpin() {
    pinned = null;
    try { localStorage.removeItem('thockscope.before'); } catch (_) {}
    $('#btn-unpin').hidden = true;
    renderReport(currentSummary);
  }

  // ------------------------------------------------------------ file overview
  function drawOverview() {
    if (!E.file) return;
    const c = canvas('cv-overview'); fit(c);
    const { ctx, w, h } = c, rep = E.file.report, ov = rep.overview, n = ov.length / 2;
    ctx.fillStyle = col.bg; ctx.fillRect(0, 0, w, h);
    let mx = 1e-4; for (const v of ov) mx = Math.max(mx, Math.abs(v));
    ctx.fillStyle = col.wave;
    for (let i = 0; i < n; i++) {
      const x = (i / n) * w, y0 = h / 2 - (ov[i * 2 + 1] / mx) * (h / 2 - 4), y1 = h / 2 - (ov[i * 2] / mx) * (h / 2 - 4);
      ctx.fillRect(x, y0, Math.max(1, w / n), Math.max(1, y1 - y0));
    }
    ctx.fillStyle = col.hit;
    for (const hit of rep.hits) ctx.fillRect((hit.time / rep.duration) * w - 1, 0, 2, 8);
    const ph = E.state.startsWith('file') ? E._playhead() : E.file.offset;
    if (ph > 0) { ctx.fillStyle = col.curve; ctx.fillRect((ph / rep.duration) * w - 1, 0, 2, h); }
  }

  // ------------------------------------------------------------ live loop
  E.on('frame', (fr) => {
    drawWave(canvas('cv-wave'), fr.waveform, col.wave, { gain: 3 });
    drawSpectrum(canvas('cv-spectrum'), fr.binsHz, fr.binsDb, fr.curveDb, { pinDb: null });
    pushSpectrogram(fr.binsHz, fr.binsDb);
    if (markHit) {
      markHit = false;
      const c = canvas('cv-spectrogram'); c.ctx.fillStyle = col.hit; c.ctx.fillRect(c.w - 2, 0, 2, 4);
    }
    if (fr.playhead != null) drawOverview();
  });
  E.on('keystroke', onKeystroke);
  E.on('state', (s) => {
    setButtons(s);
    if (s === 'mic') status('Listening… type on your keyboard! (Headphones on so the app doesn\'t hear itself.)');
    else if (s === 'file-playing') status('Playing your recording…');
    else if (s === 'idle' && !E.file) status('Stopped.');
  });
  E.on('ended', () => { status('Finished playing.'); drawOverview(); });
  E.on('file', (rep) => {
    $('#file-panel').hidden = false;
    $('#file-name').textContent = rep.name;
    renderReport(rep.summary, 'file');
    if (rep.summary.count) showProfile({ ...rep.summary, centroid: rep.summary.centroid }, false);
    $('#st-count').textContent = rep.summary.count;
    setButtons(E.state);
    requestAnimationFrame(drawOverview);
  });

  // ------------------------------------------------------------ controls
  $('#btn-mic').addEventListener('click', async () => {
    if (E.state === 'mic') { E.stop(); return; }
    try {
      status('Asking for the microphone…');
      await E.startMic();
      liveHits = 0; E.resetSession(); $('#st-count').textContent = '0';
      clearSpectrogram();
    } catch (err) {
      const msg = err && err.name === 'NotAllowedError' ? 'Microphone permission was blocked. Allow it in your browser\'s address bar and try again.'
        : err && err.name === 'NotFoundError' ? 'No microphone found. Plug one in, or upload a recording instead.'
        : (err && err.message) || 'Could not start the microphone.';
      status(msg, true);
    }
  });
  $('#file-input').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      status(`Analysing ${f.name}…`);
      const rep = await E.loadFile(f);
      status(rep.summary.count ? `Found ${rep.summary.count} key presses in ${rep.duration.toFixed(1)} s. Press Play to watch it live.` : 'No key presses found. Try raising Sensitivity, then load the file again.');
    } catch (err) {
      status('Could not read that file. Try a .wav, .mp3, .m4a or .ogg recording.', true);
      console.error(err);
    }
    e.target.value = '';
  });
  $('#btn-play').addEventListener('click', () => {
    if (E.state === 'file-playing') E.pauseFile();
    else { clearSpectrogram(); E.playFile(); }
  });
  $('#btn-stop').addEventListener('click', () => { E.stop(); if (E.file) E.file.offset = 0; drawOverview(); });
  $('#sens').addEventListener('input', (e) => E.setSensitivity(parseFloat(e.target.value)));
  $('#btn-reset').addEventListener('click', () => {
    E.resetSession(); liveHits = 0; $('#st-count').textContent = '0';
    renderReport(null); clearSpectrogram();
    $('#prof-name').textContent = '—'; $('#prof-desc').textContent = C.ui.micHint;
    $('#meter-needle').classList.remove('is-live');
  });
  $('#btn-pin').addEventListener('click', pinCurrent);
  $('#btn-unpin').addEventListener('click', unpin);
  $('#btn-unpin').hidden = !pinned;
  $('#cv-overview').addEventListener('click', (e) => {
    if (!E.file) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * E.file.report.duration;
    clearSpectrogram(); E.playFile(t);
  });

  // ------------------------------------------------------------ Fourier demo
  const fruits = [
    { name: 'Strawberry', role: 'low thump', hz: 150, amp: 1 },
    { name: 'Banana', role: 'middle body', hz: 500, amp: 0.6 },
    { name: 'Blueberry', role: 'high click', hz: 1400, amp: 0.35 },
  ];
  function renderDemoControls() {
    const box = $('#demo-controls');
    fruits.forEach((f, i) => {
      const lab = el('label', 'fruit');
      const dot = el('span', 'fruit-dot'); dot.style.background = col.fruits[i];
      const range = el('input'); range.type = 'range'; range.min = 0; range.max = 1; range.step = 0.05; range.value = f.amp;
      range.setAttribute('aria-label', `${f.name} amount`);
      range.addEventListener('input', () => { f.amp = parseFloat(range.value); drawDemo(); });
      lab.append(dot, el('span', null, `${f.name} — ${f.hz} Hz (${f.role})`), range);
      box.appendChild(lab);
    });
  }
  function drawDemo() {
    const mix = E.demoMix(fruits.map((f) => ({ hz: f.hz, amp: f.amp })), { waveMs: 20 });
    const cw = canvas('cv-demo-wave'); fit(cw);
    drawWave(cw, null);
    fruits.forEach((f, i) => {
      if (!f.amp) return;
      const one = E.demoMix([{ hz: f.hz, amp: f.amp }], { waveMs: 20 }).wave;
      drawWave(cw, one, col.fruits[i], { keep: true, gain: 0.33, width: 1.5, alpha: 0.6 });
    });
    drawWave(cw, mix.wave, col.wave, { keep: true, gain: 0.33, width: 2.5 });

    const cs = canvas('cv-demo-spec'); fit(cs);
    const { ctx, w, h } = cs, maxHz = 2000;
    ctx.fillStyle = col.bg; ctx.fillRect(0, 0, w, h);
    ctx.font = `600 10px ${col.font}`; ctx.textAlign = 'center';
    ctx.strokeStyle = col.grid; ctx.fillStyle = col.text;
    for (let t = 0; t <= maxHz; t += 250) { const x = (t / maxHz) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h - 14); ctx.stroke(); if (t % 500 === 0) { ctx.textAlign = t === 0 ? 'left' : t === maxHz ? 'right' : 'center'; ctx.fillText(t + (t ? '' : ' Hz'), x, h - 3); } }
    const spec = mix.spectrum, n = Math.floor(maxHz / mix.binHz);
    for (let k = 1; k < n; k++) {
      const hz = k * mix.binHz;
      let ci = -1; fruits.forEach((f, i) => { if (Math.abs(f.hz - hz) < 40) ci = i; });
      ctx.fillStyle = ci >= 0 ? col.fruits[ci] : col.bar;
      const bh = Math.min(1, spec[k]) * (h - 22);
      ctx.fillRect((hz / maxHz) * w - 1.5, h - 14 - bh, 3, bh);
    }
  }

  // ------------------------------------------------------------ static content
  function renderContent() {
    document.querySelectorAll('[data-text]').forEach((n) => {
      const key = n.getAttribute('data-text').split('.');
      let v = C; for (const k of key) v = v && v[k];
      if (typeof v === 'string') n.textContent = v;
    });
    document.querySelectorAll('[data-lesson]').forEach((n) => {
      const l = C.lessons.find((x) => x.id === n.getAttribute('data-lesson'));
      if (l) n.textContent = l.short;
    });

    const lessons = $('#lessons');
    C.lessons.forEach((l, i) => {
      const card = el('article', 'card lesson');
      card.appendChild(el('h3', null, `${i + 1}. ${l.title}`));
      card.appendChild(el('p', 'short', l.short));
      const d = el('details'); d.appendChild(el('summary', null, 'Tell me more')); d.appendChild(el('p', null, l.body));
      card.appendChild(d);
      lessons.appendChild(card);
    });

    const filters = [
      ['all', 'All'], ['thock', 'Thock'], ['clack', 'Clack'], ['creamy', 'Creamy'], ['quiet', 'Quiet'], ['fix', 'Fix a problem'], ['budget', 'Cheap mods'],
    ];
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
      const card = el('article', 'card recipe'); card.id = 'recipe-' + r.id; card.dataset.tags = r.tags.join(' ');
      card.appendChild(el('h3', null, r.goal));
      card.appendChild(el('p', 'recipe-want', `"${r.want}"`));
      card.appendChild(el('p', 'recipe-meta', `Cost: ${'$'.repeat(r.cost)} · Effort: ${['', 'Easy', 'Medium', 'Big project'][r.effort]}`));
      const ol = el('ol', 'recipe-steps');
      r.steps.forEach((s) => {
        const li = el('li');
        li.appendChild(el('span', 'part-tag', partName(s.part)));
        li.appendChild(document.createTextNode(s.do));
        li.appendChild(el('span', 'why', 'Why: ' + s.why));
        ol.appendChild(li);
      });
      card.appendChild(ol);
      card.appendChild(el('p', 'recipe-graph', 'On the graph: ' + r.graph));
      list.appendChild(card);
    });

    const parts = $('#part-list');
    C.parts.forEach((p) => {
      const card = el('article', 'card part');
      card.appendChild(el('h3', null, p.name));
      card.appendChild(el('p', 'short', p.what));
      card.appendChild(el('p', null, p.sound));
      card.appendChild(el('p', 'part-tip', 'Tip: ' + p.tip));
      parts.appendChild(card);
    });

    const tips = $('#tips'); C.recordingTips.forEach((t) => tips.appendChild(el('li', null, t)));
    const gl = $('#glossary'); C.glossary.forEach((g) => { gl.appendChild(el('dt', null, g.term)); gl.appendChild(el('dd', null, g.def)); });
  }

  function showRecipe(id) {
    document.querySelector('#recipe-filters .chip[data-tag="all"]').click();
    const card = document.getElementById('recipe-' + id); if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('is-highlight'); setTimeout(() => card.classList.remove('is-highlight'), 2500);
  }

  // ------------------------------------------------------------ idle drawing + resize
  function drawIdle() {
    drawWave(canvas('cv-wave'), null);
    drawSpectrum(canvas('cv-spectrum'), E.summarize([]).binsHz, null, null);
    clearSpectrogram();
    drawWave(canvas('cv-hit'), null);
    drawReportCurve(currentSummary);
    drawOverview();
    drawDemo();
  }
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { Object.values(canvases).forEach(fit); if (E.state === 'idle' || E.state === 'file-paused') drawIdle(); else { drawReportCurve(currentSummary); drawDemo(); } }, 120);
  });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); drawIdle(); });

  readColors();
  renderContent();
  renderDemoControls();
  setButtons('idle');
  drawIdle();
  if (!(window.AudioContext || window.webkitAudioContext)) status('This browser can\'t do live audio. Try Chrome, Edge, Firefox or Safari.', true);

  // Small hook for themes / tests.
  window.ThockUI = { readColors, redraw: drawIdle, showRecipe, renderReport };
})();
