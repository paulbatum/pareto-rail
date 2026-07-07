import { Euler, MathUtils, Quaternion } from 'three';
import type { PerspectiveCamera } from 'three';

export type CameraFeelFovKickOptions = {
  /** Exponential decay rate in 1/seconds. */
  decay?: number;
};

export type CameraFeelFovOffsetOptions = {
  /** Exponential response rate in 1/seconds. Use Infinity for exact assignment this frame. */
  response?: number;
};

export type CameraFeelShakeOptions = {
  /** Linear trauma decay in trauma units per second. */
  decay?: number;
  /** Maximum stored trauma after accumulation. */
  maxTrauma?: number;
  /** Maximum pitch offset at full trauma, in degrees. */
  pitchDegrees?: number;
  /** Maximum yaw offset at full trauma, in degrees. */
  yawDegrees?: number;
  /** Maximum roll offset at full trauma, in degrees. */
  rollDegrees?: number;
  /** Noise travel speed in cycles per second. */
  frequency?: number;
  /** Exponential smoothing rate in 1/seconds. */
  smoothing?: number;
};

export type CameraFeelUpdateOptions = {
  shake?: CameraFeelShakeOptions;
};

export type CameraFeelRestoreOptions = {
  /** Also restore the orientation captured at rig creation. Intended for disposal, not run-end cleanup. */
  orientation?: boolean;
};

export type CameraFeelRig = {
  readonly baseFov: number;
  kickFov(degrees: number, options?: CameraFeelFovKickOptions): void;
  setFovOffset(degrees: number, options?: CameraFeelFovOffsetOptions): void;
  shake(trauma: number, options?: CameraFeelShakeOptions): void;
  update(dt: number, options?: CameraFeelUpdateOptions): void;
  restore(options?: CameraFeelRestoreOptions): void;
  dispose(): void;
};

type FovKick = {
  offset: number;
  decay: number;
};

const DEFAULT_FOV_KICK_DECAY = 4.2;
const DEFAULT_FOV_OFFSET_RESPONSE = Infinity;
const DEFAULT_SHAKE_DECAY = 2.6;
const DEFAULT_MAX_TRAUMA = 1;
const DEFAULT_SHAKE_PITCH_DEGREES = 0.28;
const DEFAULT_SHAKE_YAW_DEGREES = 0.22;
const DEFAULT_SHAKE_ROLL_DEGREES = 0.7;
const DEFAULT_SHAKE_FREQUENCY = 9;
const DEFAULT_SHAKE_SMOOTHING = 22;
const MAX_DT = 0.1;

export function createCameraFeel(camera: PerspectiveCamera): CameraFeelRig {
  const baseFov = camera.fov;
  const baseQuaternion = camera.quaternion.clone();
  const fovKicks: FovKick[] = [];
  const shakeEuler = new Euler();
  const shakeQuaternion = new Quaternion();

  let requestedFovOffset = 0;
  let fovOffset = 0;
  let fovOffsetResponse = DEFAULT_FOV_OFFSET_RESPONSE;
  let trauma = 0;
  let traumaDecay = DEFAULT_SHAKE_DECAY;
  let maxTrauma = DEFAULT_MAX_TRAUMA;
  let elapsed = 0;
  let smoothPitch = 0;
  let smoothYaw = 0;
  let smoothRoll = 0;
  let disposed = false;

  function kickFov(degrees: number, options: CameraFeelFovKickOptions = {}) {
    if (!Number.isFinite(degrees) || degrees === 0) return;
    fovKicks.push({ offset: degrees, decay: finiteOr(options.decay, DEFAULT_FOV_KICK_DECAY) });
  }

  function setFovOffset(degrees: number, options: CameraFeelFovOffsetOptions = {}) {
    requestedFovOffset += finiteOr(degrees, 0);
    if (options.response !== undefined) fovOffsetResponse = options.response;
  }

  function shake(amount: number, options: CameraFeelShakeOptions = {}) {
    const nextMaxTrauma = positiveOr(options.maxTrauma, maxTrauma);
    maxTrauma = nextMaxTrauma;
    traumaDecay = positiveOr(options.decay, traumaDecay);
    trauma = MathUtils.clamp(trauma + Math.max(0, finiteOr(amount, 0)), 0, nextMaxTrauma);
  }

  function update(dt: number, options: CameraFeelUpdateOptions = {}) {
    if (disposed) return;
    const safeDt = MathUtils.clamp(finiteOr(dt, 0), 0, MAX_DT);
    elapsed += safeDt;

    updateFov(safeDt);
    updateShake(safeDt, options.shake);
    camera.updateMatrixWorld();
  }

  function updateFov(dt: number) {
    const response = fovOffsetResponse;
    if (response === Infinity) {
      fovOffset = requestedFovOffset;
    } else {
      const alpha = response <= 0 || dt <= 0 ? 1 : 1 - Math.exp(-response * dt);
      fovOffset += (requestedFovOffset - fovOffset) * MathUtils.clamp(alpha, 0, 1);
    }

    let kickOffset = 0;
    for (let i = fovKicks.length - 1; i >= 0; i -= 1) {
      const kick = fovKicks[i];
      kickOffset += kick.offset;
      if (dt > 0) kick.offset *= Math.exp(-Math.max(0, kick.decay) * dt);
      if (Math.abs(kick.offset) < 0.0001) fovKicks.splice(i, 1);
    }

    camera.fov = baseFov + fovOffset + kickOffset;
    camera.updateProjectionMatrix();

    requestedFovOffset = 0;
    fovOffsetResponse = DEFAULT_FOV_OFFSET_RESPONSE;
  }

  function updateShake(dt: number, options: CameraFeelShakeOptions = {}) {
    const decay = positiveOr(options.decay, traumaDecay);
    traumaDecay = decay;
    maxTrauma = positiveOr(options.maxTrauma, maxTrauma);
    if (dt > 0) trauma = Math.max(0, trauma - decay * dt);

    const normalizedTrauma = maxTrauma <= 0 ? 0 : MathUtils.clamp(trauma / maxTrauma, 0, 1);
    const amplitude = normalizedTrauma * normalizedTrauma;
    const pitchMax = MathUtils.degToRad(positiveOr(options.pitchDegrees, DEFAULT_SHAKE_PITCH_DEGREES));
    const yawMax = MathUtils.degToRad(positiveOr(options.yawDegrees, DEFAULT_SHAKE_YAW_DEGREES));
    const rollMax = MathUtils.degToRad(positiveOr(options.rollDegrees, DEFAULT_SHAKE_ROLL_DEGREES));
    const frequency = positiveOr(options.frequency, DEFAULT_SHAKE_FREQUENCY);
    const targetPitch = smoothNoise(elapsed, frequency, 1.7) * pitchMax * amplitude;
    const targetYaw = smoothNoise(elapsed, frequency * 0.83, 4.1) * yawMax * amplitude;
    const targetRoll = smoothNoise(elapsed, frequency * 1.17, 6.6) * rollMax * amplitude;
    const smoothing = positiveOr(options.smoothing, DEFAULT_SHAKE_SMOOTHING);
    const alpha = smoothing <= 0 || dt <= 0 ? 1 : 1 - Math.exp(-smoothing * dt);

    smoothPitch += (targetPitch - smoothPitch) * MathUtils.clamp(alpha, 0, 1);
    smoothYaw += (targetYaw - smoothYaw) * MathUtils.clamp(alpha, 0, 1);
    smoothRoll += (targetRoll - smoothRoll) * MathUtils.clamp(alpha, 0, 1);

    shakeEuler.set(smoothPitch, smoothYaw, smoothRoll, 'XYZ');
    shakeQuaternion.setFromEuler(shakeEuler);
    camera.quaternion.multiply(shakeQuaternion);
  }

  function restore(options: CameraFeelRestoreOptions = {}) {
    fovKicks.length = 0;
    requestedFovOffset = 0;
    fovOffset = 0;
    trauma = 0;
    smoothPitch = 0;
    smoothYaw = 0;
    smoothRoll = 0;
    camera.fov = baseFov;
    if (options.orientation === true) camera.quaternion.copy(baseQuaternion);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function dispose() {
    if (disposed) return;
    restore({ orientation: true });
    disposed = true;
  }

  return {
    baseFov,
    kickFov,
    setFovOffset,
    shake,
    update,
    restore,
    dispose,
  };
}

function finiteOr(value: number | undefined, fallback: number) {
  return value === undefined || !Number.isFinite(value) ? fallback : value;
}

function positiveOr(value: number | undefined, fallback: number) {
  const finite = finiteOr(value, fallback);
  return finite > 0 ? finite : fallback;
}

function smoothNoise(time: number, frequency: number, phase: number) {
  const t = time * frequency;
  return (
    Math.sin(t + phase)
    + Math.sin(t * 0.47 + phase * 2.31) * 0.55
    + Math.sin(t * 1.63 + phase * 0.71) * 0.25
  ) / 1.8;
}
