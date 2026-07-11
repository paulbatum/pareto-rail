import type { EventBus } from '../../events';
import { createBeatLevelAudio } from '../../engine/audio-kit';
import { secondsPerStep, midiToFreq } from '../../engine/music';
import { DOWNPOUR_OU7E_BPM } from './gameplay';

const STEP = secondsPerStep(DOWNPOUR_OU7E_BPM, 4);

// A dry, fast DnB bed: sub on the floor, rain-hats above it, and the player
// is allowed to become the lead line rather than an overlay of generic SFX.
export function createAudio(bus: EventBus) {
  let runtime: ReturnType<typeof createBeatLevelAudio>;
  const tone = (time: number, midi: number, gain: number, duration: number, type: OscillatorType = 'triangle') => {
    const ctx = runtime.context(), mix = runtime.mix(); if (!ctx || !mix) return;
    const osc = ctx.createOscillator(), amp = ctx.createGain(); osc.type = type; osc.frequency.value = midiToFreq(midi);
    amp.gain.setValueAtTime(gain, time); amp.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(amp).connect(mix.music); osc.start(time); osc.stop(time + duration + 0.03);
  };
  const hiss = (time: number, gain: number, duration: number) => {
    const ctx = runtime.context(), mix = runtime.mix(); if (!ctx || !mix?.noiseBuffer) return;
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain(); filter.type = 'highpass'; filter.frequency.value = 5500;
    amp.gain.setValueAtTime(gain, time); amp.gain.exponentialRampToValueAtTime(0.001, time + duration);
    src.buffer = mix.noiseBuffer; src.connect(filter).connect(amp).connect(mix.music); src.start(time, (time * 7.31) % 1.2); src.stop(time + duration + 0.02);
  };
  runtime = createBeatLevelAudio({
    bus, bpm: DOWNPOUR_OU7E_BPM, stepSeconds: STEP, scheduleAhead: 0.14, schedulerMs: 24, runAlignment: 'bar',
    mix: { compressor: { threshold: -18, ratio: 6, attack: 0.004, release: 0.16 }, delay: { time: STEP * 3, feedback: 0.32, dampHz: 1800, sendGain: 0.25 }, noiseSeconds: 2 },
    onStep({ step, bar, time, mode }) {
      if (mode !== 'run') { if (step % 4 === 0) tone(time, 38, 0.045, 0.12); return; }
      const bass = [31, 31, 34, 29][bar % 4];
      // 0–10 sparse rain; 10/20 are the two lightning drops; 28 slows to
      // halftime undercity; 33 leaves moonlit negative space; 36 hunts.
      if (bar < 10) { if (step === 0) tone(time, bass, 0.11, 0.3, 'sine'); if (step === 7 || step === 15) hiss(time, 0.025, 0.06); return; }
      if (bar >= 33 && bar < 36) { if (step === 0) tone(time, bass + 12, 0.055, 0.55, 'triangle'); if (step === 12) hiss(time, 0.015, 0.18); return; }
      const halftime = bar >= 28 && bar < 33;
      if (step === 0 || (!halftime && (step === 6 || step === 10))) tone(time, bass, 0.2, step === 0 ? 0.22 : 0.12, 'sine');
      if (step % (halftime ? 4 : 2) === 1) hiss(time, bar >= 36 ? 0.07 : 0.045, 0.035);
      if (step === 4 || (!halftime && step === 12)) tone(time, bass + 12, 0.05, 0.08, 'square');
      if ((bar === 10 || bar === 20) && step === 0) { hiss(time, 0.22, 0.32); tone(time, 55, 0.13, 0.42, 'sawtooth'); }
      if (bar >= 36 && step % 4 === 0) tone(time, 50 + (step / 4) * 3, 0.06, 0.18, 'sawtooth');
    },
  });
  const actionTime = () => { const ctx = runtime.context(); return ctx ? Math.ceil(ctx.currentTime / STEP) * STEP : 0; };
  bus.on('lock', ({ lockCount }) => { const t = actionTime(); tone(t, 72 + lockCount * 2, 0.06, 0.12, 'sine'); });
  bus.on('fire', ({ volleySize }) => { const t = actionTime(); tone(t, 48 + volleySize * 2, 0.12, 0.17, 'square'); });
  bus.on('hit', ({ lethal, hitStageIndex }) => { const t = actionTime(); tone(t, lethal ? 84 : 60 + hitStageIndex * 4, lethal ? 0.11 : 0.06, lethal ? 0.35 : 0.12, 'sawtooth'); });
  bus.on('kill', () => { const t = actionTime(); tone(t, 76, 0.1, 0.3, 'triangle'); });
  bus.on('miss', () => { const ctx = runtime.context(); if (ctx) tone(ctx.currentTime, 36, 0.08, 0.15, 'sawtooth'); });
  bus.on('reject', () => { const ctx = runtime.context(); if (ctx) { tone(ctx.currentTime, 39, 0.09, 0.08, 'square'); hiss(ctx.currentTime, 0.09, 0.07); } });
  return runtime.audio;
}
