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
