import type { EventBus } from '../../events';
import { createAudioGraphBuilder, createLevelAudioKit, createStepTransport, playBufferSourceVoice, playOscillatorVoice } from '../../engine/audio-kit';
import { createAudioTraceSink, createNoopTraceBus, type AudioTraceResult, type AudioTraceSink } from '../../engine/audio-trace';
import { quantizeActionSfxTime } from '../../engine/action-sfx-quantization';
import { emitBeatAt, midiToFreq } from '../../engine/music';
import { BPM, REZDLE_RUN_DURATION } from './gameplay';

// A midnight print-shop chamber piece: swung 8ths at 84 BPM, felt-piano pad
// and celesta over typewriter percussion. Every four bars the carriage
// returns — zip and ding — which is also when a new rack of type arrives.
const BEAT = 60 / BPM;
const THIRTYSECOND = BEAT / 8;
const SWING = (2 / 3) * BEAT;
const SCHEDULE_AHEAD = 0.2;
const SCHEDULER_MS = 40;

// Fmaj7 · Dm7 · Gm7 · C7, one bar each.
const CHORDS = [
  { bass: 41, pad: [53, 57, 60, 64], arp: [65, 69, 72, 76, 77] },
  { bass: 38, pad: [50, 53, 57, 60], arp: [62, 65, 69, 72, 74] },
  { bass: 43, pad: [55, 58, 62, 65], arp: [67, 70, 74, 77, 79] },
  { bass: 36, pad: [48, 52, 55, 58], arp: [64, 67, 70, 72, 76] },
];

const LOCK_STEPS = [65, 69, 72, 74, 77, 79, 81, 84];
const BELL_RUN = [77, 79, 81, 84, 86, 89, 91, 93];

export function createAudio(bus: EventBus) {
  return createRezdleAudio(bus).audio;
}

export function traceRezdleAudio(options: { seconds?: number } = {}): AudioTraceResult {
  const seconds = options.seconds ?? REZDLE_RUN_DURATION;
  const events: AudioTraceResult['events'] = [];
  const trace = createAudioTraceSink(events);
  const tracedAudio = createRezdleAudio(createNoopTraceBus(), trace);
  tracedAudio.traceRun(seconds);
  return {
    metadata: {
      level: 'rezdle',
      bpm: BPM,
      seconds,
      stepSeconds: BEAT / 2,
      mode: 'run',
    },
    events,
  };
}

function createRezdleAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let arpCounter = 0;
  let lastZipAt = -1;

  const transport = createStepTransport({
    stepSeconds: (nextStepIndex) => (nextStepIndex % 2 === 1 ? SWING : BEAT - SWING),
    scheduleAhead: SCHEDULE_AHEAD,
    startDelay: 0.08,
    onStep({ index, time }) {
      scheduleStep(index, time);
    },
  });

  const audio = createLevelAudioKit({
    initialVolume: 0.5,
    volumeScale: 0.55,
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
      noiseBuffer = null;
    },
  });

  function buildGraph(context: AudioContext, masterVolume: number) {
    const graph = createAudioGraphBuilder(context);
    master = graph.gain(masterVolume);
    graph.connect(master, context.destination);
    noiseBuffer = graph.noiseBuffer(1);
  }

  function traceRun(seconds: number) {
    arpCounter = 0;
    transport.reset(0.08, 0);
    ctx = { currentTime: 0 } as AudioContext;
    transport.runUntil(seconds);
    ctx = null;
  }

  // --- Scheduler: swung 8th steps ---------------------------------------

  function scheduleStep(step: number, time: number) {
    const eighth = step % 8;
    const bar = Math.floor(step / 8);
    const chord = CHORDS[bar % CHORDS.length];
    // Density breathes over a 12-bar arc: sparse, moving, full.
    const density = Math.floor(bar / 4) % 3;

    if (step % 2 === 0) {
      const beatNumber = step / 2;
      const isDownbeat = beatNumber % 4 === 0;
      scheduleBeat(time, beatNumber, isDownbeat);
      tickNoise(time, isDownbeat ? 0.028 : 0.016, 5200);
      if (eighth === 0) {
        padChord(time, chord.pad);
        bassNote(time, chord.bass, 0.85);
      }
      if (eighth === 4 && density > 0) bassNote(time, chord.bass + 7, 0.55);
    } else if (density > 0) {
      clack(time, 0.02 + density * 0.008);
    }

    const arpMask = density === 0 ? [3, 6] : density === 1 ? [0, 3, 4, 7] : [0, 2, 3, 4, 6, 7];
    if (arpMask.includes(eighth)) {
      const note = chord.arp[arpCounter % chord.arp.length] + 12 * Math.floor((arpCounter % 10) / 5);
      arpCounter += 1;
      bell(time, note, density === 2 ? 0.032 : 0.024, 0.4, 'arp');
    }

    // Carriage return into every 4th bar: zip through the last beat, ding on
    // the turnaround.
    if (bar % 4 === 3 && eighth === 6) {
      zip(time, 0.3, 0.024);
      bell(time + BEAT * 0.95, 96, 0.045, 0.9, 'ding');
    }
  }

  function scheduleBeat(time: number, beatNumber: number, isDownbeat: boolean) {
    if (trace) {
      trace.record(time, 'beat', { beatNumber, isDownbeat });
      return;
    }
    if (ctx) emitBeatAt(bus, ctx, time, beatNumber, isDownbeat);
  }

  // --- Voices ------------------------------------------------------------

  function noise(time: number, duration: number, gainValue: number, filterType: BiquadFilterType, frequency: number, sweepTo?: number) {
    if (!ctx || !master || !noiseBuffer) return;
    playBufferSourceVoice({
      context: ctx,
      buffer: noiseBuffer,
      time,
      stopTime: time + duration + 0.03,
      loop: true,
      filter: {
        type: filterType,
        frequency,
        Q: filterType === 'bandpass' ? 4 : 0.8,
        frequencyAutomation: sweepTo !== undefined ? [{ type: 'exponentialRamp', value: sweepTo, time: time + duration }] : undefined,
      },
      gainAutomation: [
        { type: 'set', value: gainValue, time },
        { type: 'exponentialRamp', value: 0.0005, time: time + duration },
      ],
      destination: master,
    });
  }

  function tickNoise(time: number, gainValue: number, frequency: number) {
    if (trace) {
      trace.record(time, 'tick', { gain: gainValue, frequency });
      return;
    }
    noise(time, 0.03, gainValue, 'highpass', frequency);
  }

  function clack(time: number, gainValue: number) {
    if (trace) {
      trace.record(time, 'clack', { gain: gainValue });
      return;
    }
    noise(time, 0.028, gainValue, 'bandpass', 1900);
    noise(time + 0.014, 0.02, gainValue * 0.6, 'bandpass', 2600);
  }

  function zip(time: number, duration: number, gainValue: number) {
    if (trace) {
      trace.record(time, 'zip', { duration, gain: gainValue });
      return;
    }
    noise(time, duration, gainValue, 'bandpass', 480, 2800);
  }

  function tone(time: number, frequency: number, gainValue: number, duration: number, type: OscillatorType, attack = 0.004) {
    if (!ctx || !master) return;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + duration + 0.03,
      oscillatorType: type,
      frequency,
      gainAutomation: [
        { type: 'set', value: 0.0005, time },
        { type: 'exponentialRamp', value: gainValue, time: time + attack },
        { type: 'exponentialRamp', value: 0.0005, time: time + duration },
      ],
      destination: master,
    });
  }

  // Celesta-ish: fundamental plus a quiet detuned twelfth.
  function bell(time: number, midi: number, gainValue: number, duration: number, kind = 'bell') {
    if (trace) {
      trace.record(time, kind, { midi, gain: gainValue, duration });
      return;
    }
    const frequency = midiToFreq(midi);
    tone(time, frequency, gainValue, duration, 'sine');
    tone(time, frequency * 3.01, gainValue * 0.22, duration * 0.55, 'sine');
  }

  function padChord(time: number, midis: number[]) {
    if (trace) {
      trace.record(time, 'pad', { midis });
      return;
    }
    if (!ctx || !master) return;
    for (const midi of midis) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + BEAT * 4 + 0.05,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        detune: (midi % 2 === 0 ? 1 : -1) * 4,
        filter: { type: 'lowpass', frequency: 760 },
        gainAutomation: [
          { type: 'set', value: 0.0005, time },
          { type: 'exponentialRamp', value: 0.02, time: time + 0.5 },
          { type: 'set', value: 0.02, time: time + BEAT * 2.4 },
          { type: 'exponentialRamp', value: 0.0005, time: time + BEAT * 4 },
        ],
        destination: master,
      });
    }
  }

  function bassNote(time: number, midi: number, velocity: number) {
    if (trace) {
      trace.record(time, 'bass', { midi, velocity });
      return;
    }
    tone(time, midiToFreq(midi), 0.065 * velocity, 0.55, 'sine', 0.01);
  }

  function thump(time: number, from: number, to: number, gainValue: number, duration: number) {
    if (trace) {
      trace.record(time, 'thump', { from, to, gain: gainValue, duration });
      return;
    }
    if (!ctx || !master) return;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + duration + 0.03,
      oscillatorType: 'sine',
      frequency: from,
      frequencyAutomation: [{ type: 'exponentialRamp', value: to, time: time + duration }],
      gainAutomation: [
        { type: 'set', value: gainValue, time },
        { type: 'exponentialRamp', value: 0.0005, time: time + duration },
      ],
      destination: master,
    });
  }

  const now = () => (ctx ? ctx.currentTime + 0.005 : 0);

  // --- Sound design ------------------------------------------------------

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = quantizeActionSfxTime(now(), THIRTYSECOND);
    // Keystrike: a pitched typewriter key, climbing with each lock.
    noise(time, 0.016, 0.05, 'bandpass', 1500 + lockCount * 160);
    bell(time + 0.004, LOCK_STEPS[Math.min(Math.max(lockCount, 1), 8) - 1], 0.038, 0.14, 'lockBell');
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    noise(now(), 0.045, 0.016, 'lowpass', 420);
  });

  bus.on('fire', ({ indexInVolley }) => {
    if (!ctx || (indexInVolley ?? 0) > 0) return;
    // One carriage-return zip per volley, not per shot. Attract/replay
    // volleys carry no volley index, so throttle those by time instead.
    const time = quantizeActionSfxTime(now(), THIRTYSECOND);
    if (time - lastZipAt < 0.25) return;
    lastZipAt = time;
    zip(time, 0.12, 0.035);
  });

  bus.on('hit', () => {
    if (!ctx) return;
    const time = now();
    thump(time, 175, 82, 0.06, 0.1);
    tickNoise(time, 0.02, 3800);
  });

  bus.on('kill', () => {
    if (!ctx) return;
    const time = now();
    thump(time, 240, 120, 0.04, 0.08);
    bell(time + 0.01, 89, 0.016, 0.12, 'killBell');
  });

  bus.on('volley', ({ kills, scoreAwarded, size }) => {
    if (!ctx) return;
    const time = now();
    if (scoreAwarded > 0) {
      // The word goes to print: a bell run the length of the word, capped
      // with the carriage ding.
      const notes = Math.min(kills, BELL_RUN.length);
      for (let i = 0; i < notes; i += 1) {
        bell(time + i * 0.07, BELL_RUN[i], 0.042, 0.35, 'wordBell');
      }
      bell(time + notes * 0.07 + 0.05, 96, 0.05, 1.1, 'ding');
    } else if (size >= 3) {
      // Set type that spells nothing: shuffled back into the case.
      noise(time, 0.16, 0.02, 'lowpass', 620);
    }
  });

  bus.on('reject', () => {
    if (!ctx) return;
    // The type jams: two dull clunks and a rattle, no bell.
    const time = now();
    thump(time, 130, 72, 0.055, 0.11);
    thump(time + 0.08, 95, 58, 0.045, 0.13);
    noise(time + 0.02, 0.13, 0.02, 'lowpass', 520);
  });

  bus.on('miss', () => {
    if (!ctx) return;
    tickNoise(now(), 0.01, 2400);
  });

  bus.on('runstart', () => {
    if (!ctx) return;
    const time = now();
    zip(time, 0.25, 0.03);
    bell(time + 0.28, 96, 0.05, 1.0, 'ding');
  });

  bus.on('runend', () => {
    if (!ctx) return;
    const time = now();
    padChord(time, CHORDS[0].pad);
    bell(time + 0.15, 89, 0.04, 1.4, 'ding');
  });

  return { audio, traceRun };
}
