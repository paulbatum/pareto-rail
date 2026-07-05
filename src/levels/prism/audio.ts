import type { EventBus } from '../../events';
import { createAudioGraphBuilder, createLevelAudioKit, createStepTransport, playNoiseHit, playOscillatorVoice } from '../../engine/audio-kit';
import { createAudioTraceSink, createNoopTraceBus, type AudioTraceResult, type AudioTraceSink } from '../../engine/audio-trace';
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

export function tracePrismAudio(options: { seconds?: number } = {}): AudioTraceResult {
  const seconds = options.seconds ?? PRISM_RUN_DURATION;
  const events: AudioTraceResult['events'] = [];
  const trace = createAudioTraceSink(events);
  const tracedAudio = createPrismAudio(createNoopTraceBus(), trace);
  tracedAudio.traceRun(seconds);
  return {
    metadata: {
      level: 'prism-bloom',
      bpm: PRISM_BPM,
      seconds,
      stepSeconds: SIXTEENTH,
      mode: 'run',
    },
    events,
  };
}

function createPrismAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let runStart = 0;
  let mode: 'ambient' | 'run' = 'ambient';
  let master: GainNode | null = null;
  let shimmer: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;

  const transport = createStepTransport({
    stepSeconds: SIXTEENTH,
    scheduleAhead: SCHEDULE_AHEAD,
    startDelay: 0.06,
    onStep({ index, time }) {
      scheduleStep(index, time);
    },
  });

  const audio = createLevelAudioKit({
    volumeScale: 0.8,
    schedulerMs: SCHEDULER_MS,
    onCreateContext(context, masterVolume) {
      ctx = context;
      buildGraph(context, masterVolume);
      transport.start(context);
    },
    onSchedule(context) {
      transport.schedule(context);
    },
    onVolumeChange(context, masterVolume) {
      if (master) master.gain.setTargetAtTime(masterVolume, context.currentTime, 0.05);
    },
    onDispose() {
      ctx = null;
      master = null;
      shimmer = null;
      noiseBuffer = null;
    },
  });

  function buildGraph(context: AudioContext, masterVolume: number) {
    const graph = createAudioGraphBuilder(context);

    master = graph.gain(masterVolume);
    const compressor = graph.compressor({ threshold: -20, ratio: 4 });
    graph.connect(master, compressor);
    graph.connect(compressor, context.destination);

    shimmer = graph.gain(0.55);
    const delay = graph.delay(1.4, SIXTEENTH * 5);
    const feedback = graph.gain(0.42);
    const filter = graph.biquadFilter({ type: 'highpass', frequency: 900 });
    graph.connect(shimmer, delay);
    graph.connect(delay, filter);
    graph.connect(filter, feedback);
    graph.connect(feedback, delay);
    graph.connect(filter, master);

    noiseBuffer = graph.noiseBuffer(2);
  }

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
      if (step % 4 === 0) bell(time, note + 12, 0.09, 0.9);
      return;
    }

    if (step === 0 || step === 10) lowPulse(time, bar % 2 === 0 ? 38 : 41);
    if (step % 2 === 0) bell(time, note + (bar >= 4 ? 12 : 0), 0.11, bar >= 5 ? 0.42 : 0.28);
    if (bar >= 2 && (step === 4 || step === 12)) noiseTick(time, 0.08, 0.035);
    if (bar >= 6 && step % 4 === 3) noiseTick(time, 0.045, 0.11);
  }

  function scheduleBeat(time: number, beatNumber: number, isDownbeat: boolean) {
    if (trace) {
      trace.record(time, 'beat', { beatNumber, isDownbeat });
      return;
    }
    if (ctx) emitBeatAt(bus, ctx, time, beatNumber, isDownbeat);
  }

  function bell(time: number, midi: number, velocity: number, decay: number) {
    if (trace) {
      trace.record(time, 'bell', { midi, velocity, decay });
      return;
    }
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
    if (trace) {
      trace.record(time, 'lowPulse', { midi });
      return;
    }
    if (!ctx || !master) return;
    playOscillatorVoice({
      context: ctx,
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
      destination: master,
    });
  }

  function noiseTick(time: number, velocity: number, decay: number) {
    if (trace) {
      trace.record(time, 'noiseTick', { velocity, decay });
      return;
    }
    if (!ctx || !master || !noiseBuffer) return;
    playNoiseHit({
      context: ctx,
      buffer: noiseBuffer,
      time,
      velocity,
      decay,
      filterType: 'highpass',
      frequency: 5200,
      destination: master,
      offset: Math.random() * 1.5,
    });
  }

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    bell(quantizeActionSfxTime(ctx.currentTime, THIRTYSECOND), SCALE[Math.min(lockCount - 1, SCALE.length - 1)] + 12, 0.08, 0.22);
  });

  bus.on('fire', () => {
    if (!ctx) return;
    lowPulse(quantizeActionSfxTime(ctx.currentTime, THIRTYSECOND), 50);
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
    runStart = transport.stepIndex + ((16 - (transport.stepIndex % 16)) % 16);
  });

  bus.on('runend', () => {
    mode = 'ambient';
    if (ctx) bell(ctx.currentTime + 0.05, 74, 0.13, 1.4);
  });

  return { audio, traceRun };
}
