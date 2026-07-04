import type { LevelAudio } from './types';
import { createBrowserAudioContext, installAudioUnlock } from './audio-unlock';

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
