import {
  BoxGeometry,
  Color,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { createAdditiveBasicMaterial, createTransientEffectPool } from '../../../engine/visual-kit';

// Transient visual vocabulary. Everything here is additive, thin, and short —
// the frame is already carrying two fleets and a nebula, so effects earn their
// place by being small and fast rather than large and bright. Colours, sizes,
// and lifetimes are all supplied by the caller.

export type ShardSpec = { direction: Vector3; color: Color; size: number };

type Ring = { age: number; life: number; mesh: Mesh; from: number; to: number; peak: number };
type Spark = { age: number; life: number; mesh: Mesh; velocity: Vector3; drag: number; peak: number };
type Shard = { age: number; life: number; mesh: Mesh; velocity: Vector3; spin: Vector3; peak: number };
type Streak = { age: number; life: number; mesh: Mesh; velocity: Vector3; peak: number };
type Wreck = { age: number; life: number; mesh: Group; velocity: Vector3; spin: Vector3 };

let root: Group | null = null;

const ringGeometry = new RingGeometry(0.86, 1, 40);
const sparkGeometry = new BoxGeometry(0.09, 0.09, 0.5);
const shardGeometry = new ConeGeometry(0.24, 0.7, 4);
const glintGeometry = new PlaneGeometry(1, 1);
const streakGeometry = new BoxGeometry(0.1, 0.1, 1);
const wreckGeometry = new OctahedronGeometry(1, 0);
const wreckRimGeometry = new BoxGeometry(1, 1, 1);

function opacityOf(mesh: Mesh) {
  return mesh.material as MeshBasicMaterial;
}

const rings = createTransientEffectPool<Ring, undefined>({
  update(effect, progress) {
    const scale = effect.from + (effect.to - effect.from) * (1 - (1 - progress) ** 2.4);
    effect.mesh.scale.setScalar(scale);
    opacityOf(effect.mesh).opacity = effect.peak * (1 - progress) ** 1.7;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    opacityOf(effect.mesh).dispose();
  },
});

const sparks = createTransientEffectPool<Spark, undefined>({
  update(effect, progress, dt) {
    effect.velocity.multiplyScalar(1 - effect.drag * dt);
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    if (effect.velocity.lengthSq() > 0.0001) {
      effect.mesh.lookAt(effect.mesh.position.clone().add(effect.velocity));
    }
    const stretch = 1 + effect.velocity.length() * 0.16;
    effect.mesh.scale.set(1, 1, stretch);
    opacityOf(effect.mesh).opacity = effect.peak * (1 - progress) ** 1.5;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    opacityOf(effect.mesh).dispose();
  },
});

const shards = createTransientEffectPool<Shard, undefined>({
  update(effect, progress, dt) {
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    effect.velocity.multiplyScalar(1 - 0.7 * dt);
    effect.mesh.rotation.x += effect.spin.x * dt;
    effect.mesh.rotation.y += effect.spin.y * dt;
    effect.mesh.rotation.z += effect.spin.z * dt;
    opacityOf(effect.mesh).opacity = effect.peak * (1 - progress) ** 1.2;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    opacityOf(effect.mesh).dispose();
  },
});

// Glints are camera-facing quads: muzzle sparkle, impact flash, lock ping.
const glints = createTransientEffectPool<Ring, Camera>({
  update(effect, progress, _dt, camera) {
    effect.mesh.quaternion.copy(camera.quaternion);
    const scale = effect.from + (effect.to - effect.from) * progress;
    effect.mesh.scale.setScalar(scale);
    opacityOf(effect.mesh).opacity = effect.peak * (1 - progress) ** 2;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    opacityOf(effect.mesh).dispose();
  },
});

// Streaks carry the crossfire: long thin rods travelling between the fleets.
const streaks = createTransientEffectPool<Streak, undefined>({
  update(effect, progress, dt) {
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    // Bright in the middle of its flight, fading at both ends of its life.
    opacityOf(effect.mesh).opacity = effect.peak * Math.sin(Math.min(1, progress) * Math.PI) ** 0.6;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    opacityOf(effect.mesh).dispose();
  },
});

const wrecks = createTransientEffectPool<Wreck, undefined>({
  update(effect, progress, dt) {
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    effect.mesh.rotation.x += effect.spin.x * dt;
    effect.mesh.rotation.y += effect.spin.y * dt;
    effect.mesh.rotation.z += effect.spin.z * dt;
    const fade = (1 - progress) ** 1.1;
    effect.mesh.traverse((child) => {
      const material = (child as Mesh).material as MeshBasicMaterial | undefined;
      if (material && material.transparent) material.opacity = fade;
    });
  },
  dispose(effect) {
    // Geometry is shared with every other wreck; only the per-wreck materials
    // belong to this effect.
    effect.mesh.removeFromParent();
    effect.mesh.traverse((child) => {
      const material = (child as Mesh).material as MeshBasicMaterial | undefined;
      material?.dispose();
    });
  },
});

export function createEffects(scene: Scene) {
  root = new Group();
  root.frustumCulled = false;
  scene.add(root);
  return root;
}

export function resetEffects() {
  rings.clear(undefined);
  sparks.clear(undefined);
  shards.clear(undefined);
  streaks.clear(undefined);
  wrecks.clear(undefined);
}

export function spawnRing(position: Vector3, color: Color, size: number, life: number, from = 0.15, peak = 1) {
  if (!root) return;
  const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color, opacity: peak }));
  mesh.position.copy(position);
  mesh.scale.setScalar(from);
  root.add(mesh);
  rings.add({ age: 0, life, mesh, from, to: size, peak });
}

export function spawnGlint(position: Vector3, color: Color, size: number, life: number, peak = 1) {
  if (!root) return;
  const mesh = new Mesh(glintGeometry, createAdditiveBasicMaterial({ color, opacity: peak }));
  mesh.position.copy(position);
  root.add(mesh);
  glints.add({ age: 0, life, mesh, from: size * 0.3, to: size, peak });
}

export function burstSparks(
  position: Vector3,
  color: Color,
  count: number,
  speed: number,
  life = 0.5,
  drag = 1.6,
) {
  if (!root) return;
  for (let i = 0; i < count; i += 1) {
    const mesh = new Mesh(sparkGeometry, createAdditiveBasicMaterial({ color, opacity: 1 }));
    mesh.position.copy(position);
    root.add(mesh);
    const velocity = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .normalize()
      .multiplyScalar(speed * (0.45 + Math.random() * 0.9));
    sparks.add({ age: 0, life: life * (0.6 + Math.random() * 0.7), mesh, velocity, drag, peak: 1 });
  }
}

export function burstShards(position: Vector3, specs: ShardSpec[], speed = 11) {
  if (!root) return;
  for (const spec of specs) {
    const mesh = new Mesh(shardGeometry, createAdditiveBasicMaterial({ color: spec.color, opacity: 1 }));
    mesh.position.copy(position);
    mesh.scale.setScalar(spec.size);
    root.add(mesh);
    shards.add({
      age: 0,
      life: 0.42 + Math.random() * 0.4,
      mesh,
      velocity: spec.direction.clone().multiplyScalar(speed * (0.6 + Math.random() * 0.8)),
      spin: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(11),
      peak: 1,
    });
  }
}

/** One round of the crossfire: a long rod crossing the gap between the fleets. */
export function spawnStreak(
  from: Vector3,
  direction: Vector3,
  speed: number,
  length: number,
  color: Color,
  life: number,
  thickness = 1,
) {
  if (!root) return;
  const mesh = new Mesh(streakGeometry, createAdditiveBasicMaterial({ color, opacity: 1 }));
  mesh.position.copy(from);
  mesh.scale.set(thickness, thickness, length);
  mesh.lookAt(from.clone().add(direction));
  root.add(mesh);
  streaks.add({ age: 0, life, mesh, velocity: direction.clone().normalize().multiplyScalar(speed), peak: 1 });
}

/** A tumbling piece of somebody's hull, thrown clear of a kill. */
export function spawnWreck(position: Vector3, scale: number, hullColor: Color, rimColor: Color, drift: Vector3) {
  if (!root) return;
  const group = new Group();
  const body = new Mesh(wreckGeometry, new MeshBasicMaterial({ color: hullColor.clone(), transparent: true }));
  body.scale.set(scale * 1.7, scale * 0.5, scale);
  group.add(body);
  const rim = new Mesh(wreckRimGeometry, createAdditiveBasicMaterial({ color: rimColor.clone() }));
  rim.scale.set(scale * 2.6, scale * 0.06, scale * 0.14);
  rim.position.y = scale * 0.34;
  group.add(rim);
  group.position.copy(position);
  root.add(group);
  wrecks.add({
    age: 0,
    life: 2.6,
    mesh: group,
    velocity: drift.clone(),
    spin: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3.2),
  });
}

/** Projectile and shell trails: one tiny spark dropped per frame. */
export function dropTrail(position: Vector3, color: Color, size = 1) {
  if (!root) return;
  const mesh = new Mesh(sparkGeometry, createAdditiveBasicMaterial({ color, opacity: 0.8 }));
  mesh.position.copy(position);
  mesh.scale.setScalar(size);
  root.add(mesh);
  sparks.add({ age: 0, life: 0.24, mesh, velocity: new Vector3(), drag: 0, peak: 0.8 });
}

export function updateEffects(dt: number, camera: Camera) {
  rings.update(dt, undefined);
  sparks.update(dt, undefined);
  shards.update(dt, undefined);
  glints.update(dt, camera);
  streaks.update(dt, undefined);
  wrecks.update(dt, undefined);
}

export function effectLoad() {
  return rings.size + sparks.size + shards.size + glints.size + streaks.size + wrecks.size;
}
