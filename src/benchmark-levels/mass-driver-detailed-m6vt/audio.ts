import type { EventBus } from '../../events';
import {
  createBeatLevelAudio,
  playOscillatorVoice,
  type BeatLevelAudioStep,
} from '../../engine/audio-kit';
import { voice } from '../../engine/audio-voices';
import { createArrangement, fn, hits, oneShot } from '../../engine/arrangement';
import { createAudioTraceHarness, type AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';
import { createScore, lerp, type SectionMix } from '../../engine/score';
import { createMassDriverVoices } from './audio-voices';
import { massDriverRunState } from './state';
import {
  MASS_DRIVER_BARS,
  MASS_DRIVER_BPM,
  MASS_DRIVER_RUN_DURATION,
  MASS_DRIVER_SCORE_SECTIONS,
  MASS_DRIVER_STEPS_PER_BAR,
  MASS_DRIVER_TIME,
} from './timing';

// 128 BPM locked minimal techno in E minor. The gun is the instrument: a
// persistent bass hum — the gun spooling up — climbs in pitch across the whole
// run and accelerates into the firing charge, cutting dead on the shot. The
// main loop is Em-Em-C-D (two bars per chord); the interlock bars switch to
// Em-F (the bII Phrygian dread); the muzzle resolves to a single sustained
// E major bloom — the whole run is minor, the release is major.

const SIXTEENTH = MASS_DRIVER_TIME.stepSeconds;
const THIRTYSECOND = SIXTEENTH / 2;
const STEPS_PER_BAR = MASS_DRIVER_STEPS_PER_BAR;
const BAR_SECONDS = MASS_DRIVER_TIME.barSeconds;
const LANE_STEPS = 32; // two bars: one full chord

const CHORDS = [
  { name: 'Em', bass: 40, pad: [52, 55, 59, 64], arp: [64, 67, 71, 76] },
  { name: 'Em', bass: 40, pad: [52, 55, 59, 64], arp: [64, 67, 71, 76] },
  { name: 'C', bass: 36, pad: [48, 52, 55, 60], arp: [60, 64, 67, 72] },
  { name: 'D', bass: 38, pad: [50, 54, 57, 62], arp: [62, 66, 69, 74] },
] as const;
type Chord = typeof CHORDS[number];

const EM: Chord = CHORDS[0];
const F = { name: 'F', bass: 41, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77] } as unknown as Chord;
const E_MAJOR = { name: 'E', bass: 40, pad: [52, 56, 59, 64], arp: [64, 68, 71, 76] } as unknown as Chord;

type SectionIndex = 0 | 1 | 2 | 3 | 4;

// The kill-melody lanes: degrees 0-7 into the current chord's lead set (arp
// plus the same notes an octave up). Kills unmute the lane step by step, so a
// chained volley performs a real melodic run.
const KILL_LANES: Record<SectionIndex, number[]> = {
  // Injection — a gentle rising arch out of the breech.
  0: [
    0, 1, 2, 3, 2, 1, 2, 3,
    4, 3, 2, 3, 4, 5, 4, 3,
    2, 3, 4, 5, 4, 3, 4, 5,
    6, 5, 4, 5, 6, 7, 6, 4,
  ],
  // Stage-1 — driving stepwise motion locked to the four-on-the-floor.
  1: [
    0, 2, 1, 3, 2, 4, 3, 5,
    4, 2, 3, 1, 2, 0, 1, 3,
    4, 6, 5, 7, 6, 4, 5, 3,
    4, 2, 3, 5, 4, 6, 5, 7,
  ],
  // Stage-2 — syncopated octave zig-zags; dense volleys ring as broken chords.
  2: [
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 0, 5, 1, 6, 2, 7, 3,
    0, 4, 1, 5, 2, 6, 3, 7,
    4, 7, 6, 5, 4, 3, 2, 1,
  ],
  // Interlock — high descending peals answered by a climb back to the top.
  3: [
    7, 6, 5, 4, 7, 6, 5, 4,
    5, 4, 3, 2, 5, 4, 3, 2,
    3, 2, 1, 0, 3, 2, 1, 0,
    4, 5, 6, 7, 4, 5, 6, 7,
  ],
  // Muzzle — sparse and high; there is nothing left to kill, but the lane
  // must exist for the score to stay valid.
  4: [
    7, 5, 6, 4, 7, 5, 6, 4,
    7, 5, 6, 4, 7, 5, 6, 4,
    7, 5, 6, 4, 7, 5, 6, 4,
    7, 5, 6, 4, 7, 5, 6, 4,
  ],
};

// Per-section timbres for the player's instruments: glassy at the breech,
// tight and square in stage-1, bright saws in stage-2, dark reverb-heavy saws
// at the interlocks, quiet and hall-drenched at the muzzle.
type KillVoice = { oscillator: OscillatorType; decay: number; cutoff: number; gain: number; shimmer: number; hall: number };
const SECTION_VOICES: Record<SectionIndex, {
  kill: KillVoice;
  lock: { oscillator: OscillatorType; cutoff: number; gain: number };
  fire: { cutoff: number; noise: number };
}> = {
  0: {
    kill: { oscillator: 'sine', decay: 0.5, cutoff: 3200, gain: 0.17, shimmer: 0.3, hall: 0.2 },
    lock: { oscillator: 'triangle', cutoff: 2800, gain: 0.13 },
    fire: { cutoff: 1800, noise: 0.03 },
  },
  1: {
    kill: { oscillator: 'square', decay: 0.22, cutoff: 2600, gain: 0.14, shimmer: 0.45, hall: 0.15 },
    lock: { oscillator: 'square', cutoff: 2000, gain: 0.055 },
    fire: { cutoff: 2800, noise: 0.05 },
  },
  2: {
    kill: { oscillator: 'sawtooth', decay: 0.3, cutoff: 3400, gain: 0.15, shimmer: 0.6, hall: 0.2 },
    lock: { oscillator: 'sawtooth', cutoff: 2400, gain: 0.05 },
    fire: { cutoff: 3800, noise: 0.06 },
  },
  3: {
    kill: { oscillator: 'sawtooth', decay: 0.55, cutoff: 2300, gain: 0.16, shimmer: 0.75, hall: 0.55 },
    lock: { oscillator: 'sawtooth', cutoff: 2000, gain: 0.05 },
    fire: { cutoff: 3000, noise: 0.07 },
  },
  4: {
    kill: { oscillator: 'sine', decay: 0.8, cutoff: 2600, gain: 0.12, shimmer: 0.3, hall: 0.9 },
    lock: { oscillator: 'triangle', cutoff: 2200, gain: 0.09 },
    fire: { cutoff: 1500, noise: 0.02 },
  },
};

// The climbing hum: root MIDI per arrangement bar. Idles at E2, up a fourth by
// the middle, up an octave by the interlocks, then an accelerating rise to the
// charge peak. The shot cuts it dead in a heartbeat.
function humMidiForBar(barIndex: number) {
  const b = barIndex;
  if (b < 4) return 40;
  if (b < 16) return lerp(40, 45, (b - 4) / 12);
  if (b < 20) return lerp(45, 52, (b - 16) / 4);
  if (b < 26) return lerp(52, 57, (b - 20) / 6);
  if (b < 28) return lerp(57, 64, ((b - 26) / 2) ** 0.7);
  return 64;
}

export function createAudio(bus: EventBus) {
  return createMassDriverAudio(bus).audio;
}

export const traceMassDriverAudio = createAudioTraceHarness({
  level: 'mass-driver-detailed-m6vt',
  bpm: MASS_DRIVER_BPM,
  stepSeconds: SIXTEENTH,
  defaultSeconds: MASS_DRIVER_RUN_DURATION + 2,
  createAudio: createMassDriverAudio,
});

function createMassDriverAudio(bus: EventBus, trace?: AudioTraceSink) {
  let ctx: AudioContext | null = null;

  const score = createScore<Chord, SectionIndex>({
    bpm: MASS_DRIVER_BPM,
    stepsPerBar: STEPS_PER_BAR,
    chords: CHORDS,
    barsPerChord: 2,
    alternateChordSets: [
      { chords: [EM, F], barsPerChord: 2, fromBar: MASS_DRIVER_BARS.interlock, toBar: MASS_DRIVER_BARS.shot },
      { chords: [E_MAJOR], barsPerChord: 4, fromBar: MASS_DRIVER_BARS.shot, toBar: MASS_DRIVER_BARS.end },
    ],
    sections: MASS_DRIVER_SCORE_SECTIONS,
    killLanes: KILL_LANES,
  });

  // ---- the climbing hum -----------------------------------------------------
  // Detuned saws over a sine sub through a lowpass, running for the life of
  // the audio context. Steered bar by bar from the arrangement.
  type HumNodes = {
    saws: OscillatorNode[];
    sub: OscillatorNode;
    filter: BiquadFilterNode;
    gain: GainNode;
  };
  let hum: HumNodes | null = null;

  function buildHum(context: AudioContext, destination: AudioNode) {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 1.1;
    const gain = context.createGain();
    gain.gain.value = 0;
    filter.connect(gain).connect(destination);
    const saws = [-9, 9].map((detune) => {
      const osc = context.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFreq(40);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start();
      return osc;
    });
    const sub = context.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = midiToFreq(28);
    sub.connect(gain);
    sub.start();
    hum = { saws, sub, filter, gain };
    // Fade the idle hum in.
    gain.gain.setTargetAtTime(0.05, context.currentTime + 0.1, 0.8);
  }

  function steerHum(time: number, midi: number, cutoff: number, level: number, ramp: number) {
    if (trace) {
      trace.record(time, 'hum', { midi: Math.round(midi * 10) / 10, cutoff: Math.round(cutoff), level });
      return;
    }
    if (!hum) return;
    const freq = midiToFreq(midi);
    for (const saw of hum.saws) saw.frequency.linearRampToValueAtTime(freq, time + ramp);
    hum.sub.frequency.linearRampToValueAtTime(freq / 2, time + ramp);
    hum.filter.frequency.linearRampToValueAtTime(cutoff, time + ramp);
    hum.gain.gain.setTargetAtTime(level, time, ramp * 0.5);
  }

  function cutHum(time: number) {
    if (trace) {
      trace.record(time, 'humCut', {});
      return;
    }
    if (!hum) return;
    hum.gain.gain.cancelScheduledValues(time);
    hum.gain.gain.setValueAtTime(hum.gain.gain.value, time);
    hum.gain.gain.linearRampToValueAtTime(0, time + 0.05);
  }

  function idleHum(time: number, delay = 1.6) {
    if (trace) return;
    if (!hum) return;
    steerHum(time + delay, 40, 320, 0.05, 2.5);
  }

  const runtime = createBeatLevelAudio({
    bus,
    trace,
    stepSeconds: SIXTEENTH,
    volumeScale: 0.8,
    score,
    runAlignment: 'bar',
    beatNumber: 'absolute',
    mix: {
      compressor: { threshold: -18, ratio: 5, attack: 0.005, release: 0.22 },
      // The dotted delay and the long reverb of the brief.
      delay: { time: SIXTEENTH * 3, feedback: 0.32, dampHz: 2500 },
      reverb: { seconds: 2.8, decay: 2.1, level: 0.3 },
      noiseSeconds: 2,
    },
    onPostBuild(context, mix) {
      ctx = context;
      buildHum(context, mix.music);
    },
    onBeforeBeat(step) {
      // Steer the hum on every downbeat toward the next bar's target.
      if (step.step !== 0) return;
      if (step.mode !== 'run') {
        // Attract mode: a slow idle wobble around E2.
        const wobble = Math.sin(step.bar * 1.7) * 0.6;
        steerHum(step.time, 40 + wobble, 320, 0.05, BAR_SECONDS);
        return;
      }
      const targetBar = step.bar + 1;
      if (targetBar > MASS_DRIVER_BARS.shot) return; // cut by the shot one-shot
      const t = Math.min(1, step.bar / MASS_DRIVER_BARS.shot);
      steerHum(
        step.time,
        humMidiForBar(targetBar),
        320 + 2400 * t ** 1.6,
        0.05 + 0.055 * t,
        BAR_SECONDS,
      );
    },
    onStep: scheduleStep,
    onRunStart() {
      score.clearOverride();
    },
    onRunEnd() {
      const context = runtime.context();
      if (!context) return;
      // Death mid-bore also kills the spool-up; the run's end re-idles it.
      if (massDriverRunState.outcome !== 'fired') cutHum(context.currentTime + 0.02);
      idleHum(context.currentTime);
    },
    onDispose() {
      hum = null;
      ctx = null;
    },
  });

  const voices = createMassDriverVoices({ trace, context: () => ctx, mix: runtime.mix });
  const {
    kick, clap, hat, bass, acid, pad, arp, riser, klaxon, alarm, snare, impact, crash, clank, sparkle, noiseHit,
  } = voices;
  const sfxDestination = () => runtime.mix()?.sfx ?? runtime.mix()?.master ?? null;

  // ---- player voice specs ---------------------------------------------------

  const killLayerVoice = voice<{ killVoice: KillVoice }>({
    oscillators: [{ type: ({ killVoice }) => killVoice.oscillator, gain: ({ killVoice }) => killVoice.gain }],
    duration: ({ killVoice }) => killVoice.decay,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ killVoice }) => killVoice.cutoff },
    envelope: { decay: ({ killVoice }) => killVoice.decay },
  });

  const killBodyVoice = voice<{ decay: number; gain: number }>({
    oscillators: [{ type: 'sine', octave: -1, gain: 0.55 }],
    duration: ({ decay }) => decay,
    stopPadding: 0.05,
    gainAutomation: (time, gain, { decay }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay * 0.8 },
    ],
  });

  const lockVoice = voice<{ oscillator: OscillatorType; cutoff: number; gainValue: number; lockCount: number }>({
    oscillators: [{ type: ({ oscillator }) => oscillator, gain: ({ gainValue }) => gainValue }],
    duration: 0.1,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ cutoff, lockCount }) => cutoff + lockCount * 200 },
    envelope: { decay: 0.1 },
  });

  const fireVoice = voice<{ cutoff: number }>({
    oscillators: [{ type: 'sawtooth', gain: 0.085 }],
    duration: 0.08,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { decay: 0.08 },
  });

  const tickVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.09,
    stopPadding: 0.02,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.09 },
    ],
  });

  const chipVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle' }],
    duration: 0.12,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 4000 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
    ],
  });

  // Reject is a breaker trip: a dead low minor-second CLUNK falling into the
  // floor — cold iron, no reward.
  const rejectVoice = voice<{ vel: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.22,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: 420, Q: 2 },
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.4, time: time + 0.18 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.22 },
    ],
  });

  const stabVoice = voice<{ vel: number; cutoff: number }>({
    oscillators: [{ type: 'sawtooth' }],
    duration: 0.45,
    stopPadding: 0.05,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.42 },
    ],
  });

  // ---- arrangement ----------------------------------------------------------

  const blankBar = '................';
  const kick4 = 'K...K...K...K...';
  const kickSync = 'K...K...K...K.K.';
  const offbeatHat = '..h...h...h...h.';
  const latticeHat = 'hhHhhhhOhhHhhhhO';
  const clapBackbeat = '....C.......C...';
  const bassEighth = 'B.b.b.b.B.b.b.b.';
  const bassBusy = 'B.b.u.b.B.f.b.u.';
  const quarterArp = 'A...A...A...A...';

  const padTrack = (fromBar: number) =>
    hits<Chord>(fromBar % 2 === 0 ? 'P...............' + blankBar : blankBar + 'P...............', { P: 1 },
      ({ time, chord }) => pad(time, chord.pad, BAR_SECONDS * 2 * 1.02));

  const kickTrack = (pattern: string) => hits(pattern, { K: 1 }, ({ time }, vel) => kick(time, vel));

  const hatTrack = (pattern: string) =>
    hits(pattern, { h: 0.04, H: 0.085, O: 0.13 }, ({ time }, vel, symbol) => hat(time, vel, symbol === 'O' ? 0.18 : 0.03));

  const bassTrack = (pattern: string) =>
    hits<Chord>(pattern, { B: 1, b: 0.72, u: 0.72, f: 0.72 }, ({ time, chord }, vel, symbol) => {
      const offset = symbol === 'u' ? 12 : symbol === 'f' ? 7 : 0;
      bass(time, chord.bass + offset, vel);
    });

  const arpTrack = (vel: number, octave = 0) =>
    hits<Chord>(quarterArp, { A: vel }, ({ time, step, chord }, velocity) => {
      arp(time, chord.arp[(step / 4) % chord.arp.length] + octave * 12, velocity);
    });

  // The 303 walks the chord across the sixteenth grid.
  const acidTrack = () =>
    fn<Chord>(({ time, step, chord }) => {
      const order = [0, 2, 1, 3, 0, 3, 2, 1];
      const octaveDrop = step % 4 === 2 ? -12 : 0;
      const accent = step % 8 === 0 ? 1 : step % 4 === 0 ? 0.55 : 0.2;
      if (step % 2 !== 0) return;
      acid(time, chord.arp[order[(step / 2) % order.length]] - 12 + octaveDrop, 0.85, accent);
    });

  // Injection: sparse downbeat kick with ghost kicks creeping in bar by bar.
  const injectionKick = fn<Chord>(({ time, barInSection, step }) => {
    const patterns = ['K...............', 'K.......k.......', 'K...k...k.......', 'K...k...k...k...'];
    const symbol = patterns[Math.min(3, barInSection)][step];
    if (symbol === 'K') kick(time, 1);
    if (symbol === 'k') kick(time, 0.7);
  });

  const injectionArp = fn<Chord>(({ time, barInSection, step, chord }) => {
    if (step % 4 !== 0) return;
    // A quarter-note arp climbing in velocity toward the drop.
    const vel = 0.22 + barInSection * 0.09 + (step / 16) * 0.05;
    arp(time, chord.arp[(step / 4) % chord.arp.length], vel);
  });

  // Interlock: rising alarm sweeps every couple of bars, a riser that grows
  // each bar, and the final bar's snare roll building all the way to the shot.
  const alarmTrack = fn<Chord>(({ time, barInSection, step }) => {
    if (step !== 8 || barInSection % 2 !== 0 || barInSection < 2) return;
    alarm(time, 500 + barInSection * 140, 1400 + barInSection * 420);
  });

  const interlockRiser = fn<Chord>(({ time, barInSection, step }) => {
    if (step !== 0) return;
    riser(time, BAR_SECONDS, 0.035 + barInSection * 0.014);
  });

  const snareRoll = fn<Chord>(({ time, barInSection, step }) => {
    if (barInSection !== 7) return;
    const t = step / 16;
    snare(time, 0.06 + t * 0.3);
    if (step >= 8) snare(time + THIRTYSECOND, 0.05 + t * 0.2);
  });

  // The muzzle downbeat: impact, crash, a hard duck, the hum cut, and a huge
  // E-major pad bloom — or, with interlocks still standing, the detonation.
  function scheduleShotDownbeat(time: number) {
    const mix = runtime.mix();
    cutHum(time);
    if (massDriverRunState.interlocksAlive > 0 || massDriverRunState.outcome === 'detonated') {
      // Containment failure: a long low sub rumble and filtered noise.
      impact(time, 1);
      if (ctx && mix) {
        mix.duckAt(time, 0.06, 3);
        noiseHit(time, 0.4, 2.4, 'lowpass', 500, mix.master);
        playOscillatorVoice({
          context: ctx,
          time,
          stopTime: time + 3.2,
          oscillatorType: 'sine',
          frequency: 52,
          frequencyAutomation: [{ type: 'exponentialRamp', value: 26, time: time + 2.6 }],
          gainAutomation: [
            { type: 'set', value: 0.5, time },
            { type: 'exponentialRamp', value: 0.001, time: time + 3 },
          ],
          destination: mix.master,
        });
      }
      return;
    }
    impact(time, 1);
    crash(time, 1);
    mix?.duckAt(time, 0.1, 1.4);
    // The E-major bloom: the Picardy third, wide and slow.
    pad(time + 0.05, [40, 52, 56, 59, 64, 68], BAR_SECONDS * 4);
  }

  const muzzleSparkle = fn<Chord>(({ time, barInSection, step, chord }) => {
    if (barInSection < 1) return;
    // Only glassy sparkle delays and a subsiding sub pulse, fading to silence.
    if (step === 0 && barInSection <= 2) impact(time, 0.14 - barInSection * 0.05);
    const sparkleSteps = [0, 6, 12];
    if (!sparkleSteps.includes(step)) return;
    const fade = Math.max(0, 1 - (barInSection - 1) * 0.34);
    sparkle(time, chord.arp[(step / 2 + barInSection) % chord.arp.length] + 12, 0.5 * fade);
  });

  const ambientArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    sections: [{
      name: 'ambient',
      fromBar: 0,
      tracks: [
        padTrack(0),
        hits('A...A...A...A...', { A: 0.4 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 4) % chord.arp.length], vel)),
      ],
    }],
  });

  const runArrangement = createArrangement<Chord>({
    stepsPerBar: STEPS_PER_BAR,
    chordAt: score.chordAt,
    trace,
    emitSections: true,
    sections: [
      {
        name: 'injection',
        fromBar: MASS_DRIVER_BARS.injection,
        toBar: MASS_DRIVER_BARS.stage1,
        tracks: [
          injectionKick,
          injectionArp,
          hits('........h.....h.', { h: 0.035 }, ({ time }, vel) => hat(time, vel, 0.03)),
          padTrack(0),
          oneShot(3, 0, ({ time }) => riser(time, BAR_SECONDS, 0.1)),
        ],
      },
      {
        name: 'stage-1',
        fromBar: MASS_DRIVER_BARS.stage1,
        toBar: MASS_DRIVER_BARS.stage2,
        tracks: [
          kickTrack(kick4),
          hatTrack(offbeatHat),
          bassTrack(bassEighth),
          padTrack(0),
          hits('A.......A.......', { A: 0.4 }, ({ time, step, chord }, vel) => arp(time, chord.arp[(step / 8) % chord.arp.length], vel)),
          oneShot(7, 0, ({ time }) => riser(time, BAR_SECONDS, 0.09)),
        ],
      },
      {
        name: 'stage-2',
        fromBar: MASS_DRIVER_BARS.stage2,
        toBar: MASS_DRIVER_BARS.interlock,
        tracks: [
          kickTrack(kick4),
          hits(clapBackbeat, { C: 1 }, ({ time }) => clap(time)),
          hatTrack(latticeHat),
          bassTrack(bassBusy),
          arpTrack(0.4, 1),
          acidTrack(),
          padTrack(0),
          oneShot(7, 0, ({ time }) => riser(time, BAR_SECONDS, 0.11)),
        ],
      },
      {
        name: 'interlock',
        fromBar: MASS_DRIVER_BARS.interlock,
        toBar: MASS_DRIVER_BARS.shot,
        tracks: [
          kickTrack(kickSync),
          hatTrack(latticeHat),
          bassTrack(bassEighth),
          padTrack(0),
          acidTrack(),
          // A two-bar klaxon and a low impact open the section.
          fn(({ time, barInSection, step }) => {
            if (barInSection < 2 && step % 8 === 0) klaxon(time, 68 - barInSection * 1, 1 - step / 24);
          }),
          oneShot(0, 0, ({ time }) => impact(time, 0.8)),
          alarmTrack,
          interlockRiser,
          snareRoll,
        ],
      },
      {
        name: 'muzzle',
        fromBar: MASS_DRIVER_BARS.shot,
        toBar: MASS_DRIVER_BARS.end,
        tracks: [
          oneShot(0, 0, ({ time }) => scheduleShotDownbeat(time)),
          muzzleSparkle,
        ],
      },
    ],
  });

  function scheduleStep({ position, time, mode }: BeatLevelAudioStep) {
    if (mode === 'ambient') ambientArrangement.schedule(position, time);
    else runArrangement.schedule(position, time);
  }

  // ---- the player is the soloist -------------------------------------------

  function sectionLayersAt(position: number): Array<[SectionIndex, number]> {
    const mix: SectionMix<SectionIndex> = score.sectionMixAt(position);
    return mix.from === mix.to ? [[mix.to, 1]] : [[mix.from, 1 - mix.t], [mix.to, mix.t]];
  }

  function killNote(time: number, position: number, chain: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend || !audioMix.reverbSend) return;
    const sectionMix = score.sectionMixAt(position);
    const laneSection = sectionMix.t >= 0.5 ? sectionMix.to : sectionMix.from;
    const degree = KILL_LANES[laneSection][position % LANE_STEPS];
    const midi = score.leadSetAt(position)[degree];
    if (midi === undefined) return;
    const vel = Math.min(1.35, 1 + chain * 0.12);
    for (const [section, weight] of sectionLayersAt(position)) {
      if (weight < 0.02) continue;
      const killVoice = SECTION_VOICES[section].kill;
      killLayerVoice.play({
        context: ctx,
        time,
        midi,
        killVoice,
        velocity: vel,
        weight,
        destination: output,
        sends: [
          { destination: audioMix.delaySend, gain: 0.45 },
          { destination: audioMix.reverbSend, gain: killVoice.hall },
        ],
      });
    }
    const toVoice = SECTION_VOICES[sectionMix.to].kill;
    killBodyVoice.play({ context: ctx, time, midi, decay: toVoice.decay, gain: toVoice.gain, velocity: vel, destination: output });
    if (chain >= 2) {
      killLayerVoice.play({
        context: ctx,
        time,
        midi: midi + 12,
        killVoice: { ...toVoice, gain: toVoice.gain * 0.4 },
        destination: output,
        sends: [{ destination: audioMix.delaySend, gain: 0.5 }],
      });
    }
    noiseHit(time, 0.045 * toVoice.shimmer + 0.025, 0.07, 'highpass', 5400, output);
  }

  // Each interlock kill plays a climbing confirmation — one more note than the
  // last, brighter and higher each time, capped with an ignition ping and a
  // clamp-release clank that drops in pitch per interlock.
  function interlockConfirmation(count: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend || !audioMix.reverbSend) return;
    const delaySend = audioMix.delaySend;
    const reverbSend = audioMix.reverbSend;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    const noteAt = (index: number) => {
      const degree = count - 1 + index;
      return lead[degree % lead.length] + 12 * Math.floor(degree / lead.length);
    };
    let lastMidi = lead[0];
    for (let index = 0; index < count; index += 1) {
      const at = time + index * SIXTEENTH;
      const midi = noteAt(index);
      lastMidi = midi;
      playOscillatorVoice({
        context: ctx,
        time: at,
        stopTime: at + 0.3,
        oscillatorType: 'square',
        frequency: midiToFreq(midi),
        filter: { type: 'lowpass', frequency: 1900 + count * 380 },
        gainAutomation: [
          { type: 'set', value: 0.075 + count * 0.012, time: at },
          { type: 'exponentialRamp', value: 0.001, time: at + 0.26 },
        ],
        destination: output,
        sends: [{ destination: delaySend, gain: 0.4 }, { destination: reverbSend, gain: 0.3 }],
      });
    }
    const pingAt = time + count * SIXTEENTH;
    tickVoice.play({ context: ctx, time: pingAt, midi: lastMidi + 12, vel: 0.12 + count * 0.015, destination: output, sends: [{ destination: delaySend, gain: 0.55 }] });
    clank(time, 250 * (1 - (count - 1) * 0.085), 0.9);

    if (count >= 6) sixthInterlockFinale(pingAt + SIXTEENTH);
  }

  // The sixth interlock: a beat of ducked silence, an impact, a high chord
  // stab, and a conclusive descent.
  function sixthInterlockFinale(time: number) {
    const output = sfxDestination();
    const audioMix = runtime.mix();
    if (!ctx || !output || !audioMix?.delaySend || !audioMix.reverbSend) return;
    const delaySend = audioMix.delaySend;
    audioMix.duckAt(time, 0.12, MASS_DRIVER_TIME.beatSeconds);
    impact(time + MASS_DRIVER_TIME.beatSeconds * 0.5, 0.7);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    for (const midi of chord.pad) {
      stabVoice.play({ context: ctx, time: time + MASS_DRIVER_TIME.beatSeconds * 0.5, midi: midi + 24, vel: 0.05, cutoff: 3000, destination: output, sends: [{ destination: delaySend, gain: 0.5 }] });
    }
    const lead = score.leadSetAt(position);
    [7, 6, 5, 3, 1, 0].forEach((degree, index) => {
      if (!ctx) return;
      const at = time + MASS_DRIVER_TIME.beatSeconds * 0.5 + index * SIXTEENTH;
      tickVoice.play({ context: ctx, time: at, midi: lead[degree], vel: 0.11 - index * 0.012, destination: output, sends: [{ destination: delaySend, gain: 0.5 }] });
    });
  }

  // Track interlock ids from their spawn events so interlock kills can play
  // the climbing confirmation instead of the ordinary kill lane.
  const interlockIds = new Set<number>();
  bus.on('runstart', () => interlockIds.clear());
  bus.on('spawn', ({ kind, enemyId }) => {
    if (kind === 'interlock') interlockIds.add(enemyId);
    if (kind === 'arc' && ctx) {
      // The unstable "this is incoming" tell: a short arc sizzle.
      const output = sfxDestination();
      if (output) noiseHit(ctx.currentTime, 0.05, 0.16, 'highpass', 4600, output);
    }
  });

  bus.on('kill', ({ enemyId, indexInVolley }) => {
    if (!ctx) return;
    if (interlockIds.delete(enemyId)) {
      interlockConfirmation(Math.max(1, massDriverRunState.interlocksDown));
      return;
    }
    const kill = score.nextKill(ctx.currentTime);
    const position = Math.max(0, kill.step - score.arrangementStart);
    killNote(kill.time, position, indexInVolley ?? 0);
  });

  bus.on('lock', ({ lockCount }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (!ctx || !output || !mix?.delaySend) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const lead = score.leadSetAt(position);
    // Locks walk up the live lead by lock count; the sixth lock is ignition.
    const midi = lead[Math.min(lead.length - 1, Math.max(0, lockCount - 1))];
    for (const [section, weight] of sectionLayersAt(position)) {
      if (weight < 0.02) continue;
      const voiceSpec = SECTION_VOICES[section].lock;
      lockVoice.play({
        context: ctx,
        time,
        midi,
        oscillator: voiceSpec.oscillator,
        cutoff: voiceSpec.cutoff,
        gainValue: voiceSpec.gain,
        lockCount,
        weight,
        destination: output,
        sends: [{ destination: mix.delaySend, gain: 0.35 }],
      });
    }
    if (lockCount >= 6) {
      // Ignition: an octave ping and a falling sub thump.
      tickVoice.play({ context: ctx, time, midi: midi + 12, vel: 0.14, destination: output, sends: [{ destination: mix.delaySend, gain: 0.5 }] });
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.3,
        oscillatorType: 'sine',
        frequency: 130,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 42, time: time + 0.2 }],
        gainAutomation: [
          { type: 'set', value: 0.26, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
        ],
        destination: output,
      });
    }
  });

  bus.on('unlock', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // Unlock answers with a soft high tick.
    const time = score.quantizePlayerAction(ctx.currentTime);
    const lead = score.leadSetAt(score.arrangementPositionAt(time));
    tickVoice.play({ context: ctx, time, midi: lead[lead.length - 1] + 12, vel: 0.035, destination: output });
  });

  bus.on('fire', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = score.quantizePlayerAction(ctx.currentTime);
    const position = score.arrangementPositionAt(time);
    const sectionMix = score.sectionMixAt(position);
    const fromFire = SECTION_VOICES[sectionMix.from].fire;
    const toFire = SECTION_VOICES[sectionMix.to].fire;
    const cutoff = lerp(fromFire.cutoff, toFire.cutoff, sectionMix.t);
    const noise = lerp(fromFire.noise, toFire.noise, sectionMix.t);
    // Fire is a short falling zap rooted on the live chord.
    const root = score.chordAt(position).bass;
    fireVoice.play({
      context: ctx,
      time,
      midi: root + 36,
      cutoff,
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(root + 24), time: time + 0.07 }],
      destination: output,
    });
    noiseHit(time, noise, 0.02, 'highpass', 3200, output);
  });

  // Armor chips tick a soft arpeggio; stage breaks crack metallically and
  // ring a chord tone into the hall.
  bus.on('hit', ({ lethal, stageCompleted }) => {
    const output = sfxDestination();
    const mix = runtime.mix();
    if (lethal || !ctx || !output || !mix?.delaySend || !mix.reverbSend) return;
    const delaySend = mix.delaySend;
    const reverbSend = mix.reverbSend;
    const time = score.nextGridTime(ctx.currentTime, 0.5);
    const position = score.arrangementPositionAt(time);
    const chord = score.chordAt(position);
    if (stageCompleted) {
      clank(time, 300, 0.8);
      playOscillatorVoice({
        context: ctx,
        time,
        stopTime: time + 0.9,
        oscillatorType: 'triangle',
        frequency: midiToFreq(chord.arp[2]),
        gainAutomation: [
          { type: 'set', value: 0.1, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.85 },
        ],
        destination: output,
        sends: [{ destination: reverbSend, gain: 0.9 }],
      });
      return;
    }
    ([[0, 0.07], [1, 0.055], [2, 0.045]] as const).forEach(([index, vel]) => {
      if (!ctx) return;
      chipVoice.play({ context: ctx, time: time + THIRTYSECOND * index, midi: chord.arp[index] + 12, vel, destination: output, sends: [{ destination: delaySend, gain: 0.35 }] });
    });
  });

  // A full clean volley lands a chord stab an octave up.
  bus.on('volley', ({ size, kills }) => {
    const mix = runtime.mix();
    if (!ctx || !mix?.duck || !mix.delaySend || kills < 4 || kills < size) return;
    const time = score.nextGridTime(ctx.currentTime, 4);
    const chord = score.chordAt(score.arrangementPositionAt(time));
    for (const midi of chord.pad) {
      stabVoice.play({ context: ctx, time, midi: midi + 12, vel: kills === 6 ? 0.07 : 0.05, cutoff: 2500, destination: mix.duck, sends: [{ destination: mix.delaySend, gain: 0.5 }] });
    }
    noiseHit(time, kills === 6 ? 0.1 : 0.06, 0.3, 'highpass', 6600, mix.duck);
  });

  bus.on('reject', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    // Breaker trip: E and F together, dead and dry, falling into the floor.
    rejectVoice.play({ context: ctx, time, midi: 40, vel: 0.2, destination: output });
    rejectVoice.play({ context: ctx, time: time + 0.02, midi: 41, vel: 0.15, destination: output });
    noiseHit(time, 0.13, 0.08, 'bandpass', 650, output);
  });

  // A player hit booms a falling octave under a two-note hull alarm.
  bus.on('playerhit', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.5,
      oscillatorType: 'sine',
      frequency: midiToFreq(52),
      frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(40), time: time + 0.3 }],
      gainAutomation: [
        { type: 'set', value: 0.4, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.45 },
      ],
      destination: output,
    });
    [76, 71].forEach((midi, index) => {
      if (!ctx) return;
      tickVoice.play({ context: ctx, time: time + index * 0.12, midi, vel: 0.1, destination: output });
    });
    noiseHit(time, 0.18, 0.13, 'bandpass', 900, output);
  });

  bus.on('miss', () => {
    const output = sfxDestination();
    if (!ctx || !output) return;
    // A barely-there falling tick.
    const time = ctx.currentTime;
    playOscillatorVoice({
      context: ctx,
      time,
      stopTime: time + 0.13,
      oscillatorType: 'sine',
      frequency: 480,
      frequencyAutomation: [{ type: 'exponentialRamp', value: 210, time: time + 0.1 }],
      gainAutomation: [
        { type: 'set', value: 0.035, time },
        { type: 'exponentialRamp', value: 0.001, time: time + 0.11 },
      ],
      destination: output,
    });
  });

  return runtime;
}
