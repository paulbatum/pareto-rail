import {
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import { HEAL_GOLD, JELLY_EMERALD, JELLY_GOLD, JELLY_MINT, PARASITE_CORE, PARASITE_LILAC, PARASITE_VIOLET, hdr } from './palette';

const BUBBLE_CAPACITY = 1000;
const SHARD_CAPACITY = 800;
const RING_CAPACITY = 24;

export type ShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type BubbleParticle = {
  position: Vector3;
  velocity: Vector3;
  color: Color;
  size: number;
  age: number;
  life: number;
  wobbleSpeed: number;
  wobblePhase: number;
};

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
};

type RingEffect = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  fromScale: number;
  toScale: number;
};

const bubbles: BubbleParticle[] = [];
const shards: ShardParticle[] = [];
const rings: RingEffect[] = [];

let bubbleMesh: InstancedMesh | null = null;
let shardMesh: InstancedMesh | null = null;
let effectsScene: Scene | null = null;

const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

export function createEffects(scene: Scene): void {
  effectsScene = scene;

  // Bubbles: glowing oceanic spheres
  bubbleMesh = new InstancedMesh(
    new SphereGeometry(0.12, 8, 6),
    createAdditiveBasicMaterial({ color: 0xffffff, opacity: 0.8 }),
    BUBBLE_CAPACITY,
  );
  bubbleMesh.count = 0;
  bubbleMesh.frustumCulled = false;
  scene.add(bubbleMesh);

  // Shards: sharp parasite fragments
  shardMesh = new InstancedMesh(
    new TetrahedronGeometry(0.14, 0),
    createAdditiveBasicMaterial({ color: 0xffffff, opacity: 0.9 }),
    SHARD_CAPACITY,
  );
  shardMesh.count = 0;
  shardMesh.frustumCulled = false;
  scene.add(shardMesh);

  // Pre-allocate shockwave rings
  const ringGeo = new RingGeometry(0.85, 1.0, 32);
  const ringMat = createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide });
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeo, ringMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    rings.push({
      mesh,
      color: new Color(),
      age: 0,
      life: 0,
      fromScale: 0.1,
      toScale: 5.0,
    });
  }
}

export function spawnRing(
  position: Vector3,
  color: Color,
  fromScale = 0.2,
  toScale = 4.5,
  life = 0.5,
  normal?: Vector3,
): void {
  const ring = rings.find((r) => r.age >= r.life);
  if (!ring) return;

  ring.mesh.position.copy(position);
  if (normal && normal.lengthSq() > 0.001) {
    ring.mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal.clone().normalize());
  } else {
    ring.mesh.quaternion.identity();
  }
  ring.color.copy(color);
  (ring.mesh.material as MeshBasicMaterial).color.copy(color);
  ring.fromScale = fromScale;
  ring.toScale = toScale;
  ring.life = life;
  ring.age = 0;
  ring.mesh.visible = true;
  ring.mesh.scale.setScalar(fromScale);
}

export function spawnBubble(
  position: Vector3,
  velocity: Vector3,
  color: Color,
  size = 0.35,
  life = 1.4,
): void {
  if (bubbles.length >= BUBBLE_CAPACITY) return;
  bubbles.push({
    position: position.clone(),
    velocity: velocity.clone(),
    color: color.clone(),
    size,
    age: 0,
    life,
    wobbleSpeed: 4 + Math.random() * 6,
    wobblePhase: Math.random() * Math.PI * 2,
  });
}

export function burstBubbles(
  position: Vector3,
  count: number,
  color: Color = HEAL_GOLD,
  speed = 4.0,
  baseSize = 0.4,
): void {
  for (let i = 0; i < count; i += 1) {
    const dir = new Vector3(
      (Math.random() - 0.5) * 2,
      Math.random() * 1.5 + 0.2, // upward buoyant tendency
      (Math.random() - 0.5) * 2,
    ).normalize();
    const vel = dir.multiplyScalar(speed * (0.4 + Math.random() * 0.8));
    spawnBubble(
      position,
      vel,
      color,
      baseSize * (0.6 + Math.random() * 0.8),
      0.8 + Math.random() * 1.2,
    );
  }
}

export function spawnShard(
  position: Vector3,
  velocity: Vector3,
  color: Color,
  size = 0.3,
  life = 0.9,
): void {
  if (shards.length >= SHARD_CAPACITY) return;
  const axis = new Vector3(
    Math.random() - 0.5,
    Math.random() - 0.5,
    Math.random() - 0.5,
  ).normalize();
  shards.push({
    position: position.clone(),
    velocity: velocity.clone(),
    axis,
    rotation: new Quaternion(),
    spin: (Math.random() - 0.5) * 12,
    color: color.clone(),
    size,
    age: 0,
    life,
  });
}

export function burstShards(
  position: Vector3,
  specs: ShardSpec[] | number,
  defaultColor: Color = PARASITE_VIOLET,
): void {
  if (typeof specs === 'number') {
    for (let i = 0; i < specs; i += 1) {
      const dir = new Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
      ).normalize();
      const vel = dir.multiplyScalar(5 + Math.random() * 8);
      spawnShard(position, vel, defaultColor, 0.35 + Math.random() * 0.3, 0.7 + Math.random() * 0.6);
    }
    return;
  }

  for (const spec of specs) {
    const vel = spec.direction.clone().multiplyScalar(4 + Math.random() * 6);
    spawnShard(position, vel, spec.color, spec.size, 0.6 + Math.random() * 0.5);
  }
}

export function updateEffects(dt: number, elapsed: number): void {
  // Update shockwave rings
  for (const ring of rings) {
    if (ring.age >= ring.life) {
      ring.mesh.visible = false;
      continue;
    }
    ring.age += dt;
    const progress = Math.min(1, ring.age / ring.life);
    const scale = ring.fromScale + (ring.toScale - ring.fromScale) * Math.sin((progress * Math.PI) / 2);
    ring.mesh.scale.setScalar(scale);

    const fade = Math.max(0, 1 - progress);
    (ring.mesh.material as MeshBasicMaterial).color.copy(ring.color).multiplyScalar(fade * 1.5);
  }

  // Update bubbles
  let bubbleWrite = 0;
  for (let i = 0; i < bubbles.length; i += 1) {
    const b = bubbles[i];
    b.age += dt;
    if (b.age >= b.life) continue;

    // Fluid drag & buoyancy
    b.velocity.multiplyScalar(Math.max(0, 1 - dt * 1.8));
    b.velocity.y += dt * 1.2; // slight upward drift
    b.position.addScaledVector(b.velocity, dt);

    // Subtle sinusoidal wobble
    const wobbleX = Math.sin(elapsed * b.wobbleSpeed + b.wobblePhase) * 0.04;
    const wobbleZ = Math.cos(elapsed * b.wobbleSpeed + b.wobblePhase) * 0.04;

    const progress = b.age / b.life;
    const scale = b.size * (progress < 0.2 ? progress / 0.2 : (1 - progress) * 1.1);

    scratchMatrix.makeTranslation(b.position.x + wobbleX, b.position.y, b.position.z + wobbleZ);
    scratchScale.setScalar(Math.max(0.01, scale));
    scratchMatrix.scale(scratchScale);

    if (bubbleMesh) {
      bubbleMesh.setMatrixAt(bubbleWrite, scratchMatrix);
      const intensity = 1.0 + (1 - progress) * 0.8;
      scratchColor.copy(b.color).multiplyScalar(intensity);
      bubbleMesh.setColorAt(bubbleWrite, scratchColor);
    }

    bubbles[bubbleWrite] = b;
    bubbleWrite += 1;
  }
  bubbles.length = bubbleWrite;
  if (bubbleMesh) {
    bubbleMesh.count = bubbleWrite;
    bubbleMesh.instanceMatrix.needsUpdate = true;
    if (bubbleMesh.instanceColor) bubbleMesh.instanceColor.needsUpdate = true;
  }

  // Update shards
  let shardWrite = 0;
  for (let i = 0; i < shards.length; i += 1) {
    const s = shards[i];
    s.age += dt;
    if (s.age >= s.life) continue;

    // Water drag
    s.velocity.multiplyScalar(Math.max(0, 1 - dt * 2.5));
    s.position.addScaledVector(s.velocity, dt);

    scratchQuaternion.setFromAxisAngle(s.axis, s.spin * dt);
    s.rotation.multiply(scratchQuaternion);

    const progress = s.age / s.life;
    const scale = s.size * (1 - progress);

    scratchMatrix.makeRotationFromQuaternion(s.rotation);
    scratchMatrix.setPosition(s.position);
    scratchScale.setScalar(Math.max(0.01, scale));
    scratchMatrix.scale(scratchScale);

    if (shardMesh) {
      shardMesh.setMatrixAt(shardWrite, scratchMatrix);
      const intensity = (1 - progress) * 1.6;
      scratchColor.copy(s.color).multiplyScalar(intensity);
      shardMesh.setColorAt(shardWrite, scratchColor);
    }

    shards[shardWrite] = s;
    shardWrite += 1;
  }
  shards.length = shardWrite;
  if (shardMesh) {
    shardMesh.count = shardWrite;
    shardMesh.instanceMatrix.needsUpdate = true;
    if (shardMesh.instanceColor) shardMesh.instanceColor.needsUpdate = true;
  }
}

export function resetEffects(): void {
  bubbles.length = 0;
  shards.length = 0;
  for (const ring of rings) {
    ring.age = ring.life;
    ring.mesh.visible = false;
  }
  if (bubbleMesh) bubbleMesh.count = 0;
  if (shardMesh) shardMesh.count = 0;
}

export function disposeEffects(): void {
  resetEffects();
  if (bubbleMesh) {
    bubbleMesh.removeFromParent();
    disposeObject3D(bubbleMesh);
    bubbleMesh = null;
  }
  if (shardMesh) {
    shardMesh.removeFromParent();
    disposeObject3D(shardMesh);
    shardMesh = null;
  }
  for (const ring of rings) {
    ring.mesh.removeFromParent();
    disposeObject3D(ring.mesh);
  }
  rings.length = 0;
}
