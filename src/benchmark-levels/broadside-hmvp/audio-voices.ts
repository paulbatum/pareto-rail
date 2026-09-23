import { defineInstruments, type MixBus } from '../../engine/audio-kit';
import type { AudioTraceSink } from '../../engine/audio-trace';
import { midiToFreq } from '../../engine/music';

// Leaf: the synthesized orchestra. Every instrument takes a start time and
// musical arguments only (pitches, durations, velocities); routing is fixed —
// orchestra into the duckable music bus with a hall send, the player's
// instruments into the sfx bus. The score in audio.ts decides every note.

type Env = {
  trace?: AudioTraceSink;
  context(): AudioContext | null;
  mix(): MixBus | null;
  noise(): AudioBuffer | null;
};

const FLOOR = 0.0001;

function connectOut(ctx: AudioContext, node: AudioNode, mix: MixBus, bus: 'music' | 'sfx', hall: number, echo = 0) {
  node.connect(bus === 'music' ? mix.duck : mix.sfx);
  if (hall > 0 && mix.reverbSend) {
    const send = ctx.createGain();
    send.gain.value = hall;
    node.connect(send).connect(mix.reverbSend);
  }
  if (echo > 0 && mix.delaySend) {
    const send = ctx.createGain();
    send.gain.value = echo;
    node.connect(send).connect(mix.delaySend);
  }
}

function envelope(param: AudioParam, t: number, attack: number, peak: number, hold: number, sustainLevel: number, release: number) {
  param.setValueAtTime(FLOOR, t);
  param.exponentialRampToValueAtTime(Math.max(FLOOR * 2, peak), t + Math.max(0.003, attack));
  param.setTargetAtTime(Math.max(FLOOR, peak * sustainLevel), t + attack, Math.max(0.01, hold * 0.35));
  param.setTargetAtTime(FLOOR, t + attack + hold, Math.max(0.01, release / 4));
}

function oscillator(ctx: AudioContext, type: OscillatorType, frequency: number, t: number, stop: number, detune = 0) {
  const node = ctx.createOscillator();
  node.type = type;
  node.frequency.setValueAtTime(frequency, t);
  node.detune.value = detune;
  node.start(t);
  node.stop(stop);
  return node;
}

function vibrato(ctx: AudioContext, targets: AudioParam[], t: number, stop: number, rate: number, cents: number, delay: number) {
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(cents, t + delay);
  lfo.connect(depth);
  for (const target of targets) depth.connect(target);
  lfo.start(t);
  lfo.stop(stop);
}

function noiseSource(ctx: AudioContext, buffer: AudioBuffer, t: number, stop: number, offset = Math.random()) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start(t, offset * Math.max(0, buffer.duration - 0.1));
  source.stop(stop);
  return source;
}

export function createOrchestra(env: Env) {
  const withMix = (run: (ctx: AudioContext, mix: MixBus) => void) => {
    const ctx = env.context();
    const mix = env.mix();
    if (ctx && mix) run(ctx, mix);
  };

  return defineInstruments({ trace: env.trace, context: env.context }, {
    /** String section: detuned saw ensemble with slow bow, vibrato, and a warm lowpass. */
    strings(_ctx: AudioContext, time: number, midis: number[], duration: number, velocity: number, brightness = 0.5) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(900 + brightness * 1400, time);
        filter.frequency.linearRampToValueAtTime(1300 + brightness * 2600, time + Math.min(duration, 1.2));
        filter.Q.value = 0.4;
        filter.connect(out);
        const stop = time + duration + 1.2;
        const detunes: AudioParam[] = [];
        for (const midi of midis) {
          for (const cents of [-9, 0, 8]) {
            const node = oscillator(ctx, 'sawtooth', midiToFreq(midi), time, stop, cents + (Math.random() - 0.5) * 4);
            node.connect(filter);
            detunes.push(node.detune);
          }
        }
        vibrato(ctx, detunes, time, stop, 5.2, 7, 0.5);
        const level = velocity * 0.05 / Math.sqrt(Math.max(1, midis.length));
        envelope(out.gain, time, Math.min(0.45, 0.12 + duration * 0.08), level, duration, 0.85, 0.9);
        connectOut(ctx, out, mix, 'music', 0.55);
      });
    },

    /** Spiccato ostinato: one short bowed stroke, octave-doubled with a sub body. */
    spiccato(_ctx: AudioContext, time: number, midi: number, velocity: number) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2600, time);
        filter.frequency.exponentialRampToValueAtTime(650, time + 0.13);
        filter.connect(out);
        const stop = time + 0.3;
        for (const [ratio, cents] of [[1, -6], [1, 6], [2, 0]] as const) {
          oscillator(ctx, 'sawtooth', midiToFreq(midi) * ratio, time, stop, cents).connect(filter);
        }
        const sub = ctx.createGain();
        sub.gain.value = 0.9;
        oscillator(ctx, 'sine', midiToFreq(midi), time, stop).connect(sub).connect(out);
        out.gain.setValueAtTime(FLOOR, time);
        out.gain.exponentialRampToValueAtTime(velocity * 0.06, time + 0.006);
        out.gain.exponentialRampToValueAtTime(FLOOR, time + 0.2);
        connectOut(ctx, out, mix, 'music', 0.25);
      });
    },

    /** Brass: saw pair with a blatty filter bloom and a pitch scoop into the note. */
    brass(_ctx: AudioContext, time: number, midi: number, duration: number, velocity: number, brightness = 0.6, bus: 'music' | 'sfx' = 'music') {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 1.2;
        const top = 700 + brightness * 3200 * Math.min(1.3, velocity + 0.3);
        filter.frequency.setValueAtTime(260, time);
        filter.frequency.exponentialRampToValueAtTime(top, time + 0.06);
        filter.frequency.setTargetAtTime(top * 0.62, time + 0.08, 0.2);
        filter.connect(out);
        const stop = time + duration + 0.5;
        const detunes: AudioParam[] = [];
        for (const [type, cents, gain] of [['sawtooth', -5, 1], ['sawtooth', 6, 1], ['square', 0, 0.35]] as const) {
          const node = oscillator(ctx, type, midiToFreq(midi), time, stop, cents);
          node.detune.setValueAtTime(cents - 38, time);
          node.detune.linearRampToValueAtTime(cents, time + 0.055);
          const g = ctx.createGain();
          g.gain.value = gain;
          node.connect(g).connect(filter);
          detunes.push(node.detune);
        }
        if (duration > 0.4) vibrato(ctx, detunes, time, stop, 5.4, 9, Math.min(0.6, duration * 0.5));
        envelope(out.gain, time, 0.03, velocity * 0.07, duration, 0.72, 0.18);
        connectOut(ctx, out, mix, bus, bus === 'music' ? 0.45 : 0.3);
      });
    },

    /** French horns: rounder, darker, slower to speak. */
    horn(_ctx: AudioContext, time: number, midi: number, duration: number, velocity: number) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(380, time);
        filter.frequency.exponentialRampToValueAtTime(900 + velocity * 900, time + 0.12);
        filter.Q.value = 0.8;
        filter.connect(out);
        const stop = time + duration + 0.7;
        const detunes: AudioParam[] = [];
        for (const [type, cents, gain] of [['sawtooth', -4, 0.8], ['triangle', 5, 1.2], ['sawtooth', 9, 0.5]] as const) {
          const node = oscillator(ctx, type, midiToFreq(midi), time, stop, cents);
          const g = ctx.createGain();
          g.gain.value = gain;
          node.connect(g).connect(filter);
          detunes.push(node.detune);
        }
        vibrato(ctx, detunes, time, stop, 5, 6, 0.4);
        envelope(out.gain, time, 0.07, velocity * 0.075, duration, 0.8, 0.3);
        connectOut(ctx, out, mix, 'music', 0.6);
      });
    },

    /** Trombones and tuba: the enemy's menace in the low register. */
    lowBrass(_ctx: AudioContext, time: number, midi: number, duration: number, velocity: number) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(180, time);
        filter.frequency.exponentialRampToValueAtTime(500 + velocity * 900, time + 0.05);
        filter.frequency.setTargetAtTime(420 + velocity * 300, time + 0.08, 0.15);
        filter.Q.value = 2;
        filter.connect(out);
        const stop = time + duration + 0.4;
        for (const cents of [-7, 7]) oscillator(ctx, 'sawtooth', midiToFreq(midi), time, stop, cents).connect(filter);
        const sub = ctx.createGain();
        sub.gain.value = 0.6;
        oscillator(ctx, 'sine', midiToFreq(midi - 12), time, stop).connect(sub).connect(out);
        envelope(out.gain, time, 0.02, velocity * 0.1, duration, 0.7, 0.15);
        connectOut(ctx, out, mix, 'music', 0.35);
      });
    },

    /** Timpani: tuned membrane with inharmonic partials and a felt mallet thump. */
    timpani(_ctx: AudioContext, time: number, midi: number, velocity: number, decay = 1.3) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        out.gain.value = velocity * 0.32;
        const f = midiToFreq(midi);
        for (const [ratio, gain, d] of [[1, 1, decay], [1.5, 0.35, decay * 0.5], [1.98, 0.18, decay * 0.3], [2.44, 0.08, decay * 0.2]] as const) {
          const node = oscillator(ctx, 'sine', f * ratio * 1.035, time, time + d + 0.1);
          node.frequency.exponentialRampToValueAtTime(f * ratio, time + 0.07);
          const g = ctx.createGain();
          g.gain.setValueAtTime(gain, time);
          g.gain.exponentialRampToValueAtTime(FLOOR, time + d);
          node.connect(g).connect(out);
        }
        const buffer = env.noise();
        if (buffer) {
          const mallet = noiseSource(ctx, buffer, time, time + 0.1);
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 1100;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.5, time);
          g.gain.exponentialRampToValueAtTime(FLOOR, time + 0.05);
          mallet.connect(filter).connect(g).connect(out);
        }
        connectOut(ctx, out, mix, 'music', 0.4);
      });
    },

    /** Gran cassa: the orchestral bass drum. Also the broadside's cannon. */
    granCassa(_ctx: AudioContext, time: number, velocity: number, decay = 1.1) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        const node = oscillator(ctx, 'sine', 66, time, time + decay + 0.1);
        node.frequency.exponentialRampToValueAtTime(38, time + 0.3);
        out.gain.setValueAtTime(velocity * 0.55, time);
        out.gain.exponentialRampToValueAtTime(FLOOR, time + decay);
        node.connect(out);
        const buffer = env.noise();
        if (buffer) {
          const skin = noiseSource(ctx, buffer, time, time + 0.3);
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 260;
          const g = ctx.createGain();
          g.gain.setValueAtTime(velocity * 0.5, time);
          g.gain.exponentialRampToValueAtTime(FLOOR, time + 0.22);
          skin.connect(filter).connect(g).connect(mix.duck);
        }
        connectOut(ctx, out, mix, 'music', 0.35);
      });
    },

    /** The broadside: a cannon crack over a gran-cassa boom, rippled across a beat. */
    cannon(_ctx: AudioContext, time: number, velocity: number, distance = 0) {
      withMix((ctx, mix) => {
        const buffer = env.noise();
        const out = ctx.createGain();
        const muffle = ctx.createBiquadFilter();
        muffle.type = 'lowpass';
        muffle.frequency.value = 5200 - distance * 4600;
        muffle.connect(out);
        const node = oscillator(ctx, 'sine', 92, time, time + 0.8);
        node.frequency.exponentialRampToValueAtTime(30, time + 0.45);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.9, time);
        g.gain.exponentialRampToValueAtTime(FLOOR, time + 0.7);
        node.connect(g).connect(muffle);
        if (buffer) {
          const crack = noiseSource(ctx, buffer, time, time + 0.6);
          const band = ctx.createBiquadFilter();
          band.type = 'bandpass';
          band.frequency.value = 900;
          band.Q.value = 0.6;
          const cg = ctx.createGain();
          cg.gain.setValueAtTime(0.9, time);
          cg.gain.exponentialRampToValueAtTime(0.15, time + 0.05);
          cg.gain.exponentialRampToValueAtTime(FLOOR, time + 0.5);
          crack.connect(band).connect(cg).connect(muffle);
        }
        out.gain.value = velocity * 0.32;
        connectOut(ctx, out, mix, 'music', 0.5);
      });
    },

    /** Military snare: rattle plus shell tone. */
    snare(_ctx: AudioContext, time: number, velocity: number) {
      withMix((ctx, mix) => {
        const buffer = env.noise();
        if (!buffer) return;
        const out = ctx.createGain();
        const source = noiseSource(ctx, buffer, time, time + 0.2);
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 2100;
        band.Q.value = 0.7;
        out.gain.setValueAtTime(velocity * 0.45, time);
        out.gain.exponentialRampToValueAtTime(FLOOR, time + 0.12);
        source.connect(band).connect(out);
        const shell = oscillator(ctx, 'triangle', 196, time, time + 0.08);
        const sg = ctx.createGain();
        sg.gain.setValueAtTime(velocity * 0.12, time);
        sg.gain.exponentialRampToValueAtTime(FLOOR, time + 0.06);
        shell.connect(sg).connect(out);
        connectOut(ctx, out, mix, 'music', 0.25);
      });
    },

    /** Crash cymbal. */
    crash(_ctx: AudioContext, time: number, velocity: number, decay = 2.4) {
      withMix((ctx, mix) => {
        const buffer = env.noise();
        if (!buffer) return;
        const out = ctx.createGain();
        const source = noiseSource(ctx, buffer, time, time + decay + 0.2);
        const high = ctx.createBiquadFilter();
        high.type = 'highpass';
        high.frequency.value = 4200;
        const peak = ctx.createBiquadFilter();
        peak.type = 'peaking';
        peak.frequency.value = 8500;
        peak.gain.value = 6;
        out.gain.setValueAtTime(velocity * 0.2, time);
        out.gain.exponentialRampToValueAtTime(velocity * 0.07, time + 0.25);
        out.gain.exponentialRampToValueAtTime(FLOOR, time + decay);
        source.connect(high).connect(peak).connect(out);
        connectOut(ctx, out, mix, 'music', 0.6);
      });
    },

    /** Suspended-cymbal swell that breaks exactly on the next downbeat. */
    swell(_ctx: AudioContext, time: number, duration: number, velocity: number) {
      withMix((ctx, mix) => {
        const buffer = env.noise();
        if (!buffer) return;
        const out = ctx.createGain();
        const source = noiseSource(ctx, buffer, time, time + duration + 0.05);
        const high = ctx.createBiquadFilter();
        high.type = 'highpass';
        high.frequency.setValueAtTime(2500, time);
        high.frequency.exponentialRampToValueAtTime(6000, time + duration);
        out.gain.setValueAtTime(FLOOR, time);
        out.gain.exponentialRampToValueAtTime(velocity * 0.16, time + duration);
        out.gain.setValueAtTime(FLOOR, time + duration + 0.01);
        source.connect(high).connect(out);
        connectOut(ctx, out, mix, 'music', 0.4);
      });
    },

    /** Choir "ah": saw voices through two vowel formants. */
    choir(_ctx: AudioContext, time: number, midis: number[], duration: number, velocity: number) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        const f1 = ctx.createBiquadFilter();
        f1.type = 'bandpass';
        f1.frequency.value = 760;
        f1.Q.value = 5;
        const f2 = ctx.createBiquadFilter();
        f2.type = 'bandpass';
        f2.frequency.value = 1180;
        f2.Q.value = 7;
        const pre = ctx.createGain();
        pre.connect(f1).connect(out);
        pre.connect(f2).connect(out);
        const stop = time + duration + 1.6;
        const detunes: AudioParam[] = [];
        for (const midi of midis) {
          for (const cents of [-11, 0, 12]) {
            const node = oscillator(ctx, 'sawtooth', midiToFreq(midi), time, stop, cents);
            node.connect(pre);
            detunes.push(node.detune);
          }
        }
        vibrato(ctx, detunes, time, stop, 4.6, 10, 0.8);
        envelope(out.gain, time, 0.6, velocity * 0.22 / Math.sqrt(Math.max(1, midis.length)), duration, 0.9, 1.4);
        connectOut(ctx, out, mix, 'music', 0.8);
      });
    },

    /** Harp: a plucked triangle with a sine octave. */
    harp(_ctx: AudioContext, time: number, midi: number, velocity: number) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        const stop = time + 1.8;
        oscillator(ctx, 'triangle', midiToFreq(midi), time, stop).connect(out);
        const octave = ctx.createGain();
        octave.gain.value = 0.3;
        oscillator(ctx, 'sine', midiToFreq(midi + 12), time, stop).connect(octave).connect(out);
        out.gain.setValueAtTime(FLOOR, time);
        out.gain.exponentialRampToValueAtTime(velocity * 0.11, time + 0.004);
        out.gain.exponentialRampToValueAtTime(FLOOR, time + 1.6);
        connectOut(ctx, out, mix, 'music', 0.6);
      });
    },

    // ---- the player's instruments (sfx bus) ----

    /** Lock: a harp pluck with a glassy octave — rising through the chord as the volley fills. */
    lockPluck(_ctx: AudioContext, time: number, midi: number, velocity: number) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        const stop = time + 0.9;
        oscillator(ctx, 'triangle', midiToFreq(midi), time, stop).connect(out);
        const glass = ctx.createGain();
        glass.gain.value = 0.35;
        oscillator(ctx, 'sine', midiToFreq(midi + 12), time, stop).connect(glass).connect(out);
        out.gain.setValueAtTime(FLOOR, time);
        out.gain.exponentialRampToValueAtTime(velocity * 0.1, time + 0.003);
        out.gain.exponentialRampToValueAtTime(FLOOR, time + 0.7);
        connectOut(ctx, out, mix, 'sfx', 0.3, 0.25);
      });
    },

    /** Kill: the soloist. A bell attack on a brass body; `timbre` 0 trumpet, 1 celesta, 2 muted. */
    killNote(_ctx: AudioContext, time: number, midi: number, velocity: number, timbre: number, brightness: number) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        const f = midiToFreq(midi);
        const stop = time + 1.4;
        // Bell attack: sine plus inharmonic partial, very short.
        const bell = ctx.createGain();
        bell.gain.setValueAtTime(timbre === 1 ? 0.9 : 0.45, time);
        bell.gain.exponentialRampToValueAtTime(FLOOR, time + (timbre === 1 ? 1.1 : 0.35));
        oscillator(ctx, 'sine', f * 2, time, stop).connect(bell);
        const partial = ctx.createGain();
        partial.gain.value = 0.3;
        oscillator(ctx, 'sine', f * 5.4, time, time + 0.2).connect(partial).connect(bell);
        bell.connect(out);
        if (timbre !== 1) {
          // Brass body.
          const body = ctx.createGain();
          const filter = ctx.createBiquadFilter();
          filter.type = timbre === 2 ? 'bandpass' : 'lowpass';
          filter.Q.value = timbre === 2 ? 3 : 1;
          const top = timbre === 2 ? 1400 : 1600 + brightness * 3400;
          filter.frequency.setValueAtTime(timbre === 2 ? 1400 : 400, time);
          filter.frequency.exponentialRampToValueAtTime(top, time + 0.04);
          filter.frequency.setTargetAtTime(top * 0.5, time + 0.06, 0.12);
          for (const cents of [-6, 6]) {
            const node = oscillator(ctx, timbre === 2 ? 'square' : 'sawtooth', f, time, stop, cents);
            node.detune.setValueAtTime(cents - 30, time);
            node.detune.linearRampToValueAtTime(cents, time + 0.04);
            node.connect(filter);
          }
          filter.connect(body);
          body.gain.setValueAtTime(FLOOR, time);
          body.gain.exponentialRampToValueAtTime(0.5, time + 0.02);
          body.gain.exponentialRampToValueAtTime(FLOOR, time + 0.42 + brightness * 0.2);
          body.connect(out);
        }
        out.gain.value = velocity * (timbre === 2 ? 0.36 : 0.27);
        connectOut(ctx, out, mix, 'sfx', 0.45, 0.28);
      });
    },

    /** Fire: a short horn blat on a chord tone, one per shot of the ripple, plus air. */
    fireBlat(_ctx: AudioContext, time: number, midi: number, velocity: number) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, time);
        filter.frequency.exponentialRampToValueAtTime(2200, time + 0.025);
        filter.frequency.exponentialRampToValueAtTime(500, time + 0.14);
        filter.connect(out);
        for (const cents of [-8, 8]) oscillator(ctx, 'sawtooth', midiToFreq(midi), time, time + 0.2, cents).connect(filter);
        out.gain.setValueAtTime(FLOOR, time);
        out.gain.exponentialRampToValueAtTime(velocity * 0.06, time + 0.01);
        out.gain.exponentialRampToValueAtTime(FLOOR, time + 0.16);
        const buffer = env.noise();
        if (buffer) {
          const air = noiseSource(ctx, buffer, time, time + 0.15);
          const high = ctx.createBiquadFilter();
          high.type = 'bandpass';
          high.frequency.setValueAtTime(5000, time);
          high.frequency.exponentialRampToValueAtTime(1800, time + 0.1);
          const g = ctx.createGain();
          g.gain.setValueAtTime(velocity * 0.05, time);
          g.gain.exponentialRampToValueAtTime(FLOOR, time + 0.1);
          air.connect(high).connect(g).connect(out);
        }
        connectOut(ctx, out, mix, 'sfx', 0.2);
      });
    },

    /** Non-lethal hit: a tuned timpani tick with a pizzicato chord tone. */
    armorTick(_ctx: AudioContext, time: number, root: number, tone: number, velocity: number) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        const drum = oscillator(ctx, 'sine', midiToFreq(root) * 1.04, time, time + 0.5);
        drum.frequency.exponentialRampToValueAtTime(midiToFreq(root), time + 0.05);
        const dg = ctx.createGain();
        dg.gain.setValueAtTime(0.9, time);
        dg.gain.exponentialRampToValueAtTime(FLOOR, time + 0.4);
        drum.connect(dg).connect(out);
        const pizz = oscillator(ctx, 'triangle', midiToFreq(tone), time, time + 0.3);
        const pg = ctx.createGain();
        pg.gain.setValueAtTime(0.5, time);
        pg.gain.exponentialRampToValueAtTime(FLOOR, time + 0.22);
        pizz.connect(pg).connect(out);
        out.gain.value = velocity * 0.2;
        connectOut(ctx, out, mix, 'sfx', 0.3);
      });
    },

    /** Rejected release: a muted low-brass cluster that sags flat, and a snare rattle. */
    rejectBlat(_ctx: AudioContext, time: number, velocity: number) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(900, time);
        filter.frequency.exponentialRampToValueAtTime(320, time + 0.25);
        filter.Q.value = 3;
        filter.connect(out);
        for (const midi of [46, 47, 52]) {
          const node = oscillator(ctx, 'sawtooth', midiToFreq(midi), time, time + 0.35);
          node.frequency.exponentialRampToValueAtTime(midiToFreq(midi - 2), time + 0.3);
          node.connect(filter);
        }
        out.gain.setValueAtTime(velocity * 0.22, time);
        out.gain.exponentialRampToValueAtTime(FLOOR, time + 0.3);
        const buffer = env.noise();
        if (buffer) {
          const rattle = noiseSource(ctx, buffer, time, time + 0.2);
          const band = ctx.createBiquadFilter();
          band.type = 'bandpass';
          band.frequency.value = 1500;
          const g = ctx.createGain();
          g.gain.setValueAtTime(velocity * 0.1, time);
          g.gain.exponentialRampToValueAtTime(FLOOR, time + 0.16);
          rattle.connect(band).connect(g).connect(out);
        }
        connectOut(ctx, out, mix, 'sfx', 0.15);
      });
    },

    /** A target lost: a dull low pizzicato, barely there. */
    missPizz(_ctx: AudioContext, time: number, midi: number) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        oscillator(ctx, 'triangle', midiToFreq(midi), time, time + 0.3).connect(out);
        out.gain.setValueAtTime(0.05, time);
        out.gain.exponentialRampToValueAtTime(FLOOR, time + 0.2);
        connectOut(ctx, out, mix, 'sfx', 0.1);
      });
    },

    /** Hull hit: bass drum and a dissonant brass cluster — the one sound out of key. */
    hullHit(_ctx: AudioContext, time: number) {
      withMix((ctx, mix) => {
        const out = ctx.createGain();
        const drum = oscillator(ctx, 'sine', 110, time, time + 0.6);
        drum.frequency.exponentialRampToValueAtTime(34, time + 0.35);
        const dg = ctx.createGain();
        dg.gain.setValueAtTime(0.8, time);
        dg.gain.exponentialRampToValueAtTime(FLOOR, time + 0.5);
        drum.connect(dg).connect(out);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1400;
        filter.connect(out);
        for (const midi of [56, 62, 63]) {
          const node = oscillator(ctx, 'sawtooth', midiToFreq(midi), time, time + 0.4);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.2, time);
          g.gain.exponentialRampToValueAtTime(FLOOR, time + 0.35);
          node.connect(g).connect(filter);
        }
        out.gain.value = 0.35;
        connectOut(ctx, out, mix, 'sfx', 0.2);
      });
    },
  });
}

export type Orchestra = ReturnType<typeof createOrchestra>;
