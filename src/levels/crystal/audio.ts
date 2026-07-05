import type { EventBus } from '../../events';
import {
  createAudioGraphBuilder,
  createLevelAudioKit,
  createStepTransport,
  playBufferSourceVoice,
  playNoiseHit,
  playOscillatorVoice,
} from '../../engine/audio-kit';
import { createAudioTraceSink, createNoopTraceBus, type AudioTraceResult, type AudioTraceSink } from '../../engine/audio-trace';
import { quantizeActionSfxTime } from '../../engine/action-sfx-quantization';
import { emitBeatAt, midiToFreq, quantizeToGrid } from '../../engine/music';

// Procedural synesthesia layer: a 126 BPM arrangement that builds over the
// 45-second run (kick → bass/hats → arp → claps/open hats → riser into the
// Warden fight), with game SFX pitched in A minor and quantized to musical
// grids so player actions land inside the music, Rez-style.

const BPM = 126;
const SIXTEENTH = 60 / BPM / 4;
const THIRTYSECOND = SIXTEENTH / 2;
const SCHEDULE_AHEAD = 0.18;
const SCHEDULER_MS = 25;

// A natural minor / pentatonic material.
const CHORDS = [
  { bass: 33, pad: [57, 60, 64, 67], arp: [69, 72, 76, 79] }, // Am7
  { bass: 29, pad: [53, 57, 60, 64], arp: [69, 72, 77, 81] }, // Fmaj7
  { bass: 36, pad: [52, 55, 60, 64], arp: [67, 72, 76, 79] }, // Cmaj7
  { bass: 31, pad: [55, 59, 62, 64], arp: [67, 71, 74, 79] }, // G6
];
const LOCK_SCALE = [69, 72, 74, 76, 79, 81, 84, 88]; // A minor pentatonic, rising per lock

export function createAudio(bus: EventBus) {
  return createCrystalAudio(bus).audio;
}

export function traceCrystalAudio(options: { seconds?: number } = {}): AudioTraceResult {
  const seconds = options.seconds ?? 45;
  const events: AudioTraceResult['events'] = [];
  const trace = createAudioTraceSink(events);
  const bus = createNoopTraceBus();
  const tracedAudio = createCrystalAudio(bus, trace);
  tracedAudio.traceRun(seconds);
  return {
    metadata: {
      level: 'crystal-corridor',
      bpm: BPM,
      seconds,
      stepSeconds: SIXTEENTH,
      mode: 'run',
    },
    events,
  };
}

function createCrystalAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let arrangementStart = 0;
  // Boots in ambient (attract screen); runstart switches to the full arrangement.
  let mode: 'run' | 'ambient' = 'ambient';

  let master: GainNode | null = null;
  let musicGain: GainNode | null = null;
  let sfxGain: GainNode | null = null;
  let duck: GainNode | null = null;
  let delaySend: GainNode | null = null;
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
    onCreateContext(context, musicVolume, sfxVolume) {
      ctx = context;
      buildGraph(context, musicVolume, sfxVolume);
      transport.start(context);
    },
    onSchedule(context) {
      transport.schedule(context);
    },
    onMusicVolumeChange(context, musicVolume) {
      if (musicGain) musicGain.gain.setTargetAtTime(musicVolume, context.currentTime, 0.05);
    },
    onSfxVolumeChange(context, sfxVolume) {
      if (sfxGain) sfxGain.gain.setTargetAtTime(sfxVolume, context.currentTime, 0.02);
    },
    onDispose() {
      ctx = null;
      master = null;
      musicGain = null;
      sfxGain = null;
      duck = null;
      delaySend = null;
      noiseBuffer = null;
    },
  });

  function buildGraph(context: AudioContext, musicVolume: number, sfxVolume: number) {
    const graph = createAudioGraphBuilder(context);

    master = graph.gain();
    musicGain = graph.gain(musicVolume);
    sfxGain = graph.gain(sfxVolume);
    const compressor = graph.compressor({ threshold: -18, ratio: 5, attack: 0.005, release: 0.22 });
    graph.connect(musicGain, master);
    graph.connect(sfxGain, master);
    graph.connect(master, compressor);
    graph.connect(compressor, context.destination);

    duck = graph.gain();
    graph.connect(duck, musicGain);

    // Feedback delay tuned to a dotted eighth: the space the arp lives in.
    delaySend = graph.gain();
    const delay = graph.delay(1, SIXTEENTH * 3);
    const feedback = graph.gain(0.34);
    const damp = graph.biquadFilter({ type: 'lowpass', frequency: 2600 });
    graph.connect(delaySend, delay);
    graph.connect(delay, damp);
    graph.connect(damp, feedback);
    graph.connect(feedback, delay);
    graph.connect(damp, duck);

    noiseBuffer = graph.noiseBuffer(2);
  }

  // ---- scheduler ----------------------------------------------------------

  function traceRun(seconds: number) {
    mode = 'run';
    arrangementStart = 0;
    transport.reset(0.06, 0);
    ctx = { currentTime: 0 } as AudioContext;
    transport.runUntil(seconds);
    ctx = null;
  }

  function scheduleStep(index: number, time: number) {
    const position = Math.max(0, index - arrangementStart);
    const step = position % 16;
    const bar = Math.floor(position / 16);
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];

    if (step % 4 === 0) {
      const beatNumber = Math.floor(index / 4);
      scheduleBeat(time, beatNumber, step === 0);
    }

    if (step === 0 && bar % 2 === 0) {
      pad(time, chord.pad, 16 * 2 * SIXTEENTH * 1.05);
    }

    if (mode === 'ambient') {
      if (step % 4 === 0) arpNote(time, chord.arp[(step / 4) % chord.arp.length], 0.5);
      return;
    }

    // Bar 16 lands near the Warden's entrance (~30s); bar 22 rides out the end.
    const isFillBar = bar >= 16;
    if (step % 4 === 0 || (isFillBar && step % 2 === 0 && step >= 8)) {
      kick(time, step === 0 ? 1 : 0.9);
    }
    if (bar >= 4 && (step === 4 || step === 12)) clap(time);
    if (bar >= 1) {
      const openHat = bar >= 6 && step % 4 === 2;
      if (openHat) hat(time, 0.14, 0.2);
      else if (bar >= 2 || step % 2 === 1) hat(time, step % 4 === 2 ? 0.09 : 0.045, 0.03);
    }
    if (bar >= 1) {
      const bassSteps: Record<number, number> = { 0: 0, 3: 0, 6: 12, 8: 0, 11: 0, 14: 7 };
      if (step in bassSteps) bass(time, chord.bass + bassSteps[step], step === 0 ? 1 : 0.75);
    }
    if (bar >= 2) {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      const octave = step >= 8 ? 12 : 0;
      arpNote(time, chord.arp[order[step % order.length]] + octave, bar >= 8 ? 0.85 : 0.6);
    }
    if ((bar === 14 || bar === 21) && step === 0) riser(time, 16 * 2 * SIXTEENTH);
  }

  function scheduleBeat(time: number, beatNumber: number, isDownbeat: boolean) {
    if (trace) {
      trace.record(time, 'beat', { beatNumber, isDownbeat });
      return;
    }
    if (!ctx) return;
    emitBeatAt(bus, ctx, time, beatNumber, isDownbeat);
  }

  const quantize = (time: number) => quantizeToGrid(time, THIRTYSECOND);
  const quantizeActionSfx = (time: number) => quantizeActionSfxTime(time, THIRTYSECOND);
  const musicDestination = () => musicGain ?? master;
  const sfxDestination = () => sfxGain ?? master;

  // ---- instruments --------------------------------------------------------

  function kick(time: number, vel: number) {
    if (trace) {
      trace.record(time, 'kick', { vel });
      return;
    }
    const output = musicDestination();
    if (!ctx || !output || !duck) return;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.2,
      oscillatorType: 'sine',
      frequency: 150,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 43, time: time + 0.11 }],
      gainAutomation: [
        { type: 'set', value: 0.5 * vel, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.17 },
      ],
      destination: output,
    });
    noiseHit(time, 0.1 * vel, 0.004, 'highpass', 1200, output);
    // Sidechain: everything melodic breathes around the kick.
    duck.gain.cancelScheduledValues(time);
    duck.gain.setValueAtTime(0.42, time);
    duck.gain.linearRampToValueAtTime(1, time + 0.26);
  }

  function clap(time: number) {
    if (trace) {
      trace.record(time, 'clap');
      return;
    }
    const output = musicDestination();
    if (!output) return;
    noiseHit(time, 0.16, 0.05, 'bandpass', 1900, output);
    noiseHit(time + 0.013, 0.1, 0.07, 'bandpass', 2200, output);
  }

  function hat(time: number, vel: number, decay: number) {
    if (trace) {
      trace.record(time, 'hat', { vel, decay });
      return;
    }
    if (!duck) return;
    noiseHit(time, vel, decay, 'highpass', 7200, duck);
  }

  function bass(time: number, midi: number, vel: number) {
    if (trace) {
      trace.record(time, 'bass', { midi, vel });
      return;
    }
    if (!ctx || !duck) return;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.28,
      oscillatorType: 'sawtooth',
      frequency: midiToFreq(midi),
      filter: {
        type: 'lowpass',
        Q: 6,
        frequencyAutomation: [
          { type: 'set', value: 200 + vel * 800, time },
          { type: 'exponentialRamp', value: 160, time: time + 0.2 },
        ],
      },
      gainAutomation: [
        { type: 'set', value: 0, time },
        { type: 'linearRamp', value: 0.3 * vel, time: time + 0.006 },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
      ],
      destination: duck,
    });
  }

  function pad(time: number, midis: number[], duration: number) {
    if (trace) {
      trace.record(time, 'pad', { midis, duration });
      return;
    }
    if (!ctx || !duck || !delaySend) return;
    for (const midi of midis) {
      for (const detune of [-7, 7]) {
        playOscillatorVoice({
          context: ctx,
          time,
          stopTime: time + duration + 0.05,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 420, time },
              { type: 'linearRamp', value: 760, time: time + duration * 0.5 },
              { type: 'linearRamp', value: 420, time: time + duration },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0, time },
            { type: 'linearRamp', value: 0.045, time: time + 0.5 },
            { type: 'set', value: 0.045, time: time + duration - 0.4 },
            { type: 'linearRamp', value: 0, time: time + duration },
          ],
          destination: [duck, delaySend],
        });
      }
    }
  }

  function arpNote(time: number, midi: number, vel: number) {
    if (trace) {
      trace.record(time, 'arp', { midi, vel });
      return;
    }
    if (!ctx || !duck || !delaySend) return;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.15,
      oscillatorType: 'triangle',
      frequency: midiToFreq(midi),
      filter: { type: 'lowpass', frequency: 2600 },
      gainAutomation: [
        { type: 'set', value: 0.16 * vel, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
      ],
      destination: duck,
      sends: [{ destination: delaySend, gain: 0.5 }],
    });
  }

  function riser(time: number, duration: number) {
    if (trace) {
      trace.record(time, 'riser', { duration });
      return;
    }
    const output = musicDestination();
    if (!ctx || !output || !noiseBuffer) return;
    playBufferSourceVoice({
      context: ctx,
      buffer: noiseBuffer,
      time,
      stopTime: time + duration + 0.1,
      loop: true,
      filter: {
        type: 'bandpass',
        Q: 1.2,
        frequencyAutomation: [
          { type: 'set', value: 300, time },
          { type: 'exponentialRamp', value: 6400, time: time + duration },
        ],
      },
      gainAutomation: [
        { type: 'set', value: 0.001, time },
        { type: 'exponentialRamp', value: 0.14, time: time + duration },
        { type: 'linearRamp', value: 0, time: time + duration + 0.05 },
      ],
      destination: output,
    });
  }

  function noiseHit(
    time: number,
    vel: number,
    decay: number,
    filterType: BiquadFilterType,
    frequency: number,
    destination: AudioNode,
  ) {
    if (!ctx || !noiseBuffer) return;
    playNoiseHit({
      context: ctx,
      buffer: noiseBuffer,
      time,
      velocity: vel,
      decay,
      filterType,
      frequency,
      destination,
      loopStart: Math.random(),
      offset: Math.random() * 1.5,
    });
  }

  // ---- game SFX (all in key, quantized to musical grids) ------------------

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    if (!ctx || !output || !delaySend) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = quantizeActionSfx(ctx.currentTime);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.13,
      oscillatorType: 'triangle',
      frequency: midiToFreq(midi),
      filter: { type: 'lowpass', frequency: 3200 },
      gainAutomation: [
        { type: 'set', value: 0.16, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.1 },
      ],
      destination: output,
      sends: [{ destination: delaySend, gain: 0.35 }],
    });
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = quantizeActionSfx(ctx.currentTime);
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.1,
      oscillatorType: 'sawtooth',
      frequency: 690,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 165, time: time + 0.07 }],
      gainAutomation: [
        { type: 'set', value: 0.09, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.08 },
      ],
      destination: output,
    });
    noiseHit(time, 0.05, 0.02, 'highpass', 3000, output);
  });

  bus.on('hit', ({ lethal }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output || !delaySend) return;
    const time = quantize(ctx.currentTime);
    for (const [midi, at, vel] of [
      [81, time, 0.08],
      [84, time + THIRTYSECOND, 0.07],
      [88, time + THIRTYSECOND * 2, 0.06],
    ] as const) {
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.16,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 4200 },
        gainAutomation: [
          { type: 'set', value: vel, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.14 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.38 }],
      });
    }
    noiseHit(time, 0.035, 0.035, 'highpass', 5600, output);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;

    // Negative feedback: a dry, dissonant rejection thunk that cuts through
    // the music without sounding like a successful hit sparkle.
    for (const [start, end, at, vel] of [
      [330, 92, time, 0.18],
      [233, 61, time + 0.028, 0.13],
    ] as const) {
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.26,
        oscillatorType: 'sawtooth',
        frequency: start,
        frequencyAutomation: [{ type: 'exponentialRamp', value: end, time: at + 0.2 }],
        filter: {
          type: 'bandpass',
          Q: 5,
          frequencyAutomation: [
            { type: 'set', value: 1100, time: at },
            { type: 'exponentialRamp', value: 430, time: at + 0.18 },
          ],
        },
        gainAutomation: [
          { type: 'set', value: vel, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.24 },
        ],
        destination: output,
      });
    }
    noiseHit(time, 0.15, 0.09, 'bandpass', 720, output);
    noiseHit(time + 0.025, 0.07, 0.12, 'highpass', 2400, output);
  });

  bus.on('kill', () => {
    const output = sfxDestination();
    if (!ctx || !output || !delaySend) return;
    const time = quantize(ctx.currentTime);
    for (const [frequency, vel] of [
      [880, 0.12],
      [1318.5, 0.09],
    ] as const) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.25,
        oscillatorType: 'sine',
        frequency,
        gainAutomation: [
          { type: 'set', value: vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.4 }],
      });
    }
    noiseHit(time, 0.06, 0.09, 'highpass', 5200, output);
  });

  // Hull hit: a low impact boom under a dissonant tritone stab — the one
  // sound in the level that is deliberately out of key.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.45,
      oscillatorType: 'sine',
      frequency: 96,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 34, time: time + 0.28 }],
      gainAutomation: [
        { type: 'set', value: 0.42, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.4 },
      ],
      destination: output,
    });
    for (const midi of [63, 69]) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.28,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        gainAutomation: [
          { type: 'set', value: 0.07, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.24 },
        ],
        destination: output,
      });
    }
    noiseHit(time, 0.2, 0.14, 'bandpass', 900, output);
  });

  // Warden entrance: a rising two-note alarm over a long riser.
  bus.on('spawn', ({ kind }) => {
    if (kind !== 'warden-core' || !ctx || !duck || !delaySend) return;
    const time = quantize(ctx.currentTime);
    riser(time, 1.8);
    [57, 63].forEach((midi, index) => {
      if (!ctx || !duck || !delaySend) return;
      const at = time + index * 0.42;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.55,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1600 },
        gainAutomation: [
          { type: 'set', value: 0.16, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.5 },
        ],
        destination: duck,
        sends: [{ destination: delaySend, gain: 0.5 }],
      });
    });
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.15,
      oscillatorType: 'sine',
      frequency: 130,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 68, time: time + 0.12 }],
      gainAutomation: [
        { type: 'set', value: 0.05, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.13 },
      ],
      destination: output,
    });
  });

  bus.on('runstart', () => {
    mode = 'run';
    // Restart the arrangement on the next bar boundary so the build-up
    // tracks the new run.
    arrangementStart = transport.stepIndex + ((16 - (transport.stepIndex % 16)) % 16);
  });

  bus.on('runend', () => {
    mode = 'ambient';
    if (!ctx) return;
    pad(ctx.currentTime + 0.05, [57, 64, 69, 76], 5);
  });

  return { audio, traceRun };
}

