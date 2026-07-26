import {
  Group,
  Mesh,
  OctahedronGeometry,
  PlaneGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera, Color, Scene } from 'three';
import { createTransientEffectPool } from '../../../engine/visual-kit';
import { GLUE, glow, matte } from './palette';

// Leaf module. Everything transient in the level fades by shrinking rather
// than by fading opacity, so every effect can share one cached material per
// colour and the whole layer stays at a handful of draw calls.

const RING_GEOMETRY = new TorusGeometry(0.5, 0.05, 6, 26);
const FLECK_GEOMETRY = new OctahedronGeometry(0.16, 0);
const GLINT_GEOMETRY = new PlaneGeometry(1, 1);

type Ring = { age: number; life: number; mesh: Mesh; size: number };
type Fleck = { age: number; life: number; mesh: Mesh; velocity: Vector3; spin: Vector3; gravity: number; size: number };
type Glint = { age: number; life: number; mesh: Mesh; size: number };

let root: Group | null = null;

const rings = createTransientEffectPool<Ring, undefined>({
  update(effect, progress) {
    const scale = effect.size * (0.25 + progress * 0.95) * (1 - progress * 0.15);
    effect.mesh.scale.set(scale, scale, scale * (1 - progress * 0.6));
    effect.mesh.visible = progress < 0.97;
  },
  dispose(effect) {
    effect.mesh.visible = false;
    effect.mesh.removeFromParent();
  },
});

const flecks = createTransientEffectPool<Fleck, number>({
  update(effect, progress, dt) {
    effect.velocity.y -= effect.gravity * dt;
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    effect.mesh.rotation.x += effect.spin.x * dt;
    effect.mesh.rotation.y += effect.spin.y * dt;
    effect.mesh.rotation.z += effect.spin.z * dt;
    effect.mesh.scale.setScalar(effect.size * (1 - progress) ** 0.6);
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
  },
});

const glints = createTransientEffectPool<Glint, Camera>({
  update(effect, progress, _dt, camera) {
    effect.mesh.quaternion.copy(camera.quaternion);
    effect.mesh.scale.setScalar(effect.size * Math.sin(Math.min(1, progress) * Math.PI) ** 0.5);
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
  },
});

export function createEffects(scene: Scene) {
  root = new Group();
  root.name = 'tinker-effects';
  scene.add(root);
  return root;
}

export function resetEffects() {
  rings.clear(undefined);
  flecks.clear(0);
  glints.clear(null as unknown as Camera);
}

export function spawnRing(position: Vector3, color: Color, size: number, life: number) {
  if (!root) return;
  const mesh = new Mesh(RING_GEOMETRY, glow(color, 0.85));
  mesh.position.copy(position);
  mesh.rotation.set(Math.PI / 2, 0, 0);
  root.add(mesh);
  rings.add({ age: 0, life, mesh, size });
}

/** A ring standing up to face the player, used where a flat ripple would read as a puddle. */
export function spawnFaceRing(position: Vector3, color: Color, size: number, life: number, camera: Camera) {
  if (!root) return;
  const mesh = new Mesh(RING_GEOMETRY, glow(color, 0.9));
  mesh.position.copy(position);
  mesh.quaternion.copy(camera.quaternion);
  root.add(mesh);
  rings.add({ age: 0, life, mesh, size });
}

export function burstFlecks(
  position: Vector3,
  colors: readonly Color[],
  count: number,
  speed: number,
  options: { gravity?: number; life?: number; size?: number; lit?: boolean } = {},
) {
  if (!root || colors.length === 0) return;
  const gravity = options.gravity ?? 16;
  const life = options.life ?? 0.75;
  const size = options.size ?? 1;
  for (let i = 0; i < count; i += 1) {
    const color = colors[i % colors.length];
    const mesh = new Mesh(FLECK_GEOMETRY, options.lit === false ? glow(color, 0.9) : matte(color, 0.35));
    mesh.position.copy(position);
    const theta = Math.random() * Math.PI * 2;
    const lift = 0.35 + Math.random() * 0.85;
    const radial = Math.sqrt(Math.max(0, 1 - lift * lift * 0.5));
    const velocity = new Vector3(Math.cos(theta) * radial, lift, Math.sin(theta) * radial)
      .multiplyScalar(speed * (0.6 + Math.random() * 0.8));
    root.add(mesh);
    flecks.add({
      age: 0,
      life: life * (0.7 + Math.random() * 0.6),
      mesh,
      velocity,
      spin: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(18),
      gravity,
      size: size * (0.6 + Math.random() * 0.8),
    });
  }
}

/** Black adhesive thrown off a struck core. Unlit on purpose: glue never catches the lamp. */
export function burstGlue(position: Vector3, count: number, speed: number) {
  if (!root) return;
  for (let i = 0; i < count; i += 1) {
    const mesh = new Mesh(FLECK_GEOMETRY, matte(GLUE, 0));
    mesh.position.copy(position);
    const theta = Math.random() * Math.PI * 2;
    const velocity = new Vector3(Math.cos(theta), 0.5 + Math.random(), Math.sin(theta))
      .multiplyScalar(speed * (0.5 + Math.random()));
    root.add(mesh);
    flecks.add({
      age: 0,
      life: 0.55 + Math.random() * 0.35,
      mesh,
      velocity,
      spin: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(12),
      gravity: 22,
      size: 0.9 + Math.random() * 0.9,
    });
  }
}

export function spawnGlint(position: Vector3, color: Color, size: number, life: number, camera: Camera) {
  if (!root) return;
  const mesh = new Mesh(GLINT_GEOMETRY, glow(color, 0.75));
  mesh.position.copy(position);
  mesh.quaternion.copy(camera.quaternion);
  root.add(mesh);
  glints.add({ age: 0, life, mesh, size });
}

export function updateEffects(dt: number, camera: Camera) {
  rings.update(dt, undefined);
  flecks.update(dt, 0);
  glints.update(dt, camera);
}

export function effectLoad() {
  return rings.size + flecks.size + glints.size;
}
