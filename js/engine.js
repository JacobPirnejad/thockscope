/*
 * ThockScope — engine.js
 * The "backend": audio input, live analysis, keystroke detection, and reports.
 * No UI code lives here. See docs/ENGINE_API.md for the full data contract.
 *
 * Requires: js/fft.js (window.ThockFFT)
 * Exposes:  window.ThockEngine
 */
(function (global) {
  'use strict';
  const F = global.ThockFFT;

  // ---------------------------------------------------------------- constants
  /** Frequency zones used everywhere (Hz). Tuned for keyboard sounds. */
  const BANDS = [
    { id: 'low',  name: 'Low',  nick: 'THOCK zone', from: 80,   to: 700 },
    { id: 'mid',  name: 'Mid',  nick: 'Body zone',  from: 700,  to: 2500 },
    { id: 'high', name: 'High', nick: 'CLACK zone', from: 2500, to: 12000 },
  ];
  const ANALYSIS_MIN_HZ = 80;
  const ANALYSIS_MAX_HZ = 12000;

  /** Sound-profile labels, from deepest to brightest. score = thockScore range. */
  const PROFILES = [
    { id: 'deep-thock',  name: 'Deep Thock',  min: 80, max: 101 },
    { id: 'thock',       name: 'Thock',       min: 62, max: 80 },
    { id: 'creamy',      name: 'Creamy',      min: 45, max: 62 },
    { id: 'clack',       name: 'Clack',       min: 28, max: 45 },
    { id: 'sharp-clack', name: 'Sharp Clack', min: -1, max: 28 },
  ];

  const DISPLAY_BINS = 96;           // bars on the spectrum display
  const DISPLAY_MIN_HZ = 40;
  const DISPLAY_MAX_HZ = 16000;
  const HIT_FFT = 4096;              // samples analysed per keystroke
  const HOP = 256;                   // envelope resolution for detection
  const RING = 1 << 17;              // ~2.7 s of audio history at 48 kHz

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function profileFor(score) {
    for (const p of PROFILES) if (score >= p.min && score < p.max) return p;
    return PROFILES[PROFILES.length - 1];
  }

  // ---------------------------------------------------------------- features
  /**
   * Turn a linear-magnitude spectrum into kid-friendly numbers.
   * @param {Float32Array} mags  linear magnitudes
   * @param {number} binHz
   */
  function computeFeatures(mags, binHz) {
    const k0 = Math.max(1, Math.floor(ANALYSIS_MIN_HZ / binHz));
    const k1 = Math.min(mags.length - 1, Math.ceil(ANALYSIS_MAX_HZ / binHz));
    let total = 0, weighted = 0;
    const bandPow = { low: 0, mid: 0, high: 0 };
    for (let k = k0; k <= k1; k++) {
      const f = k * binHz;
      const p = mags[k] * mags[k];
      total += p; weighted += f * p;
      if (f < BANDS[0].to) bandPow.low += p;
      else if (f < BANDS[1].to) bandPow.mid += p;
      else bandPow.high += p;
    }
    const centroid = total > 0 ? weighted / total : 0;
    const bands = {
      low: total ? bandPow.low / total : 0,
      mid: total ? bandPow.mid / total : 0,
      high: total ? bandPow.high / total : 0,
    };

    // Main pitch: loudest point of a lightly smoothed spectrum (less jumpy than a raw max).
    let peakHz = 0, best = -1;
    for (let k = k0 + 1; k < k1; k++) {
      const v = mags[k - 1] + 2 * mags[k] + mags[k + 1];
      if (v > best) { best = v; peakHz = k * binHz; }
    }

    // thockScore: 100 = very deep, 0 = very bright. Mostly from brightness (centroid),
    // nudged by how much energy sits in the THOCK zone.
    const cScore = centroid > 0
      ? ((Math.log(5000) - Math.log(centroid)) / (Math.log(5000) - Math.log(800))) * 100
      : 50;
    const lScore = (bands.low / 0.6) * 100;
    const thockScore = Math.round(clamp(0.7 * cScore + 0.3 * lScore, 0, 100));

    return { centroid, peakHz, bands, thockScore, profile: profileFor(thockScore).id };
  }

  /** How "pingy" a spectrum is: the tallest narrow spike above its neighbourhood (dB). */
  function tonality(mags, binHz) {
    const R = Math.max(8, Math.round(800 / binHz)); // compare against ±800 Hz around the spike
    const k0 = Math.max(R, Math.floor(1000 / binHz)), k1 = Math.min(mags.length - R - 1, Math.floor(9000 / binHz));
    let bestProm = 0, bestHz = 0;
    const tmp = [];
    for (let k = k0; k < k1; k++) {
      const v = F.toDb(mags[k]);
      if (mags[k] < mags[k - 1] || mags[k] < mags[k + 1]) continue;
      tmp.length = 0;
      for (let j = k - R; j <= k + R; j += 2) tmp.push(F.toDb(mags[j]));
      tmp.sort((a, b) => a - b);
      const prom = v - tmp[tmp.length >> 1];
      if (prom > bestProm) { bestProm = prom; bestHz = k * binHz; }
    }
    return { prominenceDb: bestProm, hz: bestHz };
  }

  // ---------------------------------------------------------------- detector
  /**
   * Finds keystrokes in a stream of audio and analyses each one.
   * Works the same for live mic audio and for files (offline).
   */
  class KeystrokeDetector {
    constructor(sampleRate, onHit) {
      this.sr = sampleRate;
      this.onHit = onHit;
      this.sensitivity = 0.5;
      this.axis = F.logAxis(DISPLAY_MIN_HZ, DISPLAY_MAX_HZ, DISPLAY_BINS);
      this.reset();
    }
    reset() {
      this.ring = new Float32Array(RING);
      this.env = new Float32Array(RING / HOP);   // per-hop RMS history
      this.total = 0;      // absolute samples written
      this.hopPos = 0;     // absolute sample index of next hop to process
      this.noise = 0;      // running noise floor (RMS)
      this.lastOnset = -1e12;
      this.pending = [];
    }
    setSensitivity(s) { this.sensitivity = clamp(s, 0, 1); }

    push(block) {
      const n = block.length;
      for (let i = 0; i < n; i++) this.ring[(this.total + i) & (RING - 1)] = block[i];
      this.total += n;
      while (this.total - this.hopPos >= HOP) { this._hop(); this.hopPos += HOP; }
      this._flushReady(false);
    }
    /** Call at end of a file so the last keystrokes get analysed. */
    finish() {
      this.push(new Float32Array(Math.ceil(this.sr * 0.45)));
      this._flushReady(true);
    }

    _hop() {
      let s = 0;
      for (let i = 0; i < HOP; i++) { const v = this.ring[(this.hopPos + i) & (RING - 1)]; s += v * v; }
      const rms = Math.sqrt(s / HOP);
      const hopIdx = this.hopPos / HOP;
      const envLen = this.env.length;
      this.env[hopIdx % envLen] = rms;

      if (this.noise === 0) this.noise = Math.max(rms, 1e-5);
      const sinceOnset = (this.hopPos - this.lastOnset) / this.sr;

      // Recent minimum of the envelope (so slow swells don't count as hits).
      let recentMin = Infinity;
      for (let j = 1; j <= 3; j++) recentMin = Math.min(recentMin, this.env[(hopIdx - j + envLen) % envLen]);
      if (!isFinite(recentMin)) recentMin = rms;

      // Higher sensitivity => lower thresholds.
      const ratio = 7 - this.sensitivity * 4.5;          // 7x .. 2.5x above noise
      const absMin = 0.006 - this.sensitivity * 0.005;   // 0.006 .. 0.001
      const isOnset = sinceOnset > 0.07 && rms > this.noise * ratio && rms > absMin && rms > recentMin * 2.2;

      if (isOnset) {
        this.lastOnset = this.hopPos;
        this.pending.push({ onset: this.hopPos, hopIdx });
      } else if (sinceOnset > 0.25) {
        // Track noise floor only in quiet moments.
        this.noise = rms < this.noise ? this.noise * 0.8 + rms * 0.2 : this.noise * 0.995 + rms * 0.005;
      }
    }

    _flushReady(force) {
      const need = Math.max(HIT_FFT, Math.ceil(this.sr * 0.35));
      while (this.pending.length && (force || this.total >= this.pending[0].onset + need)) {
        const hit = this.pending.shift();
        const nextOnset = this.pending.length ? this.pending[0].onset : Infinity;
        try { this.onHit(this._analyse(hit, nextOnset)); } catch (e) { console.error(e); }
      }
    }

    _analyse(hit, nextOnset) {
      const sr = this.sr, envLen = this.env.length;
      const start = hit.onset - HOP;
      const buf = new Float32Array(HIT_FFT);
      let peakAbs = 0;
      for (let i = 0; i < HIT_FFT; i++) {
        const v = this.ring[(start + i) & (RING - 1)];
        buf[i] = v;
        const a = Math.abs(v); if (a > peakAbs) peakAbs = a;
      }
      const mags = F.magnitudes(buf, F.transient(HIT_FFT));
      const binHz = sr / HIT_FFT;
      const feat = computeFeatures(mags, binHz);

      // Ring / ping check: look at what is STILL sounding 50 ms after the hit,
      // once the thump has died. A tall narrow spike there = metal ringing (spring ping).
      // A ring also fades SLOWLY: compare the spike 30 ms later (if there's room).
      const LATE = 2048, lateStart = hit.onset + Math.floor(sr * 0.05), lateGap = Math.floor(sr * 0.03);
      let ton = { prominenceDb: 0, hz: 0 }, lateRel = 0, sustain = 1;
      const grab = (from) => {
        const out = new Float32Array(LATE);
        for (let i = 0; i < LATE; i++) out[i] = this.ring[(from + i) & (RING - 1)];
        return out;
      };
      if (lateStart + LATE <= nextOnset) {
        const late = grab(lateStart);
        let lateAbs = 0;
        for (let i = 0; i < LATE; i++) { const a = Math.abs(late[i]); if (a > lateAbs) lateAbs = a; }
        lateRel = peakAbs > 0 ? lateAbs / peakAbs : 0;
        const lateMags = F.magnitudes(late, F.hann(LATE));
        ton = tonality(lateMags, sr / LATE);
        if (ton.hz && lateStart + lateGap + LATE <= nextOnset) {
          const later = F.magnitudes(grab(lateStart + lateGap), F.hann(LATE));
          const k = Math.round(ton.hz / (sr / LATE));
          const a = Math.max(lateMags[k - 1], lateMags[k], lateMags[k + 1]);
          const b = Math.max(later[k - 1], later[k], later[k + 1]);
          sustain = a > 0 ? b / a : 0;   // ~0.8 for spring ping, ~0.1 for a normal thump tail
        }
      }

      // Decay: how long until the sound fades 20 dB below its loudest point.
      const maxHops = Math.floor((Math.min(nextOnset, hit.onset + sr * 0.35) - hit.onset) / HOP);
      let peakRms = 0, peakHop = 0;
      for (let j = 0; j < Math.min(6, maxHops); j++) {
        const v = this.env[(hit.hopIdx + j) % envLen];
        if (v > peakRms) { peakRms = v; peakHop = j; }
      }
      let endHop = maxHops;
      for (let j = peakHop; j < maxHops; j++) {
        const v = this.env[(hit.hopIdx + j) % envLen];
        if (v < peakRms * 0.1 || v < this.noise * 1.5) { endHop = j; break; }
      }
      const decayMs = Math.round(((endHop - peakHop) * HOP / sr) * 1000);

      // Waveform snippet (first ~60 ms) for drawing the "shape" of the click.
      const snipLen = Math.min(HIT_FFT, Math.floor(sr * 0.06));
      const snippet = new Float32Array(256);
      for (let i = 0; i < 256; i++) snippet[i] = buf[Math.floor((i / 256) * snipLen)];

      const binsDb = F.toLogBins(mags, binHz, this.axis);
      return {
        time: hit.onset / sr,
        ...feat,
        decayMs,
        ringy: ton.prominenceDb > 15 && lateRel > 0.02 && sustain > 0.45,
        ringHz: Math.round(ton.hz),
        peakDb: Math.round(F.toDb(peakAbs) * 10) / 10,
        clipped: peakAbs >= 0.99,
        binsDb,
        snippet,
      };
    }
  }

  // ---------------------------------------------------------------- summary
  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * Combine many keystrokes into one report card.
   * @param {Array} hits  keystroke objects
   */
  function summarize(hits) {
    const axis = F.logAxis(DISPLAY_MIN_HZ, DISPLAY_MAX_HZ, DISPLAY_BINS);
    if (!hits.length) return { count: 0, binsHz: axis.hz, diagnosis: ['too-few-hits'] };
    const n = hits.length;
    const avg = (fn) => hits.reduce((s, h) => s + fn(h), 0) / n;

    // Average spectrum (average power, back to dB).
    const binsDb = new Float32Array(DISPLAY_BINS);
    for (let b = 0; b < DISPLAY_BINS; b++) {
      let p = 0;
      for (const h of hits) p += Math.pow(10, h.binsDb[b] / 10);
      binsDb[b] = 10 * Math.log10(p / n);
    }
    const curveDb = F.smooth(binsDb, 3);
    let peakHz = 0, best = -Infinity;
    for (let b = 0; b < DISPLAY_BINS; b++) {
      if (axis.hz[b] < ANALYSIS_MIN_HZ || axis.hz[b] > ANALYSIS_MAX_HZ) continue;
      if (curveDb[b] > best) { best = curveDb[b]; peakHz = axis.hz[b]; }
    }

    const scores = hits.map((h) => h.thockScore);
    const thockScore = Math.round(avg((h) => h.thockScore));
    const spread = Math.sqrt(avg((h) => (h.thockScore - thockScore) ** 2));
    const bands = { low: avg((h) => h.bands.low), mid: avg((h) => h.bands.mid), high: avg((h) => h.bands.high) };
    const decayMs = Math.round(median(hits.map((h) => h.decayMs)));
    const ringFraction = hits.filter((h) => h.ringy).length / n;
    const peakDb = Math.round(median(hits.map((h) => h.peakDb)));
    const clipped = hits.some((h) => h.clipped);
    const profile = profileFor(thockScore);

    const diagnosis = [];
    if (n < 8) diagnosis.push('too-few-hits');
    if (clipped) diagnosis.push('clipping');
    if (peakDb < -45) diagnosis.push('too-quiet');
    if (thockScore < 28) diagnosis.push('very-bright');
    else if (thockScore < 45) diagnosis.push('bright');
    else if (thockScore >= 62) diagnosis.push('deep');
    else diagnosis.push('balanced');
    if (ringFraction > 0.25) diagnosis.push('ringy');
    if (decayMs > 140) diagnosis.push('hollow');
    if (spread > 14 && n >= 8) diagnosis.push('inconsistent');

    return {
      count: n,
      thockScore,
      profile: profile.id,
      profileName: profile.name,
      consistency: Math.round(clamp(100 - spread * 3, 0, 100)), // 100 = every key sounds alike
      centroid: Math.round(median(hits.map((h) => h.centroid))),
      // main pitch = typical loudest note of each key press (the averaged curve favours low notes)
      peakHz: Math.round(median(hits.map((h) => h.peakHz))),
      curvePeakHz: Math.round(peakHz),
      bands,
      decayMs,
      ringFraction,
      peakDb,
      clipped,
      binsHz: axis.hz,
      binsDb,
      curveDb,
      scores,
      diagnosis,
    };
  }

  // ---------------------------------------------------------------- engine
  const listeners = {};
  function emit(evt, data) { (listeners[evt] || []).forEach((cb) => { try { cb(data); } catch (e) { console.error(e); } }); }

  const E = {
    BANDS, PROFILES, DISPLAY_BINS,
    state: 'idle',          // 'idle' | 'mic' | 'file-playing' | 'file-paused'
    ctx: null,
    analyser: null,
    file: null,             // { name, buffer, report }
    sessionHits: [],
    sensitivity: 0.5,

    on(evt, cb) { (listeners[evt] = listeners[evt] || []).push(cb); return () => E.off(evt, cb); },
    off(evt, cb) { listeners[evt] = (listeners[evt] || []).filter((f) => f !== cb); },

    _ensureCtx() {
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) throw new Error('This browser does not support the Web Audio API.');
        this.ctx = new AC();
        const an = this.ctx.createAnalyser();
        an.fftSize = 4096;
        an.smoothingTimeConstant = 0.55;
        an.minDecibels = -110;
        an.maxDecibels = -10;
        this.analyser = an;
        this._time = new Float32Array(an.fftSize);
        this._freqDb = new Float32Array(an.frequencyBinCount);
        this._mags = new Float32Array(an.frequencyBinCount);
        this._axis = F.logAxis(DISPLAY_MIN_HZ, DISPLAY_MAX_HZ, DISPLAY_BINS);
        this._binsDb = new Float32Array(DISPLAY_BINS);
        this._curveDb = new Float32Array(DISPLAY_BINS);

        // Raw sample tap for keystroke detection. ScriptProcessor is old but works
        // everywhere, including when the page is opened straight from a file.
        const proc = this.ctx.createScriptProcessor(2048, 1, 1);
        proc.channelCountMode = 'explicit';
        proc.channelInterpretation = 'speakers';
        const mute = this.ctx.createGain(); mute.gain.value = 0;
        proc.connect(mute); mute.connect(this.ctx.destination);
        this._proc = proc;
        this._detector = new KeystrokeDetector(this.ctx.sampleRate, (hit) => {
          this.sessionHits.push(hit);
          if (this.sessionHits.length > 400) this.sessionHits.shift();
          emit('keystroke', hit);
        });
        this._detector.setSensitivity(this.sensitivity);
        proc.onaudioprocess = (e) => {
          if (this.state !== 'mic' && this.state !== 'file-playing') return;
          const block = e.inputBuffer.getChannelData(0);
          this._detector.push(block);
          // Every raw block, gap-free (for scrolling waveforms). The array is reused: copy if you keep it.
          if (listeners.samples && listeners.samples.length) emit('samples', { data: block, sampleRate: this.ctx.sampleRate, time: e.playbackTime });
        };
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },

    _setState(s) { this.state = s; emit('state', s); if (s !== 'idle' && s !== 'file-paused') this._loop(); },

    _loop() {
      if (this._raf) return;
      const tick = () => {
        this._raf = null;
        if (this.state === 'idle' || this.state === 'file-paused') return;
        emit('frame', this._frame());
        this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    },

    /** Build one live frame from the analyser. Arrays are reused between frames — copy if you keep them. */
    _frame() {
      const an = this.analyser, sr = this.ctx.sampleRate;
      an.getFloatTimeDomainData(this._time);
      an.getFloatFrequencyData(this._freqDb);
      for (let i = 0; i < this._mags.length; i++) this._mags[i] = F.fromDb(this._freqDb[i]);
      let s = 0;
      for (let i = 0; i < this._time.length; i++) s += this._time[i] * this._time[i];
      const rms = Math.sqrt(s / this._time.length);
      F.toLogBins(this._mags, sr / an.fftSize, this._axis, this._binsDb);
      F.smooth(this._binsDb, 2, this._curveDb);
      return {
        time: this.ctx.currentTime,
        sampleRate: sr,
        waveform: this._time,
        freqDb: this._freqDb,
        binHz: sr / an.fftSize,
        binsHz: this._axis.hz,
        binsDb: this._binsDb,
        curveDb: this._curveDb,
        rms,
        levelDb: F.toDb(rms),
        features: computeFeatures(this._mags, sr / an.fftSize),
        playhead: this.state.startsWith('file') ? this._playhead() : null,
      };
    },

    _disconnectSources() {
      if (this._micNode) { this._micNode.disconnect(); this._micNode = null; }
      if (this._micStream) { this._micStream.getTracks().forEach((t) => t.stop()); this._micStream = null; }
      if (this._src) { this._src.onended = null; try { this._src.stop(); } catch (_) {} this._src.disconnect(); this._src = null; }
    },

    /** Start listening to the microphone. Must be called from a click/tap. */
    async startMic() {
      const ctx = this._ensureCtx();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access is not available here. Try Chrome, Edge or Firefox.');
      }
      this.stop();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      this._micStream = stream;
      this._micNode = ctx.createMediaStreamSource(stream);
      this._micNode.connect(this.analyser);
      this._micNode.connect(this._proc);
      this._detector.reset();
      this._setState('mic');
    },

    /**
     * Load an audio file (wav/mp3/ogg/m4a/webm...). Runs a full offline analysis
     * and returns the report. Does not start playback.
     */
    async loadFile(file) {
      const ctx = this._ensureCtx();
      this.stop();
      const data = await file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(data);
      const report = E.analyzeBuffer(buffer);
      report.name = file.name;
      this.file = { name: file.name, buffer, report, offset: 0 };
      emit('file', report);
      return report;
    },

    /** Analyse a whole AudioBuffer offline (no playback). */
    analyzeBuffer(buffer) {
      const sr = buffer.sampleRate, len = buffer.length, ch = buffer.numberOfChannels;
      const mono = new Float32Array(len);
      for (let c = 0; c < ch; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / ch; }
      const hits = [];
      const det = new KeystrokeDetector(sr, (h) => hits.push(h));
      det.setSensitivity(this.sensitivity);
      for (let i = 0; i < len; i += 4096) det.push(mono.subarray(i, Math.min(len, i + 4096)));
      det.finish();

      // Overview: min/max pairs for drawing the whole recording.
      const points = 1200, step = Math.max(1, Math.floor(len / points));
      const overview = new Float32Array(points * 2);
      for (let p = 0; p < points; p++) {
        let mn = 0, mx = 0;
        for (let i = p * step; i < Math.min(len, (p + 1) * step); i++) { const v = mono[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
        overview[p * 2] = mn; overview[p * 2 + 1] = mx;
      }
      return { duration: buffer.duration, sampleRate: sr, hits, summary: summarize(hits), overview };
    },

    /** Play the loaded file through the live visualisers. */
    playFile(fromSeconds) {
      if (!this.file) throw new Error('Load a recording first.');
      const ctx = this._ensureCtx();
      this._disconnectSources();
      const src = ctx.createBufferSource();
      src.buffer = this.file.buffer;
      src.connect(this.analyser);
      src.connect(this._proc);
      src.connect(ctx.destination);
      const offset = fromSeconds != null ? fromSeconds : (this.file.offset >= this.file.buffer.duration ? 0 : this.file.offset);
      src.start(0, offset);
      this._src = src;
      this._playStart = ctx.currentTime - offset;
      this._detector.reset();
      src.onended = () => { if (this._src === src) { this.file.offset = 0; this._src = null; this._setState('idle'); emit('ended'); } };
      this._setState('file-playing');
    },

    pauseFile() {
      if (this.state !== 'file-playing') return;
      this.file.offset = this._playhead();
      this._disconnectSources();
      this._setState('file-paused');
    },

    _playhead() { return this._src ? this.ctx.currentTime - this._playStart : (this.file ? this.file.offset : 0); },

    /** Stop mic or playback. */
    stop() {
      this._disconnectSources();
      if (this.state !== 'idle') this._setState('idle');
    },

    /** Forget the loaded recording. */
    unloadFile() { if (this.state.startsWith('file')) this.stop(); this.file = null; },

    /** Re-run the analysis of the loaded recording (e.g. after a sensitivity change). */
    reanalyzeFile() {
      if (!this.file) return null;
      const report = E.analyzeBuffer(this.file.buffer);
      report.name = this.file.name;
      this.file.report = report;
      emit('file', report);
      return report;
    },

    /** 0 = only loud hits count, 1 = very sensitive. */
    setSensitivity(s) {
      this.sensitivity = clamp(s, 0, 1);
      if (this._detector) this._detector.setSensitivity(this.sensitivity);
    },

    /** Report card for everything heard live since the last reset. */
    getSessionSummary() { return summarize(this.sessionHits); },
    resetSession() { this.sessionHits = []; emit('session-reset'); },

    // Pure helpers, exported for UIs and tests
    summarize,
    computeFeatures,
    profileFor,
    KeystrokeDetector,

    /**
     * Fourier "smoothie" demo. Mix simple waves ("fruits") and un-mix them again.
     * @param {Array<{hz:number, amp:number}>} parts
     * @returns {{wave:Float32Array, waveMs:number, spectrum:Float32Array, binHz:number, maxHz:number}}
     */
    demoMix(parts, opts) {
      opts = opts || {};
      const sr = opts.sampleRate || 8000, n = opts.size || 2048;
      const sig = new Float32Array(n);
      for (const p of parts) {
        const ph = p.phase || 0;
        for (let i = 0; i < n; i++) sig[i] += p.amp * Math.sin(2 * Math.PI * p.hz * (i / sr) + ph);
      }
      const waveMs = opts.waveMs || 25;
      const wn = Math.floor((sr * waveMs) / 1000);
      const spectrum = F.magnitudes(sig, F.hann(n));
      return { wave: sig.slice(0, wn), waveMs, spectrum, binHz: sr / n, maxHz: sr / 2, sampleRate: sr };
    },
  };

  global.ThockEngine = E;
})(typeof window !== 'undefined' ? window : globalThis);
