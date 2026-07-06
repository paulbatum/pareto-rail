import type { EventBus } from '../../events';
import { createLevelAudioKit, createMixBus, createStepTransport, defineInstruments, playNoiseHit, playOscillatorVoice, type MixBus } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { quantizeActionSfxTime } from '../../engine/action-sfx-quantization';
import { emitBeatAt, midiToFreq, quantizeToGrid, secondsPerStep } from '../../engine/music';
import { PRISM_BPM, PRISM_RUN_DURATION } from './gameplay';

const SIXTEENTH = secondsPerStep(PRISM_BPM, 4);
const THIRTYSECOND = secondsPerStep(PRISM_BPM, 8);
const SCHEDULE_AHEAD = 0.16;
const SCHEDULER_MS = 25;
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
  let ctx: AudioContext | null = null;
  let runStart = 0;
  let mode: 'ambient' | 'run' = 'ambient';
  let mix: MixBus | null = null;

  const transport = createStepTransport({
    stepSeconds: SIXTEENTH,
    scheduleAhead: SCHEDULE_AHEAD,
    startDelay: 0.06,
    onStep({ index, time }) {
      scheduleStep(index, time);
    },
  });

  const inst = defineInstruments({ trace, context: () => ctx }, {
    bell(context, time, midi, velocity, decay) {
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

  const audio = createLevelAudioKit({
    volumeScale: 0.8,
    schedulerMs: SCHEDULER_MS,
    onCreateContext(context, masterVolume) {
      ctx = context;
      mix = createMixBus(context, {
        musicVolume: masterVolume,
        sfxVolume: masterVolume,
        combinedVolume: true,
        compressor: { threshold: -20, ratio: 4 },
        delay: { maxTime: 1.4, time: SIXTEENTH * 5, feedback: 0.42, dampHz: 900, dampType: 'highpass', sendGain: 0.55, returnTo: 'master' },
        noiseSeconds: 2,
      });
      transport.start(context);
    },
    onSchedule(context) {
      transport.schedule(context);
    },
    onVolumeChange(context, masterVolume) {
      mix?.setMasterVolume(masterVolume, context.currentTime, 0.05);
    },
    onDispose() {
      ctx = null;
      mix = null;
    },
  });

  function traceRun(seconds: number) {
    mode = 'run';
    runStart = 0;
    transport.reset(0.06, 0);
    ctx = { currentTime: 0 } as AudioContext;
    transport.runUntil(seconds);
    ctx = null;
  }

  function scheduleStep(index: number, time: number) {
    const position = Math.max(0, index - runStart);
    const step = position % 16;
    const bar = Math.floor(position / 16);
    if (step % 4 === 0) scheduleBeat(time, Math.floor(index / 4), step === 0);

    const note = SCALE[(step / 2 + bar * 2) % SCALE.length | 0];
    if (mode === 'ambient') {
      if (step % 4 === 0) inst.bell(time, note + 12, 0.09, 0.9);
      return;
    }

    if (step === 0 || step === 10) inst.lowPulse(time, bar % 2 === 0 ? 38 : 41);
    if (step % 2 === 0) inst.bell(time, note + (bar >= 4 ? 12 : 0), 0.11, bar >= 5 ? 0.42 : 0.28);
    if (bar >= 2 && (step === 4 || step === 12)) inst.noiseTick(time, 0.08, 0.035);
    if (bar >= 6 && step % 4 === 3) inst.noiseTick(time, 0.045, 0.11);
  }

  function scheduleBeat(time: number, beatNumber: number, isDownbeat: boolean) {
    if (trace) {
      trace.record(time, 'beat', { beatNumber, isDownbeat });
      return;
    }
    if (ctx) emitBeatAt(bus, ctx, time, beatNumber, isDownbeat);
  }

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    inst.bell(quantizeActionSfxTime(ctx.currentTime, THIRTYSECOND), SCALE[Math.min(lockCount - 1, SCALE.length - 1)] + 12, 0.08, 0.22);
  });

  bus.on('fire', () => {
    if (!ctx) return;
    inst.lowPulse(quantizeActionSfxTime(ctx.currentTime, THIRTYSECOND), 50);
  });

  bus.on('kill', () => {
    if (!ctx) return;
    const time = quantizeToGrid(ctx.currentTime, THIRTYSECOND);
    inst.bell(time, 86, 0.12, 0.45);
    inst.noiseTick(time, 0.07, 0.06);
  });

  bus.on('miss', () => {
    if (!ctx) return;
    inst.lowPulse(ctx.currentTime, 34);
  });

  bus.on('reject', () => {
    if (!ctx) return;
    const time = ctx.currentTime;
    inst.lowPulse(time, 31);
    inst.noiseTick(time + 0.02, 0.11, 0.08);
    inst.bell(time + 0.035, 61, 0.055, 0.2);
  });

  bus.on('runstart', () => {
    mode = 'run';
    runStart = transport.stepIndex + ((16 - (transport.stepIndex % 16)) % 16);
  });

  bus.on('runend', () => {
    mode = 'ambient';
    if (ctx) inst.bell(ctx.currentTime + 0.05, 74, 0.13, 1.4);
  });

  return { audio, traceRun };
}
