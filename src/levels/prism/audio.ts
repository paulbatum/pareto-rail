import type { EventBus } from '../../events';
import { createBrowserAudioContext, installAudioUnlock } from '../../engine/audio-unlock';
import { emitBeatAt, midiToFreq, quantizeToGrid, secondsPerStep } from '../../engine/music';

const BPM = 96;
const SIXTEENTH = secondsPerStep(BPM, 4);
const THIRTYSECOND = secondsPerStep(BPM, 8);
const SCHEDULE_AHEAD = 0.16;
const SCHEDULER_MS = 25;
const SCALE = [62, 65, 69, 72, 74, 77, 81, 84];

export function createAudio(bus: EventBus) {
  let ctx: AudioContext | null = null;
  let intervalId = 0;
  let unlockGestureStart: (() => void) | null = null;
  let nextTickTime = 0;
  let sixteenthIndex = 0;
  let runStart = 0;
  let mode: 'ambient' | 'run' = 'ambient';
  let masterVolume = 0.8;
  let master: GainNode | null = null;
  let shimmer: GainNode | null = null;
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
    compressor.threshold.value = -20;
    compressor.ratio.value = 4;
    master.connect(compressor).connect(context.destination);

    shimmer = context.createGain();
    shimmer.gain.value = 0.55;
    const delay = context.createDelay(1.4);
    delay.delayTime.value = SIXTEENTH * 5;
    const feedback = context.createGain();
    feedback.gain.value = 0.42;
    const filter = context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 900;
    shimmer.connect(delay);
    delay.connect(filter).connect(feedback).connect(delay);
    filter.connect(master);

    noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 2), context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }

  function schedule() {
    if (!ctx) return;
    while (nextTickTime < ctx.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(sixteenthIndex, nextTickTime);
      nextTickTime += SIXTEENTH;
      sixteenthIndex += 1;
    }
  }

  function scheduleStep(index: number, time: number) {
    const position = Math.max(0, index - runStart);
    const step = position % 16;
    const bar = Math.floor(position / 16);
    if (step % 4 === 0 && ctx) emitBeatAt(bus, ctx, time, Math.floor(index / 4), step === 0);

    const note = SCALE[(step / 2 + bar * 2) % SCALE.length | 0];
    if (mode === 'ambient') {
      if (step % 4 === 0) bell(time, note + 12, 0.09, 0.9);
      return;
    }

    if (step === 0 || step === 10) lowPulse(time, bar % 2 === 0 ? 38 : 41);
    if (step % 2 === 0) bell(time, note + (bar >= 4 ? 12 : 0), 0.11, bar >= 5 ? 0.42 : 0.28);
    if (bar >= 2 && (step === 4 || step === 12)) noiseTick(time, 0.08, 0.035);
    if (bar >= 6 && step % 4 === 3) noiseTick(time, 0.045, 0.11);
  }

  function bell(time: number, midi: number, velocity: number, decay: number) {
    if (!ctx || !master || !shimmer) return;
    const carrier = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const gain = ctx.createGain();
    carrier.type = 'sine';
    mod.type = 'sine';
    carrier.frequency.value = midiToFreq(midi);
    mod.frequency.value = midiToFreq(midi + 12.07);
    modGain.gain.setValueAtTime(90, time);
    modGain.gain.exponentialRampToValueAtTime(0.1, time + decay);
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
    mod.connect(modGain).connect(carrier.frequency);
    carrier.connect(gain);
    gain.connect(master);
    gain.connect(shimmer);
    carrier.start(time);
    mod.start(time);
    carrier.stop(time + decay + 0.05);
    mod.stop(time + decay + 0.05);
  }

  function lowPulse(time: number, midi: number) {
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midi);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, time);
    filter.frequency.exponentialRampToValueAtTime(120, time + 0.42);
    gain.gain.setValueAtTime(0.18, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.48);
    osc.connect(filter).connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + 0.52);
  }

  function noiseTick(time: number, velocity: number, decay: number) {
    if (!ctx || !master || !noiseBuffer) return;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.value = 5200;
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
    source.connect(filter).connect(gain).connect(master);
    source.start(time, Math.random() * 1.5);
    source.stop(time + decay + 0.03);
  }

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    bell(quantizeToGrid(ctx.currentTime, THIRTYSECOND), SCALE[Math.min(lockCount - 1, SCALE.length - 1)] + 12, 0.08, 0.22);
  });

  bus.on('fire', () => {
    if (!ctx) return;
    lowPulse(quantizeToGrid(ctx.currentTime, THIRTYSECOND), 50);
  });

  bus.on('kill', () => {
    if (!ctx) return;
    const time = quantizeToGrid(ctx.currentTime, THIRTYSECOND);
    bell(time, 86, 0.12, 0.45);
    noiseTick(time, 0.07, 0.06);
  });

  bus.on('miss', () => {
    if (!ctx) return;
    lowPulse(ctx.currentTime, 34);
  });

  bus.on('reject', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    lowPulse(time, 31);
    noiseTick(time + 0.02, 0.11, 0.08);
    bell(time + 0.035, 61, 0.055, 0.2);
  });

  bus.on('runstart', () => {
    mode = 'run';
    runStart = sixteenthIndex + ((16 - (sixteenthIndex % 16)) % 16);
  });

  bus.on('runend', () => {
    mode = 'ambient';
    if (ctx) bell(ctx.currentTime + 0.05, 74, 0.13, 1.4);
  });

  return {
    start,
    installGestureStart,
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
