import {
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import { createTransientEffectPool } from '../../../engine/visual-kit';
import { createDebrisMesh } from './bikes';
import { CHROME } from './palette';

/**
 * Transient effects. Every effect draws from a recycled pool so a sixty-second
 * run never grows the scene: dead effects go back on a free list with their
 * mesh parked and hidden, and a fresh burst reuses it.
 */

type Recycler<T extends Mesh | Group> = {
  take(): T;
  give(item: T): void;
  dispose(): void;
};

function recycler<T extends Mesh | Group>(root: Group, make: () => T): Recycler<T> {
  const free: T[] = [];
  return {
    take() {
      const item = free.pop() ?? make();
      item.visible = true;
      if (!item.parent) root.add(item);
      return item;
    },
    give(item) {
      item.visible = false;
      free.push(item);
    },
    dispose() {
      free.length = 0;
    },
  };
}

type RingEffect = { age: number; life: number; mesh: Mesh; colour: Color; scale: number; spin: number };
type SparkEffect = { age: number; life: number; mesh: Mesh; velocity: Vector3; colour: Color; gravity: number };
type DebrisEffect = { age: number; life: number; mesh: Mesh; velocity: Vector3; spin: Vector3 };
type SmearEffect = { age: number; life: number; mesh: Mesh; colour: Color; length: number };

let root: Group | null = null;
let rings: Recycler<Mesh> | null = null;
let sparks: Recycler<Mesh> | null = null;
let debris: Recycler<Mesh> | null = null;
let smears: Recycler<Mesh> | null = null;

const RING_GEOMETRY = new RingGeometry(0.62, 0.78, 24);
const SPARK_GEOMETRY = new PlaneGeometry(0.16, 0.16);
const SMEAR_GEOMETRY = new PlaneGeometry(1, 1);

const ringPool = createTransientEffectPool<RingEffect, Camera>({
  update(effect, progress, dt) {
    effect.mesh.scale.setScalar(0.35 + progress * effect.scale);
    effect.mesh.rotation.z += dt * effect.spin;
    const material = effect.mesh.material as MeshBasicMaterial;
    material.color.copy(effect.colour).multiplyScalar((1 - progress) ** 1.4);
  },
  dispose(effect) {
    rings?.give(effect.mesh);
  },
});

const sparkPool = createTransientEffectPool<SparkEffect, Camera>({
  update(effect, progress, dt, camera) {
    effect.velocity.y -= effect.gravity * dt;
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    effect.mesh.quaternion.copy(camera.quaternion);
    effect.mesh.scale.setScalar(1 - progress * 0.7);
    (effect.mesh.material as MeshBasicMaterial).color.copy(effect.colour).multiplyScalar((1 - progress) ** 1.6);
  },
  dispose(effect) {
    sparks?.give(effect.mesh);
  },
});

const debrisPool = createTransientEffectPool<DebrisEffect, Camera>({
  update(effect, progress, dt) {
    effect.velocity.y -= 16 * dt;
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    effect.mesh.rotation.x += effect.spin.x * dt;
    effect.mesh.rotation.y += effect.spin.y * dt;
    effect.mesh.rotation.z += effect.spin.z * dt;
    effect.mesh.scale.setScalar(Math.max(0.05, 1 - progress * 0.5));
  },
  dispose(effect) {
    debris?.give(effect.mesh);
  },
});

const smearPool = createTransientEffectPool<SmearEffect, Camera>({
  update(effect, progress) {
    effect.mesh.scale.set(0.7 + progress * 0.8, effect.length * (0.4 + progress * 0.9), 1);
    (effect.mesh.material as MeshBasicMaterial).color.copy(effect.colour).multiplyScalar((1 - progress) ** 2);
  },
  dispose(effect) {
    smears?.give(effect.mesh);
  },
});

export function createEffects(scene: Scene) {
  disposeEffects();
  root = new Group();
  root.userData.raildIgnoreOcclusion = true;
  scene.add(root);
  rings = recycler(root, () => additiveMesh(RING_GEOMETRY));
  sparks = recycler(root, () => additiveMesh(SPARK_GEOMETRY));
  smears = recycler(root, () => additiveMesh(SMEAR_GEOMETRY));
  debris = recycler(root, () => createDebrisMesh(CHROME));
  return root;
}

function additiveMesh(geometry: BufferGeometry) {
  const mesh = new Mesh(geometry, createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide }));
  mesh.userData.raildIgnoreOcclusion = true;
  return mesh;
}

export function resetEffects(camera: Camera) {
  ringPool.clear(camera);
  sparkPool.clear(camera);
  debrisPool.clear(camera);
  smearPool.clear(camera);
}

export function disposeEffects() {
  rings?.dispose();
  sparks?.dispose();
  debris?.dispose();
  smears?.dispose();
  rings = null;
  sparks = null;
  debris = null;
  smears = null;
  if (root) {
    root.removeFromParent();
    disposeObject3D(root);
  }
  root = null;
}

/** A flat shockwave facing the camera: locks, fires, kills, stage breaks. */
export function spawnRing(position: Vector3, colour: Color, scale: number, life: number, spin = 2.4) {
  if (!rings) return;
  const mesh = rings.take();
  mesh.position.copy(position);
  mesh.scale.setScalar(0.35);
  ringPool.add({ age: 0, life, mesh, colour: colour.clone(), scale, spin });
}

/** Chrome and paint chips off a body panel. */
export function burstSparks(position: Vector3, colour: Color, count: number, speed: number, gravity = 9) {
  if (!sparks) return;
  for (let i = 0; i < count; i += 1) {
    const mesh = sparks.take();
    mesh.position.copy(position);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    sparkPool.add({
      age: 0,
      life: 0.24 + Math.random() * 0.34,
      mesh,
      colour: colour.clone(),
      gravity,
      velocity: new Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.abs(Math.cos(phi)) * 0.8 + 0.3,
        Math.sin(phi) * Math.sin(theta),
      ).multiplyScalar(speed * (0.5 + Math.random() * 0.8)),
    });
  }
}

/** Wheels and fairing panels cartwheeling down the road behind you. */
export function burstDebris(position: Vector3, count: number, speed: number) {
  if (!debris) return;
  for (let i = 0; i < count; i += 1) {
    const mesh = debris.take();
    mesh.position.copy(position);
    mesh.scale.setScalar(1);
    debrisPool.add({
      age: 0,
      life: 0.9 + Math.random() * 0.7,
      mesh,
      velocity: new Vector3(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.7 + 1.5,
        (Math.random() - 0.5) * speed * 0.6,
      ),
      spin: new Vector3(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 16 - 8),
    });
  }
}

/** A scorch smear left on the tarmac where a bike went down. */
export function spawnSmear(position: Vector3, colour: Color, length: number, life: number) {
  if (!smears) return;
  const mesh = smears.take();
  mesh.position.copy(position);
  mesh.rotation.set(-Math.PI / 2, 0, 0);
  smearPool.add({ age: 0, life, mesh, colour: colour.clone(), length });
}

export function updateEffects(dt: number, camera: Camera) {
  ringPool.update(dt, camera);
  sparkPool.update(dt, camera);
  debrisPool.update(dt, camera);
  smearPool.update(dt, camera);
}
