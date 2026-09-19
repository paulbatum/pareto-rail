// The river bed: a continuous stereo water layer under the music. Three bands
// of the same noise make the water: a lowpassed body whose cutoff is the
// water's colour (still lake = dark, rapids = bright), a low roar for the
// weight of moving water, and a highpassed spray. A slow LFO on the body gives
// the surge of standing waves. The spine decides the values per bar; this file
// only builds the nodes and moves them.

export type RiverState = {
  /** Gain of the lowpassed water body. */
  body: number;
  /** Cutoff of the body in Hz. */
  color: number;
  /** Gain of the sub-200 Hz roar. */
  roar: number;
  /** Gain of the highpassed spray. */
  spray: number;
  /** Depth of the body's surge LFO, as a fraction of `body`. */
  surge: number;
};

export type River = {
  set(time: number, state: RiverState, timeConstant: number): void;
};

export function installRiver(context: AudioContext, destination: AudioNode, initial: RiverState): River {
  // Two long, unequal buffers per side so the loop never lines up audibly.
  const makeNoise = (seconds: number, seed: number) => {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
    const data = buffer.getChannelData(0);
    let state = seed >>> 0;
    // Gently pinked noise: water has less top than white noise.
    let b0 = 0;
    let b1 = 0;
    for (let i = 0; i < data.length; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const white = (state / 4294967296) * 2 - 1;
      b0 = 0.97 * b0 + white * 0.25;
      b1 = 0.6 * b1 + white * 0.4;
      data[i] = (b0 + b1 + white * 0.2) * 0.6;
    }
    return buffer;
  };

  const surgeLfo = context.createOscillator();
  surgeLfo.frequency.value = 0.17;
  const sprayLfo = context.createOscillator();
  sprayLfo.frequency.value = 0.11;
  sprayLfo.type = 'triangle';

  const channels = [
    { pan: -0.65, seconds: 5.3, seed: 11 },
    { pan: 0.65, seconds: 6.7, seed: 29 },
  ].map(({ pan, seconds, seed }) => {
    const source = context.createBufferSource();
    source.buffer = makeNoise(seconds, seed);
    source.loop = true;

    const bodyFilter = context.createBiquadFilter();
    bodyFilter.type = 'lowpass';
    bodyFilter.Q.value = 0.4;
    bodyFilter.frequency.value = initial.color;
    const bodyGain = context.createGain();
    bodyGain.gain.value = initial.body;
    const surgeDepth = context.createGain();
    surgeDepth.gain.value = initial.body * initial.surge;

    const roarFilter = context.createBiquadFilter();
    roarFilter.type = 'lowpass';
    roarFilter.frequency.value = 170;
    roarFilter.Q.value = 0.7;
    const roarGain = context.createGain();
    roarGain.gain.value = initial.roar;

    const sprayFilter = context.createBiquadFilter();
    sprayFilter.type = 'highpass';
    sprayFilter.frequency.value = 3800;
    const sprayGain = context.createGain();
    sprayGain.gain.value = initial.spray;
    const sprayDepth = context.createGain();
    sprayDepth.gain.value = initial.spray * 0.5;

    const panner = context.createStereoPanner();
    panner.pan.value = pan;

    source.connect(bodyFilter).connect(bodyGain).connect(panner);
    source.connect(roarFilter).connect(roarGain).connect(panner);
    source.connect(sprayFilter).connect(sprayGain).connect(panner);
    surgeLfo.connect(surgeDepth).connect(bodyGain.gain);
    sprayLfo.connect(sprayDepth).connect(sprayGain.gain);
    panner.connect(destination);
    source.start(context.currentTime, seed / 10);
    return { bodyFilter, bodyGain, surgeDepth, roarGain, sprayGain, sprayDepth };
  });
  surgeLfo.start();
  sprayLfo.start();

  return {
    set(time, state, timeConstant) {
      for (const channel of channels) {
        channel.bodyFilter.frequency.setTargetAtTime(state.color, time, timeConstant);
        channel.bodyGain.gain.setTargetAtTime(state.body, time, timeConstant);
        channel.surgeDepth.gain.setTargetAtTime(state.body * state.surge, time, timeConstant);
        channel.roarGain.gain.setTargetAtTime(state.roar, time, timeConstant);
        channel.sprayGain.gain.setTargetAtTime(state.spray, time, timeConstant);
        channel.sprayDepth.gain.setTargetAtTime(state.spray * 0.5, time, timeConstant);
      }
    },
  };
}
