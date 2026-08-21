import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  createAdditiveBasicMaterial,
  createTransientEffectPool,
  type TransientEffectPool,
} from '../../../engine/visual-kit';
import {
  BRASS_METAL,
  BUTTON_CYAN,
  BUTTON_MAGENTA,
  BUTTON_YELLOW,
  CLEAN_SPARKLE,
  GLUE_DARK,
  hdr,
  LOCK_COLOR,
  PENCIL_WOOD,
  PENCIL_YELLOW,
  STEEL_METAL,
} from './palette';

export type BurstEffect = {
  mesh: Object3D;
  position: Vector3;
  velocities: Vector3[];
  rotVelocities: Vector3[];
  age: number;
  life: number;
};

export type RingEffect = {
  mesh: Mesh;
  position: Vector3;
  startScale: number;
  endScale: number;
  color: Color;
  age: number;
  life: number;
};

export type EffectsSystem = {
  root: Group;
  spawnHitBurst(position: Vector3, color: Color): void;
  spawnCleanKillBurst(position: Vector3): void;
  spawnLockRing(position: Vector3): void;
  update(dt: number): void;
  dispose(): void;
};

export function createEffectsSystem(scene: Scene): EffectsSystem {
  const root = new Group();
  scene.add(root);

  // 1. Particle Bursts Pool (Sawdust, woodchips, glue splatters)
  const chipGeom = new BoxGeometry(0.18, 0.08, 0.28);

  const burstPool = createTransientEffectPool<BurstEffect, Scene>({
    update(effect, progress, dt) {
      const alpha = 1 - progress;
      const count = effect.velocities.length;
      const children = (effect.mesh as Group).children;

      for (let i = 0; i < count; i += 1) {
        const child = children[i];
        if (!child) continue;
        const vel = effect.velocities[i];
        const rotVel = effect.rotVelocities[i];

        vel.y -= 12 * dt;
        child.position.addScaledVector(vel, dt);
        child.rotation.x += rotVel.x * dt;
        child.rotation.y += rotVel.y * dt;
        child.rotation.z += rotVel.z * dt;
        child.scale.setScalar(Math.max(0.01, alpha));
      }
    },
    dispose(effect) {
      root.remove(effect.mesh);
    },
  });

  // 2. Expanding Clean Shockwave Rings
  const ringGeom = new RingGeometry(0.6, 0.85, 24);
  const ringPool = createTransientEffectPool<RingEffect, Scene>({
    update(effect, progress) {
      const scale = MathUtils.lerp(effect.startScale, effect.endScale, progress);
      effect.mesh.scale.setScalar(scale);
      const mat = effect.mesh.material as MeshBasicMaterial;
      mat.opacity = (1 - progress) * 0.85;
    },
    dispose(effect) {
      root.remove(effect.mesh);
    },
  });

  return {
    root,
    spawnHitBurst(position: Vector3, color: Color) {
      const group = new Group();
      group.position.copy(position);
      const count = 10;
      const velocities: Vector3[] = [];
      const rotVelocities: Vector3[] = [];

      for (let i = 0; i < count; i += 1) {
        const mat = new MeshBasicMaterial({
          color: i % 2 === 0 ? color : PENCIL_WOOD,
        });
        const mesh = new Mesh(chipGeom, mat);
        group.add(mesh);

        const v = new Vector3(
          (Math.random() - 0.5) * 8,
          Math.random() * 6 + 2,
          (Math.random() - 0.5) * 8,
        );
        velocities.push(v);
        rotVelocities.push(new Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8));
      }

      root.add(group);
      burstPool.add({
        mesh: group,
        position: position.clone(),
        velocities,
        rotVelocities,
        age: 0,
        life: 0.65,
      });
    },
    spawnCleanKillBurst(position: Vector3) {
      // Golden clean ring shockwave
      const ringMat = createAdditiveBasicMaterial({
        color: hdr(BUTTON_YELLOW, 2.2),
        opacity: 0.9,
        side: DoubleSide,
      });
      const ringMesh = new Mesh(ringGeom, ringMat);
      ringMesh.position.copy(position);
      ringMesh.rotation.x = Math.PI / 2;
      root.add(ringMesh);

      ringPool.add({
        mesh: ringMesh,
        position: position.clone(),
        startScale: 0.5,
        endScale: 4.5,
        color: BUTTON_YELLOW,
        age: 0,
        life: 0.45,
      });
    },
    spawnLockRing(position: Vector3) {
      const ringMat = createAdditiveBasicMaterial({
        color: hdr(LOCK_COLOR, 1.8),
        opacity: 0.85,
        side: DoubleSide,
      });
      const ringMesh = new Mesh(ringGeom, ringMat);
      ringMesh.position.copy(position);
      root.add(ringMesh);

      ringPool.add({
        mesh: ringMesh,
        position: position.clone(),
        startScale: 1.8,
        endScale: 0.8,
        color: LOCK_COLOR,
        age: 0,
        life: 0.25,
      });
    },
    update(dt: number) {
      burstPool.update(dt, scene);
      ringPool.update(dt, scene);
    },
    dispose() {
      scene.remove(root);
      chipGeom.dispose();
      ringGeom.dispose();
    },
  };
}

// ---- Projectile Mesh (Homing Needle / Pin Dart) ----
export function createTinkerProjectileMesh(): Object3D {
  const group = new Group();

  // Polished steel needle
  const needleGeom = new CylinderGeometry(0.04, 0.01, 1.4, 6);
  const needleMat = createAdditiveBasicMaterial({ color: hdr(STEEL_METAL, 1.6) });
  const needle = new Mesh(needleGeom, needleMat);
  needle.rotation.x = Math.PI / 2;
  group.add(needle);

  // Brass bead head
  const headGeom = new SphereGeometry(0.12, 6, 6);
  const headMat = createAdditiveBasicMaterial({ color: hdr(BRASS_METAL, 2.2) });
  const head = new Mesh(headGeom, headMat);
  head.position.z = 0.7;
  group.add(head);

  // Glowing energy tail
  const tailGeom = new SphereGeometry(0.08, 6, 6);
  const tailMat = createAdditiveBasicMaterial({ color: hdr(BUTTON_CYAN, 2.0) });
  const tail = new Mesh(tailGeom, tailMat);
  tail.position.z = -0.7;
  group.add(tail);

  return group;
}

// ---- Reticle Visuals ----
// Radius must properly match lockRadiusNdc (default 0.085 NDC)
export function createTinkerReticleMesh(): Object3D {
  const group = new Group();

  // Brass compass dial outer ring
  const ringGeom = new RingGeometry(0.60, 0.65, 48);
  const ringMat = createAdditiveBasicMaterial({
    color: hdr(BRASS_METAL, 1.6),
    side: DoubleSide,
    opacity: 0.85,
  });
  const ring = new Mesh(ringGeom, ringMat);
  group.add(ring);

  // 4 Crosshair Tick Marks
  const tickGeom = new BoxGeometry(0.035, 0.18, 0.01);
  const tickMat = createAdditiveBasicMaterial({ color: hdr(BUTTON_YELLOW, 2.0) });

  const topTick = new Mesh(tickGeom, tickMat);
  topTick.position.set(0, 0.76, 0);
  const botTick = new Mesh(tickGeom, tickMat);
  botTick.position.set(0, -0.76, 0);
  const leftTick = new Mesh(tickGeom, tickMat);
  leftTick.position.set(-0.76, 0, 0);
  leftTick.rotation.z = Math.PI / 2;
  const rightTick = new Mesh(tickGeom, tickMat);
  rightTick.position.set(0.76, 0, 0);
  rightTick.rotation.z = Math.PI / 2;

  group.add(topTick, botTick, leftTick, rightTick);

  // Center targeting dot
  const centerDotGeom = new SphereGeometry(0.05, 10, 10);
  const centerDotMat = createAdditiveBasicMaterial({ color: hdr(BUTTON_CYAN, 2.4) });
  const centerDot = new Mesh(centerDotGeom, centerDotMat);
  group.add(centerDot);

  group.userData.ring = ring;
  group.userData.ringMat = ringMat;
  group.userData.ticks = [topTick, botTick, leftTick, rightTick];

  return group;
}
