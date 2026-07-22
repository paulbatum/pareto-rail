import {
  BoxGeometry,
  Camera,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { SOLVE_COLORS } from './palette';

// Speedsolve's particle language is one shape: the cube. Everything that
// breaks breaks into cubes, everything that flashes flashes as a square, and
// nothing falls — this is a void, so debris drifts, tumbles, and shrinks out
// of existence instead of obeying a gravity that does not exist here.

const SPARK_CAPACITY = 900;
const DEBRIS_CAPACITY = 760;
const RING_CAPACITY = 22;
const GLINT_CAPACITY = 10;

type Spark = {
  position: Vector3;
  velocity: Vector3;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
};

type Debris = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  spin: number;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
};

type Ring = { mesh: Mesh; color: Color; age: number; life: number; from: number; to: number };
type Glint = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };

const sparks: Spark[] = [];
const debris: Debris[] = [];
const rings: Ring[] = [];
const glints: Glint[] = [];

let sparkMesh: InstancedMesh | null = null;
let debrisMesh: InstancedMesh | null = null;
let effectsScene: Scene | null = null;

const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

export function createEffects(scene: Scene) {
  effectsScene = scene;

  sparkMesh = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    createAdditiveBasicMaterial({ color: 0xffffff, opacity: 1 }),
    SPARK_CAPACITY,
  );
  sparkMesh.frustumCulled = false;
  sparkMesh.userData.raildIgnoreOcclusion = true;
  sparkMesh.count = 0;
  scene.add(sparkMesh);

  debrisMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), DEBRIS_CAPACITY);
  debrisMesh.frustumCulled = false;
  debrisMesh.userData.raildIgnoreOcclusion = true;
  debrisMesh.count = 0;
  scene.add(debrisMesh);
}

export function disposeEffects() {
  resetEffects();
  sparkMesh?.removeFromParent();
  sparkMesh?.geometry.dispose();
  (sparkMesh?.material as MeshBasicMaterial | undefined)?.dispose();
  debrisMesh?.removeFromParent();
  debrisMesh?.geometry.dispose();
  (debrisMesh?.material as MeshBasicMaterial | undefined)?.dispose();
  sparkMesh = null;
  debrisMesh = null;
  effectsScene = null;
}

export function resetEffects() {
  sparks.length = 0;
  debris.length = 0;
  for (const ring of rings) {
    ring.mesh.removeFromParent();
    ring.mesh.geometry.dispose();
    (ring.mesh.material as MeshBasicMaterial).dispose();
  }
  rings.length = 0;
  for (const glint of glints) {
    glint.group.removeFromParent();
    for (const material of glint.materials) material.dispose();
    glint.group.traverse((child) => (child as Mesh).geometry?.dispose());
  }
  glints.length = 0;
  if (sparkMesh) sparkMesh.count = 0;
  if (debrisMesh) debrisMesh.count = 0;
}

// ---- emitters ------------------------------------------------------------------

export function spawnSparks(position: Vector3, color: Color, count: number, speed: number, size = 0.34) {
  for (let i = 0; i < count; i += 1) {
    if (sparks.length >= SPARK_CAPACITY) break;
    sparks.push({
      position: position.clone(),
      velocity: randomDirection().multiplyScalar(speed * (0.35 + Math.random() * 0.9)),
      color: color.clone(),
      size: size * (0.65 + Math.random() * 0.8),
      age: 0,
      life: 0.24 + Math.random() * 0.34,
      drag: 2.6 + Math.random() * 2.2,
    });
  }
}

/** Loose cubies: what a cube sheds. Bigger, slower, and tumbling. */
export function burstCubies(position: Vector3, direction: Vector3, color: Color, size: number, count: number) {
  for (let i = 0; i < count; i += 1) {
    if (debris.length >= DEBRIS_CAPACITY) break;
    const velocity = randomDirection().multiplyScalar(4 + Math.random() * 9).addScaledVector(direction, 7 + Math.random() * 10);
    debris.push({
      position: position.clone().addScaledVector(randomDirection(), size * 0.6),
      velocity,
      axis: randomDirection(),
      rotation: new Quaternion(),
      spin: (Math.random() * 2 - 1) * 7,
      color: color.clone(),
      size: size * (0.5 + Math.random() * 0.7),
      age: 0,
      life: 1.1 + Math.random() * 0.9,
      drag: 0.75 + Math.random() * 0.5,
    });
  }
}

/** The finish: the whole machine as a storm of tiny colored cubes. */
export function spawnConfetti(position: Vector3, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    if (debris.length >= DEBRIS_CAPACITY) break;
    debris.push({
      position: position.clone().addScaledVector(randomDirection(), Math.random() * 6),
      velocity: randomDirection().multiplyScalar(speed * (0.25 + Math.random() * 1.1)),
      axis: randomDirection(),
      rotation: new Quaternion(),
      spin: (Math.random() * 2 - 1) * 12,
      color: SOLVE_COLORS[i % SOLVE_COLORS.length].clone(),
      size: 0.55 + Math.random() * 1.5,
      age: 0,
      life: 2.4 + Math.random() * 2.6,
      drag: 0.32 + Math.random() * 0.4,
    });
  }
}

/** Square shockwave. Round rings would be the wrong shape for this level. */
export function spawnRing(position: Vector3, color: Color, scale: number, life: number) {
  if (!effectsScene || rings.length >= RING_CAPACITY) return;
  const mesh = new Mesh(
    new RingGeometry(0.86, 1, 4, 1),
    createAdditiveBasicMaterial({ color: color.clone(), opacity: 1 }),
  );
  mesh.rotation.z = Math.PI / 4;
  mesh.position.copy(position);
  mesh.userData.raildIgnoreOcclusion = true;
  effectsScene.add(mesh);
  rings.push({ mesh, color: color.clone(), age: 0, life, from: scale * 0.16, to: scale });
}

/** A four-armed cross flare: the lock/impact accent. */
export function spawnGlint(position: Vector3, color: Color, scale: number, life: number) {
  if (!effectsScene || glints.length >= GLINT_CAPACITY) return;
  const group = new Group();
  const materials: MeshBasicMaterial[] = [];
  for (let i = 0; i < 2; i += 1) {
    const material = createAdditiveBasicMaterial({ color: color.clone(), opacity: 1 });
    const mesh = new Mesh(new BoxGeometry(i === 0 ? 3.2 : 0.2, i === 0 ? 0.2 : 3.2, 0.2), material);
    materials.push(material);
    group.add(mesh);
  }
  group.position.copy(position);
  group.userData.raildIgnoreOcclusion = true;
  effectsScene.add(group);
  glints.push({ group, materials, color: color.clone(), age: 0, life, scale });
}

export function spawnTrailMote(position: Vector3, color: Color) {
  if (sparks.length >= SPARK_CAPACITY) return;
  sparks.push({
    position: position.clone(),
    velocity: randomDirection().multiplyScalar(0.5),
    color: color.clone(),
    size: 0.26,
    age: 0,
    life: 0.22,
    drag: 3.5,
  });
}

// ---- per-frame -----------------------------------------------------------------

export function updateEffects(dt: number, camera: Camera) {
  updateSparks(dt);
  updateDebris(dt);

  for (let i = rings.length - 1; i >= 0; i -= 1) {
    const ring = rings[i];
    ring.age += dt;
    const t = ring.age / ring.life;
    if (t >= 1) {
      ring.mesh.removeFromParent();
      ring.mesh.geometry.dispose();
      (ring.mesh.material as MeshBasicMaterial).dispose();
      rings.splice(i, 1);
      continue;
    }
    const eased = 1 - (1 - t) ** 2.4;
    ring.mesh.scale.setScalar(ring.from + (ring.to - ring.from) * eased);
    ring.mesh.quaternion.copy(camera.quaternion);
    ring.mesh.rotateZ(Math.PI / 4 + t * 0.5);
    const material = ring.mesh.material as MeshBasicMaterial;
    material.opacity = (1 - t) ** 1.9 * 0.8;
    material.color.copy(ring.color).multiplyScalar(0.35 + (1 - t) * 0.55);
  }

  for (let i = glints.length - 1; i >= 0; i -= 1) {
    const glint = glints[i];
    glint.age += dt;
    const t = glint.age / glint.life;
    if (t >= 1) {
      glint.group.removeFromParent();
      for (const material of glint.materials) material.dispose();
      glint.group.traverse((child) => (child as Mesh).geometry?.dispose());
      glints.splice(i, 1);
      continue;
    }
    glint.group.quaternion.copy(camera.quaternion);
    glint.group.scale.setScalar(glint.scale * (0.35 + t * 0.9));
    for (const material of glint.materials) {
      material.opacity = (1 - t) ** 2.4 * 0.85;
      material.color.copy(glint.color);
    }
  }
}

function updateSparks(dt: number) {
  if (!sparkMesh) return;
  let index = 0;
  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const spark = sparks[i];
    spark.age += dt;
    if (spark.age >= spark.life) {
      sparks.splice(i, 1);
      continue;
    }
    spark.velocity.multiplyScalar(Math.max(0, 1 - spark.drag * dt));
    spark.position.addScaledVector(spark.velocity, dt);
  }
  for (const spark of sparks) {
    if (index >= SPARK_CAPACITY) break;
    const t = spark.age / spark.life;
    const size = spark.size * (1 - t) ** 0.6;
    scratchScale.setScalar(Math.max(0.0001, size));
    scratchMatrix.compose(spark.position, scratchQuaternion.identity(), scratchScale);
    sparkMesh.setMatrixAt(index, scratchMatrix);
    sparkMesh.setColorAt(index, scratchColor.copy(spark.color).multiplyScalar(0.35 + (1 - t) * 1.05));
    index += 1;
  }
  sparkMesh.count = index;
  sparkMesh.instanceMatrix.needsUpdate = true;
  if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;
}

function updateDebris(dt: number) {
  if (!debrisMesh) return;
  let index = 0;
  for (let i = debris.length - 1; i >= 0; i -= 1) {
    const piece = debris[i];
    piece.age += dt;
    if (piece.age >= piece.life) {
      debris.splice(i, 1);
      continue;
    }
    piece.velocity.multiplyScalar(Math.max(0, 1 - piece.drag * dt));
    piece.position.addScaledVector(piece.velocity, dt);
    piece.rotation.multiply(scratchQuaternion.setFromAxisAngle(piece.axis, piece.spin * dt));
  }
  for (const piece of debris) {
    if (index >= DEBRIS_CAPACITY) break;
    const t = piece.age / piece.life;
    scratchScale.setScalar(Math.max(0.0001, piece.size * (1 - t * t)));
    scratchMatrix.compose(piece.position, piece.rotation, scratchScale);
    debrisMesh.setMatrixAt(index, scratchMatrix);
    debrisMesh.setColorAt(index, scratchColor.copy(piece.color).multiplyScalar(0.7 + (1 - t) * 0.45));
    index += 1;
  }
  debrisMesh.count = index;
  debrisMesh.instanceMatrix.needsUpdate = true;
  if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
}

function randomDirection() {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
}
