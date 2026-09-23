import { defineInstruments, playOscillatorVoice, type MixBus } from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { noiseHit as noiseHitSpec, voice } from '../../engine/audio-voices';
import { midiToFreq } from '../../engine/music';

// Leaf: every sound in Speedsolve is built from the same small kit of clean,
// hard-attack voices — a ratchet click, a plastic snap, a hollow thock. The
// drum patterns and the cube's own turns call the very same instruments, so a
// player-caused rotation is literally a fill played on the band's kit.

export type VoiceEnvironment = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
};

export type Lane = 'music' | 'sfx';

export function createSpeedsolveVoices(environment: VoiceEnvironment) {
  const destination = (lane: Lane) => {
    const mix = environment.mix();
    if (!mix) return null;
    return lane === 'music' ? mix.duck : mix.sfx;
  };
  const sends = (delay: number, reverb: number) => {
    const mix = environment.mix();
    const list: Array<{ destination: AudioNode; gain: number }> = [];
    if (mix?.delaySend && delay > 0) list.push({ destination: mix.delaySend, gain: delay });
    if (mix?.reverbSend && reverb > 0) list.push({ destination: mix.reverbSend, gain: reverb });
    return list;
  };

  const noise = noiseHitSpec({ filterType: 'bandpass', frequency: 2000, velocity: 1, decay: 0.03 });
  function noiseBurst(context: AudioContext, time: number, vel: number, decay: number, type: BiquadFilterType, frequency: number, out: AudioNode) {
    const buffer = environment.mix()?.noiseBuffer;
    if (!buffer) return;
    noise.play({ context, buffer, time, velocity: vel, decay, filterType: type, frequency, destination: out, offset: Math.random() * 1.6 });
  }

  const thockBody = voice<{ vel: number; drop: number }>({
    oscillators: [{ type: 'sine' }],
    duration: 0.32,
    stopPadding: 0.03,
    frequencyAutomation: (time, _frequency, { drop }) => [{ type: 'exponentialRamp', value: drop, time: time + 0.085 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.5 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.3 },
    ],
  });

  const blip = voice<{ vel: number; decay: number }>({
    oscillators: [{ type: 'sine' }],
    duration: ({ decay }) => decay,
    stopPadding: 0.01,
    gainAutomation: (time, _gain, { vel, decay }) => [
      { type: 'set', value: vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  const snapBody = voice<{ vel: number }>({
    oscillators: [
      { type: 'triangle', gain: 1 },
      { type: 'sine', octave: -1, gain: 0.9 },
    ],
    duration: 0.09,
    stopPadding: 0.02,
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.94, time: time + 0.05 }],
    gainAutomation: (time, _gain, { vel }) => [
      { type: 'set', value: 0.16 * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.085 },
    ],
  });

  const bassPluck = voice<{ vel: number; length: number }>({
    oscillators: [
      { type: 'square', gain: 0.075 },
      { type: 'sine', gain: 0.24 },
    ],
    duration: ({ length }) => length,
    stopPadding: 0.03,
    filter: {
      type: 'lowpass',
      Q: 3,
      frequencyAutomation: (time, { vel, length }) => [
        { type: 'set', value: 380 + vel * 1300, time },
        { type: 'exponentialRamp', value: 180, time: time + length * 0.8 },
      ],
    },
    gainAutomation: (time, gain, { length }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: gain * 0.35, time: time + length * 0.45 },
      { type: 'exponentialRamp', value: 0.001, time: time + length },
    ],
  });

  const malletTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'sine', gain: 0.13 },
      { type: 'sine', frequencyRatio: 4, gain: 0.035 },
    ],
    duration: 0.34,
    stopPadding: 0.02,
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: gain * vel, time },
      { type: 'exponentialRamp', value: gain * vel * 0.25, time: time + 0.06 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.32 },
    ],
  });

  const stabTone = voice<{ vel: number }>({
    oscillators: [{ type: 'square', gain: 0.03 }],
    duration: 0.13,
    stopPadding: 0.02,
    filter: {
      type: 'lowpass',
      frequencyAutomation: (time) => [
        { type: 'set', value: 3200, time },
        { type: 'exponentialRamp', value: 700, time: time + 0.12 },
      ],
    },
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: gain * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.12 },
    ],
  });

  const glassTone = voice<{ vel: number; length: number }>({
    oscillators: [
      { type: 'sine', gain: 0.075 },
      { type: 'sine', frequencyRatio: 2.76, gain: 0.018 },
      { type: 'sine', frequencyRatio: 5.4, gain: 0.006 },
    ],
    duration: ({ length }) => length,
    stopPadding: 0.03,
    gainAutomation: (time, gain, { vel, length }) => [
      { type: 'set', value: gain * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + length },
    ],
  });

  const airTone = voice<{ vel: number; seconds: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.03 },
      { type: 'sine', octave: 1, gain: 0.012 },
    ],
    duration: ({ seconds }) => seconds,
    stopPadding: 0.05,
    filter: { type: 'lowpass', frequency: 2400 },
    gainAutomation: (time, gain, { vel, seconds }) => [
      { type: 'set', value: 0.0001, time },
      { type: 'linearRamp', value: gain * vel, time: time + Math.min(0.6, seconds * 0.3) },
      { type: 'linearRamp', value: gain * vel * 0.7, time: time + seconds * 0.7 },
      { type: 'linearRamp', value: 0.0001, time: time + seconds },
    ],
  });

  const lockTone = voice<{ vel: number; lockCount: number }>({
    oscillators: [
      { type: 'square', gain: 0.022 },
      { type: 'sine', octave: 1, gain: 0.05 },
    ],
    duration: 0.07,
    stopPadding: 0.02,
    filter: { type: 'lowpass', cutoff: ({ lockCount }) => 2400 + lockCount * 420 },
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: gain * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.065 },
    ],
  });

  const zapTone = voice<{ vel: number }>({
    oscillators: [{ type: 'triangle', gain: 0.1 }],
    duration: 0.075,
    stopPadding: 0.02,
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.5, time: time + 0.06 }],
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: gain * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.07 },
    ],
  });

  const plinkTone = voice<{ vel: number; bright: number }>({
    oscillators: [
      { type: 'sine', gain: 0.15 },
      { type: 'triangle', octave: 1, gain: ({ bright }) => 0.025 + bright * 0.04 },
      { type: 'sine', frequencyRatio: 3.01, gain: ({ bright }) => 0.012 + bright * 0.02 },
    ],
    duration: 0.42,
    stopPadding: 0.03,
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: gain * vel, time },
      { type: 'exponentialRamp', value: gain * vel * 0.3, time: time + 0.07 },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.4 },
    ],
  });

  const clankTone = voice<{ intensity: number }>({
    oscillators: [
      { type: 'square', gain: 0.03 },
      { type: 'sine', frequencyRatio: 1.5, gain: 0.08 },
      { type: 'sine', frequencyRatio: 2.37, gain: 0.05 },
    ],
    duration: 0.3,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ intensity }) => 1800 + intensity * 3600 },
    gainAutomation: (time, gain, { intensity }) => [
      { type: 'set', value: gain * (0.8 + intensity * 0.7), time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.28 },
    ],
  });

  const buzzTone = voice<{ vel: number }>({
    oscillators: [
      { type: 'square', gain: 0.05 },
      { type: 'square', frequencyRatio: 1.059, gain: 0.05 },
    ],
    duration: 0.16,
    stopPadding: 0.02,
    filter: { type: 'lowpass', frequency: 1300 },
    frequencyAutomation: (time, frequency) => [{ type: 'exponentialRamp', value: frequency * 0.7, time: time + 0.14 }],
    gainAutomation: (time, gain, { vel }) => [
      { type: 'set', value: gain * vel, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.15 },
    ],
  });

  const instruments = defineInstruments(environment, {
    /** Hollow plastic kick: the cube's body struck. */
    thock(context: AudioContext, time: number, vel: number, lane: Lane) {
      const out = destination(lane);
      if (!out) return;
      thockBody.play({ context, time, frequency: 150, vel, drop: 46, destination: out });
      noiseBurst(context, time, 0.09 * vel, 0.012, 'bandpass', 3400, out);
    },
    /** Ratchet click: the hi-hat and the detent of every turning slice. */
    click(context: AudioContext, time: number, vel: number, frequency: number, lane: Lane) {
      const out = destination(lane);
      if (!out) return;
      noiseBurst(context, time, 0.2 * vel, 0.011, 'highpass', frequency, out);
      blip.play({ context, time, frequency: frequency * 0.75, vel: 0.03 * vel, decay: 0.012, destination: out });
    },
    /** Plastic snap: the snare, and the landing of every turn. */
    snap(context: AudioContext, time: number, vel: number, midi: number, lane: Lane) {
      const out = destination(lane);
      if (!out) return;
      noiseBurst(context, time, 0.26 * vel, 0.04, 'bandpass', 2100, out);
      noiseBurst(context, time, 0.09 * vel, 0.018, 'highpass', 6500, out);
      snapBody.play({ context, time, midi, vel, destination: out, sends: sends(0, 0.18) });
    },
    bass(context: AudioContext, time: number, midi: number, vel: number, length: number) {
      const out = destination('music');
      if (!out) return;
      bassPluck.play({ context, time, midi, vel, length, destination: out });
    },
    mallet(context: AudioContext, time: number, midi: number, vel: number, lane: Lane) {
      const out = destination(lane);
      if (!out) return;
      malletTone.play({ context, time, midi, vel, destination: out, sends: sends(0.22, 0.12) });
    },
    stab(context: AudioContext, time: number, midis: number[], vel: number) {
      const out = destination('music');
      if (!out) return;
      for (const midi of midis) stabTone.play({ context, time, midi, vel, destination: out, sends: sends(0.18, 0.1) });
    },
    glass(context: AudioContext, time: number, midi: number, vel: number, length: number, lane: Lane) {
      const out = destination(lane);
      if (!out) return;
      glassTone.play({ context, time, midi, vel, length, destination: out, sends: sends(0.35, 0.3) });
    },
    air(context: AudioContext, time: number, midis: number[], seconds: number, vel: number) {
      const out = destination('music');
      if (!out) return;
      for (const midi of midis) airTone.play({ context, time, midi, vel, seconds, destination: out, sends: sends(0, 0.4) });
    },
    riser(context: AudioContext, time: number, seconds: number, vel: number) {
      const out = destination('music');
      const buffer = environment.mix()?.noiseBuffer;
      if (!out || !buffer) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 4;
      filter.frequency.setValueAtTime(500, time);
      filter.frequency.exponentialRampToValueAtTime(7000, time + seconds);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.09 * vel, time + seconds * 0.95);
      gain.gain.linearRampToValueAtTime(0.0001, time + seconds + 0.02);
      source.connect(filter).connect(gain).connect(out);
      source.start(time);
      source.stop(time + seconds + 0.05);
    },
    lockTick(context: AudioContext, time: number, midi: number, lockCount: number) {
      const out = destination('sfx');
      if (!out) return;
      lockTone.play({ context, time, midi, vel: 1, lockCount, destination: out, sends: sends(0.2, 0) });
      noiseBurst(context, time, 0.05, 0.008, 'highpass', 7000, out);
    },
    zap(context: AudioContext, time: number, midi: number, vel: number) {
      const out = destination('sfx');
      if (!out) return;
      zapTone.play({ context, time, midi, vel, destination: out });
    },
    plink(context: AudioContext, time: number, midi: number, vel: number, bright: number) {
      const out = destination('sfx');
      if (!out) return;
      plinkTone.play({ context, time, midi, vel, bright, destination: out, sends: sends(0.3, 0.16) });
    },
    clank(context: AudioContext, time: number, midi: number, intensity: number) {
      const out = destination('sfx');
      if (!out) return;
      clankTone.play({ context, time, midi, intensity, destination: out, sends: sends(0.2, 0.2) });
      noiseBurst(context, time, 0.14 + intensity * 0.1, 0.05, 'bandpass', 1500 + intensity * 1500, out);
    },
    /** A face's worth of loose cubies clattering away: a falling cascade of clicks. */
    shower(context: AudioContext, time: number, count: number, seconds: number, rootMidi: number) {
      const out = destination('sfx');
      if (!out) return;
      for (let i = 0; i < count; i += 1) {
        const u = i / count;
        const at = time + seconds * (u ** 1.35) + Math.random() * 0.012;
        const frequency = 5200 - u * 3600 + Math.random() * 600;
        noiseBurst(context, at, (0.11 - u * 0.07) * (0.6 + Math.random() * 0.4), 0.01, 'highpass', frequency, out);
        if (i % 4 === 0) blip.play({ context, time: at, midi: rootMidi + 24 + ((i * 7) % 12), vel: 0.018 * (1 - u), decay: 0.03, destination: out });
      }
      thockBody.play({ context, time, frequency: 120, vel: 0.6, drop: 38, destination: out });
    },
    boom(context: AudioContext, time: number, vel: number) {
      const out = destination('sfx');
      if (!out) return;
      thockBody.play({ context, time, frequency: 92, vel: vel, drop: 30, destination: out });
      noiseBurst(context, time, 0.22 * vel, 0.14, 'bandpass', 800, out);
    },
    buzz(context: AudioContext, time: number, midi: number) {
      const out = destination('sfx');
      if (!out) return;
      buzzTone.play({ context, time, midi, vel: 1, destination: out });
      buzzTone.play({ context, time: time + 0.07, midi: midi - 1, vel: 0.7, destination: out });
      noiseBurst(context, time, 0.12, 0.06, 'bandpass', 900, out);
    },
    /** A long bright chord for conquests and the finale; saws under a filter sweep. */
    bloom(context: AudioContext, time: number, midis: number[], seconds: number, vel: number) {
      const out = destination('sfx');
      if (!out) return;
      for (const midi of midis) {
        for (const detune of [-5, 5]) {
          playOscillatorVoice({
            context,
            time,
            stopTime: time + seconds + 0.05,
            oscillatorType: 'sawtooth',
            frequency: midiToFreq(midi),
            detune,
            filter: {
              type: 'lowpass',
              frequencyAutomation: [
                { type: 'set', value: 900, time },
                { type: 'exponentialRamp', value: 4200, time: time + seconds * 0.3 },
                { type: 'exponentialRamp', value: 800, time: time + seconds },
              ],
            },
            gainAutomation: [
              { type: 'set', value: 0.022 * vel, time },
              { type: 'exponentialRamp', value: 0.001, time: time + seconds },
            ],
            destination: out,
            sends: sends(0.3, 0.35),
          });
        }
      }
    },
  });

  return instruments;
}

export type SpeedsolveVoices = ReturnType<typeof createSpeedsolveVoices>;
