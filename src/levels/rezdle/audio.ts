import type { EventBus } from '../../events';
import { createBrowserAudioContext, installAudioUnlock } from '../../engine/audio-unlock';
import { emitBeatAt, midiToFreq } from '../../engine/music';
import { BPM } from './gameplay';

// A midnight print-shop chamber piece: swung 8ths at 84 BPM, felt-piano pad
// and celesta over typewriter percussion. Every four bars the carriage
// returns — zip and ding — which is also when a new rack of type arrives.
const BEAT = 60 / BPM;
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
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let intervalId = 0;
  let unlockGestureStart: (() => void) | null = null;
  let masterVolume = 0.5;
  let nextStepTime = 0;
  let stepIndex = 0;
  let arpCounter = 0;

  const start = async () => {
    if (!ctx) {
      ctx = createBrowserAudioContext();
      master = ctx.createGain();
      master.gain.value = masterVolume * 0.55;
      master.connect(ctx.destination);
      noiseBuffer = buildNoiseBuffer(ctx);
      nextStepTime = ctx.currentTime + 0.08;
      stepIndex = 0;
      intervalId = window.setInterval(schedule, SCHEDULER_MS);
    }
    if (ctx.state === 'suspended') await ctx.resume();
  };

  const installGestureStart = () => {
    unlockGestureStart?.();
    unlockGestureStart = installAudioUnlock(start);
  };

  // --- Scheduler: swung 8th steps ---------------------------------------

  function schedule() {
    if (!ctx) return;
    while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(stepIndex, nextStepTime);
      stepIndex += 1;
      // Even steps are on the beat; odd steps land on the swung offbeat.
      nextStepTime += stepIndex % 2 === 1 ? SWING : BEAT - SWING;
    }
  }

  function scheduleStep(step: number, time: number) {
    if (!ctx) return;
    const eighth = step % 8;
    const bar = Math.floor(step / 8);
    const chord = CHORDS[bar % CHORDS.length];
    // Density breathes over a 12-bar arc: sparse, moving, full.
    const density = Math.floor(bar / 4) % 3;

    if (step % 2 === 0) {
      const beatNumber = step / 2;
      const isDownbeat = beatNumber % 4 === 0;
      emitBeatAt(bus, ctx, time, beatNumber, isDownbeat);
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
      bell(time, note, density === 2 ? 0.032 : 0.024, 0.4);
    }

    // Carriage return into every 4th bar: zip through the last beat, ding on
    // the turnaround.
    if (bar % 4 === 3 && eighth === 6) {
      zip(time, 0.3, 0.024);
      bell(time + BEAT * 0.95, 96, 0.045, 0.9);
    }
  }

  // --- Voices ------------------------------------------------------------

  function buildNoiseBuffer(context: AudioContext) {
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function noise(time: number, duration: number, gainValue: number, filterType: BiquadFilterType, frequency: number, sweepTo?: number) {
    if (!ctx || !master || !noiseBuffer) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, time);
    if (sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(sweepTo, time + duration);
    filter.Q.value = filterType === 'bandpass' ? 4 : 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, time);
    gain.gain.exponentialRampToValueAtTime(0.0005, time + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(time);
    source.stop(time + duration + 0.03);
  }

  function tickNoise(time: number, gainValue: number, frequency: number) {
    noise(time, 0.03, gainValue, 'highpass', frequency);
  }

  function clack(time: number, gainValue: number) {
    noise(time, 0.028, gainValue, 'bandpass', 1900);
    noise(time + 0.014, 0.02, gainValue * 0.6, 'bandpass', 2600);
  }

  function zip(time: number, duration: number, gainValue: number) {
    noise(time, duration, gainValue, 'bandpass', 480, 2800);
  }

  function tone(time: number, frequency: number, gainValue: number, duration: number, type: OscillatorType, attack = 0.004) {
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0005, time);
    gain.gain.exponentialRampToValueAtTime(gainValue, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0005, time + duration);
    osc.connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + duration + 0.03);
  }

  // Celesta-ish: fundamental plus a quiet detuned twelfth.
  function bell(time: number, midi: number, gainValue: number, duration: number) {
    const frequency = midiToFreq(midi);
    tone(time, frequency, gainValue, duration, 'sine');
    tone(time, frequency * 3.01, gainValue * 0.22, duration * 0.55, 'sine');
  }

  function padChord(time: number, midis: number[]) {
    if (!ctx || !master) return;
    for (const midi of midis) {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(midi);
      osc.detune.value = (midi % 2 === 0 ? 1 : -1) * 4;
      filter.type = 'lowpass';
      filter.frequency.value = 760;
      gain.gain.setValueAtTime(0.0005, time);
      gain.gain.exponentialRampToValueAtTime(0.02, time + 0.5);
      gain.gain.setValueAtTime(0.02, time + BEAT * 2.4);
      gain.gain.exponentialRampToValueAtTime(0.0005, time + BEAT * 4);
      osc.connect(filter).connect(gain).connect(master);
      osc.start(time);
      osc.stop(time + BEAT * 4 + 0.05);
    }
  }

  function bassNote(time: number, midi: number, velocity: number) {
    tone(time, midiToFreq(midi), 0.065 * velocity, 0.55, 'sine', 0.01);
  }

  function thump(time: number, from: number, to: number, gainValue: number, duration: number) {
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, time);
    osc.frequency.exponentialRampToValueAtTime(to, time + duration);
    gain.gain.setValueAtTime(gainValue, time);
    gain.gain.exponentialRampToValueAtTime(0.0005, time + duration);
    osc.connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + duration + 0.03);
  }

  const now = () => (ctx ? ctx.currentTime + 0.005 : 0);

  // --- Sound design ------------------------------------------------------

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = now();
    // Keystrike: a pitched typewriter key, climbing with each lock.
    noise(time, 0.016, 0.05, 'bandpass', 1500 + lockCount * 160);
    bell(time + 0.004, LOCK_STEPS[Math.min(Math.max(lockCount, 1), 8) - 1], 0.038, 0.14);
  });

  bus.on('unlock', () => {
    if (!ctx) return;
    noise(now(), 0.045, 0.016, 'lowpass', 420);
  });

  let lastZipAt = -1;

  bus.on('fire', ({ indexInVolley }) => {
    if (!ctx || (indexInVolley ?? 0) > 0) return;
    // One carriage-return zip per volley, not per shot. Attract/replay
    // volleys carry no volley index, so throttle those by time instead.
    const time = now();
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
    bell(time + 0.01, 89, 0.016, 0.12);
  });

  bus.on('volley', ({ kills, scoreAwarded, size }) => {
    if (!ctx) return;
    const time = now();
    if (scoreAwarded > 0) {
      // The word goes to print: a bell run the length of the word, capped
      // with the carriage ding.
      const notes = Math.min(kills, BELL_RUN.length);
      for (let i = 0; i < notes; i += 1) {
        bell(time + i * 0.07, BELL_RUN[i], 0.042, 0.35);
      }
      bell(time + notes * 0.07 + 0.05, 96, 0.05, 1.1);
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
    bell(time + 0.28, 96, 0.05, 1.0);
  });

  bus.on('runend', () => {
    if (!ctx) return;
    const time = now();
    padChord(time, CHORDS[0].pad);
    bell(time + 0.15, 89, 0.04, 1.4);
  });

  return {
    start,
    installGestureStart,
    setMasterVolume(volume: number) {
      masterVolume = Math.min(1, Math.max(0, volume));
      if (ctx && master) master.gain.setTargetAtTime(masterVolume * 0.55, ctx.currentTime, 0.05);
    },
    getMasterVolume() {
      return masterVolume;
    },
    async suspend() {
      if (ctx && ctx.state === 'running') await ctx.suspend();
    },
    dispose() {
      unlockGestureStart?.();
      unlockGestureStart = null;
      if (intervalId) window.clearInterval(intervalId);
      void ctx?.close();
      ctx = null;
    },
  };
}
