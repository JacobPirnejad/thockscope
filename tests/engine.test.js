// Node test: synthesize "keystrokes" and check the engine tells them apart.
// Run with:  node tests/engine.test.js
globalThis.window = globalThis;
require('../js/fft.js');
require('../js/engine.js');
const E = globalThis.ThockEngine;
const sr = 48000;

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/** count keystrokes, 250 ms apart. freqs = [[hz, amp], ...], decay = seconds. */
function makeBuffer(freqs, decay, extra) {
  const count = 12;
  const len = Math.floor(sr * (count * 0.25 + 0.5));
  const d = new Float32Array(len);
  for (let i = 0; i < len; i++) d[i] = rnd() * 0.0005;
  for (let k = 0; k < count; k++) {
    const s0 = Math.floor(sr * (0.2 + k * 0.25));
    for (let i = 0; i < sr * 0.2; i++) {
      const t = i / sr, env = Math.exp(-t / decay);
      let v = 0;
      for (const [f, a] of freqs) v += a * Math.sin(2 * Math.PI * f * t);
      v += 0.15 * rnd() * Math.exp(-t / 0.002); // tiny click transient
      d[s0 + i] += 0.4 * env * v;
      if (extra) d[s0 + i] += extra(t);
    }
  }
  return { sampleRate: sr, length: len, numberOfChannels: 1, duration: len / sr, getChannelData: () => d };
}

const thock = E.analyzeBuffer(makeBuffer([[220, 1], [450, 0.6], [900, 0.2]], 0.012)).summary;
const clack = E.analyzeBuffer(makeBuffer([[3200, 1], [5200, 0.7], [1800, 0.3]], 0.008)).summary;
const ping = E.analyzeBuffer(makeBuffer([[400, 1], [800, 0.4]], 0.012,
  (t) => 0.05 * Math.exp(-t / 0.08) * Math.sin(2 * Math.PI * 4100 * t))).summary;

const show = (n, s) => console.log(n.padEnd(6), 'hits', s.count, 'score', s.thockScore, s.profileName,
  'pitch', s.peakHz, 'centroid', s.centroid, 'decay', s.decayMs, 'ring', s.ringFraction.toFixed(2), '|', s.diagnosis.join(','));
show('thock', thock); show('clack', clack); show('ping', ping);

const demo = E.demoMix([{ hz: 150, amp: 1 }, { hz: 900, amp: 0.5 }]);
const at = (hz) => Math.max(...[-1, 0, 1].map((o) => demo.spectrum[Math.round(hz / demo.binHz) + o]));
console.log('demo: 150Hz', at(150).toFixed(2), '900Hz', at(900).toFixed(2), '500Hz', at(500).toFixed(3));

const checks = {
  'thock: 12 hits': thock.count === 12,
  'clack: 12 hits': clack.count === 12,
  'thock scores deep': thock.thockScore >= 60,
  'clack scores bright': clack.thockScore < 38,
  'ping flagged ringy': ping.diagnosis.includes('ringy'),
  'thock not ringy': !thock.diagnosis.includes('ringy'),
  'clack not ringy': !clack.diagnosis.includes('ringy'),
  'demo un-mixes the fruits': at(150) > 0.8 && at(900) > 0.4 && at(500) < 0.05,
};
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log(v ? '  ok  ' : '  FAIL', k); ok = ok && v; }
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
