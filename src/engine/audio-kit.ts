import type { LevelAudio } from './types';
import { createBrowserAudioContext, installAudioUnlock } from './audio-unlock';

export type StepTransportStep = {
  index: number;
  time: number;
};

export type StepTransportOptions = {
  stepSeconds: number;
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

export type LevelAudioKitOptions = {
  /** Player-facing volume value before scaling. Defaults to 1. */
  initialVolume?: number;
  /** Internal gain multiplier applied to player-facing volume. Defaults to 1. */
  volumeScale?: number;
  /** Interval for the level scheduler. Omit to disable interval scheduling. */
  schedulerMs?: number;
  /** Called once, after the browser AudioContext is created. */
  onCreateContext(context: AudioContext, scaledVolume: number): void;
  /** Called every scheduler interval while the AudioContext exists. */
  onSchedule?(context: AudioContext): void;
  /** Called when setMasterVolume changes after context creation. */
  onVolumeChange?(context: AudioContext, scaledVolume: number): void;
  /** Called before the AudioContext is closed. */
  onDispose?(context: AudioContext): void;
};

export function createStepTransport(options: StepTransportOptions): StepTransport {
  const startDelay = options.startDelay ?? 0;
  let nextStepTime = 0;
  let stepIndex = 0;

  const emitNextStep = () => {
    options.onStep({ index: stepIndex, time: nextStepTime });
    nextStepTime += options.stepSeconds;
    stepIndex += 1;
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

export function createLevelAudioKit(options: LevelAudioKitOptions): LevelAudio {
  const volumeScale = options.volumeScale ?? 1;
  let playerVolume = clamp01(options.initialVolume ?? 1);
  let ctx: AudioContext | null = null;
  let intervalId = 0;
  let unlockGestureStart: (() => void) | null = null;

  const scaledVolume = () => playerVolume * volumeScale;

  const start = async () => {
    if (!ctx) {
      ctx = createBrowserAudioContext();
      options.onCreateContext(ctx, scaledVolume());
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
      if (ctx) options.onVolumeChange?.(ctx, scaledVolume());
    },
    getMasterVolume() {
      return playerVolume;
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
