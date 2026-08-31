import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera, Color, Object3D } from 'three';
import { createTransientEffectPool, createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import { mulberry32 } from '../../../engine/rng';

type RingEffect = {
  kind: 'ring';
  object: Mesh;
  age: number;
  life: number;
  startScale: number;
  endScale: number;
};

type BurstEffect = {
  kind: 'burst';
  object: Group;
  age: number;
  life: number;
  shards: Array<{ mesh: Mesh; velocity: Vector3; spin: Vector3 }>;
};

type Effect = RingEffect | BurstEffect;
type EffectContext = { camera: Camera };

let root: Group | null = null;
let sceneRef: Scene | null = null;
const rng = mulberry32(0x9def9);

const pool = createTransientEffectPool<Effect, EffectContext>({
  update(effect, progress, dt, context) {
    if (effect.kind === 'ring') {
      effect.object.quaternion.copy(context.camera.quaternion);
      const eased = 1 - (1 - progress) ** 3;
      effect.object.scale.setScalar(effect.startScale + (effect.endScale - effect.startScale) * eased);
      (effect.object.material as MeshBasicMaterial).opacity = (1 - progress) ** 1.7;
      return;
    }

    for (const shard of effect.shards) {
      shard.velocity.multiplyScalar(Math.max(0, 1 - dt * 1.4));
      shard.mesh.position.addScaledVector(shard.velocity, dt);
      shard.mesh.rotation.x += shard.spin.x * dt;
      shard.mesh.rotation.y += shard.spin.y * dt;
      shard.mesh.rotation.z += shard.spin.z * dt;
      shard.mesh.scale.setScalar(Math.max(0.05, 1 - progress));
      (shard.mesh.material as MeshBasicMaterial).opacity = 1 - progress;
    }
  },
  dispose(effect) {
    effect.object.removeFromParent();
    disposeObject3D(effect.object);
  },
});

export function createEffects(scene: Scene) {
  if (root) root.removeFromParent();
  root = new Group();
  root.name = 'mass-driver-effects';
  sceneRef = scene;
  scene.add(root);
}

export function spawnShockRing(position: Vector3, color: Color, startScale = 0.5, endScale = 4.5, life = 0.42) {
  if (!root) return;
  const object = new Mesh(
    new RingGeometry(0.82, 0.9, 40),
    createAdditiveBasicMaterial({ color, opacity: 1, side: DoubleSide }),
  );
  object.position.copy(position);
  root.add(object);
  pool.add({ kind: 'ring', object, age: 0, life, startScale, endScale });
}

export function spawnBurst(position: Vector3, color: Color, count = 10, speed = 8, life = 0.58) {
  if (!root) return;
  const object = new Group();
  object.position.copy(position);
  const shards: BurstEffect['shards'] = [];
  for (let index = 0; index < count; index += 1) {
    const shard = new Mesh(
      new OctahedronGeometry(0.13 + rng() * 0.12, 0),
      createAdditiveBasicMaterial({ color: color.clone().multiplyScalar(0.72 + rng() * 0.5), opacity: 1 }),
    );
    const direction = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    shards.push({
      mesh: shard,
      velocity: direction.multiplyScalar(speed * (0.45 + rng() * 0.75)),
      spin: new Vector3(rng() * 9 - 4.5, rng() * 9 - 4.5, rng() * 9 - 4.5),
    });
    object.add(shard);
  }
  root.add(object);
  pool.add({ kind: 'burst', object, age: 0, life, shards });
}

export function updateEffects(dt: number, camera: Camera) {
  pool.update(dt, { camera });
}

export function resetEffects() {
  if (!sceneRef) return;
  pool.clear({ camera: sceneRef as unknown as Camera });
}

export function disposeEffects() {
  if (sceneRef) pool.clear({ camera: sceneRef as unknown as Camera });
  if (root) {
    root.removeFromParent();
    disposeObject3D(root);
  }
  root = null;
  sceneRef = null;
}

export function effectRoot(): Object3D | null {
  return root;
}

