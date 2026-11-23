/*
 * ThockScope — fft.js
 * A tiny, dependency-free Fast Fourier Transform plus helpers.
 *
 * The Fourier transform takes a chunk of sound (a list of numbers that wiggle up
 * and down over time) and tells you HOW MUCH of each pitch (frequency) is inside it.
 * The FFT is just a very fast way to compute that.
 *
 * Exposes: window.ThockFFT
 */
(function (global) {
  'use strict';

  /** In-place radix-2 FFT. re/im are Float32Array/Float64Array of the same power-of-two length. */
  function fft(re, im) {
    const n = re.length;
    if (n & (n - 1)) throw new Error('FFT length must be a power of two');
    // Bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    // Butterflies
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const ang = -2 * Math.PI / len;
      const wlr = Math.cos(ang), wli = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let wr = 1, wi = 0;
        for (let k = 0; k < half; k++) {
          const a = i + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          const t = wr * wlr - wi * wli;
          wi = wr * wli + wi * wlr;
          wr = t;
        }
      }
    }
  }

  const windowCache = new Map();

  /** Hann window: smooth hill shape, good for steady sounds. */
  function hann(n) {
    const key = 'hann' + n;
    if (windowCache.has(key)) return windowCache.get(key);
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    windowCache.set(key, w);
    return w;
  }

  /**
   * Transient window: a very short fade-in, flat middle, smooth fade-out.
   * Keeps the sharp "attack" of a keystroke intact (a Hann window would hide it).
   */
  function transient(n) {
    const key = 'tr' + n;
    if (windowCache.has(key)) return windowCache.get(key);
    const w = new Float32Array(n);
    const fadeIn = Math.min(32, n >> 4);
    const fadeOutStart = Math.floor(n * 0.6);
    for (let i = 0; i < n; i++) {
      if (i < fadeIn) w[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
      else if (i >= fadeOutStart) w[i] = 0.5 + 0.5 * Math.cos((Math.PI * (i - fadeOutStart)) / (n - fadeOutStart));
      else w[i] = 1;
    }
    windowCache.set(key, w);
    return w;
  }

  /**
   * Magnitude spectrum of a real signal.
   * @param {Float32Array} samples  length must be a power of two
   * @param {Float32Array} [win]    window (defaults to Hann)
   * @returns {Float32Array} magnitudes, length n/2, scaled so a full-scale sine ≈ 1.0
   */
  function magnitudes(samples, win) {
    const n = samples.length;
    win = win || hann(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    let wsum = 0;
    for (let i = 0; i < n; i++) { re[i] = samples[i] * win[i]; wsum += win[i]; }
    fft(re, im);
    const out = new Float32Array(n >> 1);
    const scale = 2 / wsum;
    for (let i = 0; i < out.length; i++) out[i] = Math.hypot(re[i], im[i]) * scale;
    return out;
  }

  const toDb = (mag) => 20 * Math.log10(Math.max(mag, 1e-9));
  const fromDb = (db) => Math.pow(10, db / 20);

  /** Log-spaced frequency axis (how ears hear pitch: each octave gets equal room). */
  function logAxis(minHz, maxHz, count) {
    const hz = new Float32Array(count);
    const edges = new Float32Array(count + 1);
    const lmin = Math.log(minHz), lmax = Math.log(maxHz);
    for (let i = 0; i <= count; i++) edges[i] = Math.exp(lmin + ((lmax - lmin) * i) / count);
    for (let i = 0; i < count; i++) hz[i] = Math.sqrt(edges[i] * edges[i + 1]);
    return { hz, edges };
  }

  /**
   * Squash a linear-magnitude spectrum into log-spaced bins, in dB.
   * @param {Float32Array} mags  linear magnitudes (bin k = k * binHz)
   * @param {number} binHz       sampleRate / fftSize
   * @param {{hz:Float32Array, edges:Float32Array}} axis from logAxis()
   * @param {Float32Array} [out]
   */
  function toLogBins(mags, binHz, axis, out) {
    const count = axis.hz.length;
    out = out || new Float32Array(count);
    for (let b = 0; b < count; b++) {
      const lo = axis.edges[b] / binHz, hi = axis.edges[b + 1] / binHz;
      let k0 = Math.floor(lo), k1 = Math.ceil(hi);
      let p = 0, c = 0;
      if (k1 - k0 <= 1) {
        // Bin narrower than one FFT bin: interpolate.
        const x = axis.hz[b] / binHz;
        const i = Math.min(mags.length - 2, Math.floor(x));
        const t = x - i;
        const m = mags[i] * (1 - t) + mags[i + 1] * t;
        p = m * m; c = 1;
      } else {
        k1 = Math.min(k1, mags.length);
        for (let k = k0; k < k1; k++) { p += mags[k] * mags[k]; c++; }
      }
      out[b] = 10 * Math.log10(Math.max(p / Math.max(c, 1), 1e-18));
    }
    return out;
  }

  /** Moving-average smoothing (used to draw the smooth "frequency curve"). */
  function smooth(arr, radius, out) {
    const n = arr.length;
    out = out || new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - radius); j <= Math.min(n - 1, i + radius); j++) {
        const w = radius + 1 - Math.abs(i - j);
        s += arr[j] * w; c += w;
      }
      out[i] = s / c;
    }
    return out;
  }

  global.ThockFFT = { fft, hann, transient, magnitudes, toDb, fromDb, logAxis, toLogBins, smooth };
})(typeof window !== 'undefined' ? window : globalThis);
