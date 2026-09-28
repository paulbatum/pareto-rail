import { CatmullRomCurve3, Euler, MathUtils, Quaternion, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { CameraFeelRig } from '../../engine/camera-feel';
import { BARS, BROADSIDE_TLLU_RUN_DURATION, BROADSIDE_TLLU_TIME } from './timing';
import { railSpeedAt } from './battlefield';
import { sampleRailFrame } from '../../engine/rail';

// Camera direction. The rail supplies position and heading; this layers on the
// things that make it a fighter and not a dolly: banks that follow the turn,
// pitch biases that pull the eye toward the set piece (up at the belly turrets,
// up at the friendly broadside), FOV that widens with speed, and the finale's
// pull-out that replaces the rail entirely.

/** Pitch bias in radians (positive looks up): keyed by bar, eased between keys. */
const PITCH_KEYS: ReadonlyArray<readonly [number, number]> = [
  [0, 0.02],
  [BARS.crossfire, 0],
  [BARS.flank - 0.5, 0],
  [BARS.flank + 0.5, 0.075],
  [BARS.eye - 0.5, 0.06],
  [BARS.eye + 0.5, 0.0],
  [BARS.belly - 0.3, 0.02],
  [BARS.belly + 0.6, 0.09],
  [BARS.flagship - 0.3, 0.12],
  [BARS.flagship + 0.6, 0.02],
  [BARS.escorts, 0],
  [BARS.trench, -0.12],
  [BARS.victory, -0.12],
];

function keyed(keys: ReadonlyArray<readonly [number, number]>, barPosition: number) {
  if (barPosition <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    if (barPosition <= keys[i][0]) {
      const [b0, v0] = keys[i - 1];
      const [b1, v1] = keys[i];
      return MathUtils.lerp(v0, v1, MathUtils.smoothstep(barPosition, b0, b1));
    }
  }
  return keys[keys.length - 1][1];
}

export type CameraFrame = {
  camera: PerspectiveCamera;
  curve: CatmullRomCurve3;
  runTime: number;
  runProgress: number;
  dt: number;
};

/** The pull-out path, in world space: up out of the trench, over both fleets, back to the launch deck. */
const FINALE_WAYPOINTS = [
  new Vector3(-236, 168, -3060),
  new Vector3(-170, 262, -2560),
  new Vector3(-40, 330, -1500),
  new Vector3(10, 300, -320),
  new Vector3(0, 214, 430),
];
const FINALE_LOOK_AT = new Vector3(-250, 60, -3560);
const FINALE_MAX_SECONDS = 6.2;
const FINALE_MIN_SECONDS = 3.4;

export function createCameraDirector(feel: CameraFeelRig) {
  let bank = 0;
  let fovOffset = 0;
  let finaleStart = -1;
  let finalePath: CatmullRomCurve3 | null = null;
  const finaleFrom = { position: new Vector3(), yaw: 0, pitch: 0 };
  let finaleSeconds = FINALE_MAX_SECONDS;
  let finalePending = false;
  let launchKicked = false;

  const tangentA = new Vector3();
  const tangentB = new Vector3();
  const euler = new Euler(0, 0, 0, 'YXZ');
  const quaternion = new Quaternion();
  const direction = new Vector3();

  function reset() {
    bank = 0;
    fovOffset = 0;
    finaleStart = -1;
    finalePath = null;
    finalePending = false;
    launchKicked = false;
    feel.restore();
  }

  /** Called when the flagship's reactor goes: the next update captures the pose and takes over. */
  function beginFinale() {
    if (finaleStart >= 0 || finalePending) return;
    finalePending = true;
  }

  /**
   * Lateral acceleration along the camera's right axis, from the rail's 3D curvature. Turning left puts the
   * centre of curvature on the left (negative), so banking into the turn is the opposite sign; through a
   * helix the axis rotates and the camera rolls with it, which is what makes a corkscrew feel like one.
   */
  function railLateralAccel(curve: CatmullRomCurve3, u: number, speed: number) {
    const length = Math.max(1, curve.getLength());
    const span = 9 / length;
    curve.getTangentAt(MathUtils.clamp(u, 0, 1), tangentA);
    curve.getTangentAt(MathUtils.clamp(u + span, 0, 1), tangentB);
    const frame = sampleRailFrame(curve, u);
    return (tangentB.sub(tangentA).dot(frame.right) / 9) * speed * speed;
  }

  function update(frame: CameraFrame) {
    const { camera, curve, runTime, runProgress, dt } = frame;
    const barPosition = runTime / BROADSIDE_TLLU_TIME.barSeconds;
    const speed = railSpeedAt(runTime);

    if (finalePending) {
      finalePending = false;
      finaleStart = runTime;
      camera.getWorldDirection(direction);
      finaleFrom.position.copy(camera.position);
      finaleFrom.yaw = Math.atan2(-direction.x, -direction.z);
      finaleFrom.pitch = Math.asin(MathUtils.clamp(direction.y, -1, 1));
      finaleSeconds = MathUtils.clamp(BROADSIDE_TLLU_RUN_DURATION - runTime - 0.15, FINALE_MIN_SECONDS, FINALE_MAX_SECONDS);
      finalePath = new CatmullRomCurve3([camera.position.clone(), ...FINALE_WAYPOINTS], false, 'centripetal', 0.5);
      feel.shake(1.0, { decay: 0.7, pitchDegrees: 1.4, yawDegrees: 1.1, rollDegrees: 2.4 });
    }

    if (finaleStart >= 0 && finalePath) {
      updateFinale(camera, runTime, dt);
      return;
    }

    // Bank into the turn: heading change along the rail, softened by tanh, smoothed over time.
    const lateral = railLateralAccel(curve, runProgress, speed);
    const targetBank = -0.55 * Math.tanh(lateral * 0.016);
    bank += (targetBank - bank) * (1 - Math.exp(-4.5 * dt));
    camera.rotateZ(bank);
    camera.rotateX(keyed(PITCH_KEYS, barPosition));

    // The launch: a deck-shaking rumble, then a kick as the bow drops away and the whole battle appears.
    if (barPosition < BARS.crossfire) feel.shake(dt * 0.7, { decay: 3.2 });
    if (!launchKicked && barPosition >= BARS.crossfire) {
      launchKicked = true;
      feel.kickFov(6, { decay: 2.4 });
      feel.shake(0.35, { decay: 2.4 });
    }

    // Wider when fast, tighter when the fleet holds its breath.
    const targetFov = MathUtils.clamp((speed - 70) * 0.13, -5, 9) + (barPosition < 0.9 ? MathUtils.lerp(6, 0, barPosition / 0.9) : 0);
    fovOffset += (targetFov - fovOffset) * (1 - Math.exp(-2.4 * dt));
    feel.setFovOffset(fovOffset);
    feel.update(dt, { shake: { pitchDegrees: 0.5, yawDegrees: 0.4, rollDegrees: 1.0, decay: 3.2 } });
  }

  function updateFinale(camera: PerspectiveCamera, runTime: number, dt: number) {
    const path = finalePath!;
    const t = MathUtils.clamp((runTime - finaleStart) / finaleSeconds, 0, 1);
    // Ease in slowly (a beat of wreckage), rush through the middle, settle into the wide shot.
    const s = t * t * t * (t * (t * 6 - 15) + 10);
    path.getPointAt(MathUtils.clamp(s, 0, 1), camera.position);

    // Orientation: swing from the trench heading around to face the burning flagship, then level out
    // looking straight down -Z at the whole battle (the end screen holds that pose).
    const swing = MathUtils.smootherstep(t, 0.02, 0.3);
    const settle = MathUtils.smootherstep(t, 0.55, 1.0);
    const yawTarget = 0;
    const yaw = finaleFrom.yaw + shortestArc(finaleFrom.yaw, yawTarget) * swing;
    direction.copy(FINALE_LOOK_AT).sub(camera.position).normalize();
    const lookPitch = Math.asin(MathUtils.clamp(direction.y, -1, 1));
    const pitch = MathUtils.lerp(finaleFrom.pitch, lookPitch, swing) * (1 - settle);
    const roll = Math.sin(t * Math.PI) * 0.22 * (1 - settle * 0.6) * (finaleFrom.yaw > 0 ? -1 : 1);
    euler.set(pitch, yaw, roll * (1 - settle));
    quaternion.setFromEuler(euler);
    camera.quaternion.copy(quaternion);
    camera.updateMatrixWorld();
    feel.setFovOffset(MathUtils.lerp(0, 24, MathUtils.smoothstep(t, 0.1, 0.85)));
    feel.update(dt, { shake: { pitchDegrees: 1.0, yawDegrees: 0.8, rollDegrees: 1.6, decay: 0.9 } });
  }

  /** Signed shortest angle from `from` to `to`. */
  function shortestArc(from: number, to: number) {
    let delta = (to - from) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    // Exactly reversed (the trench heading): swing over the right shoulder.
    if (Math.abs(Math.abs(delta) - Math.PI) < 0.35) return delta >= 0 ? Math.PI : -Math.PI;
    return delta;
  }

  return { update, reset, beginFinale, get finaleActive() { return finaleStart >= 0 || finalePending; } };
}
