import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import { createTransientEffectPool } from '../../../engine/visual-kit';
import { GRAPHITE, ORANGE, PANEL, PANEL_SHADE } from './palette';

type RingEffect = {
  kind: 'ring';
  mesh: Mesh;
  age: number;
  life: number;
  start: number;
  end: number;
};

type DebrisEffect = {
  kind: 'debris';
  mesh: Mesh;
  velocity: Vector3;
  spin: Vector3;
  age: number;
  life: number;
};

type Effect = RingEffect | DebrisEffect;
type EffectContext = { camera: PerspectiveCamera };

let sceneRef: Scene | null = null;
const RING_GEOMETRY = new RingGeometry(0.76, 0.9, 24);
const DEBRIS_GEOMETRY = new BoxGeometry(1, 1, 1);

const pool = createTransientEffectPool<Effect, EffectContext>({
  update(effect, progress, dt, { camera }) {
    if (effect.kind === 'ring') {
      const scale = MathUtils.lerp(effect.start, effect.end, 1 - (1 - progress) ** 3);
      effect.mesh.scale.setScalar(scale);
      effect.mesh.quaternion.copy(camera.quaternion);
      (effect.mesh.material as MeshBasicMaterial).opacity = (1 - progress) * 0.7;
    } else {
      effect.velocity.y -= dt * 1.4;
      effect.mesh.position.addScaledVector(effect.velocity, dt);
      effect.mesh.rotation.x += effect.spin.x * dt;
      effect.mesh.rotation.y += effect.spin.y * dt;
      effect.mesh.rotation.z += effect.spin.z * dt;
      (effect.mesh.material as MeshBasicMaterial).opacity = Math.max(0, 1 - progress * progress);
    }
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    (effect.mesh.material as MeshBasicMaterial).dispose();
  },
});

export function createEffects(scene: Scene) {
  pool.clear({ camera: new PerspectiveCamera() });
  sceneRef = scene;
}

export function clearEffects(camera: PerspectiveCamera) {
  pool.clear({ camera });
}

export function spawnRing(position: Vector3, color: Color, end = 5, life = 0.5, start = 0.2) {
  if (!sceneRef) return;
  const material = new MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: DoubleSide, depthWrite: false });
  const mesh = new Mesh(RING_GEOMETRY, material);
  mesh.userData.raildIgnoreOcclusion = true;
  mesh.position.copy(position);
  sceneRef.add(mesh);
  pool.add({ kind: 'ring', mesh, age: 0, life, start, end });
}

export function burstPanels(position: Vector3, count: number, strength: number, accent = false) {
  if (!sceneRef) return;
  for (let i = 0; i < count; i += 1) {
    const color = accent && i % 3 === 0 ? ORANGE : i % 2 === 0 ? PANEL_SHADE : PANEL;
    const mesh = new Mesh(
      DEBRIS_GEOMETRY,
      new MeshBasicMaterial({ color, transparent: true }),
    );
    mesh.scale.set(0.12 + Math.random() * 0.3, 0.08 + Math.random() * 0.22, 0.06 + Math.random() * 0.18);
    mesh.userData.raildIgnoreOcclusion = true;
    mesh.position.copy(position);
    sceneRef.add(mesh);
    const direction = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    pool.add({
      kind: 'debris',
      mesh,
      velocity: direction.multiplyScalar(strength * (0.45 + Math.random())),
      spin: new Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      age: 0,
      life: 0.7 + Math.random() * 0.7,
    });
  }
}

export function spawnImpact(position: Vector3, strong = false) {
  spawnRing(position, strong ? PANEL : ORANGE, strong ? 7 : 3.5, strong ? 0.55 : 0.3);
  burstPanels(position, strong ? 14 : 5, strong ? 9 : 4, true);
}

export function spawnMiss(position: Vector3) {
  spawnRing(position, GRAPHITE, 2.5, 0.38, 1.2);
}

export function updateEffects(dt: number, camera: PerspectiveCamera) {
  pool.update(dt, { camera });
}
