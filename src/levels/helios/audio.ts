import type { EventBus } from '../../events';
import { createBrowserAudioContext, installAudioUnlock } from '../../engine/audio-unlock';
import { emitBeatAt, midiToFreq, quantizeToGrid } from '../../engine/music';
import { HELIOS_BPM } from './gameplay';

// The Helios score: 172 BPM drum & bass in E minor, 86 bars = exactly the
// 120-second run. Sections land on the run's set pieces — drop 1 at the gate
// (bar 16), drop 2 at the corona plunge (bar 40), a breakdown while the
// serpent breaches (56–63), and the boss theme (64–79) with a phrygian F
// leaning on the tonic. The player's guns are pitched in E minor pentatonic
// and quantized to the 32nd grid, so good play sounds like percussion fills.

const SIXTEENTH = 60 / HELIOS_BPM / 4;
const THIRTYSECOND = SIXTEENTH / 2;
const SCHEDULE_AHEAD = 0.18;
const SCHEDULER_MS = 25;

type Chord = { bass: number; pad: number[]; arp: number[]; stab: number[] };

// Em — C — Am — B, two bars each.
const CHORDS: Chord[] = [
  { bass: 28, pad: [52, 55, 59, 64], arp: [64, 67, 71, 76], stab: [64, 67, 71] }, // Em
  { bass: 36, pad: [48, 55, 60, 64], arp: [60, 64, 67, 72], stab: [64, 67, 72] }, // C
  { bass: 33, pad: [45, 52, 57, 60], arp: [57, 60, 64, 69], stab: [60, 64, 69] }, // Am
  { bass: 35, pad: [47, 51, 54, 59], arp: [59, 63, 66, 71], stab: [63, 66, 71] }, // B
];
// Boss section: Em — F — Em — B. The F natural is the serpent.
const BOSS_CHORDS: Chord[] = [
  CHORDS[0],
  { bass: 29, pad: [53, 57, 60, 65], arp: [65, 69, 72, 77], stab: [65, 69, 72] }, // F
  CHORDS[0],
  CHORDS[3],
];

// E minor pentatonic, rising per lock; the sixth lock is ignition.
const LOCK_SCALE = [64, 67, 69, 71, 74, 76];

// Boss lead theme, one 8-bar phrase played twice. [bar, step(8ths), midi, beats]
const LEAD_THEME: Array<[number, number, number, number]> = [
  [0, 0, 76, 1.5], [0, 3, 74, 0.5], [0, 4, 76, 2],
  [1, 0, 79, 1], [1, 2, 77, 1], [1, 4, 76, 1], [1, 6, 74, 1],
  [2, 0, 76, 3],
  [3, 0, 71, 1], [3, 2, 74, 1], [3, 4, 76, 0.5], [3, 5, 74, 0.5], [3, 6, 71, 1],
  [4, 0, 77, 2], [4, 4, 76, 1], [4, 6, 74, 1],
  [5, 0, 76, 1], [5, 2, 74, 1], [5, 4, 71, 1], [5, 6, 69, 1],
  [6, 0, 71, 3.5],
];

export function createAudio(bus: EventBus) {
  let ctx: AudioContext | null = null;
  let intervalId = 0;
  let unlockGestureStart: (() => void) | null = null;
  let nextTickTime = 0;
  let sixteenthIndex = 0;
  let arrangementStart = 0;
  let mode: 'run' | 'ambient' = 'ambient';
  let masterVolume = 0.8;
  let heartId = -1;

  let master: GainNode | null = null;
  let duck: GainNode | null = null;
  let delaySend: GainNode | null = null;
  let reverbSend: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;

  const start = async () => {
    if (!ctx) {
      ctx = createBrowserAudioContext();
      buildGraph(ctx);
      nextTickTime = ctx.currentTime + 0.06;
      intervalId = window.setInterval(schedule, SCHEDULER_MS);
    }
    if (ctx.state === 'suspended') await ctx.resume();
  };

  const installGestureStart = () => {
    unlockGestureStart?.();
    unlockGestureStart = installAudioUnlock(start);
  };

  function buildGraph(context: AudioContext) {
    master = context.createGain();
    master.gain.value = masterVolume;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    master.connect(compressor).connect(context.destination);

    duck = context.createGain();
    duck.connect(master);

    // Dotted-eighth feedback delay: where the arp and lead live.
    delaySend = context.createGain();
    const delay = context.createDelay(1);
    delay.delayTime.value = SIXTEENTH * 3;
    const feedback = context.createGain();
    feedback.gain.value = 0.32;
    const damp = context.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2400;
    delaySend.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    damp.connect(duck);

    // Generated-impulse hall: the "cathedral of fire" space for choir and hits.
    reverbSend = context.createGain();
    const convolver = context.createConvolver();
    convolver.buffer = makeImpulse(context, 2.4, 2.6);
    const reverbLevel = context.createGain();
    reverbLevel.gain.value = 0.5;
    reverbSend.connect(convolver).connect(reverbLevel).connect(duck);

    noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 2), context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

    // The star itself: an endless low rumble under everything.
    const rumbleSource = context.createBufferSource();
    rumbleSource.buffer = noiseBuffer;
    rumbleSource.loop = true;
    const rumbleFilter = context.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 90;
    rumbleFilter.Q.value = 0.6;
    const rumbleGain = context.createGain();
    rumbleGain.gain.value = 0.16;
    const rumbleLfo = context.createOscillator();
    rumbleLfo.frequency.value = 0.11;
    const rumbleLfoGain = context.createGain();
    rumbleLfoGain.gain.value = 0.05;
    rumbleLfo.connect(rumbleLfoGain).connect(rumbleGain.gain);
    rumbleSource.connect(rumbleFilter).connect(rumbleGain).connect(master);
    rumbleSource.start();
    rumbleLfo.start();
  }

  function makeImpulse(context: AudioContext, seconds: number, decay: number) {
    const length = Math.floor(context.sampleRate * seconds);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
      }
    }
    return impulse;
  }

  // ---- scheduler ------------------------------------------------------------

  function schedule() {
    if (!ctx) return;
    while (nextTickTime < ctx.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(sixteenthIndex, nextTickTime);
      nextTickTime += SIXTEENTH;
      sixteenthIndex += 1;
    }
  }

  function scheduleStep(index: number, time: number) {
    const position = Math.max(0, index - arrangementStart);
    const step = position % 16;
    const barIndex = Math.floor(position / 16);

    if (position % 4 === 0) {
      emitBeatAt(bus, ctx as AudioContext, time, Math.floor(position / 4), step === 0);
    }

    if (mode === 'ambient') {
      const chord = CHORDS[Math.floor(barIndex / 2) % CHORDS.length];
      if (step === 0 && barIndex % 2 === 0) choir(time, chord.pad, 32 * SIXTEENTH * 1.06, 0.7);
      if (step % 4 === 0) arp(time, chord.arp[(step / 4) % chord.arp.length], 0.4);
      return;
    }

    const inBoss = barIndex >= 64 && barIndex < 80;
    const chordSet = inBoss ? BOSS_CHORDS : CHORDS;
    const chord = chordSet[Math.floor(barIndex / 2) % chordSet.length];

    // ---- section router: 0 intro · 8 build · 16 drop1 · 32 shift · 40 drop2
    //      · 56 breakdown · 64 boss · 80 outro
    if (barIndex < 8) {
      if (step === 0 && barIndex % 4 === 0) choir(time, chord.pad, 64 * SIXTEENTH * 1.02, 0.8);
      if (step % 2 === 0) arp(time, chord.arp[(step / 2) % chord.arp.length], 0.28 + barIndex * 0.04);
      if (step === 0 && barIndex >= 4) kick(time, 0.7);
      if (step === 8 && barIndex >= 6) kick(time, 0.5);
      if (barIndex >= 4 && step % 4 === 2) hat(time, 0.035, 0.025);
      return;
    }

    if (barIndex < 16) {
      if (step === 0 || step === 10) kick(time, step === 0 ? 0.95 : 0.85);
      if (step === 12) snare(time, 0.8);
      if (step % 2 === 0) hat(time, step % 4 === 2 ? 0.07 : 0.04, 0.03);
      if (step === 0 || step === 6 || step === 11) bass(time, chord.bass, 0.72, 0.5);
      if (step % 2 === 0) arp(time, chord.arp[(step / 2) % chord.arp.length], 0.55);
      if (step === 0 && barIndex % 4 === 0) choir(time, chord.pad, 64 * SIXTEENTH * 1.02, 0.7);
      if (barIndex === 14 && step === 0) riser(time, 32 * SIXTEENTH, 0.2);
      if (barIndex === 15 && step >= 8) snare(time, 0.25 + (step - 8) * 0.07); // roll into the gate
      return;
    }

    if (barIndex < 56) {
      const drop2 = barIndex >= 40;
      const shift = barIndex >= 32 && barIndex < 40;
      if (step === 0 && (barIndex === 16 || barIndex === 40)) impact(time, drop2 ? 1.1 : 1);

      // Two-step core; drop 2 adds the third kick and a ride.
      if (step === 0 || step === 10 || (drop2 && step === 6)) kick(time, step === 0 ? 1 : 0.88);
      if (step === 4 || step === 12) snare(time, 0.9);
      const ghostStep = barIndex % 2 === 0 ? 7 : 15;
      if (step === ghostStep) snare(time, 0.3);
      if (shift && barIndex % 2 === 1 && step === 14) snare(time, 0.42);
      if (step % 2 === 0) hat(time, step % 4 === 2 ? 0.085 : 0.045, 0.028);
      else if (drop2 || shift) hat(time, 0.028, 0.02);
      if (drop2 && step % 4 === 0) ride(time, 0.05);
      if ((barIndex >= 20 && barIndex % 8 === 4 || drop2 && barIndex % 4 === 2) && step === 2) openHat(time, 0.1);

      const bassSteps: Record<number, [number, number]> = drop2
        ? { 0: [0, 1], 3: [0, 0.75], 5: [12, 0.6], 6: [7, 0.8], 8: [0, 0.9], 11: [0, 0.7], 13: [3, 0.6], 14: [7, 0.8] }
        : { 0: [0, 1], 3: [0, 0.75], 6: [7, 0.8], 8: [0, 0.9], 11: [0, 0.7], 14: [7, 0.8] };
      if (step in bassSteps) bass(time, chord.bass + bassSteps[step][0], bassSteps[step][1], drop2 ? 0.9 : 0.7);

      const order = [0, 2, 1, 3, 2, 0, 3, 1];
      const octave = drop2 && step >= 8 ? 12 : 0;
      if (step % 2 === 0) arp(time, chord.arp[order[(step / 2) % order.length]] + octave, drop2 ? 0.8 : 0.62);
      if (step === 0 && barIndex % 2 === 0) stab(time, chord.stab, drop2 ? 0.85 : 0.65);
      if (step === 0 && barIndex % 8 === 0) choir(time, chord.pad, 64 * SIXTEENTH, 0.55);
      if (barIndex === 38 && step === 0) riser(time, 32 * SIXTEENTH, 0.22);
      return;
    }

    if (barIndex < 64) {
      // Breakdown: the drums die, the serpent stirs.
      if (step === 0) kick(time, 0.55);
      if (step === 0 && barIndex % 2 === 0) choir(time, chord.pad, 32 * SIXTEENTH * 1.05, 1);
      if (step % 4 === 0) arp(time, chord.arp[(step / 4) % chord.arp.length], 0.3);
      // Alarm: low B against F — the tritone under the reveal.
      if (barIndex >= 58 && step === 0) alarmSwell(time, barIndex % 2 === 0 ? 47 : 53, 16 * SIXTEENTH);
      if (barIndex === 62 && step === 0) riser(time, 32 * SIXTEENTH, 0.26);
      if (barIndex === 63) snare(time, 0.16 + step * 0.05); // full-bar roll into the boss theme
      return;
    }

    if (barIndex < 80) {
      if (step === 0 && barIndex === 64) {
        impact(time, 1.25);
        crash(time, 0.3);
      }
      if (step === 0 || step === 10 || (barIndex % 2 === 1 && step === 6)) kick(time, step === 0 ? 1 : 0.9);
      if (step === 4 || step === 12) snare(time, 0.95);
      if (step === (barIndex % 2 === 0 ? 7 : 11)) snare(time, 0.32);
      if (barIndex % 4 === 3 && step === 14) snare(time, 0.5);
      if (step % 2 === 0) hat(time, step % 4 === 2 ? 0.09 : 0.05, 0.028);
      else hat(time, 0.03, 0.02);
      if (step % 4 === 2) ride(time, 0.05);

      const bossBass: Record<number, [number, number]> = {
        0: [0, 1], 2: [0, 0.6], 3: [0, 0.8], 6: [7, 0.85], 8: [0, 0.95], 10: [12, 0.6], 11: [0, 0.75], 14: [1, 0.7],
      };
      if (step in bossBass) bass(time, chord.bass + bossBass[step][0], bossBass[step][1], 1);
      if (step === 0 && barIndex % 2 === 0) stab(time, chord.stab, 0.9);
      if (step === 0 && barIndex % 8 === 0) choir(time, chord.pad, 128 * SIXTEENTH, 0.5);

      const themeBar = (barIndex - 64) % 8;
      if (step % 2 === 0) {
        for (const [noteBar, noteStep, midi, beats] of LEAD_THEME) {
          if (noteBar === themeBar && noteStep === step / 2) lead(time, midi, beats * 4 * SIXTEENTH, 0.85);
        }
      }
      return;
    }

    // Outro: ride the wave out.
    if (barIndex < 86) {
      const fade = 1 - (barIndex - 80) / 7;
      if (step === 0 || step === 10) kick(time, 0.85 * fade);
      if (step === 12) snare(time, 0.7 * fade);
      if (step % 2 === 0) hat(time, 0.05 * fade, 0.03);
      if ((step === 0 || step === 8) && barIndex < 84) bass(time, chord.bass, 0.7 * fade, 0.5);
      if (step % 2 === 0) arp(time, chord.arp[(step / 2) % chord.arp.length], 0.5 * fade);
      if (step === 0 && barIndex === 80) choir(time, [52, 55, 59, 64, 66], 96 * SIXTEENTH, 0.9); // Em(add9)
      if (step === 0 && barIndex === 85) {
        kick(time, 1);
        crash(time, 0.25);
      }
    }
  }

  const quantize = (time: number) => quantizeToGrid(time, THIRTYSECOND);

  // ---- instruments ------------------------------------------------------------

  function kick(time: number, vel: number) {
    if (!ctx || !master || !duck) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(165, time);
    osc.frequency.exponentialRampToValueAtTime(44, time + 0.09);
    gain.gain.setValueAtTime(0.52 * vel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    osc.connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + 0.18);
    noiseHit(time, 0.09 * vel, 0.004, 'highpass', 1500, master);
    duck.gain.cancelScheduledValues(time);
    duck.gain.setValueAtTime(0.4, time);
    duck.gain.linearRampToValueAtTime(1, time + 0.16);
  }

  function snare(time: number, vel: number) {
    if (!ctx || !master) return;
    noiseHit(time, 0.2 * vel, 0.075, 'bandpass', 1750, master);
    noiseHit(time, 0.1 * vel, 0.03, 'highpass', 5200, master);
    const body = ctx.createOscillator();
    const gain = ctx.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(215, time);
    body.frequency.exponentialRampToValueAtTime(130, time + 0.05);
    gain.gain.setValueAtTime(0.14 * vel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    body.connect(gain).connect(master);
    body.start(time);
    body.stop(time + 0.09);
  }

  function hat(time: number, vel: number, decay: number) {
    if (!duck) return;
    noiseHit(time, vel, decay, 'highpass', 8200, duck);
  }

  function openHat(time: number, vel: number) {
    if (!duck) return;
    noiseHit(time, vel, 0.18, 'highpass', 7400, duck);
  }

  function ride(time: number, vel: number) {
    if (!duck) return;
    noiseHit(time, vel, 0.14, 'bandpass', 9800, duck);
  }

  function crash(time: number, vel: number) {
    if (!master || !reverbSend) return;
    noiseHit(time, vel, 0.9, 'highpass', 4600, master);
    noiseHit(time, vel * 0.5, 1.4, 'bandpass', 7200, reverbSend);
  }

  // Reese + sub: two saws detuned ±14 cents an octave up, sine at the root.
  function bass(time: number, midi: number, vel: number, growl: number) {
    if (!ctx || !duck) return;
    const dur = 0.21;
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.value = midiToFreq(midi);
    subGain.gain.setValueAtTime(0, time);
    subGain.gain.linearRampToValueAtTime(0.26 * vel, time + 0.008);
    subGain.gain.setValueAtTime(0.26 * vel, time + dur * 0.7);
    subGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    sub.connect(subGain).connect(duck);
    sub.start(time);
    sub.stop(time + dur + 0.02);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 7;
    filter.frequency.setValueAtTime(300 + growl * 900 * vel, time);
    filter.frequency.exponentialRampToValueAtTime(170, time + dur);
    const reeseGain = ctx.createGain();
    reeseGain.gain.setValueAtTime(0, time);
    reeseGain.gain.linearRampToValueAtTime(0.1 * vel, time + 0.006);
    reeseGain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    for (const detune of [-14, 14]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFreq(midi + 12);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + dur + 0.02);
    }
    filter.connect(reeseGain).connect(duck);
  }

  // Choir: detuned saw stack through a vowel-ish bandpass. The epic bed.
  function choir(time: number, midis: number[], duration: number, vel: number) {
    if (!ctx || !duck || !reverbSend) return;
    for (const midi of midis) {
      for (const detune of [-9, 9]) {
        const osc = ctx.createOscillator();
        const vowel = ctx.createBiquadFilter();
        const lowpass = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = detune + Math.sin(midi * 7.3) * 4;
        vowel.type = 'bandpass';
        vowel.frequency.setValueAtTime(620, time);
        vowel.frequency.linearRampToValueAtTime(950, time + duration * 0.5);
        vowel.frequency.linearRampToValueAtTime(620, time + duration);
        vowel.Q.value = 0.9;
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 2100;
        const level = (0.05 * vel) / Math.sqrt(midis.length / 4);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(level, time + Math.min(0.7, duration * 0.25));
        gain.gain.setValueAtTime(level, time + duration - Math.min(0.9, duration * 0.3));
        gain.gain.linearRampToValueAtTime(0, time + duration);
        osc.connect(vowel).connect(lowpass).connect(gain);
        gain.connect(duck);
        const send = ctx.createGain();
        send.gain.value = 0.6;
        gain.connect(send).connect(reverbSend);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
    }
  }

  function arp(time: number, midi: number, vel: number) {
    if (!ctx || !duck || !delaySend) return;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = midiToFreq(midi);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2900, time);
    filter.frequency.exponentialRampToValueAtTime(900, time + 0.09);
    gain.gain.setValueAtTime(0.075 * vel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.connect(filter).connect(gain);
    gain.connect(duck);
    const send = ctx.createGain();
    send.gain.value = 0.42;
    gain.connect(send).connect(delaySend);
    osc.start(time);
    osc.stop(time + 0.12);
  }

  function stab(time: number, midis: number[], vel: number) {
    if (!ctx || !duck || !reverbSend) return;
    for (const midi of midis) {
      for (const detune of [-11, 11]) {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi);
        osc.detune.value = detune;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(3600, time);
        filter.frequency.exponentialRampToValueAtTime(500, time + 0.22);
        gain.gain.setValueAtTime(0.05 * vel, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.26);
        osc.connect(filter).connect(gain);
        gain.connect(duck);
        const send = ctx.createGain();
        send.gain.value = 0.35;
        gain.connect(send).connect(reverbSend);
        osc.start(time);
        osc.stop(time + 0.3);
      }
    }
  }

  function lead(time: number, midi: number, duration: number, vel: number) {
    if (!ctx || !duck || !delaySend || !reverbSend) return;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600, time);
    filter.frequency.linearRampToValueAtTime(1700, time + duration);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.085 * vel, time + 0.02);
    gain.gain.setValueAtTime(0.085 * vel, time + Math.max(0.02, duration - 0.08));
    gain.gain.linearRampToValueAtTime(0, time + duration + 0.02);
    const vibrato = ctx.createOscillator();
    const vibratoGain = ctx.createGain();
    vibrato.frequency.value = 5.4;
    vibratoGain.gain.setValueAtTime(0, time);
    vibratoGain.gain.linearRampToValueAtTime(6, time + Math.min(0.4, duration * 0.6));
    for (const [type, detune] of [['sawtooth', -7], ['square', 7]] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midiToFreq(midi);
      osc.detune.value = detune;
      vibrato.connect(vibratoGain).connect(osc.detune);
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + duration + 0.05);
    }
    vibrato.start(time);
    vibrato.stop(time + duration + 0.05);
    filter.connect(gain);
    gain.connect(duck);
    const echo = ctx.createGain();
    echo.gain.value = 0.5;
    gain.connect(echo).connect(delaySend);
    const hall = ctx.createGain();
    hall.gain.value = 0.3;
    gain.connect(hall).connect(reverbSend);
  }

  function alarmSwell(time: number, midi: number, duration: number) {
    if (!ctx || !duck || !reverbSend) return;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToFreq(midi);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(360, time);
    filter.frequency.linearRampToValueAtTime(1500, time + duration * 0.8);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.15, time + duration * 0.7);
    gain.gain.linearRampToValueAtTime(0, time + duration);
    osc.connect(filter).connect(gain);
    gain.connect(duck);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    gain.connect(send).connect(reverbSend);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  function riser(time: number, duration: number, level: number) {
    if (!ctx || !master || !noiseBuffer) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(260, time);
    filter.frequency.exponentialRampToValueAtTime(7200, time + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + duration);
    gain.gain.linearRampToValueAtTime(0, time + duration + 0.06);
    source.connect(filter).connect(gain).connect(master);
    source.start(time);
    source.stop(time + duration + 0.1);
  }

  function impact(time: number, vel: number) {
    if (!ctx || !master) return;
    const boom = ctx.createOscillator();
    const gain = ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(120, time);
    boom.frequency.exponentialRampToValueAtTime(30, time + 0.5);
    gain.gain.setValueAtTime(0.5 * vel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.75);
    boom.connect(gain).connect(master);
    boom.start(time);
    boom.stop(time + 0.8);
    noiseHit(time, 0.26 * vel, 0.3, 'lowpass', 420, master);
    crash(time, 0.16 * vel);
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
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + Math.max(0.012, decay));
    source.connect(filter).connect(gain).connect(destination);
    source.start(time, Math.random() * 1.5);
    source.stop(time + Math.max(0.02, decay) + 0.03);
  }

  // ---- game SFX (cold player tech, in key, on the 32nd grid) -------------------

  // Icy FM pluck: sine carrier + bright partial, quick sparkle on top.
  function icePluck(time: number, midi: number, vel: number) {
    if (!ctx || !duck || !delaySend) return;
    for (const [ratio, level, decay] of [[1, 1, 0.14], [2.01, 0.35, 0.07], [3.98, 0.12, 0.04]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = midiToFreq(midi) * ratio;
      gain.gain.setValueAtTime(vel * level * 0.14, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
      osc.connect(gain);
      gain.connect(duck);
      const send = ctx.createGain();
      send.gain.value = 0.4;
      gain.connect(send).connect(delaySend);
      osc.start(time);
      osc.stop(time + decay + 0.03);
    }
    noiseHit(time, vel * 0.03, 0.02, 'highpass', 9500, duck);
  }

  bus.on('lock', ({ lockCount }) => {
    if (!ctx) return;
    const time = quantize(ctx.currentTime);
    const midi = LOCK_SCALE[Math.min(LOCK_SCALE.length, Math.max(1, lockCount)) - 1];
    icePluck(time, midi, 1);
    if (lockCount >= 6) {
      // Ignition: the sixth lock rings the octave and thumps the floor.
      icePluck(time + THIRTYSECOND, 88, 0.9);
      const boom = ctx.createOscillator();
      const gain = ctx.createGain();
      boom.type = 'sine';
      boom.frequency.setValueAtTime(90, time);
      boom.frequency.exponentialRampToValueAtTime(45, time + 0.12);
      gain.gain.setValueAtTime(0.2, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
      if (master) boom.connect(gain).connect(master);
      boom.start(time);
      boom.stop(time + 0.2);
    }
  });

  bus.on('unlock', () => {
    if (!ctx || !duck) return;
    noiseHit(ctx.currentTime, 0.025, 0.03, 'highpass', 7000, duck);
  });

  bus.on('fire', ({ indexInVolley }) => {
    if (!ctx || !master) return;
    const time = quantize(ctx.currentTime);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(920 + (indexInVolley ?? 0) * 60, time);
    osc.frequency.exponentialRampToValueAtTime(190, time + 0.06);
    gain.gain.setValueAtTime(0.07, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    osc.connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + 0.09);
    noiseHit(time, 0.05, 0.03, 'highpass', 4000, master);
  });

  bus.on('hit', ({ lethal }) => {
    if (lethal || !ctx || !duck) return;
    const time = quantize(ctx.currentTime);
    // Armor chip: a dead metallic tick — deliberately not a kill sparkle.
    for (const [frequency, vel] of [[523, 0.07], [1046, 0.045]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(vel, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
      osc.connect(gain).connect(duck);
      osc.start(time);
      osc.stop(time + 0.07);
    }
    noiseHit(time, 0.05, 0.03, 'bandpass', 3200, duck);
  });

  bus.on('stage', ({ enemyId }) => {
    if (!ctx || !master || !reverbSend) return;
    const time = quantize(ctx.currentTime);
    // Armor break: a crack and a dark bell.
    noiseHit(time, 0.22, 0.12, 'bandpass', 1300, master);
    for (const midi of [40, 47]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(midi);
      gain.gain.setValueAtTime(0.16, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.6);
      osc.connect(gain);
      gain.connect(master);
      const send = ctx.createGain();
      send.gain.value = 0.5;
      gain.connect(send).connect(reverbSend);
      osc.start(time);
      osc.stop(time + 0.65);
    }
    if (enemyId === heartId) riser(time, 1.6, 0.18); // it dives — brace
  });

  bus.on('kill', ({ enemyId, volleyId }) => {
    if (!ctx || !duck || !master) return;
    const time = quantize(ctx.currentTime);
    if (enemyId === heartId) {
      // The Suneater dies: the biggest sound in the level.
      impact(time, 1.4);
      choir(time + 0.1, [40, 52, 59, 64, 71, 76], 6, 1.2);
      riser(time, 0.8, 0.14);
      if (duck) {
        duck.gain.cancelScheduledValues(time);
        duck.gain.setValueAtTime(0.15, time);
        duck.gain.linearRampToValueAtTime(1, time + 1.1);
      }
      return;
    }
    const boom = ctx.createOscillator();
    const gain = ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(130, time);
    boom.frequency.exponentialRampToValueAtTime(52, time + 0.11);
    gain.gain.setValueAtTime(0.16, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    boom.connect(gain).connect(master);
    boom.start(time);
    boom.stop(time + 0.2);
    // Ember sizzle + a cold blip riding the volley index keeps kill chains melodic.
    noiseHit(time, 0.06, 0.16, 'bandpass', 3400, duck);
    icePluck(time + THIRTYSECOND, LOCK_SCALE[(enemyId + (volleyId ?? 0)) % LOCK_SCALE.length] + 12, 0.5);
  });

  bus.on('volley', ({ size, kills }) => {
    if (!ctx || size < 5 || kills < size) return;
    // Perfect big volley: a fast ascending flourish.
    const time = quantize(ctx.currentTime);
    [76, 79, 83, 88].forEach((midi, index) => {
      icePluck(time + index * THIRTYSECOND, midi, 0.7 - index * 0.08);
    });
  });

  bus.on('reject', () => {
    if (!ctx || !master) return;
    const time = ctx.currentTime;
    // Rejection: a dead anvil clank with a minor-second snarl — cold iron, no reward.
    for (const [frequency, at, vel] of [[233, time, 0.16], [247, time + 0.02, 0.12]] as const) {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(frequency, at);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.4, at + 0.16);
      filter.type = 'bandpass';
      filter.Q.value = 4;
      filter.frequency.value = 900;
      gain.gain.setValueAtTime(vel, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
      osc.connect(filter).connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + 0.24);
    }
    noiseHit(time, 0.14, 0.08, 'bandpass', 620, master);
  });

  bus.on('playerhit', () => {
    if (!ctx || !master) return;
    const time = ctx.currentTime;
    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(100, time);
    boom.frequency.exponentialRampToValueAtTime(30, time + 0.32);
    boomGain.gain.setValueAtTime(0.46, time);
    boomGain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
    boom.connect(boomGain).connect(master);
    boom.start(time);
    boom.stop(time + 0.55);
    // Two-tone hull alarm.
    [69, 63].forEach((midi, index) => {
      if (!ctx || !master) return;
      const at = time + index * 0.13;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = midiToFreq(midi);
      gain.gain.setValueAtTime(0.06, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
      osc.connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + 0.15);
    });
    noiseHit(time, 0.2, 0.16, 'bandpass', 800, master);
  });

  bus.on('miss', () => {
    if (!ctx || !master) return;
    const time = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(62, time + 0.11);
    gain.gain.setValueAtTime(0.045, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    osc.connect(gain).connect(master);
    osc.start(time);
    osc.stop(time + 0.14);
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (!ctx) return;
    if (kind === 'heart') {
      heartId = enemyId;
      // The Suneater breaches: a war-horn triad and a long riser.
      const time = quantize(ctx.currentTime);
      riser(time, 2.2, 0.2);
      [28, 40, 47].forEach((midi, index) => {
        if (!ctx || !duck || !reverbSend) return;
        const at = time + index * 0.3;
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFreq(midi);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(500, at);
        filter.frequency.linearRampToValueAtTime(1300, at + 0.4);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.2, at + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 1.1);
        osc.connect(filter).connect(gain);
        gain.connect(duck);
        const send = ctx.createGain();
        send.gain.value = 0.55;
        gain.connect(send).connect(reverbSend);
        osc.start(at);
        osc.stop(at + 1.2);
      });
    } else if (kind === 'flare' && master) {
      // Prominence warning: a short upward siren, quiet enough to layer.
      const time = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(340, time);
      osc.frequency.exponentialRampToValueAtTime(760, time + 0.34);
      gain.gain.setValueAtTime(0.001, time);
      gain.gain.exponentialRampToValueAtTime(0.05, time + 0.26);
      gain.gain.linearRampToValueAtTime(0, time + 0.4);
      osc.connect(gain).connect(master);
      osc.start(time);
      osc.stop(time + 0.44);
    }
  });

  bus.on('runstart', () => {
    mode = 'run';
    heartId = -1;
    // Restart the arrangement on the next 16th so the drops track the run
    // set pieces to within ~90 ms.
    arrangementStart = sixteenthIndex;
  });

  bus.on('runend', () => {
    mode = 'ambient';
    if (!ctx) return;
    choir(ctx.currentTime + 0.05, [52, 59, 64, 66, 71], 6, 0.9);
  });

  return {
    start,
    installGestureStart,
    setMasterVolume(volume: number) {
      masterVolume = Math.min(1, Math.max(0, volume)) * 0.8;
      if (ctx && master) master.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.05);
    },
    getMasterVolume() {
      return masterVolume / 0.8;
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
