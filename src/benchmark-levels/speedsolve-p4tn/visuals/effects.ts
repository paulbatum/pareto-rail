import {
  BoxGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { createAdditiveBasicMaterial, createTransientEffectPool } from '../../../engine/visual-kit';
import { mulberry32 } from '../../../engine/rng';

// Leaf file: pooled transients only, allocated once so the draw-call and object
// counts never grow during a run. Loose cubies and the finale confetti are single
// instanced meshes — a shower of two hundred fragments still costs one draw call.

const RING_COUNT = 16;
const SHARD_COUNT = 320;
const CONFETTI_COUNT = 520;

type RingEffect = {
  age: number;
  life: number;
  mesh: Mesh;
  material: MeshBasicMaterial;
  from: number;
  to: number;
  spin: number;
  angle: number;
};

type Shard = {
  active: boolean;
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  spin: number;
  scale: number;
  age: number;
  life: number;
  gravity: number;
};

const rng = mulberry32(20260724);
const matrix = new Matrix4();
const quaternion = new Quaternion();
const scaleVector = new Vector3();

let rings: RingEffect[] = [];
let ringCursor = 0;
let shards: Shard[] = [];
let shardMesh: InstancedMesh | null = null;
let confetti: Shard[] = [];
let confettiMesh: InstancedMesh | null = null;
let shardCursor = 0;
let confettiCursor = 0;

export function createEffects(scene: Scene) {
  disposeEffects(scene);

  const ringGeometry = new RingGeometry(0.86, 1, 40);
  rings = Array.from({ length: RING_COUNT }, () => {
    const material = createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide, opacity: 1 });
    const mesh = new Mesh(ringGeometry, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { age: 0, life: 1, mesh, material, from: 1, to: 2, spin: 0, angle: 0 };
  });

  shardMesh = makeShardMesh(SHARD_COUNT, 0.62);
  confettiMesh = makeShardMesh(CONFETTI_COUNT, 0.42);
  scene.add(shardMesh, confettiMesh);
  shards = Array.from({ length: SHARD_COUNT }, makeShard);
  confetti = Array.from({ length: CONFETTI_COUNT }, makeShard);
}

function makeShard(): Shard {
  return {
    active: false,
    position: new Vector3(),
    velocity: new Vector3(),
    axis: new Vector3(0, 1, 0),
    spin: 0,
    scale: 1,
    age: 0,
    life: 1,
    gravity: 0,
  };
}

function makeShardMesh(count: number, size: number) {
  // Fragments are transient debris, never cover: they are explicitly exempt from
  // the target-occlusion model rather than blocking a lock behind them.
  const mesh = new InstancedMesh(new BoxGeometry(size, size, size), new MeshBasicMaterial(), count);
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  // Seed the per-instance colour attribute up front so the material compiles with
  // instance colours from the first frame instead of the first burst.
  const seed = new Color(1, 1, 1);
  for (let index = 0; index < count; index += 1) mesh.setColorAt(index, seed);
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  hideAll(mesh, count);
  return mesh;
}

function hideAll(mesh: InstancedMesh, count: number) {
  matrix.makeScale(0, 0, 0);
  for (let index = 0; index < count; index += 1) mesh.setMatrixAt(index, matrix);
  mesh.instanceMatrix.needsUpdate = true;
}

export function resetEffects() {
  ringPool.clear(undefined);
  for (const shard of shards) shard.active = false;
  for (const shard of confetti) shard.active = false;
  if (shardMesh) hideAll(shardMesh, SHARD_COUNT);
  if (confettiMesh) hideAll(confettiMesh, CONFETTI_COUNT);
}

export function disposeEffects(scene: Scene) {
  for (const ring of rings) {
    scene.remove(ring.mesh);
    ring.material.dispose();
  }
  if (rings.length) rings[0].mesh.geometry.dispose();
  rings = [];
  for (const mesh of [shardMesh, confettiMesh]) {
    if (!mesh) continue;
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as MeshBasicMaterial).dispose();
  }
  shardMesh = null;
  confettiMesh = null;
  shards = [];
  confetti = [];
}

const ringPool = createTransientEffectPool<RingEffect, undefined>({
  update(effect, progress, dt) {
    const radius = effect.from + (effect.to - effect.from) * (1 - (1 - progress) ** 2);
    effect.mesh.scale.setScalar(radius);
    effect.angle += effect.spin * dt;
    effect.material.opacity = (1 - progress) ** 1.4;
  },
  dispose(effect) {
    effect.mesh.visible = false;
  },
});

/** An expanding hoop, used for locks, impacts, snaps and denials. */
export function spawnRing(position: Vector3, color: Color, radius: number, life: number, spin = 1) {
  if (!rings.length) return;
  const ring = rings[ringCursor];
  ringCursor = (ringCursor + 1) % rings.length;
  ring.mesh.position.copy(position);
  ring.mesh.visible = true;
  ring.angle = rng() * Math.PI;
  ring.material.color.copy(color);
  ring.material.opacity = 1;
  ring.age = 0;
  ring.life = life;
  ring.from = radius * 0.25;
  ring.to = radius;
  ring.spin = spin;
  ringPool.add(ring);
}

function emit(
  pool: Shard[],
  mesh: InstancedMesh | null,
  cursor: number,
  position: Vector3,
  color: Color,
  count: number,
  speed: number,
  life: number,
  scale: number,
  gravity: number,
) {
  if (!mesh) return cursor;
  let next = cursor;
  for (let index = 0; index < count; index += 1) {
    const shard = pool[next];
    mesh.setColorAt(next, color);
    next = (next + 1) % pool.length;
    shard.active = true;
    shard.position.copy(position);
    shard.velocity.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize()
      .multiplyScalar(speed * (0.45 + rng() * 0.85));
    shard.axis.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    shard.spin = 5 + rng() * 12;
    shard.scale = scale * (0.6 + rng() * 0.9);
    shard.age = 0;
    shard.life = life * (0.7 + rng() * 0.6);
    shard.gravity = gravity;
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return next;
}

/** Loose cubies: the shower a conquered face throws off, and every square kill. */
export function burstCubies(position: Vector3, color: Color, count: number, speed: number, life = 1.1, scale = 1) {
  shardCursor = emit(shards, shardMesh, shardCursor, position, color, count, speed, life, scale, 3.5);
}

/** The finale: the core bursts into a storm of tiny cubes. */
export function confettiStorm(position: Vector3, colors: readonly Color[], perColor: number) {
  for (const color of colors) {
    confettiCursor = emit(confetti, confettiMesh, confettiCursor, position, color, perColor, 26, 3.4, 1, 1.4);
  }
}

function updateShards(pool: Shard[], mesh: InstancedMesh | null, dt: number) {
  if (!mesh) return;
  let dirty = false;
  for (let index = 0; index < pool.length; index += 1) {
    const shard = pool[index];
    if (!shard.active) continue;
    shard.age += dt;
    if (shard.age >= shard.life) {
      shard.active = false;
      matrix.makeScale(0, 0, 0);
      mesh.setMatrixAt(index, matrix);
      dirty = true;
      continue;
    }
    shard.velocity.multiplyScalar(1 - Math.min(0.9, dt * 1.5));
    shard.velocity.y -= shard.gravity * dt;
    shard.position.addScaledVector(shard.velocity, dt);
    const fade = 1 - shard.age / shard.life;
    quaternion.setFromAxisAngle(shard.axis, shard.age * shard.spin);
    scaleVector.setScalar(shard.scale * (0.35 + fade * 0.8));
    matrix.compose(shard.position, quaternion, scaleVector);
    mesh.setMatrixAt(index, matrix);
    dirty = true;
  }
  if (dirty) mesh.instanceMatrix.needsUpdate = true;
}

export function updateEffects(dt: number, camera: Camera) {
  ringPool.update(dt, undefined);
  for (const ring of ringPool.values()) {
    ring.mesh.quaternion.copy(camera.quaternion);
    ring.mesh.rotateZ(ring.angle);
  }
  updateShards(shards, shardMesh, dt);
  updateShards(confetti, confettiMesh, dt);
}
