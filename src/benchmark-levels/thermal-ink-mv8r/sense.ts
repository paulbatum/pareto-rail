// The player's senses, shared by the runtime (which decides them), the
// visuals (which render them), and the audio (which mixes to them).
//
// `ink` is how deep the camera sits inside an ink cloud (0 clear → 1 blind).
// `thermal` is the displayed infrared level (0 murk → 1 infrared). The
// boolean `thermalOn` is the decision; the runtime animates `thermal` toward
// it as a hard snap on and a short decay off. Listeners hear the decision
// flip, so audio can crossfade its buses the instant the image changes.

type ThermalListener = (on: boolean, at: 'snap' | 'fade') => void;

export const sense = {
  ink: 0,
  thermal: 0,
  thermalOn: false,
  /** Seconds since the thermal state last flipped, for switch transients. */
  sinceSwitch: 10,
  /** Lamp power 0..1: 0 while the finale blackout holds, relights at the end. */
  lamps: 1,
  /** Finale: 0 until the core dies, then 0→1 as its thermal silhouette cools. */
  collapse: 0,
};

const listeners = new Set<ThermalListener>();

export function onThermalChange(listener: ThermalListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setThermalOn(on: boolean) {
  if (sense.thermalOn === on) return;
  sense.thermalOn = on;
  sense.sinceSwitch = 0;
  for (const listener of listeners) listener(on, on ? 'snap' : 'fade');
}

export function resetSense() {
  sense.ink = 0;
  sense.thermal = 0;
  sense.sinceSwitch = 10;
  sense.lamps = 1;
  sense.collapse = 0;
  setThermalOn(false);
}
