import { CatmullRomCurve3, MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { CameraFeelRig } from '../../engine/camera-feel';
import { bar } from './timing';
import { ANIMAL_CENTER, dirToWorld, PULL_VANTAGE, RAIL_END_Y, strandlineRunProgress, toWorld } from './world';

// The camera's job is to make three things feel like events:
//   the swing — the rail leaves the strands and the bell fills the sky like a moon;
//   the dive — the rail plunges back in;
//   the pull-back — after the parent lets go, the camera drifts back and back
//                   until the whole animal hangs in frame.
// All of it runs after the rail camera, as a purely visual layer: the runner's
// lock hit-testing always uses the final camera, so what you see is what locks.

export const VISTA_START = bar(6);
export const VISTA_FULL = bar(8.2);
export const VISTA_HOLD_END = bar(9.7);
export const VISTA_END = bar(10.9);
export const DIVE_KICK_AT = bar(10);
export const PULL_SECONDS = 8.6;
const REPLAY_DIVE_SECONDS = 2.3;

export function vistaWeight(runTime: number) {
  return MathUtils.smoothstep(runTime, VISTA_START, VISTA_FULL) * (1 - MathUtils.smoothstep(runTime, VISTA_HOLD_END, VISTA_END));
}

// Pull-back path, in the jelly's own frame (crown at the origin, +Y toward the bell).
const PULL_P0 = new Vector3(0, RAIL_END_Y, 0);
const PULL_P1 = new Vector3(0, RAIL_END_Y - 130, 12);
const PULL_P2 = new Vector3(190, -210, 46);
const PULL_P3 = PULL_VANTAGE;
const ANIMAL_CENTER_LOCAL = ANIMAL_CENTER;
const PARENT_LOCAL = new Vector3(0, -6, 0);

const smootherstep = (t: number) => {
  const c = MathUtils.clamp(t, 0, 1);
  return c * c * c * (c * (c * 6 - 15) + 10);
};

export function createCameraDirector(camera: PerspectiveCamera, curve: CatmullRomCurve3, feel: CameraFeelRig) {
  const bell = toWorld(new Vector3(0, 6, 0));
  const axisUp = dirToWorld(new Vector3(0, 1, 0));
  const animalCenter = toWorld(ANIMAL_CENTER_LOCAL.clone());
  const parentWorld = toWorld(PARENT_LOCAL.clone());
  const p0 = toWorld(PULL_P0.clone());
  const p1 = toWorld(PULL_P1.clone());
  const p2 = toWorld(PULL_P2.clone());
  const p3 = toWorld(PULL_P3.clone());

  const scratchForward = new Vector3();
  const scratchTarget = new Vector3();
  const scratchPosition = new Vector3();
  const scratchQuaternion = new Quaternion();
  const scratchQuaternionB = new Quaternion();
  // A camera-typed stand-in: `lookAt` on a camera aims −Z, which is what we want.
  const dummy = new PerspectiveCamera();

  let roll = 0;
  let divedAt = -1;
  let pullStartQuaternion: Quaternion | null = null;
  let replayFrom: { position: Vector3; quaternion: Quaternion } | null = null;
  let driftAge = 0;
  let sway = 0;
  let swimClock = 0;

  const railStart = curve.getPointAt(0);

  const invQuaternion = new Quaternion();
  const axisCamera = new Vector3();
  /** Roll about the view axis so the animal's axis points `target` radians from screen-right. */
  function levelAnimal(amount: number, target: number) {
    camera.updateMatrixWorld();
    invQuaternion.copy(camera.quaternion).invert();
    axisCamera.copy(axisUp).applyQuaternion(invQuaternion);
    if (Math.hypot(axisCamera.x, axisCamera.y) < 0.05) return;
    const angle = Math.atan2(axisCamera.y, axisCamera.x);
    let delta = target - angle;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    camera.rotateZ(-delta * amount);
  }

  return {
    /** Captured when the run (re)starts, so a replay can dive in from wherever the last run ended. */
    beginRun() {
      camera.up.set(0, 1, 0);
      pullStartQuaternion = null;
      divedAt = -1;
      driftAge = 0;
      const far = camera.position.distanceTo(railStart) > 40;
      replayFrom = far ? { position: camera.position.clone(), quaternion: camera.quaternion.clone() } : null;
    },

    update(dt: number, runTime: number, freedAt: number) {
      const progress = strandlineRunProgress(runTime);
      const u = MathUtils.clamp(progress, 0, 1);

      // Bank into the rail's turns: the yaw rate of the tangent, smoothed.
      const tangent = curve.getTangentAt(u);
      const ahead = curve.getTangentAt(MathUtils.clamp(u + 0.012, 0, 1));
      const turn = tangent.x * ahead.z - tangent.z * ahead.x;
      // Positive `turn` is a right turn; rolling the camera clockwise leans into it.
      const targetRoll = MathUtils.clamp(-turn * 26, -0.22, 0.22);
      roll += (targetRoll - roll) * Math.min(1, dt * 3);
      camera.rotateZ(roll);

      // The swing: turn the view toward the bell as the rail leaves the strands.
      const w = vistaWeight(runTime);
      if (w > 0.001) {
        camera.getWorldDirection(scratchForward);
        scratchTarget.copy(bell).sub(camera.position).normalize();
        scratchQuaternion.setFromUnitVectors(scratchForward, scratchForward.clone().lerp(scratchTarget, 0.94 * w).normalize());
        camera.quaternion.premultiply(scratchQuaternion);
        feel.setFovOffset(6 * w);
        // Bank hard into the swing until the animal hangs upright in the frame:
        // bell above, strands below — the shape you know it by.
        levelAnimal(0.82 * w, Math.PI / 2 + 0.2);
      }

      // The water moves you: a slow swell in position and roll, so even a still
      // hand on the mouse never sees a rigid camera.
      if (freedAt < 0) {
        swimClock += dt;
        camera.position.x += Math.sin(swimClock * 0.61) * 0.16;
        camera.position.y += Math.sin(swimClock * 0.47 + 1.1) * 0.12;
        camera.rotateZ(Math.sin(swimClock * 0.39) * 0.008);
      }

      // The dive back in: a kick of field of view on the drop.
      if (divedAt < 0 && runTime >= DIVE_KICK_AT) {
        divedAt = runTime;
        feel.kickFov(9, { decay: 2.1 });
        feel.shake(0.55);
      }

      // Hovering at the crown: the water breathes.
      if (runTime > bar(12.4) && freedAt < 0) {
        sway += dt;
        camera.position.x += Math.sin(sway * 0.7) * 0.28;
        camera.position.y += Math.sin(sway * 0.53 + 1.2) * 0.22;
        camera.position.z += Math.cos(sway * 0.41) * 0.2;
      }

      // Replay: dive back from wherever the last run ended.
      if (replayFrom && runTime < REPLAY_DIVE_SECONDS) {
        const k = smootherstep(runTime / REPLAY_DIVE_SECONDS);
        dummy.position.copy(curve.getPointAt(u));
        dummy.lookAt(curve.getPointAt(MathUtils.clamp(u + 0.025, 0, 1)));
        camera.position.lerpVectors(replayFrom.position, dummy.position, k);
        camera.quaternion.slerpQuaternions(replayFrom.quaternion, dummy.quaternion, k);
        feel.setFovOffset(8 * Math.sin(k * Math.PI));
      } else if (replayFrom) {
        replayFrom = null;
      }

      // The pull-back.
      if (freedAt >= 0) {
        const tau = MathUtils.clamp((runTime - freedAt) / PULL_SECONDS, 0, 1);
        if (!pullStartQuaternion) pullStartQuaternion = camera.quaternion.clone();
        const s = tau < 0.5 ? 4 * tau * tau * tau : 1 - (-2 * tau + 2) ** 3 / 2; // easeInOutCubic
        // cubic Bézier through the back-and-around path
        const a = 1 - s;
        scratchPosition
          .copy(p0)
          .multiplyScalar(a * a * a)
          .addScaledVector(p1, 3 * a * a * s)
          .addScaledVector(p2, 3 * a * s * s)
          .addScaledVector(p3, s * s * s);
        // After the pull the camera keeps drifting back and around, slowly, to the end.
        const after = Math.max(0, runTime - freedAt - PULL_SECONDS);
        if (after > 0) {
          scratchTarget.copy(p3).sub(animalCenter);
          const orbit = after * 0.012;
          scratchTarget.applyAxisAngle(axisUp, orbit);
          scratchPosition.copy(animalCenter).addScaledVector(scratchTarget, 1 + after * 0.02);
        }
        camera.position.copy(scratchPosition);
        scratchTarget.copy(parentWorld).lerp(animalCenter, smootherstep(MathUtils.clamp((tau - 0.04) / 0.8, 0, 1)));
        dummy.position.copy(scratchPosition);
        dummy.up.set(0, 1, 0);
        dummy.lookAt(scratchTarget);
        camera.quaternion.slerpQuaternions(pullStartQuaternion, dummy.quaternion, smootherstep(tau / 0.92));
        camera.updateMatrixWorld();
        levelAnimal(0.9 * smootherstep((tau - 0.1) / 0.8), 0.98);
        feel.setFovOffset(0);
        // Carry the roll into the camera's up vector: the runner aims its own
        // camera along the rail with this up, so after the run ends — when only
        // the runner is steering — the view is still the one we composed.
        camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      }
    },

    /** After the run ends the animal keeps drifting; so does the camera, slowly outward. */
    drift(dt: number) {
      driftAge += dt;
      camera.getWorldDirection(scratchForward);
      camera.position.addScaledVector(scratchForward, -Math.min(6, 1.5 + driftAge * 0.5) * dt);
    },
  };
}
