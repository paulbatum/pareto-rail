import { midiToFreq } from '../../engine/music';

// Plucked strings by Karplus-Strong, rendered offline into AudioBuffers.
//
// A live Web Audio feedback loop cannot do this above about 345 Hz: a DelayNode
// inside a cycle is clamped to one 128-frame render quantum, which caps the loop
// frequency. The kora register sits well above that, so each string is computed
// in JS once (delay line, two-point averaging loss filter, allpass for exact
// tuning) and cached per note and timbre. Playback is then a single buffer source.

export type PluckTimbre =
  | 'harp' // soft finger pluck near the middle of the string: round, long
  | 'kora' // bright thumb pluck near the bridge: hollow and ringing
  | 'bite' // hard nail pluck at the bridge: the boss and whitewater attack
  | 'pizz' // cello pizzicato: dark and short, for shots
  | 'muted' // a string damped by the palm: the rejected release
  | 'cable'; // a steel cable under tension: long, metallic, very bright

type TimbreSpec = {
  /** One-pole lowpass coefficient applied to the noise burst (1 = white). */
  brightness: number;
  /** Pluck position as a fraction of the string; comb-filters the burst. */
  position: number;
  /** Weight of the older sample in the loop's averaging filter. 0.5 damps the most. */
  damping: number;
  /** Seconds to fall 60 dB at MIDI 36 and at MIDI 88. */
  t60Low: number;
  t60High: number;
  maxSeconds: number;
};

const TIMBRES: Record<PluckTimbre, TimbreSpec> = {
  harp: { brightness: 0.32, position: 0.28, damping: 0.5, t60Low: 3.2, t60High: 1.3, maxSeconds: 2.2 },
  kora: { brightness: 0.75, position: 0.11, damping: 0.42, t60Low: 2.6, t60High: 1.0, maxSeconds: 1.8 },
  bite: { brightness: 1, position: 0.07, damping: 0.3, t60Low: 2.2, t60High: 0.8, maxSeconds: 1.5 },
  pizz: { brightness: 0.28, position: 0.22, damping: 0.5, t60Low: 0.55, t60High: 0.3, maxSeconds: 0.6 },
  muted: { brightness: 0.22, position: 0.18, damping: 0.5, t60Low: 0.1, t60High: 0.07, maxSeconds: 0.14 },
  cable: { brightness: 1, position: 0.04, damping: 0.18, t60Low: 1.6, t60High: 1.1, maxSeconds: 1.6 },
};

// 32 kHz keeps the cache small (a 1.5 s string is ~190 KB) and still carries
// the pluck's attack up to 16 kHz; the context resamples on playback.
const RENDER_RATE = 32000;

export type PluckBank = {
  buffer(midi: number, timbre: PluckTimbre): AudioBuffer;
};

export function createPluckBank(context: BaseAudioContext): PluckBank {
  const cache = new Map<string, AudioBuffer>();
  let seed = 0x5eed;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };

  return {
    buffer(midi, timbre) {
      const note = Math.round(midi);
      const key = `${timbre}:${note}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const samples = renderString(note, TIMBRES[timbre], random);
      const buffer = context.createBuffer(1, samples.length, RENDER_RATE);
      buffer.copyToChannel(samples, 0);
      cache.set(key, buffer);
      return buffer;
    },
  };
}

function renderString(midi: number, spec: TimbreSpec, random: () => number) {
  const frequency = midiToFreq(midi);
  const period = RENDER_RATE / frequency;
  const registerT = Math.min(1, Math.max(0, (midi - 36) / 52));
  const t60 = spec.t60Low + (spec.t60High - spec.t60Low) * registerT;
  const length = Math.ceil(RENDER_RATE * Math.min(spec.maxSeconds, t60 + 0.05));
  const out = new Float32Array(length);

  // Excitation: one period of filtered noise, comb-filtered at the pluck point.
  const burstLength = Math.max(2, Math.round(period));
  const burst = new Float32Array(burstLength);
  let smoothed = 0;
  for (let i = 0; i < burstLength; i += 1) {
    smoothed += spec.brightness * (random() - smoothed);
    burst[i] = smoothed;
  }
  const tap = Math.max(1, Math.round(period * spec.position));
  let mean = 0;
  for (let i = burstLength - 1; i >= 0; i -= 1) {
    burst[i] -= i >= tap ? burst[i - tap] : 0;
    mean += burst[i];
  }
  mean /= burstLength;
  for (let i = 0; i < burstLength; i += 1) burst[i] -= mean;

  // Loop delay = integer part + averaging filter delay + allpass fraction.
  const loopDelay = period - spec.damping;
  let whole = Math.floor(loopDelay);
  let fraction = loopDelay - whole;
  if (fraction < 0.1) {
    whole -= 1;
    fraction += 1;
  }
  const allpass = (1 - fraction) / (1 + fraction);
  const loss = 0.001 ** (1 / (frequency * t60));
  let allpassIn = 0;
  let allpassOut = 0;
  for (let n = 0; n < length; n += 1) {
    const newer = n - whole >= 0 ? out[n - whole] : 0;
    const older = n - whole - 1 >= 0 ? out[n - whole - 1] : 0;
    const averaged = (1 - spec.damping) * newer + spec.damping * older;
    const tuned = allpass * averaged + allpassIn - allpass * allpassOut;
    allpassIn = averaged;
    allpassOut = tuned;
    out[n] = (n < burstLength ? burst[n] : 0) + loss * tuned;
  }

  // DC block, short fade at the tail, normalise.
  let previousIn = 0;
  let previousOut = 0;
  let peak = 0;
  for (let n = 0; n < length; n += 1) {
    const blocked = out[n] - previousIn + 0.995 * previousOut;
    previousIn = out[n];
    previousOut = blocked;
    out[n] = blocked;
    peak = Math.max(peak, Math.abs(blocked));
  }
  const fade = Math.min(length, Math.round(RENDER_RATE * 0.02));
  for (let i = 0; i < fade; i += 1) out[length - 1 - i] *= i / fade;
  const scale = peak > 0 ? 0.8 / peak : 0;
  for (let n = 0; n < length; n += 1) out[n] *= scale;
  return out;
}
