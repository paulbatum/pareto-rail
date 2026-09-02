import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import {
  createTransientEffectPool,
  additiveMaterialParameters,
  type TransientEffectPool,
} from '../../../engine/visual-kit';
import {
  DENIED_RED,
  hdr,
  JELLY_EMERALD,
  JELLY_GOLD,
  JELLY_MINT,
  LOCK_CYAN,
  PARASITE_TOXIC,
  PARASITE_VIOLET,
  PEARL_WHITE,
} from './palette';

const MAX_BURST_PARTICLES = 36;
const burstGeom = new OctahedronGeometry(0.24, 0);
const burstMat = new MeshBasicMaterial(
  additiveMaterialParameters({ color: hdr(JELLY_MINT, 1.8), transparent: true }),
);

const ringGeom = new RingGeometry(0.3, 0.45, 24);
const ringMat = new MeshBasicMaterial(
  additiveMaterialParameters({ color: hdr(LOCK_CYAN, 2.0), transparent: true }),
);

type BurstEffect = {
  age: number;
  life: number;
  origin: Vector3;
  color: Color;
  velocities: Vector3[];
  mesh: InstancedMesh;
};

type RingEffect = {
  age: number;
  life: number;
  origin: Vector3;
  normal: Vector3;
  color: Color;
  startScale: number;
  endScale: number;
  mesh: InstancedMesh;
};

export type VisualEffects = {
  spawnBurst(pos: Vector3, color: Color, count?: number): void;
  spawnShockwave(pos: Vector3, normal: Vector3, color: Color, scale?: number): void;
  update(dt: number): void;
  clear(): void;
  dispose(): void;
};

export function createVisualEffects(scene: Scene): VisualEffects {
  const root = new Group();
  scene.add(root);

  const bursts: TransientEffectPool<BurstEffect, undefined> = createTransientEffectPool({
    update(effect, progress) {
      const alpha = 1.0 - progress;
      const m = new Matrix4();
      const q = new Quaternion();
      const s = new Vector3();
      const scale = (1.0 - progress * 0.7) * (0.8 + 0.4 * alpha);

      for (let i = 0; i < effect.velocities.length; i++) {
        const vel = effect.velocities[i];
        const p = effect.origin.clone().addScaledVector(vel, progress * effect.life);
        s.set(scale, scale, scale);
        m.compose(p, q, s);
        effect.mesh.setMatrixAt(i, m);
      }
      effect.mesh.instanceMatrix.needsUpdate = true;
      (effect.mesh.material as MeshBasicMaterial).opacity = alpha;
    },
    dispose(effect) {
      root.remove(effect.mesh);
      effect.mesh.dispose();
    },
  });

  const shockwaves: TransientEffectPool<RingEffect, undefined> = createTransientEffectPool({
    update(effect, progress) {
      const alpha = Math.sin((1.0 - progress) * Math.PI);
      const scale = effect.startScale + (effect.endScale - effect.startScale) * progress;
      const m = new Matrix4();
      const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), effect.normal);
      const s = new Vector3(scale, scale, scale);
      m.compose(effect.origin, q, s);
      effect.mesh.setMatrixAt(0, m);
      effect.mesh.instanceMatrix.needsUpdate = true;
      (effect.mesh.material as MeshBasicMaterial).opacity = alpha;
    },
    dispose(effect) {
      root.remove(effect.mesh);
      effect.mesh.dispose();
    },
  });

  return {
    spawnBurst(pos, color, count = 16) {
      const particleCount = Math.min(count, MAX_BURST_PARTICLES);
      const mat = new MeshBasicMaterial(
        additiveMaterialParameters({ color: hdr(color, 2.0), transparent: true, opacity: 1.0 }),
      );
      const mesh = new InstancedMesh(burstGeom, mat, particleCount);
      const velocities: Vector3[] = [];

      for (let i = 0; i < particleCount; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = (Math.random() - 0.5) * Math.PI;
        const speed = 4.0 + Math.random() * 8.0;
        velocities.push(
          new Vector3(
            Math.cos(phi) * Math.cos(theta) * speed,
            Math.cos(phi) * Math.sin(theta) * speed,
            Math.sin(phi) * speed,
          ),
        );
      }

      root.add(mesh);
      bursts.add({
        age: 0,
        life: 0.65,
        origin: pos.clone(),
        color,
        velocities,
        mesh,
      });
    },

    spawnShockwave(pos, normal, color, maxRadius = 4.0) {
      const mat = new MeshBasicMaterial(
        additiveMaterialParameters({ color: hdr(color, 2.2), transparent: true, opacity: 1.0 }),
      );
      const mesh = new InstancedMesh(ringGeom, mat, 1);
      root.add(mesh);
      shockwaves.add({
        age: 0,
        life: 0.45,
        origin: pos.clone(),
        normal: normal.clone().normalize(),
        color,
        startScale: 0.5,
        endScale: maxRadius,
        mesh,
      });
    },

    update(dt) {
      bursts.update(dt, undefined);
      shockwaves.update(dt, undefined);
    },

    clear() {
      bursts.clear(undefined);
      shockwaves.clear(undefined);
    },

    dispose() {
      bursts.clear(undefined);
      shockwaves.clear(undefined);
      root.removeFromParent();
    },
  };
}
