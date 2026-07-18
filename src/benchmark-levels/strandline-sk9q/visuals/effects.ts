import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createTransientEffectPool } from '../../../engine/visual-kit';

// STRANDLINE effect pools. Everything is light in water: rings are expanding
// ripple fronts, sparks are drifting motes, glints are soft flashes, and the
// heal bloom is the green-gold breath a strand gives off when a parasite dies.
// Leaf construction only — the spine (visuals/index.ts) decides what fires
// where, in which color, and how big.

type RingEffect = { age: number; life: number; mesh: Mesh; maxRadius: number };
type SparkEffect = { age: number; life: number; mesh: Mesh; velocity: Vector3; spin: Vector3; drag: number };
type GlintEffect = { age: number; life: number; mesh: Mesh; size: number };
type BloomEffect = { age: number; life: number; parts: Mesh[]; velocities: Vector3[] };

let root: Group | null = null;

const ringPool = createTransientEffectPool<RingEffect, undefined>({
  update(effect, progress, dt) {
    const eased = 1 - (1 - progress) ** 2;
    effect.mesh.scale.setScalar(0.12 + eased * effect.maxRadius);
    (effect.mesh.material as MeshBasicMaterial).opacity = (1 - progress) * 0.85;
    effect.mesh.rotation.z += dt * 0.6;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    effect.mesh.geometry.dispose();
    (effect.mesh.material as MeshBasicMaterial).dispose();
  },
});

const sparkPool = createTransientEffectPool<SparkEffect, undefined>({
  update(effect, progress, dt) {
    effect.velocity.multiplyScalar(1 - effect.drag * dt);
    // Motes hang in water: a slight upward buoyant drift as they slow.
    effect.velocity.y += dt * 0.35 * progress;
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    effect.mesh.rotation.x += effect.spin.x * dt;
    effect.mesh.rotation.y += effect.spin.y * dt;
    effect.mesh.rotation.z += effect.spin.z * dt;
    effect.mesh.scale.setScalar(Math.max(0.001, 1 - progress * 0.85));
    (effect.mesh.material as MeshBasicMaterial).opacity = 1 - progress * progress;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    effect.mesh.geometry.dispose();
    (effect.mesh.material as MeshBasicMaterial).dispose();
  },
});

const glintPool = createTransientEffectPool<GlintEffect, undefined>({
  update(effect, progress) {
    effect.mesh.scale.setScalar(Math.max(0.001, effect.size * (1 - progress * progress)));
    (effect.mesh.material as MeshBasicMaterial).opacity = 1 - progress;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    effect.mesh.geometry.dispose();
    (effect.mesh.material as MeshBasicMaterial).dispose();
  },
});

const bloomPool = createTransientEffectPool<BloomEffect, undefined>({
  update(effect, progress, dt) {
    for (let i = 0; i < effect.parts.length; i += 1) {
      const part = effect.parts[i];
      part.position.addScaledVector(effect.velocities[i], dt);
      effect.velocities[i].multiplyScalar(1 - dt * 1.4);
      part.scale.setScalar(Math.max(0.001, 1 - progress * 0.6));
      (part.material as MeshBasicMaterial).opacity = (1 - progress) * 0.6;
    }
  },
  dispose(effect) {
    for (const part of effect.parts) {
      part.removeFromParent();
      part.geometry.dispose();
      (part.material as MeshBasicMaterial).dispose();
    }
  },
});

export function createEffects(sceneRoot: Object3D) {
  root = new Group();
  root.userData.raildIgnoreOcclusion = true;
  sceneRoot.add(root);
}

export function resetEffects() {
  ringPool.clear(undefined);
  sparkPool.clear(undefined);
  glintPool.clear(undefined);
  bloomPool.clear(undefined);
}

export function updateEffects(dt: number) {
  ringPool.update(dt, undefined);
  sparkPool.update(dt, undefined);
  glintPool.update(dt, undefined);
  bloomPool.update(dt, undefined);
}

// An expanding ripple ring facing the camera (callers orient it if needed).
export function spawnRing(position: Vector3, color: Color, maxRadius: number, life: number) {
  if (!root) return;
  const mesh = new Mesh(
    new RingGeometry(0.82, 1, 40),
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, side: 2 }),
  );
  mesh.position.copy(position);
  root.add(mesh);
  ringPool.add({ age: 0, life, mesh, maxRadius });
}

// Drifting motes: small tumbling tetra shards that hang in the water.
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, life = 0.9) {
  if (!root) return;
  for (let i = 0; i < count; i += 1) {
    const mesh = new Mesh(
      new TetrahedronGeometry(0.06 + Math.random() * 0.1),
      new MeshBasicMaterial({ color: color.clone().multiplyScalar(0.7 + Math.random() * 0.6), transparent: true, opacity: 1, blending: AdditiveBlending, depthWrite: false }),
    );
    mesh.position.copy(position);
    const velocity = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .normalize()
      .multiplyScalar(speed * (0.35 + Math.random() * 0.65));
    root.add(mesh);
    sparkPool.add({
      age: 0,
      life: life * (0.6 + Math.random() * 0.8),
      mesh,
      velocity,
      spin: new Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8),
      drag: 2.2,
    });
  }
}

// A soft round flash that swells and dies.
export function spawnGlint(position: Vector3, color: Color, size: number, life: number) {
  if (!root) return;
  const mesh = new Mesh(
    new SphereGeometry(0.5, 10, 8),
    new MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: AdditiveBlending, depthWrite: false }),
  );
  mesh.position.copy(position);
  root.add(mesh);
  glintPool.add({ age: 0, life, mesh, size });
}

// The heal bloom: a breath of green-gold globes drifting up off a cleansed
// patch of strand. This is the signature kill payoff.
export function spawnHealBloom(position: Vector3, color: Color, size = 1) {
  if (!root) return;
  const parts: Mesh[] = [];
  const velocities: Vector3[] = [];
  const count = 6;
  for (let i = 0; i < count; i += 1) {
    const part = new Mesh(
      new SphereGeometry(0.16 + Math.random() * 0.2 * size, 8, 6),
      new MeshBasicMaterial({ color: color.clone().multiplyScalar(0.8 + Math.random() * 0.5), transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false }),
    );
    part.position.copy(position).add(new Vector3((Math.random() - 0.5) * 0.7 * size, (Math.random() - 0.5) * 0.7 * size, (Math.random() - 0.5) * 0.7 * size));
    root.add(part);
    parts.push(part);
    velocities.push(new Vector3((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 1.4, (Math.random() - 0.5) * 1.2));
  }
  bloomPool.add({ age: 0, life: 1.6, parts, velocities });
}

// A projectile trail crumb: a tiny mote that fades where it was dropped.
export function dropTrail(position: Vector3, color: Color) {
  if (!root) return;
  if (sparkPool.size > 140) return;
  const mesh = new Mesh(
    new TetrahedronGeometry(0.05),
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false }),
  );
  mesh.position.copy(position);
  root.add(mesh);
  sparkPool.add({ age: 0, life: 0.45, mesh, velocity: new Vector3(0, 0.15, 0), spin: new Vector3(1, 2, 0.5), drag: 0.4 });
}
