import type { EventBus } from '../../events';
import { createBrowserAudioContext, installAudioUnlock } from '../../engine/audio-unlock';
import { emitBeatAt, midiToFreq, quantizeToGrid, secondsPerStep } from '../../engine/music';

const BPM = 104;
const STEP = secondsPerStep(BPM, 2);
const SCHEDULE_AHEAD = 0.16;
const SCHEDULER_MS = 30;

export function createAudio(bus: EventBus) {
  let ctx: AudioContext | null = null;
  let intervalId = 0;
  let unlockGestureStart: (() => void) | null = null;
  let masterVolume = 0.5;
  let master: GainNode | null = null;
  let nextTickTime = 0;
  let stepIndex = 0;

  const start = async () => {
    if (!ctx) {
      ctx = createBrowserAudioContext();
      master = ctx.createGain();
      master.gain.value = masterVolume * 0.45;
      master.connect(ctx.destination);
      nextTickTime = ctx.currentTime + 0.06;
      intervalId = window.setInterval(schedule, SCHEDULER_MS);
    }
    if (ctx.state === 'suspended') await ctx.resume();
  };

  const installGestureStart = () => {
    unlockGestureStart?.();
    unlockGestureStart = installAudioUnlock(start);
  };

  function schedule() {
    if (!ctx) return;
    while (nextTickTime < ctx.currentTime + SCHEDULE_AHEAD) {
      const beatNumber = Math.floor(stepIndex / 2);
      if (stepIndex % 2 === 0) {
        emitBeatAt(bus, ctx, nextTickTime, beatNumber, beatNumber % 4 === 0);
        tick(nextTickTime, beatNumber % 4 === 0 ? 880 : 660, beatNumber % 4 === 0 ? 0.055 : 0.035);
      }
      nextTickTime += STEP;
      stepIndex += 1;
    }
  }

  function tick(time: number, frequency: number, gainValue: number) {
    tone(time, frequency, gainValue, 0.035, 'sine');
  }

  function tone(time: number, frequency: number, gainValue: number, duration: number, type: OscillatorType = 'triangle') {
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(gainValue, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  const quantize = () => (ctx ? quantizeToGrid(ctx.currentTime, STEP / 2) : 0);

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    tone(quantize(), midiToFreq(72 + Math.min(lockCount, 8)), 0.045, 0.07);
  });

  bus.on('fire', () => {
    if (!ctx) return;
    const time = quantize();
    tone(time, 520, 0.04, 0.06, 'sawtooth');
    tone(time + 0.025, 360, 0.025, 0.055, 'sawtooth');
  });

  bus.on('hit', () => {
    if (!ctx) return;
    tone(quantize(), 960, 0.035, 0.05);
  });

  bus.on('kill', () => {
    if (!ctx) return;
    const time = quantize();
    tone(time, 1174.66, 0.05, 0.12, 'sine');
    tone(time + 0.035, 1567.98, 0.035, 0.1, 'sine');
  });

  bus.on('volley', ({ scoreAwarded }) => {
    if (!ctx || scoreAwarded <= 0) return;
    const time = quantize();
    tone(time, 659.25, 0.045, 0.12);
    tone(time + 0.05, 783.99, 0.04, 0.12);
    tone(time + 0.1, 987.77, 0.04, 0.14);
  });

  return {
    start,
    installGestureStart,
    setMasterVolume(volume: number) {
      masterVolume = Math.min(1, Math.max(0, volume));
      if (ctx && master) master.gain.setTargetAtTime(masterVolume * 0.45, ctx.currentTime, 0.05);
    },
    getMasterVolume() {
      return masterVolume;
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
