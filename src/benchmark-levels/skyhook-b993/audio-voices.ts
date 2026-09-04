import { defineInstruments, playNoiseHit, type MixBus } from '../../engine/audio-kit';
import { voice, type VoiceSpec } from '../../engine/audio-voices';
import type { AudioTraceSink } from '../../engine/audio-trace';
export type VoiceName = 'pad' | 'bass' | 'pluck' | 'lock' | 'fire' | 'kill' | 'impact';
export function createSkyhookVoices(env: { context(): AudioContext | null; mix(): MixBus | null; trace?: AudioTraceSink }, specs: Record<VoiceName, VoiceSpec>) {
  const voices = Object.fromEntries(Object.entries(specs).map(([name, spec]) => [name, voice(spec)])) as Record<VoiceName, ReturnType<typeof voice>>;
  return defineInstruments(env, {
    tone(context, time: number, name: VoiceName, midi: number, gain: number, duration: number, pan: number, player: boolean) {
      const mix = env.mix(); if (!mix) return;
      const output = player ? mix.sfx : mix.duck;
      const stereo = context.createStereoPanner(); stereo.pan.value = pan; stereo.connect(output);
      const parts = voices[name].play({ context, time, midi, gain, duration, destination: stereo,
        sends: mix.reverbSend ? [{ destination: mix.reverbSend, gain: player ? 0.12 : 0.28 }] : [] });
      // Audio-clock cleanup preserves sustained notes across pause and resume.
      let remaining = parts.length;
      for (const part of parts) part.oscillator.addEventListener('ended', () => {
        part.oscillator.disconnect(); part.gain.disconnect();
        if (--remaining === 0) stereo.disconnect();
      }, { once: true });
    },
    air(context, time: number, gain: number, decay: number, frequency: number, player: boolean) {
      const mix = env.mix(); if (!mix?.noiseBuffer) return;
      playNoiseHit({ context, time, buffer: mix.noiseBuffer, velocity: gain, decay, filterType: 'bandpass', frequency, destination: player ? mix.sfx : mix.duck });
    },
  });
}
