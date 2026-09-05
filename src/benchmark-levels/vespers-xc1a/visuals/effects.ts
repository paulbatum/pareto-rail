import {
  Camera,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { VOID } from './palette';

// The level's particle language: black glass breaks into dark shards that
// fall, coloured sparks fly for a moment, thin rings ripple, glints flash,
// and light streaks carry a kill's colour home to its window.

const SPARK_CAPACITY = 1200;
const SHARD_CAPACITY = 320;
const RING_CAPACITY = 28;
const GLINT_CAPACITY = 12;
const STREAK_CAPACITY = 18;

type Spark = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // unit length: feeds setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
  gravity: number;
};

type Shard = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  spin: number;
  scale: Vector3;
  age: number;
  life: number;
};

type RingEffect = { mesh: Mesh; color: Color; age: number; life: number; fromScale: number; toScale: number };
type GlintEffect = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };
type StreakEffect = {
  mesh: Mesh;
  from: Vector3;
  control: Vector3;
  to: Vector3;
  color: Color;
  age: number;
  life: number;
  onArrive: (() => void) | null;
};

const sparks: Spark[] = [];
const shards: Shard[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const streaks: StreakEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
let shardMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const scratchPosition = new Vector3();

export function createEffects(scene: Scene) {
  sparkMesh = new InstancedMesh(
    new TetrahedronGeometry(0.11, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  // Dark glass: normal-blended, near-black, only visible against light.
  const shardGeometry = new TetrahedronGeometry(0.5, 0);
  shardGeometry.scale(1, 1, 0.25);
  shardMesh = new InstancedMesh(
    shardGeometry,
    new MeshBasicMaterial({ color: VOID.clone().multiplyScalar(3), blending: NormalBlending, depthWrite: true }),
    SHARD_CAPACITY,
  );
  shardMesh.count = 0;
  shardMesh.frustumCulled = false;
  scene.add(shardMesh);

  const ringGeometry = new RingGeometry(0.965, 1, 56);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  // Four-point glint: two crossed thin blades.
  const bladeGeometry = new PlaneGeometry(1.7, 0.05);
  for (let i = 0; i < GLINT_CAPACITY; i += 1) {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    for (const rotation of [0, Math.PI / 2]) {
      const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
      const blade = new Mesh(bladeGeometry, material);
      blade.rotation.z = rotation;
      group.add(blade);
      materials.push(material);
    }
    group.visible = false;
    scene.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }

  const streakGeometry = new SphereGeometry(0.26, 10, 8);
  for (let i = 0; i < STREAK_CAPACITY; i += 1) {
    const mesh = new Mesh(streakGeometry, createAdditiveBasicMaterial({ color: 0x000000 }));
    mesh.visible = false;
    scene.add(mesh);
    streaks.push({ mesh, from: new Vector3(), control: new Vector3(), to: new Vector3(), color: new Color(), age: 0, life: -1, onArrive: null });
  }
}

function pushSpark(spark: Spark) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(spark);
}

function pushShard(shard: Shard) {
  if (shards.length >= SHARD_CAPACITY) shards.shift();
  shards.push(shard);
}

// Coloured glass sparks: quick, bright, a little gravity.
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, gravity = 4, rng: () => number = Math.random) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(rng);
    pushSpark({
      position: position.clone(),
      velocity: direction.clone().multiplyScalar(speed * (0.35 + rng() * 0.9)),
      axis: direction,
      rotation: new Quaternion(),
      spin: 8 + rng() * 14,
      color: color.clone(),
      size: 0.4 + rng() * 0.6,
      age: 0,
      life: 0.3 + rng() * 0.35,
      drag: 2.6,
      gravity,
    });
  }
}

// The black body breaks into dark glass that tumbles and falls toward the
// candle floor.
export function burstShards(position: Vector3, directions: Vector3[] | undefined, count: number, size: number, rng: () => number = Math.random) {
  const list = directions && directions.length > 0 ? directions : Array.from({ length: count }, () => randomUnit(rng));
  for (let i = 0; i < Math.max(count, list.length); i += 1) {
    const outward = (list[i % list.length] ?? randomUnit(rng)).clone().normalize();
    pushShard({
      position: position.clone().addScaledVector(outward, 0.3),
      velocity: outward.multiplyScalar(4 + rng() * 5).add(new Vector3((rng() - 0.5) * 2, rng() * 2, (rng() - 0.5) * 2)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 3 + rng() * 7,
      scale: new Vector3(size * (0.6 + rng() * 0.8), size * (0.6 + rng() * 1.2), size),
      age: 0,
      life: 1.1 + rng() * 0.6,
    });
  }
}

export function dropTrail(position: Vector3, color: Color, size = 0.45) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 4,
    color: color.clone(),
    size,
    age: 0,
    life: 0.26,
    drag: 1,
    gravity: 0,
  });
}

export function spawnRing(position: Vector3, color: Color, toScale: number, life: number) {
  const ring = rings.find((candidate) => candidate.life < 0);
  if (!ring) return;
  ring.mesh.position.copy(position);
  ring.mesh.scale.setScalar(0.01);
  (ring.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  ring.mesh.visible = true;
  ring.color.copy(color);
  ring.age = 0;
  ring.life = life;
  ring.fromScale = toScale * 0.12;
  ring.toScale = toScale;
}

export function spawnGlint(position: Vector3, color: Color, scale = 1, life = 0.18) {
  const glint = glints.find((candidate) => candidate.life < 0);
  if (!glint) return;
  glint.group.position.copy(position);
  glint.group.scale.setScalar(0.01);
  for (const material of glint.materials) material.color.set(0, 0, 0);
  glint.group.visible = true;
  glint.color.copy(color);
  glint.age = 0;
  glint.life = life;
  glint.scale = scale;
}

// Light going home: a bright bead flies from the kill to the window along a
// lifted arc, trailing sparks, and calls back when it lands.
export function spawnStreak(from: Vector3, to: Vector3, color: Color, life: number, onArrive: () => void) {
  const streak = streaks.find((candidate) => candidate.life < 0);
  if (!streak) {
    onArrive();
    return;
  }
  streak.from.copy(from);
  streak.to.copy(to);
  streak.control.copy(from).lerp(to, 0.5);
  streak.control.y += 3 + from.distanceTo(to) * 0.18;
  streak.color.copy(color);
  streak.age = 0;
  streak.life = life;
  streak.onArrive = onArrive;
  streak.mesh.position.copy(from);
  streak.mesh.visible = true;
  (streak.mesh.material as MeshBasicMaterial).color.copy(color).multiplyScalar(2.2);
}

export function updateEffects(dt: number, camera: Camera) {
  if (sparkMesh) {
    let count = 0;
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.age += dt;
      if (spark.age >= spark.life) {
        sparks.splice(i, 1);
        continue;
      }
      spark.velocity.y -= spark.gravity * dt;
      spark.velocity.multiplyScalar(Math.max(0, 1 - spark.drag * dt));
      spark.position.addScaledVector(spark.velocity, dt);
      scratchQuaternion.setFromAxisAngle(spark.axis, spark.spin * dt);
      spark.rotation.premultiply(scratchQuaternion).normalize();
      const fade = 1 - spark.age / spark.life;
      scratchScale.setScalar(spark.size * (0.35 + fade * 0.65));
      scratchMatrix.compose(spark.position, spark.rotation, scratchScale);
      sparkMesh.setMatrixAt(count, scratchMatrix);
      scratchColor.copy(spark.color).multiplyScalar(fade * fade);
      sparkMesh.setColorAt(count, scratchColor);
      count += 1;
    }
    sparkMesh.count = count;
    sparkMesh.instanceMatrix.needsUpdate = true;
    if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;
  }

  if (shardMesh) {
    let count = 0;
    for (let i = shards.length - 1; i >= 0; i -= 1) {
      const shard = shards[i];
      shard.age += dt;
      if (shard.age >= shard.life) {
        shards.splice(i, 1);
        continue;
      }
      shard.velocity.y -= 11 * dt;
      shard.velocity.multiplyScalar(Math.max(0, 1 - 1.4 * dt));
      shard.position.addScaledVector(shard.velocity, dt);
      scratchQuaternion.setFromAxisAngle(shard.axis, shard.spin * dt);
      shard.rotation.premultiply(scratchQuaternion).normalize();
      const progress = shard.age / shard.life;
      const shrink = progress < 0.7 ? 1 : Math.max(0.01, (1 - progress) / 0.3);
      scratchScale.copy(shard.scale).multiplyScalar(shrink);
      scratchMatrix.compose(shard.position, shard.rotation, scratchScale);
      shardMesh.setMatrixAt(count, scratchMatrix);
      count += 1;
    }
    shardMesh.count = count;
    shardMesh.instanceMatrix.needsUpdate = true;
  }

  for (const ring of rings) {
    if (ring.life < 0) continue;
    ring.age += dt;
    if (ring.age >= ring.life) {
      ring.life = -1;
      ring.mesh.visible = false;
      continue;
    }
    const progress = ring.age / ring.life;
    const eased = 1 - (1 - progress) * (1 - progress);
    ring.mesh.scale.setScalar(ring.fromScale + (ring.toScale - ring.fromScale) * eased);
    ring.mesh.quaternion.copy(camera.quaternion);
    (ring.mesh.material as MeshBasicMaterial).color.copy(ring.color).multiplyScalar((1 - progress) ** 1.5);
  }

  for (const glint of glints) {
    if (glint.life < 0) continue;
    glint.age += dt;
    if (glint.age >= glint.life) {
      glint.life = -1;
      glint.group.visible = false;
      continue;
    }
    const progress = glint.age / glint.life;
    const envelope = Math.sin(Math.min(1, progress * 1.15) * Math.PI);
    glint.group.scale.setScalar(Math.max(0.01, glint.scale * envelope));
    glint.group.quaternion.copy(camera.quaternion);
    glint.group.rotation.z += dt * 3;
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }

  for (const streak of streaks) {
    if (streak.life < 0) continue;
    streak.age += dt;
    const t = Math.min(1, streak.age / streak.life);
    const eased = t * t * (3 - 2 * t);
    // Quadratic Bezier through the lifted control point.
    const a = 1 - eased;
    scratchPosition
      .copy(streak.from)
      .multiplyScalar(a * a)
      .addScaledVector(streak.control, 2 * a * eased)
      .addScaledVector(streak.to, eased * eased);
    streak.mesh.position.copy(scratchPosition);
    streak.mesh.scale.setScalar(0.8 + 0.5 * Math.sin(streak.age * 30));
    dropTrail(scratchPosition, streak.color, 0.5);
    if (t >= 1) {
      streak.life = -1;
      streak.mesh.visible = false;
      const onArrive = streak.onArrive;
      streak.onArrive = null;
      onArrive?.();
    }
  }
}

export function resetEffects() {
  sparks.length = 0;
  shards.length = 0;
  if (sparkMesh) sparkMesh.count = 0;
  if (shardMesh) shardMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
  for (const streak of streaks) {
    streak.life = -1;
    streak.onArrive = null;
    streak.mesh.visible = false;
  }
}

export function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
