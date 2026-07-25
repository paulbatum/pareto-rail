import {
  CircleGeometry,
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
import { createAdditiveBasicMaterial, createTransientEffectPool } from '../../../engine/visual-kit';
import { INK_BLACK } from './palette';

// Transient effect pools: expanding rings, spark bursts, oily ink gushes, and
// glints. Ink gushes use normal blending — ink must darken the frame, not add
// to it.

const ringGeometry = new RingGeometry(0.42, 0.5, 28);
const sparkGeometry = new PlaneGeometry(0.2, 0.055);
const dropletGeometry = new CircleGeometry(0.17, 8);
const glintGeometry = new PlaneGeometry(1, 0.085);

let root: Group | null = null;

type RingEffect = { age: number; life: number; mesh: Mesh; size: number };
type SparkEffect = { age: number; life: number; mesh: Mesh; velocity: Vector3 };
type DropletEffect = { age: number; life: number; mesh: Mesh; velocity: Vector3; grow: number };
type GlintEffect = { age: number; life: number; mesh: Group; size: number };

let cameraRef: Camera | null = null;

const rings = createTransientEffectPool<RingEffect, undefined>({
  update(effect, progress) {
    const eased = 1 - (1 - progress) ** 2;
    effect.mesh.scale.setScalar(0.25 + eased * effect.size);
    (effect.mesh.material as MeshBasicMaterial).opacity = 0.85 * (1 - progress);
    if (cameraRef) effect.mesh.quaternion.copy(cameraRef.quaternion);
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    (effect.mesh.material as MeshBasicMaterial).dispose();
  },
});

const sparks = createTransientEffectPool<SparkEffect, undefined>({
  update(effect, progress, dt) {
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    effect.velocity.multiplyScalar(1 - dt * 2.2);
    (effect.mesh.material as MeshBasicMaterial).opacity = 0.95 * (1 - progress);
    if (cameraRef) {
      effect.mesh.quaternion.copy(cameraRef.quaternion);
      effect.mesh.rotateZ(Math.atan2(effect.velocity.y, effect.velocity.x));
    }
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    (effect.mesh.material as MeshBasicMaterial).dispose();
  },
});

const droplets = createTransientEffectPool<DropletEffect, undefined>({
  update(effect, progress, dt) {
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    effect.velocity.y -= dt * 2.4;
    effect.velocity.multiplyScalar(1 - dt * 1.1);
    effect.mesh.scale.setScalar(1 + progress * effect.grow);
    (effect.mesh.material as MeshBasicMaterial).opacity = 0.92 * (1 - progress * progress);
    if (cameraRef) effect.mesh.quaternion.copy(cameraRef.quaternion);
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    (effect.mesh.material as MeshBasicMaterial).dispose();
  },
});

const glints = createTransientEffectPool<GlintEffect, undefined>({
  update(effect, progress) {
    const pop = progress < 0.25 ? progress / 0.25 : 1 - (progress - 0.25) / 0.75;
    effect.mesh.scale.setScalar(0.2 + pop * effect.size);
    for (const child of effect.mesh.children) {
      (((child as Mesh).material) as MeshBasicMaterial).opacity = pop;
    }
    if (cameraRef) {
      effect.mesh.quaternion.copy(cameraRef.quaternion);
      effect.mesh.rotateZ(effect.age * 1.5);
    }
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    for (const child of effect.mesh.children) (((child as Mesh).material) as MeshBasicMaterial).dispose();
  },
});

export function createEffects(scene: Scene) {
  root = new Group();
  scene.add(root);
}

export function resetEffects() {
  rings.clear(undefined);
  sparks.clear(undefined);
  droplets.clear(undefined);
  glints.clear(undefined);
}

export function updateEffects(dt: number, camera: Camera) {
  cameraRef = camera;
  rings.update(dt, undefined);
  sparks.update(dt, undefined);
  droplets.update(dt, undefined);
  glints.update(dt, undefined);
}

export function spawnRing(position: Vector3, color: Color, size: number, life: number) {
  if (!root) return;
  const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color, opacity: 0.85, side: DoubleSide }));
  mesh.position.copy(position);
  root.add(mesh);
  rings.add({ age: 0, life, mesh, size });
}

export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
  if (!root) return;
  for (let i = 0; i < count; i += 1) {
    const mesh = new Mesh(sparkGeometry, createAdditiveBasicMaterial({ color, opacity: 0.95, side: DoubleSide }));
    mesh.position.copy(position);
    const velocity = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .normalize()
      .multiplyScalar(speed * (0.55 + Math.random() * 0.75));
    root.add(mesh);
    sparks.add({ age: 0, life: 0.4 + Math.random() * 0.3, mesh, velocity });
  }
}

/** Oily gush: dark droplets that spread, sag, and thin out. */
export function burstInk(position: Vector3, count: number, speed: number) {
  if (!root) return;
  for (let i = 0; i < count; i += 1) {
    const material = new MeshBasicMaterial({
      color: INK_BLACK.clone().multiplyScalar(0.7 + Math.random() * 0.6),
      transparent: true,
      opacity: 0.92,
      side: DoubleSide,
      depthWrite: false,
    });
    const mesh = new Mesh(dropletGeometry, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(0.6 + Math.random() * 1.1);
    const velocity = new Vector3(Math.random() - 0.5, Math.random() - 0.35, Math.random() - 0.5)
      .normalize()
      .multiplyScalar(speed * (0.5 + Math.random() * 0.9));
    root.add(mesh);
    droplets.add({ age: 0, life: 0.7 + Math.random() * 0.5, mesh, velocity, grow: 1.6 + Math.random() * 1.4 });
  }
}

export function spawnGlint(position: Vector3, color: Color, size: number, life: number) {
  if (!root) return;
  const group = new Group();
  for (const rotation of [0, Math.PI / 2]) {
    const blade = new Mesh(glintGeometry, createAdditiveBasicMaterial({ color, opacity: 1, side: DoubleSide }));
    blade.rotation.z = rotation;
    group.add(blade);
  }
  group.position.copy(position);
  root.add(group);
  glints.add({ age: 0, life, mesh: group, size });
}
