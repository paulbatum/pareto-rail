import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import type { Camera, Scene } from 'three';
import { createAdditiveBasicMaterial, createTransientEffectPool, disposeObject3D } from '../../../engine/visual-kit';

// Everything here happens in water, so nothing sparks and nothing snaps: hits
// disperse, kills bloom outward and then hang as drifting matter, and every
// loose particle rises slightly because it is buoyant. Rings are pressure
// fronts through the water rather than energy shells.

export type ShardSpec = { direction: Vector3; color: Color; size: number };

type EffectKind = 'ring' | 'mote' | 'shard' | 'glint' | 'trail';

type Effect = {
  age: number;
  life: number;
  kind: EffectKind;
  object: Object3D;
  material: MeshBasicMaterial;
  velocity: Vector3;
  spin: Vector3;
  drag: number;
  buoyancy: number;
  fromScale: number;
  toScale: number;
  opacity: number;
};

const ringGeometry = new RingGeometry(0.72, 1, 40);
const moteGeometry = new CircleGeometry(1, 8);
const glintGeometry = new PlaneGeometry(1, 1);
const shardGeometry = new TetrahedronGeometry(1, 0);

let root: Group | null = null;

const pool = createTransientEffectPool<Effect, Camera | null>({
  update(effect, progress, dt, camera) {
    if (effect.kind === 'ring' || effect.kind === 'glint' || effect.kind === 'mote' || effect.kind === 'trail') {
      if (camera) effect.object.quaternion.copy(camera.quaternion);
    }
    if (effect.kind === 'shard') {
      effect.object.rotation.x += effect.spin.x * dt;
      effect.object.rotation.y += effect.spin.y * dt;
      effect.object.rotation.z += effect.spin.z * dt;
    }
    if (effect.velocity.lengthSq() > 0 || effect.buoyancy !== 0) {
      effect.object.position.addScaledVector(effect.velocity, dt);
      effect.object.position.y += effect.buoyancy * dt;
      effect.velocity.multiplyScalar(Math.max(0, 1 - effect.drag * dt));
    }
    const eased = effect.kind === 'ring' ? 1 - (1 - progress) ** 2.4 : progress;
    effect.object.scale.setScalar(effect.fromScale + (effect.toScale - effect.fromScale) * eased);
    effect.material.opacity = effect.opacity * (1 - progress) ** 1.6;
  },
  dispose(effect) {
    effect.object.removeFromParent();
    effect.material.dispose();
  },
});

export function createEffects(scene: Scene) {
  root = new Group();
  root.name = 'strandline-effects';
  scene.add(root);
  return root;
}

export function resetEffects() {
  pool.clear(null);
}

export function disposeEffects() {
  pool.clear(null);
  if (root) {
    root.removeFromParent();
    disposeObject3D(root);
    root = null;
  }
}

export function updateEffects(dt: number, camera: Camera) {
  pool.update(dt, camera);
}

function add(effect: Effect) {
  if (!root) return;
  root.add(effect.object);
  pool.add(effect);
}

function material(color: Color, opacity: number, side = DoubleSide) {
  return createAdditiveBasicMaterial({ color, opacity, side });
}

/** A pressure front travelling out through the water. */
export function spawnRing(position: Vector3, color: Color, radius: number, life: number, thicknessBias = 1) {
  const mat = material(color, 0.85);
  const mesh = new Mesh(ringGeometry, mat);
  mesh.position.copy(position);
  mesh.scale.setScalar(0.001);
  add({
    age: 0,
    life,
    kind: 'ring',
    object: mesh,
    material: mat,
    velocity: new Vector3(),
    spin: new Vector3(),
    drag: 0,
    buoyancy: 0,
    fromScale: radius * 0.12 * thicknessBias,
    toScale: radius,
    opacity: 0.85,
  });
}

/** Loose luminous matter drifting out of a wound and rising as it fades. */
export function burstMotes(
  position: Vector3,
  color: Color,
  count: number,
  speed: number,
  options: { life?: number; size?: number; buoyancy?: number } = {},
) {
  const life = options.life ?? 1.1;
  const size = options.size ?? 0.26;
  for (let i = 0; i < count; i += 1) {
    const mat = material(color, 0.9);
    const mesh = new Mesh(moteGeometry, mat);
    mesh.position.copy(position);
    const direction = randomDirection();
    const scale = size * (0.55 + Math.random() * 0.9);
    add({
      age: 0,
      life: life * (0.7 + Math.random() * 0.6),
      kind: 'mote',
      object: mesh,
      material: mat,
      velocity: direction.multiplyScalar(speed * (0.35 + Math.random())),
      spin: new Vector3(),
      drag: 2.6,
      buoyancy: options.buoyancy ?? 0.9,
      fromScale: scale,
      toScale: scale * 1.9,
      opacity: 0.9,
    });
  }
}

/** The body coming apart: authored fragments thrown along their own normals. */
export function burstShards(position: Vector3, specs: readonly ShardSpec[], speed = 9) {
  for (const spec of specs) {
    const mat = material(spec.color, 0.95, DoubleSide);
    const mesh = new Mesh(shardGeometry, mat);
    mesh.position.copy(position);
    mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    add({
      age: 0,
      life: 0.75 + Math.random() * 0.5,
      kind: 'shard',
      object: mesh,
      material: mat,
      velocity: spec.direction.clone().normalize().multiplyScalar(speed * (0.6 + Math.random() * 0.7)),
      spin: new Vector3(rand(6), rand(6), rand(6)),
      drag: 3.1,
      buoyancy: 0.4,
      fromScale: spec.size,
      toScale: spec.size * 0.25,
      opacity: 0.95,
    });
  }
}

/** A single hard flash of light at a point — impacts, locks, the killing blow. */
export function spawnGlint(position: Vector3, color: Color, size: number, life: number) {
  const mat = material(color, 1);
  const mesh = new Mesh(glintGeometry, mat);
  mesh.position.copy(position);
  add({
    age: 0,
    life,
    kind: 'glint',
    object: mesh,
    material: mat,
    velocity: new Vector3(),
    spin: new Vector3(),
    drag: 0,
    buoyancy: 0,
    fromScale: size * 0.3,
    toScale: size * 1.8,
    opacity: 1,
  });
}

/** Cavitation left behind a moving thing. */
export function dropTrail(position: Vector3, color: Color, size = 0.34) {
  const mat = material(color, 0.55);
  const mesh = new Mesh(moteGeometry, mat);
  mesh.position.copy(position);
  add({
    age: 0,
    life: 0.4,
    kind: 'trail',
    object: mesh,
    material: mat,
    velocity: new Vector3(),
    spin: new Vector3(),
    drag: 0,
    buoyancy: 0.5,
    fromScale: size,
    toScale: size * 0.2,
    opacity: 0.55,
  });
}

function randomDirection() {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}

function rand(scale: number) {
  return (Math.random() * 2 - 1) * scale;
}
