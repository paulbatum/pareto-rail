import { CatmullRomCurve3, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { bankAt, broadsideRail, frameAtTime, runProgress, viewFrameAt, type ViewFrame } from './flight';
import { FLAGSHIP, toWorld } from './setpieces';
import { BROADSIDE_DURATION, bar } from './timing';

// THE CAMERA. The runner seats the camera on the rail and looks down it; this
// module replaces that orientation with the flown frame — smoothed heading
// plus bank into every turn and both corkscrews — while preserving whatever
// edge-look the player's pointer added on top. From bar 30 it takes the
// position too: the pull-out that climbs out of the trench, turns to look
// back at the breaking flagship, and retreats until the whole battle is in
// frame against the nebula. The final vista looks straight down −z so the
// runner's end-state orientation (identity) matches it and REPLAY hangs in
// front of the view.

const RUNNER_LOOK_AHEAD = 0.025;
const PULLOUT_START = bar(30);
const PULLOUT_TURN = bar(31.2);

const tmpFrame: ViewFrame = { position: new Vector3(), forward: new Vector3(), right: new Vector3(), up: new Vector3() };
const tmpMatrix = new Matrix4();
const runnerQuaternion = new Quaternion();
const edgeQuaternion = new Quaternion();
const desiredQuaternion = new Quaternion();
const tmpVector = new Vector3();
const lookProbe = new Vector3();

/** The flagship's heart: what the pull-out looks back at. */
export const FLAGSHIP_HEART = toWorld(FLAGSHIP.place, 0, -40, (FLAGSHIP.sternZ + FLAGSHIP.bowZ) / 2);

const pullout = (() => {
  const exit = frameAtTime(PULLOUT_START);
  const a = exit.position.clone();
  const b = exit.position.clone().addScaledVector(exit.forward, 70).add(new Vector3(0, 190, 0));
  const c = new Vector3(FLAGSHIP_HEART.x - 260, FLAGSHIP_HEART.y + 300, FLAGSHIP_HEART.z + 2200);
  const m = b.clone().lerp(c, 0.45).add(new Vector3(-120, 160, 0));
  const path = new CatmullRomCurve3([a, b, m, c], false, 'centripetal');
  return { path, a, b, c, exitForward: exit.forward.clone() };
})();

export const FINAL_VISTA = pullout.c.clone();

function basisQuaternion(forward: Vector3, up: Vector3, target: Quaternion) {
  const f = forward.clone().normalize();
  const r = new Vector3().crossVectors(f, up).normalize();
  const u = new Vector3().crossVectors(r, f).normalize();
  tmpMatrix.makeBasis(r, u, f.negate());
  return target.setFromRotationMatrix(tmpMatrix);
}

/** Recompute the orientation the runner gave the camera this frame (before edge look). */
function runnerBase(u: number, target: Quaternion) {
  const curve = broadsideRail();
  const position = curve.getPointAt(MathUtils.clamp(u, 0, 1));
  const look = curve.getPointAt(MathUtils.clamp(u + RUNNER_LOOK_AHEAD, 0, 1));
  tmpMatrix.lookAt(position, look, new Vector3(0, 1, 0));
  return target.setFromRotationMatrix(tmpMatrix);
}

function smootherstep(t: number) {
  const x = MathUtils.clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Pull-out pose at a run time ≥ bar 30. */
export function pulloutPose(runTime: number, position: Vector3, quaternion: Quaternion) {
  const turn = MathUtils.clamp((runTime - PULLOUT_START) / (PULLOUT_TURN - PULLOUT_START), 0, 1);
  const retreat = MathUtils.clamp((runTime - PULLOUT_TURN) / (BROADSIDE_DURATION - PULLOUT_TURN), 0, 1);
  // First third of the path climbs out while turning; the rest is a long eased retreat.
  const t = runTime < PULLOUT_TURN
    ? (1 - (1 - turn) * (1 - turn)) / 3
    : 1 / 3 + smootherstep(retreat) * (2 / 3);
  pullout.path.getPoint(MathUtils.clamp(t, 0, 1), position);

  // Look: along the trench → back at the flagship's heart → straight down −z.
  const exitLook = pullout.a.clone().addScaledVector(pullout.exitForward, 200);
  const heartLook = FLAGSHIP_HEART.clone();
  const vistaLook = position.clone().add(new Vector3(0, 0, -1000));
  if (runTime < PULLOUT_TURN) {
    lookProbe.copy(exitLook).lerp(heartLook, smootherstep(turn));
  } else {
    const k = smootherstep(MathUtils.clamp(retreat * 1.25, 0, 1));
    lookProbe.copy(heartLook).lerp(vistaLook, k);
  }
  const forward = tmpVector.copy(lookProbe).sub(position);
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  return basisQuaternion(forward, new Vector3(0, 1, 0), quaternion);
}

/**
 * Called from the runner's updateCameraEffects every running frame, after it
 * has seated the camera and applied edge look.
 */
export function applyFlownCamera(camera: PerspectiveCamera, runTime: number) {
  const u = runProgress(runTime);
  runnerBase(u, runnerQuaternion);
  edgeQuaternion.copy(runnerQuaternion).invert().multiply(camera.quaternion);

  if (runTime >= PULLOUT_START) {
    pulloutPose(runTime, camera.position, desiredQuaternion);
  } else {
    viewFrameAt(u, bankAt(runTime), tmpFrame);
    basisQuaternion(tmpFrame.forward, tmpFrame.up, desiredQuaternion);
    // A replay starts from the final vista kilometers away: cut, don't fly back.
    if (runTime < 1.05 && camera.position.distanceToSquared(tmpFrame.position) > 60 * 60) camera.position.copy(tmpFrame.position);
  }
  camera.quaternion.copy(desiredQuaternion).multiply(edgeQuaternion);
  camera.updateMatrixWorld();
}

/** Attract: parked on the carrier's flight deck, looking down the catapult track into the battle. */
export function applyAttractCamera(camera: PerspectiveCamera, modeTime: number) {
  camera.position.set(
    Math.sin(modeTime * 0.31) * 0.35,
    0.1 + Math.sin(modeTime * 0.47) * 0.12,
    2 + Math.sin(modeTime * 0.23) * 0.4,
  );
  const look = new Vector3(Math.sin(modeTime * 0.19) * 2.4, 1.2 + Math.sin(modeTime * 0.27) * 0.8, -120);
  camera.lookAt(look);
  camera.updateMatrixWorld();
}
