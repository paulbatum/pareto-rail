/**
 * The level's second sense, shared by everything that has to agree on what the
 * player can currently see.
 *
 * `ink` is authored cloud density around the camera. `thermal` is the infrared
 * imager: it only engages inside ink, and only while the player is holding the
 * trigger — raising the scope and raising the gun are the same gesture. The
 * imager keeps its picture for a breath after the release so a volley fired
 * blind is still watched home before the dark closes again.
 *
 * The runtime writes this once per frame; gameplay, visuals, and audio read it.
 * It is deliberately level-local state rather than an event: it is a continuous
 * value every system samples, not a moment anything reacts to.
 */
export type VisionState = {
  /** Authored ink density around the camera, 0..1. */
  ink: number;
  /** Infrared imager strength, 0..1. */
  thermal: number;
  /** True while the player holds the trigger. */
  hold: boolean;
  /** True once the imager has been raised at least once this run. */
  everEngaged: boolean;
};

const state: VisionState = { ink: 0, thermal: 0, hold: false, everEngaged: false };

/** Ink density at which normal sight is considered lost. */
export const INK_BLIND_THRESHOLD = 0.55;

const THERMAL_RISE = 26;
const THERMAL_FALL = 4.4;
const THERMAL_LINGER = 0.85;

let lingerUntil = -Infinity;
let clock = 0;

export function vision(): Readonly<VisionState> {
  return state;
}

export function resetVision() {
  state.ink = 0;
  state.thermal = 0;
  state.hold = false;
  state.everEngaged = false;
  lingerUntil = -Infinity;
}

/** The reticle's per-frame active flag is the only hold signal the engine exposes. */
export function setVisionHold(hold: boolean) {
  state.hold = hold;
  if (hold) lingerUntil = clock + THERMAL_LINGER;
}

export function updateVision(dt: number, ink: number) {
  clock += dt;
  state.ink = ink;
  const armed = ink >= INK_BLIND_THRESHOLD * 0.5;
  const wants = armed && (state.hold || clock < lingerUntil);
  const target = wants ? Math.min(1, ink / INK_BLIND_THRESHOLD) : 0;
  const rate = target > state.thermal ? THERMAL_RISE : THERMAL_FALL;
  state.thermal += (target - state.thermal) * Math.min(1, dt * rate);
  if (state.thermal > 0.6) state.everEngaged = true;
  return state;
}
