import { defineInstruments, playNoiseHit, playOscillatorVoice, type MixBus } from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Synth voices for Thermal Ink. Leaf file: every function takes its pitch,
// time, and level from the score spine; nothing here decides what plays when.
//
// Routing (built by the spine in onPostBuild):
//   drums   — kick and sub thuds
//   metal   — clanks, chains, hiss, grit: the "noise" that falls back in thermal
//   bass    — the bouncing bass, side-chained to the kick
//   tone    — pads, drones, foghorn, lamp hum
//   melMurk / melThermal — the melody's two voices, crossfaded by the sight
//   sfx     — the player's instruments

export type ThermalInkBuses = {
  drums: GainNode;
  metal: GainNode;
  bass: GainNode;
  tone: GainNode;
  melMurk: GainNode;
  melThermal: GainNode;
  reverb: GainNode;
  delay: GainNode;
  sfx: GainNode;
};

export type VoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
  buses(): ThermalInkBuses | null;
};

const METAL_RATIOS = [1, 2.76, 5.4, 8.93];

export function createThermalInkVoices(env: VoiceEnvironment) {
  const noise = (context: AudioContext, time: number, velocity: number, decay: number, filterType: BiquadFilterType, frequency: number, destination: AudioNode) => {
    const buffer = env.mix()?.noiseBuffer;
    if (!buffer) return;
    playNoiseHit({ context, buffer, time, velocity, decay, filterType, frequency, destination, loopStart: Math.random(), offset: Math.random() * 1.5 });
  };

  /** A struck-metal partial stack: pipe, hull plate, anvil, bell. */
  const strike = (context: AudioContext, time: number, freq: number, gain: number, decay: number, destination: AudioNode, sends: Array<{ destination: AudioNode; gain: number }> = [], brightness = 1) => {
    METAL_RATIOS.forEach((ratio, index) => {
      const partialDecay = decay / (1 + index * 0.9);
      const level = gain * [1, 0.55, 0.3, 0.16][index] * (index === 0 ? 1 : brightness);
      if (level < 0.002) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + partialDecay + 0.05,
        oscillatorType: 'sine',
        frequency: freq * ratio,
        gainAutomation: [
          { type: 'set', value: level, time },
          { type: 'exponentialRamp', value: 0.0005, time: time + partialDecay },
        ],
        destination,
        sends,
      });
    });
  };

  return defineInstruments({ trace: env.trace, context: env.context }, {
    // ---- rhythm section ------------------------------------------------------

    kick(context: AudioContext, time: number, vel: number) {
      const buses = env.buses();
      if (!buses) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.6,
        oscillatorType: 'sine',
        frequency: 128,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 40, time: time + 0.16 }],
        gainAutomation: [
          { type: 'set', value: 0.7 * vel, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.55 },
        ],
        destination: buses.drums,
      });
      // The industrial half: a dull steam-hammer thud under the sine.
      noise(context, time, 0.22 * vel, 0.1, 'lowpass', 260, buses.drums);
      noise(context, time, 0.08 * vel, 0.012, 'highpass', 3000, buses.drums);
      // Side-chain: the bass ducks under every kick, which is what makes it bounce.
      buses.bass.gain.cancelScheduledValues(time);
      buses.bass.gain.setValueAtTime(0.25, time);
      buses.bass.gain.linearRampToValueAtTime(1, time + 0.24);
    },

    hammer(context: AudioContext, time: number, midi: number, vel: number) {
      const buses = env.buses();
      if (!buses) return;
      strike(context, time, midiToFreq(midi), 0.07 * vel, 0.42, buses.metal, [{ destination: buses.reverb, gain: 0.35 }], 0.9);
      noise(context, time, 0.12 * vel, 0.035, 'bandpass', 2600, buses.metal);
    },

    chain(context: AudioContext, time: number, vel: number) {
      const buses = env.buses();
      if (!buses) return;
      for (let i = 0; i < 5; i += 1) {
        const at = time + i * (0.022 + Math.random() * 0.03);
        noise(context, at, (0.06 + Math.random() * 0.05) * vel, 0.025, 'bandpass', 3200 + Math.random() * 2400, buses.metal);
      }
    },

    hiss(context: AudioContext, time: number, vel: number, seconds: number) {
      const buses = env.buses();
      const buffer = env.mix()?.noiseBuffer;
      if (!buses || !buffer) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 5200;
      filter.Q.value = 0.8;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.05 * vel, time + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0005, time + seconds);
      source.connect(filter).connect(gain).connect(buses.metal);
      source.start(time, Math.random());
      source.stop(time + seconds + 0.05);
    },

    grit(context: AudioContext, time: number, vel: number) {
      const buses = env.buses();
      if (!buses) return;
      noise(context, time, 0.03 * vel, 0.022, 'highpass', 7800, buses.metal);
    },

    bass(context: AudioContext, time: number, midi: number, vel: number, seconds: number) {
      const buses = env.buses();
      if (!buses) return;
      const freq = midiToFreq(midi);
      const cutoff = 170 + vel * 1150;
      for (const [type, detune, level] of [['sawtooth', -6, 0.16], ['square', 7, 0.09]] as const) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + seconds + 0.08,
          oscillatorType: type,
          frequency: freq,
          detune,
          filter: {
            type: 'lowpass',
            Q: 7,
            frequencyAutomation: [
              { type: 'set', value: cutoff, time },
              { type: 'exponentialRamp', value: 140, time: time + Math.max(0.12, seconds * 0.85) },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0, time },
            { type: 'linearRamp', value: level * vel, time: time + 0.006 },
            { type: 'exponentialRamp', value: level * vel * 0.45, time: time + seconds * 0.6 },
            { type: 'exponentialRamp', value: 0.0005, time: time + seconds + 0.06 },
          ],
          destination: buses.bass,
        });
      }
      playOscillatorVoice({
        context,
        time,
        stopTime: time + seconds + 0.1,
        oscillatorType: 'sine',
        frequency: freq / 2,
        gainAutomation: [
          { type: 'set', value: 0, time },
          { type: 'linearRamp', value: 0.27 * vel, time: time + 0.01 },
          { type: 'exponentialRamp', value: 0.0005, time: time + seconds + 0.08 },
        ],
        destination: buses.bass,
      });
    },

    // ---- harmony and atmosphere ------------------------------------------------

    pad(context: AudioContext, time: number, notes: number[], seconds: number, level: number) {
      const buses = env.buses();
      if (!buses) return;
      for (const midi of notes) {
        for (const detune of [-9, 8]) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + seconds + 0.9,
            oscillatorType: 'sawtooth',
            frequency: midiToFreq(midi),
            detune,
            filter: {
              type: 'lowpass',
              Q: 0.7,
              frequencyAutomation: [
                { type: 'set', value: 380, time },
                { type: 'linearRamp', value: 900, time: time + seconds * 0.5 },
                { type: 'linearRamp', value: 420, time: time + seconds + 0.8 },
              ],
            },
            gainAutomation: [
              { type: 'set', value: 0, time },
              { type: 'linearRamp', value: 0.022 * level, time: time + 0.7 },
              { type: 'set', value: 0.022 * level, time: time + Math.max(0.7, seconds) },
              { type: 'linearRamp', value: 0, time: time + seconds + 0.85 },
            ],
            destination: buses.tone,
            sends: [{ destination: buses.reverb, gain: 0.5 }],
          });
        }
      }
    },

    foghorn(context: AudioContext, time: number, midi: number, seconds: number, level: number) {
      const buses = env.buses();
      if (!buses) return;
      const freq = midiToFreq(midi);
      for (const [type, ratio, detune, gain] of [['sawtooth', 1, -4, 0.11], ['sawtooth', 1, 5, 0.11], ['square', 2, 0, 0.03]] as const) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + seconds + 1.4,
          oscillatorType: type,
          frequency: freq * ratio,
          detune,
          frequencyAutomation: [
            { type: 'set', value: freq * ratio * 0.985, time },
            { type: 'linearRamp', value: freq * ratio, time: time + 0.35 },
            { type: 'set', value: freq * ratio, time: time + seconds },
            { type: 'linearRamp', value: freq * ratio * 0.955, time: time + seconds + 1.3 },
          ],
          filter: { type: 'lowpass', frequency: 420, Q: 3 },
          gainAutomation: [
            { type: 'set', value: 0, time },
            { type: 'linearRamp', value: gain * level, time: time + 0.4 },
            { type: 'linearRamp', value: gain * level * 0.8, time: time + seconds },
            { type: 'linearRamp', value: 0, time: time + seconds + 1.3 },
          ],
          destination: buses.tone,
          sends: [{ destination: buses.reverb, gain: 0.9 }],
        });
      }
    },

    // The melody speaks with two voices at once; the sight chooses which you hear.
    melody(context: AudioContext, time: number, midi: number, seconds: number, vel: number) {
      const buses = env.buses();
      if (!buses) return;
      const freq = midiToFreq(midi);
      // Murk: a hazy, detuned, drifting voice drowned in the harbor.
      const lfo = context.createOscillator();
      lfo.frequency.value = 4.6;
      const lfoDepth = context.createGain();
      lfoDepth.gain.setValueAtTime(0, time);
      lfoDepth.gain.linearRampToValueAtTime(14, time + Math.min(0.6, seconds));
      lfo.connect(lfoDepth);
      const murkFilter = context.createBiquadFilter();
      murkFilter.type = 'lowpass';
      murkFilter.Q.value = 1.4;
      murkFilter.frequency.setValueAtTime(700, time);
      murkFilter.frequency.linearRampToValueAtTime(1500, time + Math.min(0.35, seconds * 0.5));
      murkFilter.frequency.exponentialRampToValueAtTime(600, time + seconds + 0.3);
      const murkGain = context.createGain();
      murkGain.gain.setValueAtTime(0, time);
      murkGain.gain.linearRampToValueAtTime(0.085 * vel, time + 0.09);
      murkGain.gain.setValueAtTime(0.085 * vel, time + seconds * 0.8);
      murkGain.gain.exponentialRampToValueAtTime(0.0005, time + seconds + 0.45);
      const oscillators: OscillatorNode[] = [];
      for (const detune of [-13, 11]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        lfoDepth.connect(osc.detune);
        osc.connect(murkFilter);
        oscillators.push(osc);
      }
      murkFilter.connect(murkGain);
      murkGain.connect(buses.melMurk);
      const murkSend = context.createGain();
      murkSend.gain.value = 0.7;
      murkGain.connect(murkSend).connect(buses.reverb);
      const stop = time + seconds + 0.5;
      for (const osc of [...oscillators, lfo]) {
        osc.start(time);
        osc.stop(stop);
      }

      // Thermal: bright, dry, exact — a square with a sine an octave above.
      for (const [type, ratio, level] of [['square', 1, 0.045], ['sine', 2, 0.05], ['triangle', 1, 0.05]] as const) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + seconds + 0.2,
          oscillatorType: type,
          frequency: freq * ratio,
          filter: { type: 'lowpass', frequency: 5200, Q: 0.9 },
          gainAutomation: [
            { type: 'set', value: 0, time },
            { type: 'linearRamp', value: level * vel, time: time + 0.008 },
            { type: 'exponentialRamp', value: level * vel * 0.6, time: time + seconds * 0.7 },
            { type: 'exponentialRamp', value: 0.0005, time: time + seconds + 0.15 },
          ],
          destination: buses.melThermal,
          sends: [{ destination: buses.delay, gain: 0.18 }],
        });
      }
    },

    /** A tolled harbor bell: bell buoys ring as they rise. */
    bell(context: AudioContext, time: number, midi: number, vel: number) {
      const buses = env.buses();
      if (!buses) return;
      strike(context, time, midiToFreq(midi), 0.09 * vel, 2.2, buses.tone, [{ destination: buses.reverb, gain: 0.8 }], 0.7);
    },

    riser(context: AudioContext, time: number, seconds: number, level: number) {
      const buses = env.buses();
      const buffer = env.mix()?.noiseBuffer;
      if (!buses || !buffer) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 3;
      filter.frequency.setValueAtTime(300, time);
      filter.frequency.exponentialRampToValueAtTime(4200, time + seconds);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.09 * level, time + seconds);
      gain.gain.linearRampToValueAtTime(0, time + seconds + 0.05);
      source.connect(filter).connect(gain).connect(buses.metal);
      source.start(time);
      source.stop(time + seconds + 0.1);
    },

    /** The creature's voice: a sliding, formant-choked groan under a noise surge. */
    groan(context: AudioContext, time: number, midi: number, seconds: number, level: number, fall: number) {
      const buses = env.buses();
      if (!buses) return;
      const freq = midiToFreq(midi);
      for (const detune of [-18, 0, 21]) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + seconds + 0.2,
          oscillatorType: 'sawtooth',
          frequency: freq,
          detune,
          frequencyAutomation: [
            { type: 'set', value: freq * 1.06, time },
            { type: 'exponentialRamp', value: freq * fall, time: time + seconds },
          ],
          filter: {
            type: 'bandpass',
            Q: 4,
            frequencyAutomation: [
              { type: 'set', value: 380, time },
              { type: 'exponentialRamp', value: 720, time: time + seconds * 0.4 },
              { type: 'exponentialRamp', value: 260, time: time + seconds },
            ],
          },
          gainAutomation: [
            { type: 'set', value: 0, time },
            { type: 'linearRamp', value: 0.09 * level, time: time + 0.15 },
            { type: 'linearRamp', value: 0.07 * level, time: time + seconds * 0.7 },
            { type: 'linearRamp', value: 0, time: time + seconds },
          ],
          destination: buses.sfx,
          sends: [{ destination: buses.reverb, gain: 0.7 }],
        });
      }
      noise(context, time, 0.14 * level, seconds * 0.6, 'lowpass', 500, buses.sfx);
    },

    /** Steel coming down: a long bending shriek, then the crash. */
    steelCrash(context: AudioContext, time: number, fallSeconds: number) {
      const buses = env.buses();
      if (!buses) return;
      for (const [start, end] of [[620, 410], [930, 560]] as const) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + fallSeconds + 0.2,
          oscillatorType: 'sawtooth',
          frequency: start,
          frequencyAutomation: [{ type: 'exponentialRamp', value: end, time: time + fallSeconds }],
          filter: { type: 'bandpass', frequency: 1400, Q: 6 },
          gainAutomation: [
            { type: 'set', value: 0, time },
            { type: 'linearRamp', value: 0.035, time: time + fallSeconds * 0.5 },
            { type: 'linearRamp', value: 0, time: time + fallSeconds },
          ],
          destination: buses.sfx,
          sends: [{ destination: buses.reverb, gain: 0.5 }],
        });
      }
      const impact = time + fallSeconds;
      strike(context, impact, 92, 0.34, 1.6, buses.sfx, [{ destination: buses.reverb, gain: 0.8 }], 1);
      strike(context, impact + 0.05, 141, 0.2, 1.1, buses.sfx, [{ destination: buses.reverb, gain: 0.6 }], 1);
      noise(context, impact, 0.4, 1.2, 'lowpass', 900, buses.sfx);
      noise(context, impact, 0.22, 0.5, 'bandpass', 2400, buses.sfx);
      playOscillatorVoice({
        context,
        time: impact,
        stopTime: impact + 1,
        oscillatorType: 'sine',
        frequency: 70,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 30, time: impact + 0.7 }],
        gainAutomation: [
          { type: 'set', value: 0.55, time: impact },
          { type: 'exponentialRamp', value: 0.001, time: impact + 0.9 },
        ],
        destination: buses.sfx,
      });
    },

    /** Water breaking: an arm erupting, a severed piece landing. */
    splash(context: AudioContext, time: number, level: number) {
      const buses = env.buses();
      if (!buses) return;
      noise(context, time, 0.3 * level, 0.9, 'lowpass', 1400, buses.sfx);
      noise(context, time + 0.03, 0.12 * level, 0.5, 'highpass', 2600, buses.sfx);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.6,
        oscillatorType: 'sine',
        frequency: 85,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 38, time: time + 0.4 }],
        gainAutomation: [
          { type: 'set', value: 0.35 * level, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.5 },
        ],
        destination: buses.sfx,
      });
    },

    /** Lamps dying: a failing ballast buzz and a pop. */
    blackout(context: AudioContext, time: number) {
      const buses = env.buses();
      if (!buses) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.7,
        oscillatorType: 'sawtooth',
        frequency: 100,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 40, time: time + 0.6 }],
        filter: { type: 'bandpass', frequency: 900, Q: 2 },
        gainAutomation: [
          { type: 'set', value: 0.12, time },
          { type: 'linearRamp', value: 0.0, time: time + 0.65 },
        ],
        destination: buses.sfx,
      });
      noise(context, time + 0.6, 0.35, 0.08, 'bandpass', 3000, buses.sfx);
    },

    // ---- the player's instruments --------------------------------------------------

    lockTick(context: AudioContext, time: number, midi: number, lockCount: number, thermal: number) {
      const buses = env.buses();
      if (!buses) return;
      const freq = midiToFreq(midi);
      // Murk: a relay tick with a pipe partial. Thermal: a clean sonar ping.
      const murk = 1 - thermal;
      if (murk > 0.02) {
        strike(context, time, freq, 0.05 * murk, 0.18, buses.sfx, [{ destination: buses.delay, gain: 0.25 }], 0.5);
        noise(context, time, 0.03 * murk, 0.012, 'bandpass', 4200, buses.sfx);
      }
      if (thermal > 0.02) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + 0.22,
          oscillatorType: 'sine',
          frequency: freq * 2,
          gainAutomation: [
            { type: 'set', value: (0.06 + lockCount * 0.006) * thermal, time },
            { type: 'exponentialRamp', value: 0.0005, time: time + 0.2 },
          ],
          destination: buses.sfx,
          sends: [{ destination: buses.delay, gain: 0.35 }],
        });
      }
    },

    harpoon(context: AudioContext, time: number, rootMidi: number, volleySize: number) {
      const buses = env.buses();
      if (!buses) return;
      // Pneumatic release: a pitched thunk falling an octave and a hiss of air.
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.16,
        oscillatorType: 'triangle',
        frequency: midiToFreq(rootMidi + 36),
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(rootMidi + 24), time: time + 0.09 }],
        gainAutomation: [
          { type: 'set', value: 0.06 + volleySize * 0.004, time },
          { type: 'exponentialRamp', value: 0.0005, time: time + 0.14 },
        ],
        destination: buses.sfx,
      });
      noise(context, time, 0.05, 0.05, 'bandpass', 1800, buses.sfx);
    },

    killNote(context: AudioContext, time: number, midi: number, chain: number, thermal: number) {
      const buses = env.buses();
      if (!buses) return;
      const freq = midiToFreq(midi);
      const vel = Math.min(1.4, 1 + chain * 0.1);
      const murk = 1 - thermal;
      if (murk > 0.02) {
        // A struck pipe in the fog.
        strike(context, time, freq, 0.11 * vel * murk, 0.9, buses.sfx, [{ destination: buses.reverb, gain: 0.45 }, { destination: buses.delay, gain: 0.25 }], 0.8);
        playOscillatorVoice({
          context,
          time,
          stopTime: time + 0.05,
          oscillatorType: 'square',
          frequency: freq,
          filter: { type: 'lowpass', frequency: 3000 },
          gainAutomation: [
            { type: 'set', value: 0.03 * murk, time },
            { type: 'exponentialRamp', value: 0.0005, time: time + 0.04 },
          ],
          destination: buses.sfx,
        });
      }
      if (thermal > 0.02) {
        // A focused ping, dry and exact.
        for (const [type, ratio, level] of [['sine', 1, 0.11], ['triangle', 2, 0.045]] as const) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + 0.5,
            oscillatorType: type,
            frequency: freq * ratio,
            gainAutomation: [
              { type: 'set', value: level * vel * thermal, time },
              { type: 'exponentialRamp', value: 0.0005, time: time + 0.45 },
            ],
            destination: buses.sfx,
            sends: [{ destination: buses.delay, gain: 0.4 }],
          });
        }
      }
      noise(context, time, 0.025 + chain * 0.006, 0.05, 'highpass', 6000, buses.sfx);
    },

    /** Harpoon into flesh on a multi-hit target: a wet anvil that grows with damage. */
    fleshAnvil(context: AudioContext, time: number, midi: number, intensity: number) {
      const buses = env.buses();
      if (!buses) return;
      strike(context, time, midiToFreq(midi), 0.12 + 0.1 * intensity, 0.5 + intensity * 0.4, buses.sfx, [{ destination: buses.reverb, gain: 0.35 }], 0.5 + intensity * 0.6);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.3,
        oscillatorType: 'sine',
        frequency: midiToFreq(midi - 12) * 2,
        frequencyAutomation: [{ type: 'exponentialRamp', value: midiToFreq(midi - 12), time: time + 0.08 }],
        gainAutomation: [
          { type: 'set', value: 0.2 + 0.12 * intensity, time },
          { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
        ],
        destination: buses.sfx,
      });
      noise(context, time, 0.1 + intensity * 0.06, 0.12, 'lowpass', 900, buses.sfx);
    },

    /** Stab of the live chord, for severs and perfect volleys. */
    chordStab(context: AudioContext, time: number, notes: number[], level: number, seconds: number) {
      const buses = env.buses();
      if (!buses) return;
      for (const midi of notes) {
        for (const detune of [-7, 7]) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + seconds + 0.1,
            oscillatorType: 'sawtooth',
            frequency: midiToFreq(midi),
            detune,
            filter: {
              type: 'lowpass',
              frequencyAutomation: [
                { type: 'set', value: 2600, time },
                { type: 'exponentialRamp', value: 500, time: time + seconds },
              ],
            },
            gainAutomation: [
              { type: 'set', value: 0.028 * level, time },
              { type: 'exponentialRamp', value: 0.0005, time: time + seconds },
            ],
            destination: buses.sfx,
            sends: [{ destination: buses.reverb, gain: 0.5 }, { destination: buses.delay, gain: 0.3 }],
          });
        }
      }
    },

    subDrop(context: AudioContext, time: number, from: number, to: number, seconds: number, level: number) {
      const buses = env.buses();
      if (!buses) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + seconds + 0.1,
        oscillatorType: 'sine',
        frequency: from,
        frequencyAutomation: [{ type: 'exponentialRamp', value: to, time: time + seconds * 0.7 }],
        gainAutomation: [
          { type: 'set', value: 0.6 * level, time },
          { type: 'exponentialRamp', value: 0.001, time: time + seconds },
        ],
        destination: buses.sfx,
      });
    },

    /** Falling bell peal for the kill that ends it. */
    peal(context: AudioContext, time: number, notes: number[], step: number) {
      const buses = env.buses();
      if (!buses) return;
      notes.forEach((midi, index) => {
        strike(context, time + index * step, midiToFreq(midi), 0.09 - index * 0.006, 1.8, buses.sfx, [{ destination: buses.reverb, gain: 0.7 }, { destination: buses.delay, gain: 0.3 }], 0.7);
      });
    },

    rejectBuzz(context: AudioContext, time: number) {
      const buses = env.buses();
      if (!buses) return;
      for (const [freq, at, level] of [[233, 0, 0.12], [330, 0.02, 0.09]] as const) {
        playOscillatorVoice({
          context,
          time: time + at,
          stopTime: time + at + 0.24,
          oscillatorType: 'sawtooth',
          frequency: freq,
          frequencyAutomation: [{ type: 'exponentialRamp', value: freq * 0.7, time: time + at + 0.2 }],
          filter: { type: 'bandpass', frequency: 900, Q: 4 },
          gainAutomation: [
            { type: 'set', value: level, time: time + at },
            { type: 'exponentialRamp', value: 0.0005, time: time + at + 0.22 },
          ],
          destination: buses.sfx,
        });
      }
      noise(context, time, 0.14, 0.06, 'bandpass', 600, buses.sfx);
    },

    missThud(context: AudioContext, time: number) {
      const buses = env.buses();
      if (!buses) return;
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.18,
        oscillatorType: 'sine',
        frequency: 110,
        frequencyAutomation: [{ type: 'exponentialRamp', value: 55, time: time + 0.14 }],
        gainAutomation: [
          { type: 'set', value: 0.06, time },
          { type: 'exponentialRamp', value: 0.0005, time: time + 0.16 },
        ],
        destination: buses.sfx,
      });
    },

    hullHit(context: AudioContext, time: number) {
      const buses = env.buses();
      if (!buses) return;
      strike(context, time, 61, 0.3, 0.9, buses.sfx, [{ destination: buses.reverb, gain: 0.4 }], 1);
      for (const midi of [62, 63]) {
        playOscillatorVoice({
          context,
          time,
          stopTime: time + 0.3,
          oscillatorType: 'square',
          frequency: midiToFreq(midi),
          filter: { type: 'lowpass', frequency: 1600 },
          gainAutomation: [
            { type: 'set', value: 0.05, time },
            { type: 'exponentialRamp', value: 0.0005, time: time + 0.28 },
          ],
          destination: buses.sfx,
        });
      }
      noise(context, time, 0.35, 0.3, 'lowpass', 700, buses.sfx);
    },

    /** The sight switching: a relay clack and a rising (on) or falling (off) whine. */
    sightSwitch(context: AudioContext, time: number, on: boolean) {
      const buses = env.buses();
      if (!buses) return;
      noise(context, time, on ? 0.16 : 0.09, 0.02, 'bandpass', 2400, buses.sfx);
      playOscillatorVoice({
        context,
        time,
        stopTime: time + 0.2,
        oscillatorType: 'sine',
        frequency: on ? 1800 : 3200,
        frequencyAutomation: [{ type: 'exponentialRamp', value: on ? 3600 : 1400, time: time + 0.14 }],
        gainAutomation: [
          { type: 'set', value: on ? 0.04 : 0.022, time },
          { type: 'exponentialRamp', value: 0.0005, time: time + 0.16 },
        ],
        destination: buses.sfx,
      });
    },
  });
}
