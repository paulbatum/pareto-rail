import type { EventBus } from '../../events';
import { createBrowserAudioContext, installAudioUnlock } from '../../engine/audio-unlock';
import { emitBeatAt, midiToFreq, quantizeToGrid } from '../../engine/music';

// Procedural synesthesia layer: a 126 BPM arrangement that builds over the
// 45-second run (kick → bass/hats → arp → claps/open hats → riser into the
// Warden fight), with game SFX pitched in A minor and quantized to the
// 32nd-note grid so player actions land inside the music, Rez-style.

const BPM = 126;
const SIXTEENTH = 60 / BPM / 4;
const THIRTYSECOND = SIXTEENTH / 2;
const SCHEDULE_AHEAD = 0.18;
const SCHEDULER_MS = 25;

// A natural minor / pentatonic material.
const CHORDS = [
  { bass: 33, pad: [57, 60, 64, 67], arp: [69, 72, 76, 79] }, // Am7
  { bass: 29, pad: [53, 57, 60, 64], arp: [69, 72, 77, 81] }, // Fmaj7
  { bass: 36, pad: [52, 55, 60, 64], arp: [67, 72, 76, 79] }, // Cmaj7
  { bass: 31, pad: [55, 59, 62, 64], arp: [67, 71, 74, 79] }, // G6
];
const LOCK_SCALE = [69, 72, 74, 76, 79, 81, 84, 88]; // A minor pentatonic, rising per lock

export function createAudio(bus: EventBus) {
  let ctx: AudioContext | null = null;
  let intervalId = 0;
  let unlockGestureStart: (() => void) | null = null;
  let nextTickTime = 0;
  let sixteenthIndex = 0;
  let arrangementStart = 0;
  // Boots in ambient (attract screen); runstart switches to the full arrangement.
  let mode: 'run' | 'ambient' = 'ambient';
  let masterVolume = 0.8;

  let master: GainNode | null = null;
  let duck: GainNode | null = null;
  let delaySend: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;

  const start = async () => {
    if (!ctx) {
      ctx = createBrowserAudioContext();
      buildGraph(ctx);
      nextTickTime = ctx.currentTime + 0.06;
      intervalId = window.setInterval(schedule, SCHEDULER_MS);
    }
    if (ctx.state === 'suspended') await ctx.resume();
  };

  const installGestureStart = () => {
    unlockGestureStart?.();
    unlockGestureStart = installAudioUnlock(start);
  };

  function buildGraph(context: AudioContext) {
    master = context.createGain();
    master.gain.value = masterVolume;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.22;
    master.connect(compressor).connect(context.destination);

    duck = context.createGain();
    duck.connect(master);

    // Feedback delay tuned to a dotted eighth: the space the arp lives in.
    delaySend = context.createGain();
    const delay = context.createDelay(1);
    delay.delayTime.value = SIXTEENTH * 3;
    const feedback = context.createGain();
    feedback.gain.value = 0.34;
    const damp = context.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    delaySend.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    damp.connect(duck);

    noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 2), context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }

  // ---- scheduler ----------------------------------------------------------

  function schedule() {
    if (!ctx) return;
    while (nextTickTime < ctx.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(sixteenthIndex, nextTickTime);
      nextTickTime += SIXTEENTH;
      sixteenthIndex += 1;
    }
  }

  function scheduleStep(index: number, time: number) {
    const position = Math.max(0, index - arrangementStart);
    const step = position % 16;
    const bar = Math.floor(position / 16);
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];

    if (step % 4 === 0) {
      const beatNumber = Math.floor(index / 4);
      scheduleBeat(time, beatNumber, step === 0);
    }

    if (step === 0 && bar % 2 === 0) {
      pad(time, chord.pad, 16 * 2 * SIXTEENTH * 1.05);
    }

    if (mode === 'ambient') {
      if (step % 4 === 0) arpNote(time, chord.arp[(step / 4) % chord.arp.length], 0.5);
      return;
    }

    // Bar 16 lands near the Warden's entrance (~30s); bar 22 rides out the end.
    const isFillBar = bar >= 16;
    if (step % 4 === 0 || (isFillBar && step % 2 === 0 && step >= 8)) {
      kick(time, step === 0 ? 1 : 0.9);
    }
    if (bar >= 4 && (step === 4 || step === 12)) clap(time);
    if (bar >= 1) {
      const openHat = bar >= 6 && step % 4 === 2;
      if (openHat) hat(time, 0.14, 0.2);
      else if (bar >= 2 || step % 2 === 1) hat(time, step % 4 === 2 ? 0.09 : 0.045, 0.03);
    }
    if (bar >= 1) {
      const bassSteps: Record<number, number> = { 0: 0, 3: 0, 6: 12, 8: 0, 11: 0, 14: 7 };
      if (step in bassSteps) bass(time, chord.bass + bassSteps[step], step === 0 ? 1 : 0.75);
    }
    if (bar >= 2) {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      const octave = step >= 8 ? 12 : 0;
      arpNote(time, chord.arp[order[step % order.length]] + octave, bar >= 8 ? 0.85 : 0.6);
    }
    if ((bar === 14 || bar === 21) && step === 0) riser(time, 16 * 2 * SIXTEENTH);
  }

  function scheduleBeat(time: number, beatNumber: number, isDownbeat: boolean) {
    if (!ctx) return;
    emitBeatAt(bus, ctx, time, beatNumber, isDownbeat);
  }

  const quantize = (time: number) => quantizeToGrid(time, THIRTYSECOND);

  // ---- instruments --------------------------------------------------------

  function kick(time: number, vel: number) {
    if (!ctx || !master || !duck) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(43, time + 0.11);
    gain.gain.setValueAtTime(0.5 * vel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.17);
    osc.connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + 0.2);
    noiseHit(time, 0.1 * vel, 0.004, 'highpass', 1200, master);
    // Sidechain: everything melodic breathes around the kick.
    duck.gain.cancelScheduledValues(time);
    duck.gain.setValueAtTime(0.42, time);
    duck.gain.linearRampToValueAtTime(1, time + 0.26);
  }

  function clap(time: number) {
    if (!master) return;
    noiseHit(time, 0.16, 0.05, 'bandpass', 1900, master);
    noiseHit(time + 0.013, 0.1, 0.07, 'bandpass', 2200, master);
  }

  function hat(time: number, vel: number, decay: number) {
    if (!duck) return;
    noiseHit(time, vel, decay, 'highpass', 7200, duck);
  }

  function bass(time: number, midi: number, vel: number) {
    if (!ctx || !duck) return;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToFreq(midi);
    filter.type = 'lowpass';
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(200 + vel * 800, time);
    filter.frequency.exponentialRampToValueAtTime(160, time + 0.2);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.3 * vel, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
    osc.connect(filter).connect(gain).connect(duck);
    osc.start(time);
    osc.stop(time + 0.28);
  }

  function pad(time: number, midis: number[], duration: number) {
    if (!ctx || !duck || !delaySend) return;
    for (const midi of midis) {
      for (const detune of [-7, 7]) {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = detune;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(420, time);
        filter.frequency.linearRampToValueAtTime(760, time + duration * 0.5);
        filter.frequency.linearRampToValueAtTime(420, time + duration);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.045, time + 0.5);
        gain.gain.setValueAtTime(0.045, time + duration - 0.4);
        gain.gain.linearRampToValueAtTime(0, time + duration);
        osc.connect(filter).connect(gain);
        gain.connect(duck);
        gain.connect(delaySend);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
    }
  }

  function arpNote(time: number, midi: number, vel: number) {
    if (!ctx || !duck || !delaySend) return;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midi);
    filter.type = 'lowpass';
    filter.frequency.value = 2600;
    gain.gain.setValueAtTime(0.16 * vel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    osc.connect(filter).connect(gain);
    gain.connect(duck);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    gain.connect(send).connect(delaySend);
    osc.start(time);
    osc.stop(time + 0.15);
  }

  function riser(time: number, duration: number) {
    if (!ctx || !master || !noiseBuffer) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(300, time);
    filter.frequency.exponentialRampToValueAtTime(6400, time + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.14, time + duration);
    gain.gain.linearRampToValueAtTime(0, time + duration + 0.05);
    source.connect(filter).connect(gain).connect(master);
    source.start(time);
    source.stop(time + duration + 0.1);
  }

  function noiseHit(
    time: number,
    vel: number,
    decay: number,
    filterType: BiquadFilterType,
    frequency: number,
    destination: AudioNode,
  ) {
    if (!ctx || !noiseBuffer) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loopStart = Math.random();
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + Math.max(0.012, decay));
    source.connect(filter).connect(gain).connect(destination);
    source.start(time, Math.random() * 1.5);
    source.stop(time + Math.max(0.02, decay) + 0.03);
  }

  // ---- game SFX (all in key, all on the grid) -----------------------------

  bus.on('lock', ({ lockCount }) => {
    if (!ctx || !duck || !delaySend) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = quantize(ctx.currentTime);
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midi);
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    gain.gain.setValueAtTime(0.16, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.connect(filter).connect(gain);
    gain.connect(duck);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    gain.connect(send).connect(delaySend);
    osc.start(time);
    osc.stop(time + 0.13);
  });

  bus.on('fire', () => {
    if (!ctx || !master) return;
    const time = quantize(ctx.currentTime);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(690, time);
    osc.frequency.exponentialRampToValueAtTime(165, time + 0.07);
    gain.gain.setValueAtTime(0.09, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    osc.connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + 0.1);
    noiseHit(time, 0.05, 0.02, 'highpass', 3000, master);
  });

  bus.on('hit', ({ lethal }) => {
    if (lethal || !ctx || !duck || !delaySend) return;
    const time = quantize(ctx.currentTime);
    for (const [midi, at, vel] of [
      [81, time, 0.08],
      [84, time + THIRTYSECOND, 0.07],
      [88, time + THIRTYSECOND * 2, 0.06],
    ] as const) {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(midi);
      filter.type = 'lowpass';
      filter.frequency.value = 4200;
      gain.gain.setValueAtTime(vel, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.14);
      osc.connect(filter).connect(gain);
      gain.connect(duck);
      const send = ctx.createGain();
      send.gain.value = 0.38;
      gain.connect(send).connect(delaySend);
      osc.start(at);
      osc.stop(at + 0.16);
    }
    noiseHit(time, 0.035, 0.035, 'highpass', 5600, duck);
  });

  bus.on('shielded', () => {
    if (!ctx || !master) return;
    const time = ctx.currentTime;

    // Negative feedback: a dry, dissonant shield thunk that cuts through the
    // music without sounding like a successful hit sparkle.
    for (const [start, end, at, vel] of [
      [330, 92, time, 0.18],
      [233, 61, time + 0.028, 0.13],
    ] as const) {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(start, at);
      osc.frequency.exponentialRampToValueAtTime(end, at + 0.2);
      filter.type = 'bandpass';
      filter.Q.value = 5;
      filter.frequency.setValueAtTime(1100, at);
      filter.frequency.exponentialRampToValueAtTime(430, at + 0.18);
      gain.gain.setValueAtTime(vel, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.24);
      osc.connect(filter).connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + 0.26);
    }
    noiseHit(time, 0.15, 0.09, 'bandpass', 720, master);
    noiseHit(time + 0.025, 0.07, 0.12, 'highpass', 2400, master);
  });

  bus.on('kill', () => {
    if (!ctx || !duck || !delaySend) return;
    const time = quantize(ctx.currentTime);
    for (const [frequency, vel] of [
      [880, 0.12],
      [1318.5, 0.09],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(vel, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
      osc.connect(gain);
      gain.connect(duck);
      const send = ctx.createGain();
      send.gain.value = 0.4;
      gain.connect(send).connect(delaySend);
      osc.start(time);
      osc.stop(time + 0.25);
    }
    noiseHit(time, 0.06, 0.09, 'highpass', 5200, duck);
  });

  // Hull hit: a low impact boom under a dissonant tritone stab — the one
  // sound in the level that is deliberately out of key.
  bus.on('playerhit', () => {
    if (!ctx || !master) return;
    const time = ctx.currentTime;
    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(96, time);
    boom.frequency.exponentialRampToValueAtTime(34, time + 0.28);
    boomGain.gain.setValueAtTime(0.42, time);
    boomGain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
    boom.connect(boomGain).connect(master);
    boom.start(time);
    boom.stop(time + 0.45);
    for (const midi of [63, 69]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = midiToFreq(midi);
      gain.gain.setValueAtTime(0.07, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
      osc.connect(gain).connect(master);
      osc.start(time);
      osc.stop(time + 0.28);
    }
    noiseHit(time, 0.2, 0.14, 'bandpass', 900, master);
  });

  // Warden entrance: a rising two-note alarm over a long riser.
  bus.on('spawn', ({ kind }) => {
    if (kind !== 'warden-core' || !ctx || !duck || !delaySend) return;
    const time = quantize(ctx.currentTime);
    riser(time, 1.8);
    [57, 63].forEach((midi, index) => {
      if (!ctx || !duck || !delaySend) return;
      const at = time + index * 0.42;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFreq(midi);
      filter.type = 'lowpass';
      filter.frequency.value = 1600;
      gain.gain.setValueAtTime(0.16, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
      osc.connect(filter).connect(gain);
      gain.connect(duck);
      const send = ctx.createGain();
      send.gain.value = 0.5;
      gain.connect(send).connect(delaySend);
      osc.start(at);
      osc.stop(at + 0.55);
    });
  });

  bus.on('miss', () => {
    if (!ctx || !master) return;
    const time = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(68, time + 0.12);
    gain.gain.setValueAtTime(0.05, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.13);
    osc.connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + 0.15);
  });

  bus.on('runstart', () => {
    mode = 'run';
    // Restart the arrangement on the next bar boundary so the build-up
    // tracks the new run.
    arrangementStart = sixteenthIndex + ((16 - (sixteenthIndex % 16)) % 16);
  });

  bus.on('runend', () => {
    mode = 'ambient';
    if (!ctx) return;
    pad(ctx.currentTime + 0.05, [57, 64, 69, 76], 5);
  });

  return {
    start,
    installGestureStart,
    // 0..1; safe to call before the AudioContext exists.
    setMasterVolume(volume: number) {
      masterVolume = Math.min(1, Math.max(0, volume)) * 0.8;
      if (ctx && master) master.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.05);
    },
    getMasterVolume() {
      return masterVolume / 0.8;
    },
    async suspend() {
      if (ctx && ctx.state === 'running') await ctx.suspend();
    },
    dispose() {
      unlockGestureStart?.();
      unlockGestureStart = null;
      if (intervalId) window.clearInterval(intervalId);
      void ctx?.close();
      ctx = null;
    },
  };
}
