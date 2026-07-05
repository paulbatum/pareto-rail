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
import { emitBeatAt, midiToFreq } from '../../engine/music';
import { CRYSTAL_BPM } from './gameplay';

// Rez-style synesthesia experiment (forked from crystal-corridor's audio):
// the arrangement carries drums, bass, and pads, but the LEAD MELODY is a
// hidden two-bar sequencer lane that only sounds where the player lands
// kills. Each kill snaps to the transport's real 16th-note grid and plays
// whatever note the lane holds at that step, so a chained volley performs an
// actual melodic run. The lane's contour, the kill instrument, and the
// lock/fire timbres all change across the level's three acts, and every
// pitched player sound follows the current chord — the player is the
// soloist and the gun retunes with the harmony.

const SIXTEENTH = 60 / CRYSTAL_BPM / 4;
const THIRTYSECOND = SIXTEENTH / 2;
const SCHEDULE_AHEAD = 0.18;
const SCHEDULER_MS = 25;
const STEPS_PER_BAR = 16;
const LANE_STEPS = 32; // two bars: one full chord

// A natural minor / pentatonic material (same harmonic bed as crystal).
const CHORDS = [
  { bass: 33, pad: [57, 60, 64, 67], arp: [69, 72, 76, 79] }, // Am7
  { bass: 29, pad: [53, 57, 60, 64], arp: [69, 72, 77, 81] }, // Fmaj7
  { bass: 36, pad: [52, 55, 60, 64], arp: [67, 72, 76, 79] }, // Cmaj7
  { bass: 31, pad: [55, 59, 62, 64], arp: [67, 71, 74, 79] }, // G6
];
const LOCK_SCALE = [69, 72, 74, 76, 79, 81, 84, 88]; // A minor pentatonic, rising per lock

// The kill-melody lanes. Values are degrees 0–7 into the current chord's
// lead set (arp plus the same notes an octave up), so a kill on any step of
// any bar lands on a chord tone. Each lane is a 32-step contour over the
// two-bar chord cycle; kills "unmute" it step by step, and a chained volley
// plays consecutive steps — a real melodic fragment.
type SectionIndex = 0 | 1 | 2;
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Act 1 — glass garden: a slow stepwise arch. Sparse waves pick calm
  // fragments out of it.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 1, 2, 3, 4, 5,
    4, 3, 4, 5, 6, 5, 4, 3,
    4, 5, 6, 7, 6, 5, 4, 2,
  ],
  // Act 2 — the corridor wakes up: syncopated octave zig-zags, so dense
  // volleys ring out as fast broken-chord runs.
  1: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 7, 6, 5, 4, 3, 2, 1,
  ],
  // Act 3 — the Warden: high descending peals answered by a climb back to
  // the top, so shield breaks and core chips toll like bells.
  2: [
    7, 6, 5, 4, 7, 6, 5, 4,
    5, 4, 3, 2, 5, 4, 3, 2,
    3, 2, 1, 0, 3, 2, 1, 0,
    4, 5, 6, 7, 4, 5, 6, 7,
  ],
};

// Per-act voicing for the player's instruments (kill, lock, fire).
const SECTION_VOICES: Record<SectionIndex, {
  kill: { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; shimmer: number };
  lock: { oscillator: OscillatorType; cutoff: number };
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { oscillator: 'sine', decay: 0.42, cutoff: 3400, gain: 0.17, shimmer: 0.35 },
    lock: { oscillator: 'triangle', cutoff: 2800 },
    fire: { cutoff: 1900, noise: 0.03 },
  },
  1: {
    kill: { oscillator: 'square', decay: 0.24, cutoff: 2600, gain: 0.15, shimmer: 0.5 },
    lock: { oscillator: 'square', cutoff: 2200 },
    fire: { cutoff: 3200, noise: 0.05 },
  },
  2: {
    kill: { oscillator: 'sawtooth', decay: 0.5, cutoff: 3000, gain: 0.16, shimmer: 0.7 },
    lock: { oscillator: 'sawtooth', cutoff: 2400 },
    fire: { cutoff: 4200, noise: 0.07 },
  },
};

export function createAudio(bus: EventBus) {
  return createCrystalResonanceAudio(bus).audio;
}

export function traceCrystalResonanceAudio(options: { seconds?: number } = {}): AudioTraceResult {
  const seconds = options.seconds ?? 45;
  const events: AudioTraceResult['events'] = [];
  const trace = createAudioTraceSink(events);
  const bus = createNoopTraceBus();
  const tracedAudio = createCrystalResonanceAudio(bus, trace);
  tracedAudio.traceRun(seconds);
  return {
    metadata: {
      level: 'crystal-resonance',
      bpm: CRYSTAL_BPM,
      seconds,
      stepSeconds: SIXTEENTH,
      mode: 'run',
    },
    events,
  };
}

function createCrystalResonanceAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;
  let arrangementStart = 0;
  // Boots in ambient (attract screen); runstart switches to the full arrangement.
  let mode: 'run' | 'ambient' = 'ambient';
  // Audio-clock time of transport step 0. Player sounds snap to this grid —
  // not to an absolute-zero grid — so they land exactly on the music.
  let transportEpoch = 0;
  let wardenActive = false;
  let coreId = -1;
  let coreMaxHp = 0;

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
      transportEpoch = transport.nextStepTime;
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

  // ---- musical position ----------------------------------------------------
  // Every player-triggered sound asks three questions: which grid step does
  // this land on, which chord sounds there, and which act's voice speaks.

  function nextGridTime(time: number, gridSixteenths = 1) {
    const grid = SIXTEENTH * gridSixteenths;
    const stepsFromEpoch = Math.max(0, Math.ceil((time - transportEpoch) / grid - 1e-4));
    return transportEpoch + stepsFromEpoch * grid;
  }

  function arrangementPositionAt(time: number) {
    const step = Math.round((time - transportEpoch) / SIXTEENTH);
    return Math.max(0, step - arrangementStart);
  }

  function chordAt(position: number) {
    const bar = Math.floor(position / STEPS_PER_BAR);
    return CHORDS[Math.floor(bar / 2) % CHORDS.length];
  }

  // Sections track the arrangement bars the same way the drum build does
  // (act 2 gameplay begins ~bar 5, the Warden fill lands at bar 16). Because
  // the backing track does NOT change at bar 5, the player-instrument
  // handover crossfades over two bars there instead of snapping; the Warden's
  // spawn snaps instantly because the music turns over with it.
  type SectionMix = { from: SectionIndex; to: SectionIndex; t: number };

  function sectionMixAt(position: number): SectionMix {
    if (wardenActive) return { from: 2, to: 2, t: 1 };
    const bar = position / STEPS_PER_BAR;
    if (bar >= 18) return { from: 2, to: 2, t: 1 };
    if (bar >= 16) return { from: 1, to: 2, t: (bar - 16) / 2 };
    if (bar >= 7) return { from: 1, to: 1, t: 1 };
    if (bar >= 5) return { from: 0, to: 1, t: (bar - 5) / 2 };
    return { from: 0, to: 0, t: 1 };
  }

  function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
  }

  function leadSetAt(position: number) {
    const chord = chordAt(position);
    return [...chord.arp, ...chord.arp.map((midi) => midi + 12)];
  }

  // ---- scheduler ----------------------------------------------------------

  function traceRun(seconds: number) {
    mode = 'run';
    arrangementStart = 0;
    transport.reset(0.06, 0);
    transportEpoch = 0.06;
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
    // During runs the bed arp sits an octave lower, quieter, and on eighths
    // instead of sixteenths — the top register belongs to the player's kill
    // melody. (Crystal's original doubles up an octave and louder instead.)
    if (bar >= 2 && step % 2 === 0) {
      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      arpNote(time, chord.arp[order[(step / 2) % order.length]] - 12, bar >= 8 ? 0.6 : 0.45);
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

  // ---- the player's instruments -------------------------------------------
  // Kills read the hidden melody lane, locks climb the pentatonic in the
  // act's timbre, fire is a pitched zap rooted on the current chord. All
  // snap to the transport's real grid.

  function killNote(time: number, position: number, mix: SectionMix, chain: number) {
    const output = sfxDestination();
    if (!ctx || !output || !delaySend) return;
    // Mid-blend the lane contour flips at the halfway point; the timbre is
    // what needs the smooth handover, not the (always-consonant) note choice.
    const laneSection = mix.t >= 0.5 ? mix.to : mix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = leadSetAt(position)[degree];
    const fromVoice = SECTION_VOICES[mix.from].kill;
    const toVoice = SECTION_VOICES[mix.to].kill;
    // Chained volley kills crescendo, and from the third onward a soft upper
    // octave rings above the line.
    const vel = Math.min(1.35, 1 + chain * 0.12);
    const decay = lerp(fromVoice.decay, toVoice.decay, mix.t);
    const gain = lerp(fromVoice.gain, toVoice.gain, mix.t);
    const shimmer = lerp(fromVoice.shimmer, toVoice.shimmer, mix.t);

    // Crossfade the lead: inside a blend window both acts' oscillators sound
    // with complementary weights, so the timbre slides rather than snapping.
    const layers: Array<[typeof fromVoice, number]> = mix.from === mix.to
      ? [[toVoice, 1]]
      : [[fromVoice, 1 - mix.t], [toVoice, mix.t]];
    for (const [voice, weight] of layers) {
      if (weight < 0.02) continue;
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + voice.decay + 0.05,
        oscillatorType: voice.oscillator,
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: voice.cutoff },
        gainAutomation: [
          { type: 'set', value: voice.gain * vel * weight, time },
          { type: 'exponentialRamp', value: 0.001, time: time + voice.decay },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.45 }],
      });
    }
    // A pure-tone body an octave below keeps square/saw voices from thinness.
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + decay + 0.05,
      oscillatorType: 'sine',
      frequency: midiToFreq(midi - 12),
      gainAutomation: [
        { type: 'set', value: gain * 0.55 * vel, time },
        { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
      ],
      destination: output,
    });
    if (chain >= 2) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + decay + 0.05,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi + 12),
        gainAutomation: [
          { type: 'set', value: gain * 0.4, time },
          { type: 'exponentialRamp', value: 0.001, time: time + decay },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.5 }],
      });
    }
    noiseHit(time, 0.05 * shimmer + 0.03, 0.08, 'highpass', 5200, output);
  }

  // Chipping the core rings a deep anvil where everything else in the level
  // rings high. It grows with the damage dealt (intensity 0→1 across the
  // core's HP) and a beacon note climbs the lead set with it, so the fight
  // audibly ratchets toward the finale.
  function coreChip(intensity: number) {
    const output = sfxDestination();
    if (!ctx || !output || !delaySend) return;
    const time = nextGridTime(ctx.currentTime, 0.5);
    const position = arrangementPositionAt(time);
    const chord = chordAt(position);
    const rootFreq = midiToFreq(chord.bass + 12);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.45,
      oscillatorType: 'sine',
      frequency: rootFreq * 3,
      frequencyAutomation: [{ type: 'exponentialRamp', value: rootFreq, time: time + 0.09 }],
      gainAutomation: [
        { type: 'set', value: 0.26 + 0.16 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.38 },
      ],
      destination: output,
    });
    // Metallic face: the whole chord struck at once, brightening with damage.
    for (const midi of chord.arp) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.24,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 2200 + 2600 * intensity },
        gainAutomation: [
          { type: 'set', value: 0.045 + 0.02 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.3 }],
      });
    }
    const leadSet = leadSetAt(position);
    const beacon = leadSet[Math.min(leadSet.length - 1, Math.floor(intensity * leadSet.length))];
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.55,
      oscillatorType: 'sine',
      frequency: midiToFreq(beacon + 12),
      gainAutomation: [
        { type: 'set', value: 0.07 + 0.07 * intensity, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
      ],
      destination: output,
      sends: [{ destination: delaySend, gain: 0.5 }],
    });
    noiseHit(time, 0.12 + 0.08 * intensity, 0.06, 'bandpass', 1400, output);
  }

  // The killing blow on the core: the music bows out for a breath, a sub
  // drop lands on the tonic, a saw power chord blooms, and a victory peal
  // falls from the top of the register through the delay.
  function coreFinale() {
    const output = sfxDestination();
    if (!ctx || !output || !delaySend || !duck) return;
    const time = nextGridTime(ctx.currentTime, 2);

    duck.gain.cancelScheduledValues(time);
    duck.gain.setValueAtTime(0.2, time);
    duck.gain.linearRampToValueAtTime(1, time + 1.8);

    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 1,
      oscillatorType: 'sine',
      frequency: 220,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 55, time: time + 0.45 }],
      gainAutomation: [
        { type: 'set', value: 0.5, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.9 },
      ],
      destination: output,
    });
    // Tonic bloom: A stacked through three octaves with a slow filter open.
    for (const midi of [45, 57, 64, 69]) {
      for (const detune of [-6, 6]) {
        playOscillatorVoice({
          context: ctx,
          time,
          stopTime: time + 1.5,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          detune,
          filter: {
            type: 'lowpass',
            frequencyAutomation: [
              { type: 'set', value: 700, time },
              { type: 'linearRamp', value: 2600, time: time + 0.9 },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0.05, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 1.4 },
          ],
          destination: output,
          sends: [{ destination: delaySend, gain: 0.35 }],
        });
      }
    }
    // Victory peal: A minor pentatonic falling from the top, ringing out.
    [93, 88, 84, 81, 76, 72, 69].forEach((midi, index) => {
      if (!ctx || !output || !delaySend) return;
      const at = time + index * SIXTEENTH;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.5,
        oscillatorType: 'triangle',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 3800 },
        gainAutomation: [
          { type: 'set', value: 0.13 - index * 0.008, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.45 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.55 }],
      });
    });
    noiseHit(time, 0.14, 0.6, 'highpass', 6000, output);
  }

  // Each kill takes at least the step after the previous one, so rapid
  // volley kills never stack on one step — they walk the lane note by note.
  let lastKillStep = -1;
  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (enemyId === coreId) {
      coreFinale();
      return;
    }
    let step = Math.round((nextGridTime(ctx.currentTime) - transportEpoch) / SIXTEENTH);
    if (step <= lastKillStep) step = lastKillStep + 1;
    lastKillStep = step;
    const time = transportEpoch + step * SIXTEENTH;
    const position = Math.max(0, step - arrangementStart);
    killNote(time, position, sectionMixAt(position), indexInVolley ?? 0);
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    if (!ctx || !output || !delaySend) return;
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    const time = nextGridTime(ctx.currentTime, 0.5);
    const mix = sectionMixAt(arrangementPositionAt(time));
    const layers: Array<[SectionIndex, number]> = mix.from === mix.to
      ? [[mix.to, 1]]
      : [[mix.from, 1 - mix.t], [mix.to, mix.t]];
    for (const [section, weight] of layers) {
      if (weight < 0.02) continue;
      const voice = SECTION_VOICES[section].lock;
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.13,
        oscillatorType: voice.oscillator,
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: voice.cutoff + lockCount * 180 },
        gainAutomation: [
          { type: 'set', value: 0.14 * weight, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.1 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.35 }],
      });
    }
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = nextGridTime(ctx.currentTime, 0.5);
    const position = arrangementPositionAt(time);
    const mix = sectionMixAt(position);
    const fromFire = SECTION_VOICES[mix.from].fire;
    const toFire = SECTION_VOICES[mix.to].fire;
    // Fire keeps one oscillator; its brightness slides between acts.
    const voice = {
      cutoff: lerp(fromFire.cutoff, toFire.cutoff, mix.t),
      noise: lerp(fromFire.noise, toFire.noise, mix.t),
    };
    // The zap starts three octaves above the chord root and falls one, so
    // even the gun retunes as the harmony moves.
    const root = chordAt(position).bass;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.1,
      oscillatorType: 'sawtooth',
      frequency: midiToFreq(root + 36),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.07 }],
      filter: { type: 'lowpass', frequency: voice.cutoff },
      gainAutomation: [
        { type: 'set', value: 0.09, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.08 },
      ],
      destination: output,
    });
    noiseHit(time, voice.noise, 0.02, 'highpass', 3000, output);
  });

  // Armor chips (non-lethal hits) climb the current chord instead of a fixed
  // triad, so the Warden fight stays in tune bar to bar. Chips on the core
  // itself ring the heavy anvil instead — the fight's stakes live in that
  // sound growing.
  bus.on('hit', ({ lethal, enemyId, hitPointsRemaining }) => {
    const output = sfxDestination();
    if (lethal || !ctx || !output || !delaySend) return;
    if (enemyId === coreId) {
      coreMaxHp = Math.max(coreMaxHp, hitPointsRemaining + 1);
      coreChip(1 - hitPointsRemaining / coreMaxHp);
      return;
    }
    const time = nextGridTime(ctx.currentTime, 0.5);
    const arp = chordAt(arrangementPositionAt(time)).arp;
    ([[0, 0.08], [1, 0.07], [2, 0.06]] as const).forEach(([index, vel]) => {
      if (!ctx || !output || !delaySend) return;
      const at = time + THIRTYSECOND * index;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.16,
        oscillatorType: 'triangle',
        frequency: midiToFreq(arp[index] + 12),
        filter: { type: 'lowpass', frequency: 4200 },
        gainAutomation: [
          { type: 'set', value: vel, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.14 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.38 }],
      });
    });
    noiseHit(time, 0.035, 0.035, 'highpass', 5600, output);
  });

  // A clean volley of four or more kills earns a flourish: the chord stabbed
  // on the next beat under a bright shimmer — the music itself applauds.
  bus.on('volley', ({ size, kills }) => {
    if (!ctx || !duck || !delaySend || kills < 4 || kills < size) return;
    const time = nextGridTime(ctx.currentTime, 4);
    const chord = chordAt(arrangementPositionAt(time));
    for (const midi of chord.pad) {
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.5,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(midi + 12),
        filter: { type: 'lowpass', frequency: 2400 },
        gainAutomation: [
          { type: 'set', value: 0.055, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
        ],
        destination: duck,
        sends: [{ destination: delaySend, gain: 0.5 }],
      });
    }
    noiseHit(time, 0.09, 0.3, 'highpass', 6800, duck);
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

  // Warden entrance: a rising two-note alarm over a long riser. From here on
  // the kill melody speaks in the Warden's voice.
  bus.on('spawn', ({ kind, enemyId }) => {
    if (kind !== 'warden-core' || !ctx || !duck || !delaySend) return;
    wardenActive = true;
    coreId = enemyId;
    const time = nextGridTime(ctx.currentTime);
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
    wardenActive = false;
    coreId = -1;
    coreMaxHp = 0;
    // Restart the arrangement on the next bar boundary so the build-up
    // tracks the new run.
    arrangementStart = transport.stepIndex + ((16 - (transport.stepIndex % 16)) % 16);
  });

  bus.on('runend', () => {
    mode = 'ambient';
    wardenActive = false;
    if (!ctx) return;
    pad(ctx.currentTime + 0.05, [57, 64, 69, 76], 5);
  });

  return { audio, traceRun };
}
