import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { CatmullRomCurve3 } from 'three';
import { MathUtils } from 'three';
import type { PieceShape } from './creatures';
import { CREAM, ERASER_PINK, WOOD_DARK } from './palette';

// The hero: a rolling cleaning ball that starts marble-sized and ends as a
// lumpy melon. Rescued pieces stick to its surface as per-instance transforms
// in the ball's local frame, so rolling carries every button and pin with it
// and the silhouette records the whole run.

const STICK_CAPACITY: Record<PieceShape, number> = { disc: 72, box: 72, stick: 56, ball: 56 };

type StickSlot = { used: number };

export type TinkerBall = ReturnType<typeof createTinkerBall>;

const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const worldUp = new Vector3(0, 1, 0);
const rockAxis = new Vector3(0, 0, 1);
const moveDelta = new Vector3();
const rollAxis = new Vector3();

export function createTinkerBall() {
  // Root carries position and beat squash (world axes); spin carries the
  // rolling rotation and the growth scale.
  const root = new Group();
  const spin = new Group();
  root.add(spin);
  root.userData.raildIgnoreOcclusion = true;

  const core = new Mesh(
    new SphereGeometry(1, 24, 18),
    new MeshBasicMaterial({ color: CREAM.clone().multiplyScalar(0.5) }),
  );
  spin.add(core);
  // Two painted bands so the roll reads even before any pieces stick.
  for (const [tilt, color] of [[0.5, ERASER_PINK], [-0.9, WOOD_DARK]] as const) {
    const band = new Mesh(
      new CylinderGeometry(0.995, 0.995, 0.14, 24, 1, true),
      new MeshBasicMaterial({ color: color.clone().multiplyScalar(0.52) }),
    );
    band.rotation.z = tilt;
    spin.add(band);
  }

  const stickGeometries: Record<PieceShape, InstancedMesh> = {
    disc: new InstancedMesh(new CylinderGeometry(0.5, 0.47, 0.16, 12), new MeshBasicMaterial(), STICK_CAPACITY.disc),
    box: new InstancedMesh(new BoxGeometry(0.5, 0.34, 0.42), new MeshBasicMaterial(), STICK_CAPACITY.box),
    stick: new InstancedMesh(new CylinderGeometry(0.05, 0.05, 1, 6), new MeshBasicMaterial(), STICK_CAPACITY.stick),
    ball: new InstancedMesh(new SphereGeometry(0.5, 10, 8), new MeshBasicMaterial(), STICK_CAPACITY.ball),
  };
  const slots: Record<PieceShape, StickSlot> = { disc: { used: 0 }, box: { used: 0 }, stick: { used: 0 }, ball: { used: 0 } };
  for (const mesh of Object.values(stickGeometries)) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    spin.add(mesh);
  }

  const rollQuaternion = new Quaternion();
  const lastPosition = new Vector3();
  let radius = 0.38;
  let squash = 0;
  let stickCount = 0;
  let initialized = false;

  function reset() {
    for (const shape of Object.keys(stickGeometries) as PieceShape[]) {
      stickGeometries[shape].count = 0;
      slots[shape].used = 0;
    }
    stickCount = 0;
    rollQuaternion.identity();
    initialized = false;
  }

  /** Attach a rescued piece to the surface, sized in world units at attach time. */
  function addStick(shape: PieceShape, color: Color, size: number) {
    const mesh = stickGeometries[shape];
    const slot = slots[shape];
    const capacity = STICK_CAPACITY[shape];
    const index = slot.used % capacity;
    slot.used += 1;
    mesh.count = Math.min(capacity, slot.used);
    stickCount += 1;

    const direction = randomUnit();
    // Sticks live on the unit sphere; divide by the current radius so the
    // piece lands at true world size no matter how big the ball is now.
    const localScale = Math.max(0.12, (size / radius) * 0.9);
    scratchQuaternion.setFromUnitVectors(worldUp, direction);
    scratchQuaternion.multiply(new Quaternion().setFromAxisAngle(worldUp, Math.random() * Math.PI * 2));
    // Counter-rotate out of the current roll so the piece sticks where the
    // surface actually is this frame.
    const orientation = rollQuaternion.clone().invert().multiply(scratchQuaternion);
    const position = direction.clone().applyQuaternion(rollQuaternion.clone().invert()).multiplyScalar(0.98);
    scratchScale.setScalar(localScale);
    scratchMatrix.compose(position, orientation, scratchScale);
    mesh.setMatrixAt(index, scratchMatrix);
    scratchColor.copy(color);
    mesh.setColorAt(index, scratchColor);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function radiusFor(runProgress: number) {
    return 0.36 + 1.6 * MathUtils.smoothstep(runProgress, 0, 1);
  }

  /** Where the ball sits for a given eased rail progress. Past the rail end it
   * rolls straight off along the final tangent, so the camera never overtakes
   * it during the coast. */
  function positionFor(curve: CatmullRomCurve3, runProgress: number, target: Vector3) {
    const r = radiusFor(runProgress);
    const lead = 6 + r * 5.2;
    const length = curve.getLength();
    const uRaw = runProgress + lead / length;
    if (uRaw <= 1) {
      target.copy(curve.getPointAt(uRaw));
    } else {
      target.copy(curve.getPointAt(1)).addScaledVector(curve.getTangentAt(1), (uRaw - 1) * length);
    }
    target.y = r;
    return target;
  }

  function update(dt: number, curve: CatmullRomCurve3, runProgress: number, beatEnergy: number, elapsed: number) {
    radius = radiusFor(runProgress);
    positionFor(curve, runProgress, root.position);

    if (!initialized) {
      lastPosition.copy(root.position);
      initialized = true;
    }

    moveDelta.copy(root.position).sub(lastPosition);
    moveDelta.y = 0;
    const distance = moveDelta.length();
    if (distance > 0.0001) {
      rollAxis.crossVectors(worldUp, moveDelta.normalize()).normalize();
      scratchQuaternion.setFromAxisAngle(rollAxis, distance / radius);
      rollQuaternion.premultiply(scratchQuaternion).normalize();
    }
    lastPosition.copy(root.position);
    spin.quaternion.copy(rollQuaternion);
    if (distance <= 0.0001) {
      // Parked on the attract screen: an idle, expectant rock.
      scratchQuaternion.setFromAxisAngle(rockAxis, Math.sin(elapsed * 1.3) * 0.06);
      spin.quaternion.premultiply(scratchQuaternion);
    }

    // Beat squash: the ball bounces to the kick.
    squash = Math.max(0, squash - dt * 5);
    squash = Math.max(squash, beatEnergy * 0.16);
    root.scale.set(radius * (1 + squash * 0.35), radius * (1 - squash * 0.5), radius * (1 + squash * 0.35));
  }

  return {
    root,
    reset,
    addStick,
    update,
    positionFor,
    radius: () => radius,
    stickCount: () => stickCount,
  };
}

function randomUnit(): Vector3 {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
