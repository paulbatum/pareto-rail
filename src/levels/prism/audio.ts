import type { EventBus } from '../../events';
import { createArrangement, fn } from '../../engine/arrangement';
import { createBeatLevelAudio, defineInstruments, playNoiseHit, playOscillatorVoice, type BeatLevelAudioStep } from '../../engine/audio-kit';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore } from '../../engine/score';
import {
  PRISM_ARRANGEMENT_SECTIONS,
  PRISM_BPM,
  PRISM_RUN_DURATION,
  PRISM_SCORE_SECTIONS,
  PRISM_STEPS_PER_BAR,
  PRISM_TIME,
  type PrismSectionName,
} from './timing';

const SIXTEENTH = PRISM_TIME.stepSeconds;
const STEPS_PER_BAR = PRISM_STEPS_PER_BAR;
const SCALE = [62, 65, 69, 72, 74, 77, 81, 84] as const;
const PLAYER_LEAD = SCALE.map((midi) => midi + 12);

type PrismChord = { bass: number; lead: readonly number[] };

const CHORDS: readonly PrismChord[] = [
  { bass: 38, lead: PLAYER_LEAD },
  { bass: 41, lead: PLAYER_LEAD },
];

const KILL_LANES: Record<PrismSectionName, readonly number[]> = {
  opening: [4, 5, 4, 3, 4, 5, 6, 5, 4, 3, 2, 3, 4, 5, 6, 7],
  pulse: [3, 4, 5, 4, 6, 5, 4, 3, 5, 6, 7, 6, 5, 4, 3, 2],
  shimmer: [4, 6, 5, 7, 4, 6, 5, 3, 4, 5, 6, 7, 6, 5, 4, 2],
  bloom: [5, 6, 7, 6, 5, 4, 6, 7, 4, 5, 6, 5, 4, 3, 2, 3],
  finale: [7, 6, 5, 4, 6, 5, 4, 3, 5, 4, 3, 2, 4, 5, 6, 7],
};

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
  const score = createScore<PrismChord, PrismSectionName>({
    bpm: PRISM_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 1,
    sections: PRISM_SCORE_SECTIONS,
    leadSet: (chord) => chord.lead,
    killLanes: KILL_LANES,
  });

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    score,
    stepSeconds: SIXTEENTH,
    scheduleAhead: 0.16,
    schedulerMs: 25,
    volumeScale: 0.8,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      combinedVolume: true,
      compressor: { threshold: -20, ratio: 4 },
      delay: { maxTime: 1.4, time: SIXTEENTH * 5, feedback: 0.42, dampHz: 900, dampType: 'highpass', sendGain: 0.55, returnTo: 'master' },
      noiseSeconds: 2,
    },
    onBeforeBeat({ step, bar, time, mode }) {
      if (mode === 'run' && step === 0) runArrangement.recordSectionStart(time, bar);
    },
    onStep: scheduleStep,
    onRunEnd() {
      const ctx = runtime.context();
      if (ctx) inst.bell(ctx.currentTime + 0.05, 74, 0.13, 1.4);
    },
  });

  const inst = defineInstruments({ trace, context: runtime.context }, {
    bell(context, time, midi, velocity, decay) {
      const mix = runtime.mix();
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
      const mix = runtime.mix();
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
      const mix = runtime.mix();
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

  const ambientArrangement = createArrangement<PrismChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [fn(({ time, step, bar }) => {
        const note = SCALE[((step / 2 + bar * 2) % SCALE.length) | 0];
        if (step % 4 === 0) inst.bell(time, note + 12, 0.09, 0.9);
      })],
    }],
  });

  const runTrack = fn<PrismChord>(({ time, step, bar }) => {
    const note = SCALE[((step / 2 + bar * 2) % SCALE.length) | 0];
    if (step === 0 || step === 10) inst.lowPulse(time, bar % 2 === 0 ? 38 : 41);
    if (step % 2 === 0) inst.bell(time, note + (bar >= 4 ? 12 : 0), 0.11, bar >= 5 ? 0.42 : 0.28);
    if (bar >= 2 && (step === 4 || step === 12)) inst.noiseTick(time, 0.08, 0.035);
    if (bar >= 6 && step % 4 === 3) inst.noiseTick(time, 0.045, 0.11);
  });

  const runArrangement = createArrangement<PrismChord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: PRISM_ARRANGEMENT_SECTIONS.map((section) => ({
      name: section.name,
      fromBar: section.fromBar,
      toBar: section.toBar,
      tracks: [runTrack],
    })),
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  bus.on('lock', ({ lockCount }) => {
    const ctx = runtime.context();
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    const midi = lead[Math.min(lockCount - 1, lead.length - 1)] ?? PLAYER_LEAD[0];
    inst.bell(time, midi, 0.08, 0.22);
  });

  bus.on('fire', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    inst.lowPulse(time, chord.bass + 12);
  });

  bus.on('kill', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    const kill = score.nextKill(ctx.currentTime);
    inst.bell(kill.time, kill.midi, 0.12, 0.45);
    inst.noiseTick(kill.time, 0.07, 0.06);
  });

  bus.on('miss', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    // Miss feedback stays immediate; grid delay makes a failed target read late.
    const chord = score.chordAt(score.arrangementPositionAt(ctx.currentTime));
    inst.lowPulse(ctx.currentTime, chord.bass - 4);
  });

  bus.on('reject', () => {
    const ctx = runtime.context();
    if (!ctx) return;
    // Reject feedback is deliberately unquantized so invalid releases feel instant.
    const time = ctx.currentTime;
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    const lead = score.leadSetAt(position);
    inst.lowPulse(time, chord.bass - 7);
    inst.noiseTick(time + 0.02, 0.11, 0.08);
    inst.bell(time + 0.035, (lead[0] ?? PLAYER_LEAD[0]) - 13, 0.055, 0.2);
  });

  return runtime;
}
