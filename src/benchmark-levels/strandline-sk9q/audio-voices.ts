import {
  defineInstruments,
  playBufferSourceVoice,
  playOscillatorVoice,
  type MixBus,
} from '../../engine/audio-kit';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Strandline sound world: everything is wet, round, and alive. The jelly's own
// pulse is the kick drum; bells and droplets are the bioluminescence; the
// parasites are sour detuned blips and dry ticks. This file is the leaf
// construction layer — the spine (audio.ts) owns when each voice plays, at
// what pitch, and how loud it sits in the mix.

export type StrandlineVoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type StrandlineWater = {
  /** Ramp the deep water bed toward `level` (0..1) with a slow time constant. */
  setDeep(level: number, time: number): void;
  /** Ramp the bright surface-hiss bed toward `level` (0..1). */
  setShimmer(level: number, time: number): void;
};

// Two looping noise beds: a deep brown rumble and a high sunlit hiss. The
// arrangement fades the shimmer up in the sunlit sections and down in the deep.
export function installStrandlineWater(context: AudioContext, mix: MixBus): StrandlineWater | null {
  if (!mix.noiseBuffer) return null;

  const deepSource = context.createBufferSource();
  deepSource.buffer = mix.noiseBuffer;
  deepSource.loop = true;
  const deepFilter = context.createBiquadFilter();
  deepFilter.type = 'lowpass';
  deepFilter.frequency.value = 210;
  const deepGain = context.createGain();
  deepGain.gain.value = 0.14;
  const swell = context.createOscillator();
  swell.frequency.value = 0.07;
  const swellGain = context.createGain();
  swellGain.gain.value = 0.05;
  swell.connect(swellGain).connect(deepGain.gain);
  deepSource.connect(deepFilter).connect(deepGain).connect(mix.music);

  const shimmerSource = context.createBufferSource();
  shimmerSource.buffer = mix.noiseBuffer;
  shimmerSource.loop = true;
  const shimmerFilter = context.createBiquadFilter();
  shimmerFilter.type = 'bandpass';
  shimmerFilter.frequency.value = 5200;
  shimmerFilter.Q.value = 0.6;
  const shimmerGain = context.createGain();
  shimmerGain.gain.value = 0.012;
  shimmerSource.connect(shimmerFilter).connect(shimmerGain).connect(mix.music);

  deepSource.start();
  shimmerSource.start();
  swell.start();

  return {
    setDeep(level, time) {
      deepGain.gain.setTargetAtTime(0.28 * level, time, 1.2);
    },
    setShimmer(level, time) {
      shimmerGain.gain.setTargetAtTime(0.05 * level, time, 1.4);
    },
  };
}

export function createStrandlineVoices(environment: StrandlineVoiceEnvironment) {
  const musicDestination = () => environment.mix()?.music ?? environment.mix()?.master ?? null;
  const sfxDestination = () => environment.mix()?.sfx ?? environment.mix()?.master ?? null;

  const noiseHitVoice = noiseHitSpec({ filterType: 'highpass', frequency: 1000, velocity: 1, decay: 0.05 });

  function noiseHit(time: number, vel: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode) {
    const context = environment.context();
    const noiseBuffer = environment.mix()?.noiseBuffer;
    if (!context || !noiseBuffer) return;
    noiseHitVoice.play({ context, buffer: noiseBuffer, time, velocity: vel, decay, filterType, frequency, destination, offset: Math.random() * 2 });
  }

  function reverbSend(gain: number) {
    const send = environment.mix()?.reverbSend;
    return send && gain > 0 ? [{ destination: send, gain }] : [];
  }

  // The jelly's pulse: a round sine drop with a soft membrane click. It is the
  // kick drum of the whole level, so it lightly pumps the mix.
  const pulseTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.26,
    stopPadding: 0.04,
    frequencyAutomation: (time) => [{ type: 'exponentialRamp', value: 40, time: time + 0.16 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.42 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.26 },
    ],
  });

  // Sub bass note: sine + triangle blend, short and warm.
  const bassTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'triangle', gain: 0.5 },
    ],
    duration: 0.34,
    stopPadding: 0.05,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.16 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.34 },
    ],
  });

  // The pad: two detuned saws over a triangle sub, slow-attack, lowpassed. The
  // cutoff comes from the spine — dark in the drift, open in the reveals.
  const padTone = voice<{ cutoff: number; dur: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.4, detune: -7 },
      { type: 'sawtooth', gain: 0.4, detune: 8 },
      { type: 'triangle', gain: 0.55, octave: -1 },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.2,
    filter: { type: 'lowpass', cutoff: ({ cutoff }) => cutoff },
    envelope: { attack: ({ dur }) => Math.min(1.1, dur * 0.3), decay: ({ dur }) => dur, sustain: 0.7, release: 1.2 },
  });

  // Bioluminescent bell: sine with two inharmonic glassy partials, long tail.
  const bellTone = voice<{ vel: number; bright: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'sine', frequencyRatio: 2.76, gain: ({ bright }) => 0.3 * bright },
      { type: 'sine', frequencyRatio: 5.44, gain: ({ bright }) => 0.1 * bright },
    ],
    duration: 1.5,
    stopPadding: 0.2,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.085 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 1.5 },
    ],
  });

  // Short high sparkle for offbeat shimmer.
  const sparkleTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'sine', frequencyRatio: 3.01, gain: 0.25 },
    ],
    duration: 0.5,
    stopPadding: 0.1,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.03 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
    ],
  });

  // Distant animal call: a slow gliss sigh, bandpassed and reverberant.
  const callTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine', gain: 1 }],
    duration: 2.6,
    stopPadding: 0.3,
    filter: { type: 'bandpass', frequency: 700, Q: 2.2 },
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency, time },
      { type: 'linearRamp', value: frequency * 1.42, time: time + 0.9 },
      { type: 'linearRamp', value: frequency * 0.85, time: time + 2.4 },
    ],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'exponentialRamp', value: 0.05 * vel, time: time + 0.5 },
      { type: 'exponentialRamp', value: 0.001, time: time + 2.6 },
    ],
  });

  // Player droplet: a quick pitch-bent chirp — a bead of light in water.
  const dropletTone = voice<{ vel: number }>({
    oscillators: [{ type: 'sine', gain: 1 }],
    duration: 0.12,
    stopPadding: 0.03,
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.82, time: time + 0.1 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.09 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
    ],
  });

  // Player volley pluck: a round triangular dart with a noise transient.
  const pluckTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'triangle', gain: 1 },
      { type: 'sine', octave: 1, gain: 0.3 },
    ],
    duration: 0.2,
    stopPadding: 0.04,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.11 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.2 },
    ],
  });

  // Parasite sourness: two detuned squares a semitone apart, lowpassed hard.
  const sourTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'square', gain: 0.4 },
      { type: 'square', gain: 0.4, midiOffset: 1, detune: 9 },
    ],
    duration: 0.16,
    stopPadding: 0.04,
    filter: { type: 'lowpass', frequency: 900 },
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.06 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.16 },
    ],
  });

  // Boss gong: deep sine with inharmonic partials; the parent's voice.
  const gongTone = voice<{ vel: number; dur: number }>({
    oscillators: [
      { type: 'sine', gain: 1 },
      { type: 'sine', frequencyRatio: 1.483, gain: 0.5 },
      { type: 'sine', frequencyRatio: 2.137, gain: 0.22 },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.3,
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.22 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 2.2 },
    ],
  });

  // Section drone: a cold saw bed under the boss, lowpassed to a menace hum.
  const droneTone = voice<{ dur: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.5, detune: -5 },
      { type: 'sawtooth', gain: 0.5, detune: 6 },
    ],
    duration: ({ dur }) => dur,
    stopPadding: 0.2,
    filter: { type: 'lowpass', frequency: 260 },
    envelope: { attack: 0.6, decay: ({ dur }) => dur, sustain: 0.85, release: 0.9 },
  });

  const instruments = defineInstruments({ trace: environment.trace, context: environment.context }, {
    // The jelly's pulse — the level's kick.
    pulse(context, time, vel) {
      const output = musicDestination();
      if (!output) return;
      pulseTone.play({ context, time, frequency: 96, vel, destination: output });
      noiseHit(time, 0.03 * vel, 0.006, 'highpass', 1800, output);
      if (vel > 0.55) environment.mix()?.duckAt(time, 0.86, 0.16);
    },

    bass(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      bassTone.play({ context, time, midi, vel, destination: output });
    },

    // Sustained chord pad. `tones` are midi notes; one voice per tone.
    pad(context, time, tones, vel, cutoff, dur) {
      const output = musicDestination();
      if (!output) return;
      for (const tone of tones as number[]) {
        padTone.play({ context, time, midi: tone, velocity: vel, cutoff, dur, destination: output, sends: reverbSend(0.35) });
      }
    },

    bell(context, time, midi, vel, bright = 1) {
      const output = musicDestination();
      if (!output) return;
      bellTone.play({ context, time, midi, vel, bright, destination: output, sends: reverbSend(0.6) });
    },

    sparkle(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      sparkleTone.play({ context, time, midi, vel, destination: output, sends: reverbSend(0.5) });
    },

    // Distant animal call in the blue.
    call(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      callTone.play({ context, time, midi, vel, destination: output, sends: reverbSend(1.2) });
    },

    tick(context, time, vel) {
      const duck = environment.mix()?.duck;
      if (!duck) return;
      noiseHit(time, 0.028 * vel, 0.02, 'highpass', 8800, duck);
    },

    // A rising current for transitions: bandpass noise swept upward.
    whoosh(context, time, vel, dur = 1.6) {
      const output = musicDestination();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!output || !noiseBuffer) return;
      playBufferSourceVoice({
        context,
        time,
        stopTime: time + dur + 0.2,
        buffer: noiseBuffer,
        gainAutomation: [
          { type: 'set', value: 0.0001, time },
          { type: 'exponentialRamp', value: 0.07 * vel, time: time + dur * 0.6 },
          { type: 'exponentialRamp', value: 0.001, time: time + dur },
        ],
        filter: {
          type: 'bandpass',
          Q: 1.1,
          frequencyAutomation: [
            { type: 'set', value: 320, time },
            { type: 'exponentialRamp', value: 3400, time: time + dur },
          ],
        },
        destination: output,
      });
    },

    // Low menace drone under the parent section.
    drone(context, time, midi, vel, dur) {
      const output = musicDestination();
      if (!output) return;
      droneTone.play({ context, time, midi, velocity: vel, dur, destination: output });
    },

    // ---- player & gameplay voices (SFX bus) ---------------------------------

    lockDroplet(context, time, midi, vel) {
      const output = sfxDestination();
      if (!output) return;
      dropletTone.play({ context, time, midi, vel, destination: output, sends: reverbSend(0.35) });
      noiseHit(time, 0.02 * vel, 0.004, 'highpass', 5200, output);
    },

    firePluck(context, time, midi, vel) {
      const output = sfxDestination();
      if (!output) return;
      pluckTone.play({ context, time, midi, vel, destination: output, sends: reverbSend(0.3) });
      noiseHit(time, 0.035 * vel, 0.008, 'bandpass', 2600, output);
    },

    hitKnock(context, time, midi, vel) {
      const output = sfxDestination();
      if (!output) return;
      pluckTone.play({ context, time, midi, vel: vel * 0.8, destination: output });
      noiseHit(time, 0.06 * vel, 0.02, 'bandpass', 1500, output);
    },

    killBell(context, time, midi, vel) {
      const output = sfxDestination();
      if (!output) return;
      bellTone.play({ context, time, midi, vel: vel * 1.35, bright: 1.4, destination: output, sends: reverbSend(0.7) });
      noiseHit(time, 0.03 * vel, 0.05, 'highpass', 6400, output);
    },

    rejectSour(context, time, midi, vel) {
      const output = sfxDestination();
      if (!output) return;
      sourTone.play({ context, time, midi, vel, destination: output });
      sourTone.play({ context, time: time + 0.07, midi: midi - 1, vel: vel * 0.8, destination: output });
    },

    hullThud(context, time, vel) {
      const output = sfxDestination();
      if (!output) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.4,
        oscillatorType: 'sine',
        frequency: 58,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 34, time: time + 0.22 }],
        gainAutomation: [
          { type: 'set', value: 0.4 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.38 },
        ],
        destination: output,
      });
      noiseHit(time, 0.12 * vel, 0.09, 'lowpass', 900, output);
      environment.mix()?.duckAt(time, 0.7, 0.3);
    },

    // A spore launch: a wet squeeze of air.
    spitBlip(context, time, midi, vel) {
      const output = sfxDestination();
      if (!output) return;
      dropletTone.play({ context, time, midi, vel, destination: output });
      noiseHit(time, 0.04 * vel, 0.03, 'bandpass', 800, output);
    },

    // Brood spawn stinger: three quick descending wet notes.
    broodSting(context, time, midi, vel) {
      const output = musicDestination();
      if (!output) return;
      for (let i = 0; i < 3; i += 1) {
        dropletTone.play({ context, time: time + i * 0.09, midi: midi - i * 3, vel: vel * (1 - i * 0.2), destination: output, sends: reverbSend(0.5) });
      }
      noiseHit(time, 0.06 * vel, 0.12, 'lowpass', 1400, output);
    },

    // Webbing tear: a ripping noise sweep plus a falling dissonant wail.
    // `stage` (0..2) escalates the figure.
    webTear(context, time, vel, stage) {
      const output = musicDestination();
      const noiseBuffer = environment.mix()?.noiseBuffer;
      if (!output || !noiseBuffer) return;
      playBufferSourceVoice({
        context,
        time,
        stopTime: time + 1.4,
        buffer: noiseBuffer,
        gainAutomation: [
          { type: 'set', value: 0.14 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 1.2 },
        ],
        filter: {
          type: 'bandpass',
          Q: 1.4,
          frequencyAutomation: [
            { type: 'set', value: 2600 + stage * 500, time },
            { type: 'exponentialRamp', value: 240, time: time + 1.1 },
          ],
        },
        destination: output,
      });
      const base = 52 + stage * 4;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 1.3,
        oscillatorType: 'sawtooth',
        frequency: midiToFreq(base),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(base - 14), time: time + 1.1 }],
        filter: { type: 'lowpass', frequency: 1100 },
        gainAutomation: [
          { type: 'set', value: 0.09 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 1.2 },
        ],
        destination: output,
      });
      // A bright clean bell answers: the strand underneath comes back to life.
      bellTone.play({ context, time: time + 0.5, midi: 76 + stage * 2, vel: 0.9, bright: 1.3, destination: output, sends: reverbSend(0.8) });
    },

    parentGong(context, time, midi, vel, dur = 2.2) {
      const output = musicDestination();
      if (!output) return;
      gongTone.play({ context, time, midi, vel, dur, destination: output, sends: reverbSend(0.9) });
      environment.mix()?.duckAt(time, 0.8, 0.4);
    },

    // The parent's death: a long serene A-major swell with slow bell arpeggio.
    sereneSwell(context, time, tones, vel) {
      const output = musicDestination();
      if (!output) return;
      for (const tone of tones as number[]) {
        padTone.play({ context, time, midi: tone, velocity: vel * 1.15, cutoff: 2600, dur: 5.5, destination: output, sends: reverbSend(0.7) });
      }
      const arp = [69, 73, 76, 81, 76, 73];
      arp.forEach((midi, index) => {
        bellTone.play({ context, time: time + 0.6 + index * 0.42, midi, vel: 0.7, bright: 1.2, destination: output, sends: reverbSend(0.9) });
      });
    },
  });

  return instruments;
}

export type StrandlineVoices = ReturnType<typeof createStrandlineVoices>;
