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
