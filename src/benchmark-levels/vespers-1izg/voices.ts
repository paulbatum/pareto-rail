import {
  applyAutomation,
  defineInstruments,
  playNoiseHit,
  playOscillatorVoice,
  type InstrumentEnvironment,
} from '../../engine/audio-kit';
import { midiToFreq } from '../../engine/music';

// Organ and choir voices for Vespers. Every stop is built from raw
// oscillator stacks — flues are sine/triangle pairs, principals are filtered
// saws, the bell is inharmonic partials. Everything feeds the cathedral
// reverb; only the bell also slaps the delay.

export type VespersVoiceArgs = {
  pedal(time: number, midi: number, vel: number, dur: number): void;
  flute(time: number, midi: number, vel: number, dur: number): void;
  principal(time: number, midi: number, vel: number, dur: number): void;
  soprano(time: number, midi: number, vel: number, dur: number): void;
  choir(time: number, midi: number, vel: number, dur: number): void;
  bell(time: number, midi: number, vel: number): void;
  riser(time: number, dur: number): void;
  noise(time: number, vel: number, decay: number, type: BiquadFilterType, freq: number): void;
};

type MusicBus = {
  duck: AudioNode;
  reverbSend?: AudioNode;
  delaySend?: AudioNode;
  noiseBuffer?: AudioBuffer;
};

export function createVespersVoices(
  environment: InstrumentEnvironment & { musicBus(): MusicBus | null },
): VespersVoiceArgs {
  const defs = {
      // The 16' + 8' pedal: the held note everything hangs on. Slow speech,
      // deep, almost felt rather than heard.
      pedal(context: AudioContext, time: number, midi: number, vel = 1, dur = 4) {
        const bus = environment.musicBus();
        if (!bus) return;
        const freq = midiToFreq(midi);
        for (const [ratio, gain] of [[0.5, 0.17], [1, 0.09]] as const) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + dur + 1.4,
            oscillatorType: 'sine',
            frequency: freq * ratio,
            gainAutomation: [
              { type: 'set', value: 0.0001, time },
              { type: 'linearRamp', value: gain * vel, time: time + 0.5 },
              { type: 'set', value: gain * vel, time: time + dur },
              { type: 'exponentialRamp', value: 0.001, time: time + dur + 1.2 },
            ],
            destination: bus.duck,
            sends: [{ destination: bus.reverbSend ?? bus.duck, gain: 0.25 }],
          });
        }
      },

      // Gedact flute stop: soft, breathy, the first voice to answer the pedal.
      flute(context: AudioContext, time: number, midi: number, vel = 1, dur = 1.6) {
        const bus = environment.musicBus();
        if (!bus) return;
        for (const [type, octave, gain] of [
          ['triangle', 0, 0.1],
          ['sine', 1, 0.028],
        ] as const) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + dur + 0.6,
            oscillatorType: type,
            frequency: midiToFreq(midi + octave * 12),
            gainAutomation: [
              { type: 'set', value: 0.0001, time },
              { type: 'linearRamp', value: gain * vel, time: time + 0.09 },
              { type: 'exponentialRamp', value: Math.max(0.001, gain * vel * 0.6), time: time + dur },
              { type: 'exponentialRamp', value: 0.001, time: time + dur + 0.5 },
            ],
            destination: bus.duck,
            sends: [{ destination: bus.reverbSend ?? bus.duck, gain: 0.4 }],
          });
        }
      },

      // Principal stop: the solid mid-organ tone, a filtered saw with speech.
      principal(context: AudioContext, time: number, midi: number, vel = 1, dur = 0.9) {
        const bus = environment.musicBus();
        if (!bus) return;
        playOscillatorVoice({
          context,
          time,
          stopTime: time + dur + 0.4,
          oscillatorType: 'sawtooth',
          frequency: midiToFreq(midi),
          filter: { type: 'lowpass', frequency: 1500, Q: 0.6 },
          gainAutomation: [
            { type: 'set', value: 0.0001, time },
            { type: 'linearRamp', value: 0.05 * vel, time: time + 0.03 },
            { type: 'exponentialRamp', value: Math.max(0.001, 0.05 * vel * 0.65), time: time + dur },
            { type: 'exponentialRamp', value: 0.001, time: time + dur + 0.3 },
          ],
          destination: bus.duck,
          sends: [{ destination: bus.reverbSend ?? bus.duck, gain: 0.35 }],
        });
      },

      // The tune: a wide, slightly detuned sine pair — the voice the whole
      // counterpoint exists to carry.
      soprano(context: AudioContext, time: number, midi: number, vel = 1, dur = 1.6) {
        const bus = environment.musicBus();
        if (!bus) return;
        for (const detune of [-5, 5]) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + dur + 0.7,
            oscillatorType: 'sine',
            frequency: midiToFreq(midi),
            detune,
            gainAutomation: [
              { type: 'set', value: 0.0001, time },
              { type: 'linearRamp', value: 0.055 * vel, time: time + 0.18 },
              { type: 'exponentialRamp', value: Math.max(0.001, 0.055 * vel * 0.7), time: time + dur },
              { type: 'exponentialRamp', value: 0.001, time: time + dur + 0.6 },
            ],
            destination: bus.duck,
            sends: [{ destination: bus.reverbSend ?? bus.duck, gain: 0.45 }],
          });
        }
      },

      // Choir weight for the swells: detuned saws behind a slow-opening
      // filter — a human-ish pad, never percussive.
      choir(context: AudioContext, time: number, midi: number, vel = 1, dur = 5.6) {
        const bus = environment.musicBus();
        if (!bus) return;
        for (const detune of [-8, 8]) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + dur + 1.6,
            oscillatorType: 'sawtooth',
            frequency: midiToFreq(midi),
            detune,
            filter: {
              type: 'lowpass',
              frequencyAutomation: [
                { type: 'set', value: 420, time },
                { type: 'linearRamp', value: 950, time: time + dur * 0.55 },
                { type: 'linearRamp', value: 480, time: time + dur },
              ],
            },
            gainAutomation: [
              { type: 'set', value: 0.0001, time },
              { type: 'linearRamp', value: 0.024 * vel, time: time + 1.4 },
              { type: 'set', value: 0.024 * vel, time: time + dur - 1.0 },
              { type: 'exponentialRamp', value: 0.001, time: time + dur + 1.4 },
            ],
            destination: bus.duck,
            sends: [{ destination: bus.reverbSend ?? bus.duck, gain: 0.5 }],
          });
        }
      },

      // Bell weight: inharmonic partials, long decay, a strike of noise.
      bell(context: AudioContext, time: number, midi: number, vel = 1) {
        const bus = environment.musicBus();
        if (!bus) return;
        const base = midiToFreq(midi);
        for (const [ratio, gain, decay] of [
          [1, 0.085, 3.4],
          [2.74, 0.032, 2.2],
          [5.43, 0.014, 1.1],
        ] as const) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + decay + 0.3,
            oscillatorType: 'sine',
            frequency: base * ratio,
            gainAutomation: [
              { type: 'set', value: gain * vel, time },
              { type: 'exponentialRamp', value: 0.001, time: time + decay },
            ],
            destination: bus.duck,
            sends: [
              { destination: bus.reverbSend ?? bus.duck, gain: 0.55 },
              { destination: bus.delaySend ?? bus.duck, gain: 0.2 },
            ],
          });
        }
        if (bus.noiseBuffer) {
          playNoiseHit({
            context,
            buffer: bus.noiseBuffer,
            time,
            velocity: 0.03 * vel,
            decay: 0.08,
            filterType: 'bandpass',
            frequency: base * 6,
            destination: bus.duck,
          });
        }
      },

      riser(context: AudioContext, time: number, dur = 5.7) {
        const bus = environment.musicBus();
        if (!bus || !bus.noiseBuffer) return;
        const source = context.createBufferSource();
        source.buffer = bus.noiseBuffer;
        source.loop = true;
        const filter = context.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 1.4;
        applyAutomation(filter.frequency, [
          { type: 'set', value: 180, time },
          { type: 'exponentialRamp', value: 2600, time: time + dur },
        ]);
        const gain = context.createGain();
        applyAutomation(gain.gain, [
          { type: 'set', value: 0.0001, time },
          { type: 'exponentialRamp', value: 0.075, time: time + dur * 0.85 },
          { type: 'exponentialRamp', value: 0.001, time: time + dur + 0.2 },
        ]);
        source.connect(filter).connect(gain).connect(bus.duck);
        const send = context.createGain();
        send.gain.value = 0.4;
        gain.connect(send).connect(bus.reverbSend ?? bus.duck);
        source.start(time);
        source.stop(time + dur + 0.3);
      },

      noise(context: AudioContext, time: number, vel = 0.05, decay = 0.08, type: BiquadFilterType = 'highpass', freq = 3000) {
        const bus = environment.musicBus();
        if (!bus || !bus.noiseBuffer) return;
        playNoiseHit({
          context,
          buffer: bus.noiseBuffer,
          time,
          velocity: vel,
          decay,
          filterType: type,
          frequency: freq,
          destination: bus.duck,
        });
      },
};
  return defineInstruments(
    environment,
    defs as never,
    {
      pedal: ['time', 'midi', 'vel', 'dur'],
      flute: ['time', 'midi', 'vel', 'dur'],
      principal: ['time', 'midi', 'vel', 'dur'],
      soprano: ['time', 'midi', 'vel', 'dur'],
      choir: ['time', 'midi', 'vel', 'dur'],
      bell: ['time', 'midi', 'vel'],
      riser: ['time', 'dur'],
      noise: ['time', 'vel', 'decay', 'type', 'freq'],
    },
  ) as unknown as VespersVoiceArgs;
}
