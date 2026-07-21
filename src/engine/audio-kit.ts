import type { EventBus } from '../events';
import type { LevelAudio } from './types';
import type { AudioTraceSink, AudioTraceValue } from './audio-trace';
import { createBrowserAudioContext, installAudioUnlock } from './audio-unlock';
import { emitBeatAt } from './music';

export type StepTransportStep = {
  index: number;
  time: number;
};

export type StepTransportOptions = {
  stepSeconds: number | ((nextStepIndex: number) => number);
  scheduleAhead: number;
  startDelay?: number;
  onStep(step: StepTransportStep): void;
};

export type StepTransport = {
  readonly stepIndex: number;
  readonly nextStepTime: number;
  start(context: Pick<AudioContext, 'currentTime'>): void;
  reset(nextStepTime?: number, stepIndex?: number): void;
  schedule(context: Pick<AudioContext, 'currentTime'>): void;
  runUntil(seconds: number): void;
};

export type CompressorOptions = {
  threshold?: number;
  knee?: number;
  ratio?: number;
  attack?: number;
  release?: number;
};

export type BiquadFilterOptions = {
  type?: BiquadFilterType;
  frequency?: number;
  Q?: number;
  gain?: number;
  detune?: number;
};

export type AudioGraphBuilder = {
  gain(initialValue?: number): GainNode;
  compressor(options: CompressorOptions): DynamicsCompressorNode;
  delay(maxDelayTime: number, delayTime: number): DelayNode;
  biquadFilter(options: BiquadFilterOptions): BiquadFilterNode;
  noiseBuffer(seconds: number, channels?: number): AudioBuffer;
  connect(source: AudioNode, destination: AudioNode | AudioParam): AudioNode | AudioParam;
};

export type MixBusDelayOptions = {
  time: number;
  feedback: number;
  dampHz: number;
  maxTime?: number;
  dampType?: BiquadFilterType;
  sendGain?: number;
  returnTo?: 'duck' | 'master';
};

export type MixBusReverbOptions = {
  seconds: number;
  decay: number;
  level: number;
  returnTo?: 'duck' | 'master';
};

export type MixBusOptions = {
  musicVolume?: number;
  sfxVolume?: number;
  compressor?: CompressorOptions;
  delay?: MixBusDelayOptions;
  reverb?: MixBusReverbOptions;
  noiseSeconds?: number;
  /** Prism-style graph: one player volume gain instead of separate music/sfx gains. */
  combinedVolume?: boolean;
};

export type MixBus = {
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  duck: GainNode;
  delaySend?: GainNode;
  reverbSend?: GainNode;
  noiseBuffer?: AudioBuffer;
  setMasterVolume(volume: number, time: number, smoothing?: number): void;
  setMusicVolume(volume: number, time: number, smoothing?: number): void;
  setSfxVolume(volume: number, time: number, smoothing?: number): void;
  duckAt(time: number, depth: number, recover: number): void;
};

export type InstrumentEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
};

type InstrumentDefinition = (context: AudioContext, time: number, ...args: any[]) => void;
type InstrumentMap = Record<string, InstrumentDefinition>;
type InstrumentPublic<T> = T extends (context: AudioContext, ...args: infer Args) => void ? (...args: Args) => void : never;

export type InstrumentRegistry<T extends InstrumentMap> = {
  [K in keyof T]: InstrumentPublic<T[K]>;
};

export type AutomationStep = {
  type: 'set' | 'linearRamp' | 'exponentialRamp';
  value: number;
  time: number;
};

export type OscillatorVoiceOptions = {
  context: AudioContext;
  time: number;
  stopTime: number;
  oscillatorType: OscillatorType;
  frequency: number;
  frequencyAutomation?: AutomationStep[];
  detune?: number;
  gainAutomation: AutomationStep[];
  filter?: BiquadFilterOptions & { frequencyAutomation?: AutomationStep[] };
  destination: AudioNode | AudioNode[];
  sends?: Array<{ destination: AudioNode; gain: number }>;
};

export type BufferSourceVoiceOptions = {
  context: AudioContext;
  buffer: AudioBuffer;
  time: number;
  stopTime: number;
  loop?: boolean;
  filter?: BiquadFilterOptions & { frequencyAutomation?: AutomationStep[] };
  gainAutomation: AutomationStep[];
  destination: AudioNode;
};

export type NoiseHitOptions = {
  context: AudioContext;
  buffer: AudioBuffer;
  time: number;
  velocity: number;
  decay: number;
  filterType: BiquadFilterType;
  frequency: number;
  destination: AudioNode;
  loopStart?: number;
  offset?: number;
};

export type BeatLevelAudioMode = 'ambient' | 'run';

export type BeatLevelAudioScore = {
  readonly arrangementStart: number;
  setEpoch(time: number): void;
  restartArrangement(stepIndex: number, options: { align: 'bar' | 'step' }): number;
};

export type BeatLevelAudioStep = {
  index: number;
  position: number;
  step: number;
  bar: number;
  time: number;
  mode: BeatLevelAudioMode;
};

export type BeatLevelAudioRuntime = {
  audio: LevelAudio;
  traceRun(seconds: number): void;
  context(): AudioContext | null;
  mix(): MixBus | null;
  mode(): BeatLevelAudioMode;
  arrangementStart(): number;
  transport(): StepTransport;
};

export type BeatLevelAudioOptions = {
  bus: EventBus;
  trace?: AudioTraceSink;
  bpm?: number;
  stepSeconds: number;
  stepsPerBar?: number;
  scheduleAhead?: number;
  schedulerMs?: number;
  startDelay?: number;
  volumeScale?: number;
  mix: MixBusOptions | ((context: AudioContext, musicVolume: number, sfxVolume: number) => MixBusOptions);
  score?: BeatLevelAudioScore;
  runAlignment?: 'bar' | 'step';
  beatNumber?: 'absolute' | 'position' | ((step: BeatLevelAudioStep) => number);
  onBeforeBeat?(step: BeatLevelAudioStep): void;
  onStep(step: BeatLevelAudioStep): void;
  onPostBuild?(context: AudioContext, mix: MixBus): void;
  onRunStart?(runtime: BeatLevelAudioRuntime): void;
  onRunEnd?(runtime: BeatLevelAudioRuntime): void;
  onDispose?(): void;
};

export type LevelAudioKitOptions = {
  /** Player-facing combined volume value before scaling. Defaults to 1. */
  initialVolume?: number;
  /** Player-facing music volume value before scaling. Defaults to initialVolume or 1. */
  initialMusicVolume?: number;
  /** Player-facing sound-effect volume value before scaling. Defaults to initialVolume or 1. */
  initialSfxVolume?: number;
  /** Internal gain multiplier applied to player-facing volume. Defaults to 1. */
  volumeScale?: number;
  /** Interval for the level scheduler. Omit to disable interval scheduling. */
  schedulerMs?: number;
  /** Called once, after the browser AudioContext is created. */
  onCreateContext(context: AudioContext, scaledMusicVolume: number, scaledSfxVolume: number): void;
  /** Called every scheduler interval while the AudioContext exists. */
  onSchedule?(context: AudioContext): void;
  /** Backward-compatible combined-volume callback. */
  onVolumeChange?(context: AudioContext, scaledVolume: number): void;
  /** Called when setMusicVolume changes after context creation. */
  onMusicVolumeChange?(context: AudioContext, scaledVolume: number): void;
  /** Called when setSfxVolume changes after context creation. */
  onSfxVolumeChange?(context: AudioContext, scaledVolume: number): void;
  /** Called before the AudioContext is closed. */
  onDispose?(context: AudioContext): void;
};

export function createStepTransport(options: StepTransportOptions): StepTransport {
  const startDelay = options.startDelay ?? 0;
  let nextStepTime = 0;
  let stepIndex = 0;

  const emitNextStep = () => {
    // Advance before dispatching: a step callback that throws must not leave the
    // transport parked on the same step, re-firing it on every scheduler tick.
    const step = { index: stepIndex, time: nextStepTime };
    stepIndex += 1;
    nextStepTime += typeof options.stepSeconds === 'function' ? options.stepSeconds(stepIndex) : options.stepSeconds;
    options.onStep(step);
  };

  return {
    get stepIndex() {
      return stepIndex;
    },
    get nextStepTime() {
      return nextStepTime;
    },
    start(context) {
      nextStepTime = context.currentTime + startDelay;
      stepIndex = 0;
    },
    reset(nextTime = startDelay, index = 0) {
      nextStepTime = nextTime;
      stepIndex = index;
    },
    schedule(context) {
      while (nextStepTime < context.currentTime + options.scheduleAhead) emitNextStep();
    },
    runUntil(seconds) {
      while (nextStepTime < seconds) emitNextStep();
    },
  };
}

export function createAudioGraphBuilder(context: AudioContext): AudioGraphBuilder {
  return {
    gain(initialValue = 1) {
      const node = context.createGain();
      node.gain.value = initialValue;
      return node;
    },
    compressor(options) {
      const node = context.createDynamicsCompressor();
      if (options.threshold !== undefined) node.threshold.value = options.threshold;
      if (options.knee !== undefined) node.knee.value = options.knee;
      if (options.ratio !== undefined) node.ratio.value = options.ratio;
      if (options.attack !== undefined) node.attack.value = options.attack;
      if (options.release !== undefined) node.release.value = options.release;
      return node;
    },
    delay(maxDelayTime, delayTime) {
      const node = context.createDelay(maxDelayTime);
      node.delayTime.value = delayTime;
      return node;
    },
    biquadFilter(options) {
      const node = context.createBiquadFilter();
      if (options.type !== undefined) node.type = options.type;
      if (options.frequency !== undefined) node.frequency.value = options.frequency;
      if (options.Q !== undefined) node.Q.value = options.Q;
      if (options.gain !== undefined) node.gain.value = options.gain;
      if (options.detune !== undefined) node.detune.value = options.detune;
      return node;
    },
    noiseBuffer(seconds, channels = 1) {
      const buffer = context.createBuffer(channels, Math.floor(context.sampleRate * seconds), context.sampleRate);
      for (let channel = 0; channel < channels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      }
      return buffer;
    },
    connect(source: AudioNode, destination: AudioNode | AudioParam) {
      if (destination instanceof AudioParam) {
        source.connect(destination);
        return destination;
      }
      source.connect(destination);
      return destination;
    },
  };
}

export function createMixBus(context: AudioContext, options: MixBusOptions): MixBus {
  const graph = createAudioGraphBuilder(context);
  const musicVolume = options.musicVolume ?? 1;
  const sfxVolume = options.sfxVolume ?? musicVolume;
  const compressor = graph.compressor(options.compressor ?? {});

  const master = graph.gain(options.combinedVolume ? musicVolume : 1);
  graph.connect(master, compressor);
  graph.connect(compressor, context.destination);

  const music = options.combinedVolume ? master : graph.gain(musicVolume);
  const sfx = options.combinedVolume ? master : graph.gain(sfxVolume);
  const duck = options.combinedVolume ? master : graph.gain(1);
  if (!options.combinedVolume) {
    graph.connect(duck, music);
    graph.connect(music, master);
    graph.connect(sfx, master);
  }

  const delayReturnDestination = (returnTo: 'duck' | 'master' = 'duck') => (returnTo === 'master' ? master : duck);
  let delaySend: GainNode | undefined;
  if (options.delay) {
    delaySend = graph.gain(options.delay.sendGain ?? 1);
    const delay = graph.delay(options.delay.maxTime ?? Math.max(1, options.delay.time), options.delay.time);
    const feedback = graph.gain(options.delay.feedback);
    const damp = graph.biquadFilter({ type: options.delay.dampType ?? 'lowpass', frequency: options.delay.dampHz });
    graph.connect(delaySend, delay);
    graph.connect(delay, damp);
    graph.connect(damp, feedback);
    graph.connect(feedback, delay);
    graph.connect(damp, delayReturnDestination(options.delay.returnTo));
  }

  let reverbSend: GainNode | undefined;
  if (options.reverb) {
    reverbSend = graph.gain();
    const convolver = context.createConvolver();
    convolver.buffer = createReverbImpulse(context, options.reverb.seconds, options.reverb.decay);
    const reverbLevel = graph.gain(options.reverb.level);
    graph.connect(reverbSend, convolver);
    graph.connect(convolver, reverbLevel);
    graph.connect(reverbLevel, delayReturnDestination(options.reverb.returnTo));
  }

  const noiseBuffer = options.noiseSeconds === undefined ? undefined : graph.noiseBuffer(options.noiseSeconds);
  const smooth = (param: AudioParam, volume: number, time: number, smoothing: number) => {
    param.setTargetAtTime(volume, time, smoothing);
  };

  return {
    master,
    music,
    sfx,
    duck,
    delaySend,
    reverbSend,
    noiseBuffer,
    setMasterVolume(volume, time, smoothing = 0.05) {
      smooth(master.gain, volume, time, smoothing);
    },
    setMusicVolume(volume, time, smoothing = 0.05) {
      smooth((options.combinedVolume ? master : music).gain, volume, time, smoothing);
    },
    setSfxVolume(volume, time, smoothing = 0.02) {
      smooth((options.combinedVolume ? master : sfx).gain, volume, time, smoothing);
    },
    duckAt(time, depth, recover) {
      duck.gain.cancelScheduledValues(time);
      duck.gain.setValueAtTime(depth, time);
      duck.gain.linearRampToValueAtTime(1, time + recover);
    },
  };
}

export function createReverbImpulse(context: AudioContext, seconds: number, decay: number) {
  const length = Math.floor(context.sampleRate * seconds);
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
  }
  return impulse;
}

export function defineInstruments<T extends InstrumentMap>(
  environment: InstrumentEnvironment,
  definitions: T,
  argNames: Partial<Record<keyof T, readonly string[]>> = {},
): InstrumentRegistry<T> {
  const instruments: Partial<Record<keyof T, (...args: AudioTraceValue[]) => void>> = {};
  for (const key of Object.keys(definitions) as Array<keyof T>) {
    const name = String(key);
    const body = definitions[key];
    const dataNames = argNames[key] ?? parseInstrumentArgumentNames(body).slice(2);
    instruments[key] = ((...args: any[]) => {
      if (environment.trace) {
        environment.trace.record(Number(args[0] ?? 0), name, traceDataForArgs(dataNames, args.slice(1)));
        return;
      }
      const context = environment.context();
      if (!context) return;
      body(context, Number(args[0] ?? 0), ...args.slice(1));
    }) as InstrumentRegistry<T>[typeof key];
  }
  return instruments as InstrumentRegistry<T>;
}

function traceDataForArgs(names: readonly string[], values: readonly unknown[]) {
  const data: Record<string, AudioTraceValue> = {};
  for (let i = 0; i < values.length; i += 1) data[names[i] ?? `arg${i + 1}`] = toTraceValue(values[i]);
  return data;
}

function toTraceValue(value: unknown): AudioTraceValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(toTraceValue);
  return String(value);
}

function parseInstrumentArgumentNames(fn: Function) {
  const source = Function.prototype.toString.call(fn).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const match = source.match(/^[^(]*\(([^)]*)\)/);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((part) => part.trim().replace(/^\.\.\./, '').replace(/\s*=.*$/, ''))
    .filter(Boolean);
}

export function applyAutomation(param: AudioParam, steps: AutomationStep[]) {
  for (const step of steps) {
    if (step.type === 'set') param.setValueAtTime(step.value, step.time);
    else if (step.type === 'linearRamp') param.linearRampToValueAtTime(step.value, step.time);
    else param.exponentialRampToValueAtTime(step.value, step.time);
  }
}

export function playOscillatorVoice(options: OscillatorVoiceOptions) {
  const oscillator = options.context.createOscillator();
  oscillator.type = options.oscillatorType;
  oscillator.frequency.setValueAtTime(options.frequency, options.time);
  if (options.detune !== undefined) oscillator.detune.value = options.detune;
  if (options.frequencyAutomation) applyAutomation(oscillator.frequency, options.frequencyAutomation);

  const gain = options.context.createGain();
  applyAutomation(gain.gain, options.gainAutomation);

  let voiceOutput: AudioNode = oscillator;
  if (options.filter) {
    const filter = options.context.createBiquadFilter();
    if (options.filter.type !== undefined) filter.type = options.filter.type;
    if (options.filter.frequency !== undefined) filter.frequency.value = options.filter.frequency;
    if (options.filter.Q !== undefined) filter.Q.value = options.filter.Q;
    if (options.filter.gain !== undefined) filter.gain.value = options.filter.gain;
    if (options.filter.detune !== undefined) filter.detune.value = options.filter.detune;
    if (options.filter.frequencyAutomation) applyAutomation(filter.frequency, options.filter.frequencyAutomation);
    oscillator.connect(filter);
    voiceOutput = filter;
  }

  voiceOutput.connect(gain);
  for (const destination of Array.isArray(options.destination) ? options.destination : [options.destination]) gain.connect(destination);
  for (const sendDefinition of options.sends ?? []) {
    const send = options.context.createGain();
    send.gain.value = sendDefinition.gain;
    gain.connect(send).connect(sendDefinition.destination);
  }
  oscillator.start(options.time);
  oscillator.stop(options.stopTime);
  return { oscillator, gain };
}

export function playBufferSourceVoice(options: BufferSourceVoiceOptions) {
  const source = options.context.createBufferSource();
  source.buffer = options.buffer;
  source.loop = options.loop ?? false;

  const gain = options.context.createGain();
  applyAutomation(gain.gain, options.gainAutomation);

  let voiceOutput: AudioNode = source;
  if (options.filter) {
    const filter = options.context.createBiquadFilter();
    if (options.filter.type !== undefined) filter.type = options.filter.type;
    if (options.filter.frequency !== undefined) filter.frequency.value = options.filter.frequency;
    if (options.filter.Q !== undefined) filter.Q.value = options.filter.Q;
    if (options.filter.gain !== undefined) filter.gain.value = options.filter.gain;
    if (options.filter.detune !== undefined) filter.detune.value = options.filter.detune;
    if (options.filter.frequencyAutomation) applyAutomation(filter.frequency, options.filter.frequencyAutomation);
    source.connect(filter);
    voiceOutput = filter;
  }

  voiceOutput.connect(gain).connect(options.destination);
  source.start(options.time);
  source.stop(options.stopTime);
  return { source, gain };
}

export function playNoiseHit(options: NoiseHitOptions) {
  const source = options.context.createBufferSource();
  source.buffer = options.buffer;
  if (options.loopStart !== undefined) source.loopStart = options.loopStart;

  const filter = options.context.createBiquadFilter();
  filter.type = options.filterType;
  filter.frequency.value = options.frequency;

  const gain = options.context.createGain();
  gain.gain.setValueAtTime(options.velocity, options.time);
  gain.gain.exponentialRampToValueAtTime(0.001, options.time + Math.max(0.012, options.decay));

  source.connect(filter).connect(gain).connect(options.destination);
  source.start(options.time, options.offset);
  source.stop(options.time + Math.max(0.02, options.decay) + 0.03);
}

export function createBeatLevelAudio(options: BeatLevelAudioOptions): BeatLevelAudioRuntime {
  const stepsPerBar = options.stepsPerBar ?? 16;
  const scheduleAhead = options.scheduleAhead ?? 0.18;
  const schedulerMs = options.schedulerMs ?? 25;
  const startDelay = options.startDelay ?? 0.06;
  const runAlignment = options.runAlignment ?? 'step';
  let ctx: AudioContext | null = null;
  let mix: MixBus | null = null;
  let mode: BeatLevelAudioMode = 'ambient';
  let localArrangementStart = 0;

  const arrangementStart = () => options.score?.arrangementStart ?? localArrangementStart;
  const restartArrangement = (stepIndex: number) => {
    if (options.score) localArrangementStart = options.score.restartArrangement(stepIndex, { align: runAlignment });
    else localArrangementStart = runAlignment === 'bar'
      ? stepIndex + ((stepsPerBar - (stepIndex % stepsPerBar)) % stepsPerBar)
      : stepIndex;
  };

  const transport = createStepTransport({
    stepSeconds: options.stepSeconds,
    scheduleAhead,
    startDelay,
    onStep({ index, time }) {
      const position = Math.max(0, index - arrangementStart());
      const step = position % stepsPerBar;
      const bar = Math.floor(position / stepsPerBar);
      const stepInfo = { index, position, step, bar, time, mode };
      if (step % 4 === 0) {
        options.onBeforeBeat?.(stepInfo);
        scheduleBeat(stepInfo);
      }
      options.onStep(stepInfo);
    },
  });

  const audio = createLevelAudioKit({
    volumeScale: options.volumeScale ?? 1,
    schedulerMs,
    onCreateContext(context, musicVolume, sfxVolume) {
      ctx = context;
      const mixOptions = typeof options.mix === 'function' ? options.mix(context, musicVolume, sfxVolume) : { ...options.mix, musicVolume, sfxVolume };
      mix = createMixBus(context, mixOptions);
      options.onPostBuild?.(context, mix);
      transport.start(context);
      options.score?.setEpoch(transport.nextStepTime);
    },
    onSchedule(context) {
      transport.schedule(context);
    },
    onVolumeChange(context, volume) {
      if (mix && options.mix && typeof options.mix !== 'function' && options.mix.combinedVolume) mix.setMasterVolume(volume, context.currentTime, 0.05);
    },
    onMusicVolumeChange(context, volume) {
      mix?.setMusicVolume(volume, context.currentTime, 0.05);
    },
    onSfxVolumeChange(context, volume) {
      mix?.setSfxVolume(volume, context.currentTime, 0.02);
    },
    onDispose() {
      ctx = null;
      mix = null;
      options.onDispose?.();
    },
  });

  const runtime: BeatLevelAudioRuntime = {
    audio,
    traceRun(seconds) {
      mode = 'run';
      restartArrangement(0);
      options.onRunStart?.(runtime);
      transport.reset(startDelay, 0);
      options.score?.setEpoch(startDelay);
      ctx = { currentTime: 0 } as AudioContext;
      transport.runUntil(seconds);
      ctx = null;
    },
    context() {
      return ctx;
    },
    mix() {
      return mix;
    },
    mode() {
      return mode;
    },
    arrangementStart,
    transport() {
      return transport;
    },
  };

  options.bus.on('runstart', () => {
    mode = 'run';
    restartArrangement(transport.stepIndex);
    options.onRunStart?.(runtime);
  });

  options.bus.on('runend', () => {
    mode = 'ambient';
    options.onRunEnd?.(runtime);
  });

  function scheduleBeat(step: BeatLevelAudioStep) {
    const beatNumber = typeof options.beatNumber === 'function'
      ? options.beatNumber(step)
      : Math.floor((options.beatNumber === 'position' ? step.position : step.index) / 4);
    const isDownbeat = step.step === 0;
    if (options.trace) {
      options.trace.record(step.time, 'beat', { beatNumber, isDownbeat });
      return;
    }
    if (ctx) emitBeatAt(options.bus, ctx, step.time, beatNumber, isDownbeat);
  }

  return runtime;
}

export function createLevelAudioKit(options: LevelAudioKitOptions): LevelAudio {
  const volumeScale = options.volumeScale ?? 1;
  let playerVolume = clamp01(options.initialVolume ?? 1);
  let musicVolume = clamp01(options.initialMusicVolume ?? options.initialVolume ?? 1);
  let sfxVolume = clamp01(options.initialSfxVolume ?? options.initialVolume ?? 1);
  let ctx: AudioContext | null = null;
  let intervalId = 0;
  let unlockGestureStart: (() => void) | null = null;

  const scaledVolume = () => playerVolume * volumeScale;
  const scaledMusicVolume = () => musicVolume * volumeScale;
  const scaledSfxVolume = () => sfxVolume * volumeScale;

  const start = async () => {
    if (!ctx) {
      ctx = createBrowserAudioContext();
      options.onCreateContext(ctx, scaledMusicVolume(), scaledSfxVolume());
      if (options.schedulerMs !== undefined && options.onSchedule) {
        intervalId = window.setInterval(() => {
          if (ctx) options.onSchedule?.(ctx);
        }, options.schedulerMs);
      }
    }
    if (ctx.state === 'suspended') await ctx.resume();
  };

  const installGestureStart = () => {
    unlockGestureStart?.();
    unlockGestureStart = installAudioUnlock(start);
  };

  return {
    start,
    installGestureStart,
    setMasterVolume(volume: number) {
      playerVolume = clamp01(volume);
      musicVolume = playerVolume;
      sfxVolume = playerVolume;
      if (ctx) {
        options.onVolumeChange?.(ctx, scaledVolume());
        options.onMusicVolumeChange?.(ctx, scaledMusicVolume());
        options.onSfxVolumeChange?.(ctx, scaledSfxVolume());
      }
    },
    getMasterVolume() {
      return playerVolume;
    },
    setMusicVolume(volume: number) {
      musicVolume = clamp01(volume);
      if (ctx) {
        options.onVolumeChange?.(ctx, scaledMusicVolume());
        options.onMusicVolumeChange?.(ctx, scaledMusicVolume());
      }
    },
    getMusicVolume() {
      return musicVolume;
    },
    setSfxVolume(volume: number) {
      sfxVolume = clamp01(volume);
      if (ctx) options.onSfxVolumeChange?.(ctx, scaledSfxVolume());
    },
    getSfxVolume() {
      return sfxVolume;
    },
    async suspend() {
      if (ctx && ctx.state === 'running') await ctx.suspend();
    },
    dispose() {
      unlockGestureStart?.();
      unlockGestureStart = null;
      if (intervalId) {
        window.clearInterval(intervalId);
        intervalId = 0;
      }
      const closingContext = ctx;
      ctx = null;
      if (closingContext) {
        options.onDispose?.(closingContext);
        void closingContext.close();
      }
    },
  };
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
