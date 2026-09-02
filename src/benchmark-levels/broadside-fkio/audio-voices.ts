import { midiToFreq } from '../../engine/music';
import { noiseHit, voice } from '../../engine/audio-voices';
import { defineInstruments, type MixBus } from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';

export type BroadsideVoicesOptions = {
  trace?: AudioTraceSink;
  context: () => AudioContext | null;
  mix: () => MixBus | null;
};

export function createBroadsideVoices({ trace, context, mix }: BroadsideVoicesOptions) {
  // ---- Orchestral synthesizers --------------------------------------------

  // Timpani: pitch-dropping resonant kettle drum
  const timpaniVoice = voice<{ midi: number; decay?: number }>({
    oscillators: [
      { type: 'sine', gain: 0.85 },
      { type: 'triangle', octave: 1, gain: 0.35 },
    ],
    duration: ({ decay = 0.8 }) => decay,
    stopPadding: 0.1,
    filter: { type: 'lowpass', frequency: 380, Q: 3.5 },
    frequencyAutomation: (time, frequency) => [
      { type: 'set', value: frequency * 1.8, time },
      { type: 'exponentialRamp', value: frequency, time: time + 0.08 },
    ],
    gainAutomation: (time, gain, { decay = 0.8 }) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + decay },
    ],
  });

  // Brass: majestic French horns & trumpets with brassy filter swell
  const brassVoice = voice<{ duration?: number; cutoff?: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.55 },
      { type: 'sawtooth', detune: 9, gain: 0.45 },
      { type: 'triangle', octave: -1, gain: 0.3 },
    ],
    duration: ({ duration = 0.6 }) => duration,
    stopPadding: 0.08,
    filter: {
      type: 'lowpass',
      cutoff: 1400,
      Q: 2.2,
      frequencyAutomation: (time, { cutoff = 3800 }) => [
        { type: 'set', value: 1200, time },
        { type: 'exponentialRamp', value: cutoff, time: time + 0.06 },
        { type: 'exponentialRamp', value: 1600, time: time + 0.5 },
      ],
    },
    envelope: { attack: 0.04, decay: 0.55, sustain: 0.4, release: 0.15 },
  });

  // Strings Ostinato: crisp, rhythmic staccato violins driving the battle
  const stringOstinatoVoice = voice({
    oscillators: [
      { type: 'sawtooth', gain: 0.4 },
      { type: 'triangle', detune: 7, gain: 0.45 },
    ],
    duration: 0.18,
    stopPadding: 0.04,
    filter: { type: 'lowpass', frequency: 2600, Q: 1.5 },
    envelope: { attack: 0.015, decay: 0.16, sustain: 0.2, release: 0.04 },
  });

  // Melodic Solo Kill Voice: shimmering celesta / glockenspiel
  const killVoice = voice<{ shimmer?: number }>({
    oscillators: [
      { type: 'sine', gain: 0.6 },
      { type: 'triangle', octave: 1, gain: 0.4 },
      { type: 'sine', octave: 2, gain: 0.25 },
    ],
    duration: 0.48,
    stopPadding: 0.08,
    filter: { type: 'lowpass', frequency: 4800, Q: 1.2 },
    gainAutomation: (time, gain) => [
      { type: 'set', value: gain, time },
      { type: 'exponentialRamp', value: 0.001, time: time + 0.48 },
    ],
  });

  // Lock Pip: bright harp / bell ping
  const lockVoice = voice<{ lockCount: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.5 },
      { type: 'sine', octave: 1, gain: 0.35 },
    ],
    duration: 0.12,
    stopPadding: 0.03,
    filter: { type: 'lowpass', cutoff: ({ lockCount }) => 2800 + lockCount * 300 },
    envelope: { attack: 0.005, decay: 0.11, sustain: 0.1, release: 0.02 },
  });

  // Fire / Volley: punchy brass accent
  const fireVoice = voice<{ volleySize: number }>({
    oscillators: [
      { type: 'sawtooth', gain: 0.45 },
      { type: 'square', octave: -1, gain: 0.35 },
    ],
    duration: 0.14,
    stopPadding: 0.04,
    filter: { type: 'lowpass', frequency: 3200, Q: 2.0 },
    envelope: { attack: 0.01, decay: 0.13, sustain: 0.1, release: 0.02 },
  });

  // Boss Impact / Shield Break: heavy orchestral gong & energy dispersion
  const bossHitVoice = voice<{ intensity: number }>({
    oscillators: [
      { type: 'triangle', gain: 0.7 },
      { type: 'sine', detune: 14, gain: 0.5 },
      { type: 'sawtooth', octave: -1, gain: 0.4 },
    ],
    duration: 1.2,
    stopPadding: 0.15,
    filter: { type: 'lowpass', frequency: 1800, Q: 3.0 },
    gainAutomation: (time, gain, { intensity }) => [
      { type: 'set', value: gain * (0.8 + intensity * 0.6), time },
      { type: 'exponentialRamp', value: 0.001, time: time + 1.2 },
    ],
  });

  // Noise percussion: snare and crash cymbal
  const snareHit = noiseHit({ filterType: 'bandpass', frequency: 1600, decay: 0.14 });
  const crashHit = noiseHit({ filterType: 'highpass', frequency: 3200, decay: 1.8 });
  const subThud = noiseHit({ filterType: 'lowpass', frequency: 180, decay: 0.35 });

  // ---- Instrument definitions ---------------------------------------------

  const inst = defineInstruments({ trace, context }, {
    timpani(ctx, time, midi, velocity = 1, decay = 0.8) {
      const bus = mix();
      if (!bus?.master) return;
      timpaniVoice.play({ context: ctx, time, midi, velocity: velocity * 0.9, decay, destination: bus.master });
    },
    brass(ctx, time, midi, velocity = 1, duration = 0.6, cutoff = 3800) {
      const bus = mix();
      if (!bus?.master) return;
      brassVoice.play({ context: ctx, time, midi, velocity: velocity * 0.75, duration, cutoff, destination: bus.master });
    },
    strings(ctx, time, midi, velocity = 1) {
      const bus = mix();
      if (!bus?.master) return;
      stringOstinatoVoice.play({ context: ctx, time, midi, velocity: velocity * 0.6, destination: bus.master });
    },
    pad(ctx, time, notes: readonly number[], velocity = 0.4, duration = 3.6) {
      const bus = mix();
      if (!bus?.master) return;
      for (const [index, midi] of notes.entries()) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(midiToFreq(midi), time);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200 + index * 180, time);
        
        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(velocity / Math.sqrt(notes.length), time + 0.4);
        gain.gain.setValueAtTime(velocity / Math.sqrt(notes.length), time + duration - 0.5);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

        osc.connect(filter).connect(gain).connect(bus.master);
        if (bus.reverbSend) gain.connect(bus.reverbSend);
        osc.start(time);
        osc.stop(time + duration + 0.1);
      }
    },
    snare(ctx, time, velocity = 0.8) {
      const bus = mix();
      if (!bus?.master || !bus.noiseBuffer) return;
      snareHit.play({ context: ctx, buffer: bus.noiseBuffer, time, velocity: velocity * 0.7, destination: bus.master });
    },
    crash(ctx, time, velocity = 0.9) {
      const bus = mix();
      if (!bus?.master || !bus.noiseBuffer) return;
      crashHit.play({ context: ctx, buffer: bus.noiseBuffer, time, velocity, destination: bus.master });
      if (bus.reverbSend) crashHit.play({ context: ctx, buffer: bus.noiseBuffer, time, velocity: velocity * 0.5, destination: bus.reverbSend });
    },
    thud(ctx, time, velocity = 1) {
      const bus = mix();
      if (!bus?.master || !bus.noiseBuffer) return;
      subThud.play({ context: ctx, buffer: bus.noiseBuffer, time, velocity, destination: bus.master });
    },
    killMelody(ctx, time, midi, velocity = 1) {
      const bus = mix();
      if (!bus?.master) return;
      killVoice.play({ context: ctx, time, midi, velocity: velocity * 0.85, destination: bus.master });
      if (bus.reverbSend) killVoice.play({ context: ctx, time, midi, velocity: velocity * 0.4, destination: bus.reverbSend });
    },
    lockPip(ctx, time, midi, lockCount: number) {
      const bus = mix();
      if (!bus?.master) return;
      lockVoice.play({ context: ctx, time, midi, lockCount, velocity: 0.5 + lockCount * 0.04, destination: bus.master });
    },
    fireAccent(ctx, time, midi, volleySize: number) {
      const bus = mix();
      if (!bus?.master) return;
      fireVoice.play({ context: ctx, time, midi, volleySize, velocity: 0.65 + volleySize * 0.05, destination: bus.master });
    },
    bossImpact(ctx, time, midi, intensity: number) {
      const bus = mix();
      if (!bus?.master) return;
      bossHitVoice.play({ context: ctx, time, midi, intensity, velocity: 0.85, destination: bus.master });
      if (bus.reverbSend) bossHitVoice.play({ context: ctx, time, midi, intensity, velocity: 0.5, destination: bus.reverbSend });
    },
  });

  return inst;
}
