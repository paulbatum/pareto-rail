/* Every level builds its own Web Audio graph, and a level is free to connect a voice
   straight to `context.destination` instead of routing it through its mix bus. Such a
   voice ignores the level's own volume handling. `governOutput` puts a gain node in
   front of the speakers and hides it behind the context's `destination` property, so
   every connection a level makes — mix bus or stray voice — passes through one node the
   player controls. */

export type GovernedOutput = {
  /** Sets the output level, ramping over `smoothing` seconds to avoid a click. */
  setLevel(volume: number, smoothing?: number): void;
};

export function governOutput(context: AudioContext, initialVolume: number): GovernedOutput {
  const speakers = context.destination;
  const output = context.createGain();
  output.gain.value = clamp01(initialVolume);
  output.connect(speakers);

  /* An own property shadows the `destination` accessor that BaseAudioContext.prototype
     defines, so only this context is affected. */
  Object.defineProperty(context, 'destination', {
    configurable: true,
    get: () => output as unknown as AudioDestinationNode,
  });

  return {
    /* A linear ramp, not setTargetAtTime: an exponential approach never reaches its
       target, so a player who drags the slider to 0 would keep hearing a quiet tail. */
    setLevel(volume, smoothing = 0.03) {
      const now = context.currentTime;
      output.gain.cancelScheduledValues(now);
      output.gain.setValueAtTime(output.gain.value, now);
      output.gain.linearRampToValueAtTime(clamp01(volume), now + smoothing);
    },
  };
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
