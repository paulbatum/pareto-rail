import type { EventBus } from '../events';

export type AudioTraceValue = string | number | boolean | null | AudioTraceValue[];

export type AudioTraceEvent = {
  time: number;
  kind: string;
  data?: Record<string, AudioTraceValue>;
};

export type AudioTraceResult = {
  metadata: {
    level: string;
    bpm?: number;
    seconds: number;
    stepSeconds?: number;
    mode?: string;
  };
  events: AudioTraceEvent[];
};

export type AudioTraceSink = {
  record(time: number, kind: string, data?: Record<string, AudioTraceValue>): void;
};

export type TraceAudioFactory = (bus: EventBus, trace: AudioTraceSink) => { traceRun(seconds: number): void };

export type AudioTraceHarnessOptions = {
  level: string;
  bpm?: number;
  stepSeconds?: number;
  defaultSeconds: number;
  mode?: string;
  createAudio: TraceAudioFactory;
};

export function createAudioTraceSink(events: AudioTraceEvent[]): AudioTraceSink {
  return {
    record(time, kind, data) {
      events.push({ time: roundTraceTime(time), kind, data });
    },
  };
}

export function roundTraceTime(time: number) {
  return Math.round(time * 1000) / 1000;
}

export function createAudioTraceHarness(options: AudioTraceHarnessOptions) {
  return (traceOptions: { seconds?: number } = {}): AudioTraceResult => {
    const seconds = traceOptions.seconds ?? options.defaultSeconds;
    const events: AudioTraceResult['events'] = [];
    const trace = createAudioTraceSink(events);
    const tracedAudio = options.createAudio(createNoopTraceBus(), trace);
    tracedAudio.traceRun(seconds);
    return {
      metadata: {
        level: options.level,
        bpm: options.bpm,
        seconds,
        stepSeconds: options.stepSeconds,
        mode: options.mode ?? 'run',
      },
      events,
    };
  };
}

export function createNoopTraceBus(): EventBus {
  return {
    on() {
      return () => false;
    },
    emit() {},
    clear() {},
  } as EventBus;
}
