import type { EventBus } from '../../events';
import { createBeatLevelAudio, defineInstruments, playNoiseHit, playOscillatorVoice } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { quantizeActionSfxTime } from '../../engine/action-sfx-quantization';
import { midiToFreq, quantizeToGrid, secondsPerStep } from '../../engine/music';
import { PRISM_BPM, PRISM_RUN_DURATION } from './gameplay';

const SIXTEENTH = secondsPerStep(PRISM_BPM, 4);
const THIRTYSECOND = secondsPerStep(PRISM_BPM, 8);
const SCALE = [62, 65, 69, 72, 74, 77, 81, 84];

export function createAudio(bus: EventBus) {
  return createPrismAudio(bus).audio;
}

export const tracePrismAudio = createAudioTraceHarness({
  level: 'prism-bloom',
  bpm: PRISM_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: PRISM_RUN_DURATION,
  createAudio: createPrismAudio,
});

function createPrismAudio(bus: EventBus, trace?: AudioTraceSink) {
  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    scheduleAhead: 0.16,
    schedulerMs: 25,
    volumeScale: 0.8,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      combinedVolume: true,
      compressor: { threshold: -20, ratio: 4 },
      delay: { maxTime: 1.4, time: SIXTEENTH * 5, feedback: 0.42, dampHz: 900, dampType: 'highpass', sendGain: 0.55, returnTo: 'master' },
      noiseSeconds: 2,
    },
    onStep({ position, step, bar, time, mode }) {
      const note = SCALE[(step / 2 + bar * 2) % SCALE.length | 0];
      if (mode === 'ambient') {
        if (step % 4 === 0) inst.bell(time, note + 12, 0.09, 0.9);
        return;
      }

      if (step === 0 || step === 10) inst.lowPulse(time, bar % 2 === 0 ? 38 : 41);
      if (step % 2 === 0) inst.bell(time, note + (bar >= 4 ? 12 : 0), 0.11, bar >= 5 ? 0.42 : 0.28);
      if (bar >= 2 && (step === 4 || step === 12)) inst.noiseTick(time, 0.08, 0.035);
      if (bar >= 6 && step % 4 === 3) inst.noiseTick(time, 0.045, 0.11);
    },
    onRunEnd() {
      const ctx = runtime.context();
      if (ctx) inst.bell(ctx.currentTime + 0.05, 74, 0.13, 1.4);
    },
  });

  const inst = defineInstruments({ trace, context: runtime.context }, {
    bell(context, time, midi, velocity, decay) {
      const mix = runtime.mix();
      if (!mix?.master || !mix.delaySend) return;
      const carrier = context.createOscillator();
      const mod = context.createOscillator();
      const modGain = context.createGain();
      const gain = context.createGain();
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
      gain.connect(mix.master);
      gain.connect(mix.delaySend);
      carrier.start(time);
      mod.start(time);
      carrier.stop(time + decay + 0.05);
      mod.stop(time + decay + 0.05);
    },
    lowPulse(context, time, midi) {
      const mix = runtime.mix();
      if (!mix?.master) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.52,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        filter: {
          type: 'lowpass',
          frequency: 900,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 120, time: time + 0.42 }],
        },
        gainAutomation: [
          { type: 'set', value: 0.18, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.48 },
        ],
        destination: mix.master,
      });
    },
    noiseTick(context, time, velocity, decay) {
      const mix = runtime.mix();
      if (!mix?.master || !mix.noiseBuffer) return;
      playNoiseHit({
        context,
        buffer: mix.noiseBuffer,
        time,
        velocity,
        decay,
        filterType: 'highpass',
        frequency: 5200,
        destination: mix.master,
        offset: Math.random() * 1.5,
      });
    },
  });

  bus.on('lock', ({ lockCount }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    inst.bell(quantizeActionSfxTime(ctx.currentTime, THIRTYSECOND), SCALE[Math.min(lockCount - 1, SCALE.length - 1)] + 12, 0.08, 0.22);
  });

  bus.on('fire', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    inst.lowPulse(quantizeActionSfxTime(ctx.currentTime, THIRTYSECOND), 50);
  });

  bus.on('kill', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    const time = quantizeToGrid(ctx.currentTime, THIRTYSECOND);
    inst.bell(time, 86, 0.12, 0.45);
    inst.noiseTick(time, 0.07, 0.06);
  });

  bus.on('miss', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    inst.lowPulse(ctx.currentTime, 34);
  });

  bus.on('reject', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    const time = ctx.currentTime;
    inst.lowPulse(time, 31);
    inst.noiseTick(time + 0.02, 0.11, 0.08);
    inst.bell(time + 0.035, 61, 0.055, 0.2);
  });

  return runtime;
}
