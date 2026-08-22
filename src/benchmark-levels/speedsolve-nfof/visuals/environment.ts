import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { createSpeedsolveRail } from '../gameplay';
import { mulberry32, RING_TINT, VOID_FOG, VOID_PALE } from './palette';

// The arena is a pale, softly lit void — the cube owns all the colour. Motion
// comes from guide rings strung along the rail (the camera flies through ring
// after ring, selling both speed and the helical orbit) and from slow-drifting
// dust motes. Everything here is thin lines or tiny chips: never an occluder.

const RING_COUNT = 44;
const DUST_COUNT = 130;
const DUST_RANGE = 30;

export type Environment = {
  rings: Group;
  dust: InstancedMesh;
  dustState: Array<{ offset: Vector3; rise: number; size: number }>;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = new Color(VOID_PALE);
  scene.fog = new FogExp2(VOID_FOG, 0.011);

  const curve = createSpeedsolveRail();
  const rng = mulberry32(0x5017e);

  const root = new Group();
  root.userData.raildIgnoreOcclusion = true;

  // Guide rings perpendicular to the rail.
  const rings = new Group();
  const circleGeometry = new BufferGeometry();
  const circlePoints: number[] = [];
  for (let i = 0; i < 64; i += 1) {
    const a0 = (i / 64) * Math.PI * 2;
    const a1 = ((i + 1) / 64) * Math.PI * 2;
    circlePoints.push(Math.cos(a0), Math.sin(a0), 0, Math.cos(a1), Math.sin(a1), 0);
  }
  circleGeometry.setAttribute('position', new Float32BufferAttribute(circlePoints, 3));

  for (let i = 0; i < RING_COUNT; i += 1) {
    const u = (i + 0.5) / RING_COUNT + (rng() - 0.5) * 0.008;
    const frame = sampleRailFrame(curve, Math.min(1, Math.max(0, u)));
    const material = new LineBasicMaterial(additiveMaterialParameters({
      color: RING_TINT.clone().multiplyScalar(0.5 + rng() * 0.4),
      opacity: 0.16 + rng() * 0.14,
    }));
    const ring = new LineSegments(circleGeometry, material);
    ring.position.copy(frame.position);
    ring.quaternion.setFromRotationMatrix(new Matrix4().lookAt(
      new Vector3(0, 0, 0),
      frame.tangent.clone().negate(),
      frame.up,
    ));
    const radius = 13 + rng() * 17;
    ring.scale.setScalar(radius);
    rings.add(ring);
  }
  // A few huge halo rings far off-axis for depth.
  for (let i = 0; i < 6; i += 1) {
    const u = rng();
    const frame = sampleRailFrame(curve, u);
    const material = new LineBasicMaterial(additiveMaterialParameters({
      color: RING_TINT.clone().multiplyScalar(0.35),
      opacity: 0.08,
    }));
    const ring = new LineSegments(circleGeometry, material);
    ring.position.copy(frame.position).addScaledVector(frame.right, (rng() - 0.5) * 60).addScaledVector(frame.up, (rng() - 0.5) * 40);
    ring.quaternion.copy(frameQuaternion(frame.tangent));
    ring.scale.setScalar(45 + rng() * 45);
    rings.add(ring);
  }
  root.add(rings);

  scene.add(root);

  // Weightless dust.
  const dust = new InstancedMesh(
    new TetrahedronGeometry(0.11, 0),
    new MeshBasicMaterial(additiveMaterialParameters({ color: 0xffffff })),
    DUST_COUNT,
  );
  dust.frustumCulled = false;
  const dustState: Environment['dustState'] = [];
  const tint = new Color(0.62, 0.66, 0.76);
  for (let i = 0; i < DUST_COUNT; i += 1) {
    dustState.push({
      offset: new Vector3((rng() - 0.5) * DUST_RANGE, (rng() - 0.5) * DUST_RANGE, (rng() - 0.5) * DUST_RANGE),
      rise: 0.3 + rng() * 0.9,
      size: 0.4 + rng() * 1.1,
    });
    dust.setColorAt(i, tint.clone().multiplyScalar(0.35 + rng() * 0.4));
  }
  if (dust.instanceColor) dust.instanceColor.needsUpdate = true;
  scene.add(dust);

  return { rings, dust, dustState };
}

function frameQuaternion(tangent: Vector3): Quaternion {
  return new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(0, 0, 0), tangent.clone().negate(), new Vector3(0, 1, 0)));
}

const dustMatrix = new Matrix4();
const dustPos = new Vector3();
const dustQuat = new Quaternion();
const dustScale = new Vector3();
const dustAxis = new Vector3(0.3, 1, 0.2).normalize();

export function updateEnvironment(env: Environment, frame: { dt: number; elapsed: number; camera: PerspectiveCamera }) {
  const { dt, elapsed, camera } = frame;
  const spin = dustQuat.setFromAxisAngle(dustAxis, elapsed * 0.2);
  for (let i = 0; i < DUST_COUNT; i += 1) {
    const chip = env.dustState[i];
    chip.offset.y += chip.rise * dt;
    if (chip.offset.y > DUST_RANGE) chip.offset.y = -DUST_RANGE;
    dustPos.copy(camera.position).add(chip.offset);
    dustScale.setScalar(chip.size);
    dustMatrix.compose(dustPos, spin, dustScale);
    env.dust.setMatrixAt(i, dustMatrix);
  }
  env.dust.instanceMatrix.needsUpdate = true;
}

export function resetEnvironment(_env: Environment) {
  // Static scenery — nothing accumulates across runs.
}
