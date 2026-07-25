import { midiToFreq } from '../../engine/music';

// Web Audio Organ Synthesis primitives for Vespers
export function playPedalVoice(
  ctx: AudioContext,
  dest: AudioNode,
  time: number,
  freq: number,
  duration: number,
  gainVal = 0.35,
) {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(freq, time);

  osc2.type = 'sawtooth';
  osc2.frequency.setValueAtTime(freq * 1.002, time); // Subtle pipe detune

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(320, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(gainVal, time + 0.15); // Smooth pipe envelope
  gain.gain.setValueAtTime(gainVal, time + Math.max(0.15, duration - 0.2));
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(dest);

  osc1.start(time);
  osc2.start(time);
  osc1.stop(time + duration + 0.05);
  osc2.stop(time + duration + 0.05);
}

export function playOrganVoice(
  ctx: AudioContext,
  dest: AudioNode,
  time: number,
  freq: number,
  duration: number,
  gainVal = 0.2,
  isBright = false,
) {
  // Pipe organ voice composed of fundamental (8'), octave (4'), and fifth (2 2/3')
  const osc8 = ctx.createOscillator();
  const osc4 = ctx.createOscillator();
  const oscQuint = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc8.type = isBright ? 'sawtooth' : 'triangle';
  osc8.frequency.setValueAtTime(freq, time);

  osc4.type = 'sine';
  osc4.frequency.setValueAtTime(freq * 2, time);

  oscQuint.type = 'sine';
  oscQuint.frequency.setValueAtTime(freq * 3, time);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(isBright ? 3500 : 2200, time);

  const attack = 0.04;
  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(gainVal, time + attack);
  gain.gain.setValueAtTime(gainVal * 0.85, time + duration - 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration + 0.1);

  osc8.connect(filter);
  osc4.connect(filter);
  oscQuint.connect(filter);
  filter.connect(gain);
  gain.connect(dest);

  osc8.start(time);
  osc4.start(time);
  oscQuint.start(time);
  const stopTime = time + duration + 0.15;
  osc8.stop(stopTime);
  osc4.stop(stopTime);
  oscQuint.stop(stopTime);
}

export function playTuttiOrganVoice(
  ctx: AudioContext,
  dest: AudioNode,
  time: number,
  freq: number,
  duration: number,
  gainVal = 0.3,
) {
  // Full Cathedral Tutti Organ: 16', 8', 4', 2', and mixture rank with reed bite
  const osc16 = ctx.createOscillator();
  const osc8 = ctx.createOscillator();
  const osc4 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const oscReed = ctx.createOscillator();

  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc16.type = 'sawtooth';
  osc16.frequency.setValueAtTime(freq * 0.5, time);

  osc8.type = 'sawtooth';
  osc8.frequency.setValueAtTime(freq, time);

  osc4.type = 'square';
  osc4.frequency.setValueAtTime(freq * 2, time);

  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(freq * 4, time);

  oscReed.type = 'sawtooth';
  oscReed.frequency.setValueAtTime(freq * 1.003, time);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(6500, time);
  filter.Q.setValueAtTime(1.5, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(gainVal, time + 0.06);
  gain.gain.setValueAtTime(gainVal, time + duration - 0.04);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration + 0.2);

  osc16.connect(filter);
  osc8.connect(filter);
  osc4.connect(filter);
  osc2.connect(filter);
  oscReed.connect(filter);
  filter.connect(gain);
  gain.connect(dest);

  const stopTime = time + duration + 0.25;
  osc16.start(time);
  osc8.start(time);
  osc4.start(time);
  osc2.start(time);
  oscReed.start(time);

  osc16.stop(stopTime);
  osc8.stop(stopTime);
  osc4.stop(stopTime);
  osc2.stop(stopTime);
  oscReed.stop(stopTime);
}

export function playChoirSwellVoice(
  ctx: AudioContext,
  dest: AudioNode,
  time: number,
  freq: number,
  duration: number,
  gainVal = 0.15,
) {
  // Cathedral vocal choir swell using dual formant filters
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const f1 = ctx.createBiquadFilter();
  const f2 = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(freq, time);
  osc2.type = 'sawtooth';
  osc2.frequency.setValueAtTime(freq * 1.005, time);

  // 'Ah/Oh' vocal formants
  f1.type = 'bandpass';
  f1.frequency.setValueAtTime(700, time);
  f1.Q.setValueAtTime(3.0, time);

  f2.type = 'bandpass';
  f2.frequency.setValueAtTime(1200, time);
  f2.Q.setValueAtTime(3.5, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(gainVal, time + 0.25);
  gain.gain.setValueAtTime(gainVal, time + duration - 0.2);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration + 0.3);

  osc1.connect(f1);
  osc2.connect(f2);
  f1.connect(gain);
  f2.connect(gain);
  gain.connect(dest);

  const stopTime = time + duration + 0.35;
  osc1.start(time);
  osc2.start(time);
  osc1.stop(stopTime);
  osc2.stop(stopTime);
}

// Player gameplay action sounds (Lock, Fire, Hit, Kill, Reject)
export function playOrganLockSound(ctx: AudioContext, dest: AudioNode, time: number, midiNote: number) {
  const freq = midiToFreq(midiNote);
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, time);

  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2400, time);
  filter.Q.setValueAtTime(2.0, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(0.12, time + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(dest);

  osc.start(time);
  osc.stop(time + 0.1);
}

export function playOrganFireSound(ctx: AudioContext, dest: AudioNode, time: number, midiNotes: number[]) {
  for (let i = 0; i < midiNotes.length; i++) {
    const note = midiNotes[i];
    const noteTime = time + i * 0.025;
    const freq = midiToFreq(note);

    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, noteTime);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, noteTime);

    gain.gain.setValueAtTime(0.001, noteTime);
    gain.gain.linearRampToValueAtTime(0.1, noteTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.18);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    osc.start(noteTime);
    osc.stop(noteTime + 0.2);
  }
}

export function playOrganKillSound(
  ctx: AudioContext,
  dest: AudioNode,
  time: number,
  midiNote: number,
  isBossKill = false,
) {
  const freq = midiToFreq(midiNote);

  if (isBossKill) {
    // Conclusive Tutti organ finale chord for boss destruction
    const chord = [midiNote, midiNote + 4, midiNote + 7, midiNote + 12];
    for (const note of chord) {
      playTuttiOrganVoice(ctx, dest, time, midiToFreq(note), 2.5, 0.35);
    }
    return;
  }

  // Melodic organ pipe kill note
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc1.type = 'triangle';
  osc1.frequency.setValueAtTime(freq, time);

  osc2.type = 'sawtooth';
  osc2.frequency.setValueAtTime(freq * 2, time);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(4200, time);

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(0.18, time + 0.015);
  gain.gain.setValueAtTime(0.15, time + 0.12);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.45);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(dest);

  osc1.start(time);
  osc2.start(time);
  const stopTime = time + 0.5;
  osc1.stop(stopTime);
  osc2.stop(stopTime);
}

export function playOrganRejectSound(ctx: AudioContext, dest: AudioNode, time: number) {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  // Dissonant minor second (stopped pipe error)
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(146.83, time); // D3
  osc2.type = 'sawtooth';
  osc2.frequency.setValueAtTime(155.56, time); // Eb3

  gain.gain.setValueAtTime(0.001, time);
  gain.gain.linearRampToValueAtTime(0.15, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(dest);

  osc1.start(time);
  osc2.start(time);
  osc1.stop(time + 0.18);
  osc2.stop(time + 0.18);
}
