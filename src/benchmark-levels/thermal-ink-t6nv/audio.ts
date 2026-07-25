import type { EventBus } from '../../events';
import { createBeatLevelAudio } from '../../engine/audio-kit';
import { secondsPerStep } from '../../engine/music';
import { THERMAL_INK_T6NV_BPM } from './timing';

const BEAT_SECONDS = secondsPerStep(THERMAL_INK_T6NV_BPM, 1);

// D Minor Haunting Lead Scale (D4, F4, G4, A4, C5, D5, F5)
const LEAD_MELODY = [
  293.66, 349.23, 392.00, 440.00, 523.25, 587.33, 698.46,
];

export function createAudio(bus: EventBus) {
  let ctx: AudioContext | null = null;
  let leadFilterNode: BiquadFilterNode | null = null;

  let currentStep = 0;
  let currentBar = 0;
  let isInfrared = false;

  const beatAudio = createBeatLevelAudio({
    bus,
    stepSeconds: BEAT_SECONDS,
    mix: {
      compressor: { threshold: -16, ratio: 4.5, attack: 0.004, release: 0.2 },
    },
    onPostBuild(context, _mix) {
      ctx = context;
      leadFilterNode = context.createBiquadFilter();
      leadFilterNode.type = 'bandpass';
      leadFilterNode.frequency.value = 1800;
      leadFilterNode.Q.value = 1.5;
    },
    onStep({ time, step }) {
      if (!ctx) return;
      currentStep = step % 16;
      currentBar = Math.floor(step / 16);

      // 1. Industrial Kick Pulse (Steps 0, 8)
      if (currentStep === 0 || currentStep === 8) {
        playKick(ctx, time, currentStep === 0 ? 1.0 : 0.7);
      }

      // 2. Sparse Metallic Percussion (Steps 4, 12 + sparse 16ths)
      if (currentStep === 4 || currentStep === 12) {
        playMetallicSnare(ctx, time);
      } else if (currentStep % 4 === 2 && currentBar % 2 === 1) {
        playMetallicHat(ctx, time);
      }

      // 3. Heavy Bouncing Synth Bass (Steps 0, 3, 6, 8, 11, 14)
      const bassPattern = [0, 3, 6, 8, 11, 14];
      if (bassPattern.includes(currentStep)) {
        const bassFreq = currentBar % 4 === 3 ? 65.41 : 73.42; // D2 or C2
        playBouncingBass(ctx, time, bassFreq, isInfrared ? 0.4 : 0.75);
      }

      // 4. Simple, Haunting Synth Melody
      const melodyPattern = [0, 4, 6, 8, 10, 12, 14];
      if (melodyPattern.includes(currentStep)) {
        const idx = (currentBar * 2 + Math.floor(currentStep / 2)) % LEAD_MELODY.length;
        const freq = LEAD_MELODY[idx];
        playHauntingLead(ctx, time, freq, leadFilterNode, isInfrared);
      }
    },
  });

  const audio = beatAudio.audio;

  // Listen to gameplay events for action audio
  bus.on('lock', () => {
    const context = beatAudio.context();
    if (context) playLockChime(context, context.currentTime);
  });

  bus.on('fire', () => {
    const context = beatAudio.context();
    if (context) playFireImpulse(context, context.currentTime);
  });

  bus.on('kill', () => {
    const context = beatAudio.context();
    if (context) playKillMelody(context, context.currentTime);
  });

  bus.on('runstart', () => {
    currentStep = 0;
    currentBar = 0;
  });

  return {
    ...audio,
    setInfraredMode(active: boolean) {
      isInfrared = active;
      const context = beatAudio.context();
      if (leadFilterNode && context) {
        const now = context.currentTime;
        // In IR: melody becomes brighter, sharply focused (+cutoff), noise & bass fall back
        leadFilterNode.frequency.setTargetAtTime(active ? 4200 : 1800, now, 0.15);
        leadFilterNode.Q.setTargetAtTime(active ? 4.5 : 1.5, now, 0.15);
      }
    },
  };
}

// Synth Voice Helpers
function playKick(ctx: AudioContext, time: number, gainVal: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(130, time);
  osc.frequency.exponentialRampToValueAtTime(35, time + 0.12);
  gain.gain.setValueAtTime(gainVal * 0.9, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.2);
}

function playMetallicSnare(ctx: AudioContext, time: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(240, time);
  osc.frequency.exponentialRampToValueAtTime(80, time + 0.08);
  gain.gain.setValueAtTime(0.4, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.14);
}

function playMetallicHat(ctx: AudioContext, time: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(800, time);
  gain.gain.setValueAtTime(0.12, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.06);
}

function playBouncingBass(ctx: AudioContext, time: number, freq: number, gainVal: number) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, time);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(600, time);
  filter.frequency.exponentialRampToValueAtTime(140, time + 0.14);

  gain.gain.setValueAtTime(gainVal * 0.6, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.18);
}

function playHauntingLead(
  ctx: AudioContext,
  time: number,
  freq: number,
  leadFilter: BiquadFilterNode | null,
  isIr: boolean,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, time);

  const gainVal = isIr ? 0.35 : 0.22;
  gain.gain.setValueAtTime(gainVal, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

  if (leadFilter) {
    osc.connect(leadFilter);
    leadFilter.connect(gain);
  } else {
    osc.connect(gain);
  }
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.38);
}

function playLockChime(ctx: AudioContext, time: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, time);
  osc.frequency.exponentialRampToValueAtTime(1320, time + 0.08);
  gain.gain.setValueAtTime(0.2, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.12);
}

function playFireImpulse(ctx: AudioContext, time: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(320, time);
  osc.frequency.exponentialRampToValueAtTime(60, time + 0.14);
  gain.gain.setValueAtTime(0.35, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.16);
}

function playKillMelody(ctx: AudioContext, time: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(587.33, time); // D5
  osc.frequency.exponentialRampToValueAtTime(1174.66, time + 0.15); // D6
  gain.gain.setValueAtTime(0.3, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.22);
}
