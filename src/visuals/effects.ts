import {
  AdditiveBlending,
  Camera,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import type { ShardSpec } from './crystal';
import { CORE_WHITE, hdr } from './palette';

const SHARD_CAPACITY = 1024;
const RING_CAPACITY = 20;
const FLASH_CAPACITY = 10;

type ShardParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  spin: number;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
};

type RingEffect = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  fromScale: number;
  toScale: number;
};

type FlashEffect = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  scale: number;
};

const shards: ShardParticle[] = [];
const rings: RingEffect[] = [];
const flashes: FlashEffect[] = [];

let shardMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

export function createEffects(scene: Scene) {
  shardMesh = new InstancedMesh(
    new TetrahedronGeometry(0.13, 0),
    new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false }),
    SHARD_CAPACITY,
  );
  shardMesh.count = 0;
  shardMesh.frustumCulled = false;
  scene.add(shardMesh);

  const ringGeometry = new RingGeometry(0.92, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(
      ringGeometry,
      new MeshBasicMaterial({
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  const flashGeometry = new SphereGeometry(0.5, 12, 8);
  for (let i = 0; i < FLASH_CAPACITY; i += 1) {
    const mesh = new Mesh(
      flashGeometry,
      new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    flashes.push({ mesh, color: new Color(), age: 0, life: -1, scale: 1 });
  }
}

function spawnShard(particle: ShardParticle) {
  if (shards.length >= SHARD_CAPACITY) shards.shift();
  shards.push(particle);
}

// The enemy explodes into its *own* shards: each facet of the crystal flies
// outward along the direction it was mounted on.
export function burstShatter(position: Vector3, specs: ShardSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const velocity = spec.direction
      .clone()
      .normalize()
      .multiplyScalar(9 + rng() * 8)
      .add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(4));
    spawnShard({
      position: position.clone(),
      velocity,
      axis: new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
      rotation: new Quaternion(),
      spin: 6 + rng() * 14,
      color: spec.color.clone().multiplyScalar(1.7),
      size: 1.6 + spec.size * 2.4,
      age: 0,
      life: 0.75 + rng() * 0.45,
      drag: 2.2,
    });
  }
}

export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    spawnShard({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: direction.clone(),
      rotation: new Quaternion(),
      spin: 10 + Math.random() * 20,
      color: color.clone().multiplyScalar(1.5),
      size: 0.5 + Math.random() * 0.7,
      age: 0,
      life: 0.3 + Math.random() * 0.3,
      drag: 3.5,
    });
  }
}

// Tiny slow shard dropped behind a projectile each frame: reads as a trail.
export function dropTrail(position: Vector3, color: Color) {
  spawnShard({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2),
    axis: new Vector3(0, 1, 0),
    rotation: new Quaternion(),
    spin: 4,
    color: color.clone().multiplyScalar(1.1),
    size: 0.55,
    age: 0,
    life: 0.28,
    drag: 1,
  });
}

export function spawnRing(position: Vector3, color: Color, toScale: number, life: number) {
  const ring = rings.find((r) => r.life < 0);
  if (!ring) return;
  ring.mesh.position.copy(position);
  ring.mesh.visible = true;
  ring.color.copy(color);
  ring.age = 0;
  ring.life = life;
  ring.fromScale = toScale * 0.15;
  ring.toScale = toScale;
}

export function spawnFlash(position: Vector3, color: Color = hdr(CORE_WHITE, 3), scale = 1.6, life = 0.22) {
  const flash = flashes.find((f) => f.life < 0);
  if (!flash) return;
  flash.mesh.position.copy(position);
  flash.mesh.visible = true;
  flash.color.copy(color);
  flash.age = 0;
  flash.life = life;
  flash.scale = scale;
}

export function updateEffects(dt: number, camera: Camera) {
  if (shardMesh) {
    let count = 0;
    for (let i = shards.length - 1; i >= 0; i -= 1) {
      const shard = shards[i];
      shard.age += dt;
      if (shard.age >= shard.life) {
        shards.splice(i, 1);
        continue;
      }
      shard.velocity.multiplyScalar(Math.max(0, 1 - shard.drag * dt));
      shard.position.addScaledVector(shard.velocity, dt);
      scratchQuaternion.setFromAxisAngle(shard.axis, shard.spin * dt);
      shard.rotation.premultiply(scratchQuaternion);

      const fade = 1 - shard.age / shard.life;
      scratchScale.setScalar(shard.size * (0.35 + fade * 0.65));
      scratchMatrix.compose(shard.position, shard.rotation, scratchScale);
      shardMesh.setMatrixAt(count, scratchMatrix);
      // Additive blending: fading to black is fading to invisible.
      scratchColor.copy(shard.color).multiplyScalar(fade * fade);
      shardMesh.setColorAt(count, scratchColor);
      count += 1;
    }
    shardMesh.count = count;
    shardMesh.instanceMatrix.needsUpdate = true;
    if (shardMesh.instanceColor) shardMesh.instanceColor.needsUpdate = true;
  }

  for (const ring of rings) {
    if (ring.life < 0) continue;
    ring.age += dt;
    if (ring.age >= ring.life) {
      ring.life = -1;
      ring.mesh.visible = false;
      continue;
    }
    const progress = ring.age / ring.life;
    const eased = 1 - (1 - progress) * (1 - progress);
    ring.mesh.scale.setScalar(ring.fromScale + (ring.toScale - ring.fromScale) * eased);
    ring.mesh.quaternion.copy(camera.quaternion);
    (ring.mesh.material as MeshBasicMaterial).color.copy(ring.color).multiplyScalar((1 - progress) ** 1.5);
  }

  for (const flash of flashes) {
    if (flash.life < 0) continue;
    flash.age += dt;
    if (flash.age >= flash.life) {
      flash.life = -1;
      flash.mesh.visible = false;
      continue;
    }
    const progress = flash.age / flash.life;
    flash.mesh.scale.setScalar(flash.scale * (0.4 + progress * 1.4));
    (flash.mesh.material as MeshBasicMaterial).color.copy(flash.color).multiplyScalar((1 - progress) ** 2);
  }
}

export function resetEffects() {
  shards.length = 0;
  if (shardMesh) shardMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const flash of flashes) {
    flash.life = -1;
    flash.mesh.visible = false;
  }
}
