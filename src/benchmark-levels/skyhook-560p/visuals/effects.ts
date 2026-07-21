import {
  BoxGeometry,
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

// Skyhook's effect vocabulary is aeronautical rather than pyrotechnic: torn
// panel fragments, condensation rings that stop working once the air runs out,
// hot cutting sparks, and thin contrail wisps. Nothing here is a fireball.

export type DebrisSpec = { direction: Vector3; color: Color; size: number };

type DebrisEffect = {
  age: number;
  life: number;
  mesh: Mesh;
  velocity: Vector3;
  spin: Vector3;
  material: MeshBasicMaterial;
};

type RingEffect = {
  age: number;
  life: number;
  mesh: Mesh;
  radius: number;
  material: MeshBasicMaterial;
  billboard: boolean;
};

type SparkEffect = {
  age: number;
  life: number;
  mesh: Mesh;
  size: number;
  material: MeshBasicMaterial;
};

type WispEffect = {
  age: number;
  life: number;
  mesh: Mesh;
  material: MeshBasicMaterial;
  drift: Vector3;
};

let root: Group | null = null;

/** Air density in [0,1], written by the environment. Condensation rings need air. */
let airDensity = 1;

const debrisGeometry = new BoxGeometry(1, 1, 1);
const sparkGeometry = new CircleGeometry(1, 10);
const wispGeometry = new PlaneGeometry(1, 1);
// Two ring profiles, shared for the whole run: a fat condensation disc for the
// weather and a thin structural rim for vacuum.
const vaporRingGeometry = new RingGeometry(0.62, 1, 28);
const thinRingGeometry = new RingGeometry(0.92, 1, 28);

const debrisPool = createTransientEffectPool<DebrisEffect, Camera>({
  update(effect, progress, dt) {
    effect.velocity.multiplyScalar(1 - Math.min(1, dt * 0.9));
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    effect.mesh.rotation.x += effect.spin.x * dt;
    effect.mesh.rotation.y += effect.spin.y * dt;
    effect.mesh.rotation.z += effect.spin.z * dt;
    const fade = 1 - progress;
    effect.material.opacity = fade;
    effect.mesh.scale.setScalar(effect.mesh.userData.size * (0.5 + fade * 0.5));
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    effect.material.dispose();
  },
});

const ringPool = createTransientEffectPool<RingEffect, Camera>({
  update(effect, progress, _dt, camera) {
    if (effect.billboard) effect.mesh.quaternion.copy(camera.quaternion);
    const grow = 0.16 + progress * progress * 0.84;
    effect.mesh.scale.setScalar(effect.radius * grow);
    effect.material.opacity = (1 - progress) ** 1.6;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    effect.material.dispose();
  },
});

const sparkPool = createTransientEffectPool<SparkEffect, Camera>({
  update(effect, progress, _dt, camera) {
    effect.mesh.quaternion.copy(camera.quaternion);
    const flare = Math.sin(Math.min(1, progress * 1.6) * Math.PI);
    effect.mesh.scale.setScalar(effect.size * (0.35 + flare));
    effect.material.opacity = 1 - progress;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    effect.material.dispose();
  },
});

const wispPool = createTransientEffectPool<WispEffect, Camera>({
  update(effect, progress, dt, camera) {
    effect.mesh.quaternion.copy(camera.quaternion);
    effect.mesh.position.addScaledVector(effect.drift, dt);
    effect.mesh.scale.set(0.18 + progress * 0.7, 1.5 + progress * 2.4, 1);
    effect.material.opacity = (1 - progress) * 0.5;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    effect.material.dispose();
  },
});

export function createEffects(scene: Scene) {
  root = new Group();
  root.name = "skyhook-effects";
  // Debris, rings and sparks are transient decoration; they never hide a target.
  root.userData.raildIgnoreOcclusion = true;
  scene.add(root);
  return root;
}

export function setEffectAirDensity(value: number) {
  airDensity = value;
}

export function resetEffects() {
  const camera = null as unknown as Camera;
  debrisPool.clear(camera);
  ringPool.clear(camera);
  sparkPool.clear(camera);
  wispPool.clear(camera);
}

/** Torn hull plate, thrown along the authored break directions. */
export function burstDebris(position: Vector3, specs: readonly DebrisSpec[], speed = 12, spread = 0.5) {
  if (!root) return;
  for (const spec of specs) {
    const material = new MeshBasicMaterial({ color: spec.color, transparent: true, side: DoubleSide });
    const mesh = new Mesh(debrisGeometry, material);
    mesh.position.copy(position);
    mesh.userData.size = spec.size;
    mesh.scale.setScalar(spec.size);
    const velocity = spec.direction.clone().multiplyScalar(speed * (0.55 + Math.random() * 0.9));
    velocity.x += (Math.random() - 0.5) * speed * spread;
    velocity.y += (Math.random() - 0.5) * speed * spread;
    velocity.z += (Math.random() - 0.5) * speed * spread;
    root.add(mesh);
    debrisPool.add({
      age: 0,
      life: 0.55 + Math.random() * 0.5,
      mesh,
      material,
      velocity,
      spin: new Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
    });
  }
}

/**
 * A shock ring. Down in the weather it is condensation and reads as a fat white
 * disc of vapour; in vacuum only the thin structural rim survives.
 */
export function spawnRing(position: Vector3, color: Color, radius: number, life: number, opacity = 0.85) {
  if (!root) return;
  const material = createAdditiveBasicMaterial({
    color,
    side: DoubleSide,
    opacity: opacity * (0.35 + airDensity * 0.65),
  });
  const mesh = new Mesh(airDensity > 0.35 ? vaporRingGeometry : thinRingGeometry, material);
  mesh.position.copy(position);
  root.add(mesh);
  ringPool.add({ age: 0, life, mesh, radius, material, billboard: true });
}

/** A hard specular glint — locks, hits and cutting heads. */
export function spawnSpark(position: Vector3, color: Color, size: number, life: number) {
  if (!root) return;
  const material = createAdditiveBasicMaterial({ color, side: DoubleSide, opacity: 1 });
  const mesh = new Mesh(sparkGeometry, material);
  mesh.position.copy(position);
  root.add(mesh);
  sparkPool.add({ age: 0, life, mesh, size, material });
}

/** Contrail wisp dropped behind fast movers; it only forms where there is air. */
export function dropWisp(position: Vector3, color: Color, drift?: Vector3) {
  if (!root || airDensity < 0.12) return;
  const material = createAdditiveBasicMaterial({ color, side: DoubleSide, opacity: 0.5 });
  const mesh = new Mesh(wispGeometry, material);
  mesh.position.copy(position);
  root.add(mesh);
  wispPool.add({
    age: 0,
    life: 0.34 + airDensity * 0.2,
    mesh,
    material,
    drift: drift?.clone() ?? new Vector3(0, -2, 0),
  });
}

/** Player shot trail — always visible, air or not; it is the car's own tracer. */
export function dropTracer(position: Vector3, color: Color) {
  if (!root) return;
  const material = createAdditiveBasicMaterial({ color, side: DoubleSide, opacity: 0.75 });
  const mesh = new Mesh(wispGeometry, material);
  mesh.position.copy(position);
  root.add(mesh);
  wispPool.add({ age: 0, life: 0.22, mesh, material, drift: new Vector3() });
}

export function updateEffects(dt: number, camera: Camera) {
  debrisPool.update(dt, camera);
  ringPool.update(dt, camera);
  sparkPool.update(dt, camera);
  wispPool.update(dt, camera);
}

export function effectCount() {
  return debrisPool.size + ringPool.size + sparkPool.size + wispPool.size;
}
