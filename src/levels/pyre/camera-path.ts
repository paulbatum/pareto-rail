import { CatmullRomCurve3, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { CatmullRomCurve3 as Curve, PerspectiveCamera } from 'three';

/**
 * A keyframed camera rig for the fly-around.
 *
 * The runner drives position from the rail and points the camera along the rail
 * tangent. That is the wrong facing for an orbit — arcing around the scene would
 * aim the camera along the arc instead of at what it circles. So the rail
 * carries position only, and each keyframe also names a point to look at; the
 * rig re-aims the camera after the runner has placed it, keeping the player's
 * edge-look offset intact.
 */
export interface CameraKey {
  time: number;
  position: readonly [number, number, number];
  focus: readonly [number, number, number];
}

const SAMPLES_PER_SEGMENT = 128;
const UP = new Vector3(0, 1, 0);

/**
 * Monotone cubic through the keys: hits every key exactly, never overshoots
 * between them, and has no velocity step at a key. Plain linear interpolation
 * would jolt the camera every time a segment changed speed.
 */
function monotoneSpline(xs: readonly number[], ys: readonly number[]) {
  const n = xs.length;
  const slopes: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i += 1) slopes[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);

  const tangents: number[] = new Array(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i += 1) tangents[i] = (slopes[i - 1] + slopes[i]) / 2;

  for (let i = 0; i < n - 1; i += 1) {
    if (slopes[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / slopes[i];
    const b = tangents[i + 1] / slopes[i];
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[i] = scale * a * slopes[i];
      tangents[i + 1] = scale * b * slopes[i];
    }
  }

  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = n - 2;
    while (i > 0 && xs[i] > x) i -= 1;
    const span = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / span;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * span * tangents[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * span * tangents[i + 1]
    );
  };
}

export function createCameraPath(keys: readonly CameraKey[]) {
  const railPoints = keys.map((key) => new Vector3(...key.position));
  const divisions = (keys.length - 1) * SAMPLES_PER_SEGMENT;

  const createRail = () => {
    const curve = new CatmullRomCurve3(railPoints.map((point) => point.clone()), false, 'catmullrom', 0.5);
    // Seed the same arc-length cache the key table was measured against, so a
    // key's progress value maps back to exactly that key's point.
    curve.getLengths(divisions);
    return curve;
  };

  const lengths = createRail().getLengths(divisions);
  const total = lengths[divisions];
  const times = keys.map((key) => key.time);
  const railProgress = monotoneSpline(times, keys.map((_, index) => lengths[index * SAMPLES_PER_SEGMENT] / total));

  const focusCurve = new CatmullRomCurve3(keys.map((key) => new Vector3(...key.focus)), false, 'catmullrom', 0.5);
  const focusParameter = monotoneSpline(times, keys.map((_, index) => index / (keys.length - 1)));

  const focus = new Vector3();
  const tangent = new Vector3();
  const basis = new Matrix4();
  const railFacing = new Quaternion();
  const wantFacing = new Quaternion();
  const edgeLook = new Quaternion();

  const focusAt = (time: number, out = focus) => focusCurve.getPoint(MathUtils.clamp(focusParameter(time), 0, 1), out);

  return {
    createRail,
    runProgress: (time: number) => MathUtils.clamp(railProgress(time), 0, 1),
    focusAt,
    /** Re-aim an already-placed camera at the authored focus for this moment. */
    aim(camera: PerspectiveCamera, curve: Curve, progress: number, time: number) {
      curve.getPointAt(MathUtils.clamp(progress + 0.025, 0, 1), tangent);
      basis.lookAt(camera.position, tangent, UP);
      railFacing.setFromRotationMatrix(basis);
      // Whatever the runner's pose differs from the plain rail facing by is the
      // player's edge look; it is re-applied on top of the authored facing.
      edgeLook.copy(railFacing).invert().multiply(camera.quaternion);

      basis.lookAt(camera.position, focusAt(time), UP);
      wantFacing.setFromRotationMatrix(basis);
      camera.quaternion.copy(wantFacing).multiply(edgeLook);
      camera.updateMatrixWorld();
    },
    /** Aim without an edge-look pass, for the attract pose the runner captures as its base. */
    aimDirect(camera: PerspectiveCamera, time: number) {
      basis.lookAt(camera.position, focusAt(time), UP);
      camera.quaternion.setFromRotationMatrix(basis);
      camera.updateMatrixWorld();
    },
  };
}
