import {
  Camera,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';

const SHARD_CAPACITY = 768;
const RING_CAPACITY = 26;
const GLINT_CAPACITY = 14;

export type ShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
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

type GlintEffect = {
  group: Group;
  materials: MeshBasicMaterial[];
  color: Color;
  age: number;
  life: number;
  scale: number;
};

const shards: ShardParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];

let shardMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

export function createEffects(scene: Scene) {
  shardMesh = new InstancedMesh(
    new TetrahedronGeometry(0.14, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SHARD_CAPACITY,
  );
  shardMesh.count = 0;
  shardMesh.frustumCulled = false;
  shardMesh.userData.raildIgnoreOcclusion = true;
  scene.add(shardMesh);

  const ringGeometry = new RingGeometry(0.965, 1, 56);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(
      ringGeometry,
      createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }),
    );
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.8, 0.06);
  for (let i = 0; i < GLINT_CAPACITY; i += 1) {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    for (const rotation of [0, Math.PI / 2]) {
      const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
      const blade = new Mesh(bladeGeometry, material);
      blade.rotation.z = rotation;
      group.add(blade);
      materials.push(material);
    }
    group.visible = false;
    group.userData.raildIgnoreOcclusion = true;
    scene.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }
}

function spawnShard(particle: ShardParticle) {
  if (shards.length >= SHARD_CAPACITY) shards.shift();
  shards.push(particle);
}

// An enemy breaks into its own facets: shards fly along their mount
// directions in the enemy's accent color.
export function burstShatter(position: Vector3, specs: ShardSpec[] | undefined, accent: Color) {
  const source = specs && specs.length > 0 ? specs : makeFallbackSpecs(accent);
  for (const spec of source) {
    const outward = spec.direction.clone().normalize();
    const size = Math.max(0.3, spec.size);
    spawnShard({
      position: position.clone().addScaledVector(outward, 0.3),
      velocity: outward
        .clone()
        .multiplyScalar(5.5 + Math.random() * 5.5)
        .add(randomUnit().multiplyScalar(1.6)),
      axis: randomUnit(),
      rotation: new Quaternion(),
      spin: 5 + Math.random() * 9,
      color: spec.color.clone(),
      size: size * (0.8 + Math.random() * 0.4),
      age: 0,
      life: 0.6 + Math.random() * 0.4,
      drag: 2.2,
    });
  }
}

function makeFallbackSpecs(accent: Color): ShardSpec[] {
  const specs: ShardSpec[] = [];
  for (let i = 0; i < 10; i += 1) {
    specs.push({ direction: randomUnit(), color: accent.clone(), size: 0.5 + Math.random() * 0.4 });
  }
  return specs;
}

export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit();
    spawnShard({
      position: position.clone(),
      velocity: direction.clone().multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: direction,
      rotation: new Quaternion(),
      spin: 8 + Math.random() * 14,
      color: color.clone(),
      size: 0.45 + Math.random() * 0.5,
      age: 0,
      life: 0.25 + Math.random() * 0.25,
      drag: 3.5,
    });
  }
}

export function dropTrail(position: Vector3, color: Color) {
  spawnShard({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2),
    axis: randomUnit(),
    rotation: new Quaternion(),
    spin: 4,
    color: color.clone(),
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
  ring.mesh.scale.setScalar(0.01);
  (ring.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  ring.mesh.visible = true;
  ring.color.copy(color);
  ring.age = 0;
  ring.life = life;
  ring.fromScale = toScale * 0.12;
  ring.toScale = toScale;
}

export function spawnGlint(position: Vector3, color: Color, scale = 1, life = 0.18) {
  const glint = glints.find((g) => g.life < 0);
  if (!glint) return;
  glint.group.position.copy(position);
  glint.group.scale.setScalar(0.01);
  for (const material of glint.materials) material.color.set(0, 0, 0);
  glint.group.visible = true;
  glint.color.copy(color);
  glint.age = 0;
  glint.life = life;
  glint.scale = scale;
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
      shard.rotation.premultiply(scratchQuaternion).normalize();

      const fade = 1 - shard.age / shard.life;
      scratchScale.setScalar(shard.size * (0.35 + fade * 0.65));
      scratchMatrix.compose(shard.position, shard.rotation, scratchScale);
      shardMesh.setMatrixAt(count, scratchMatrix);
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

  for (const glint of glints) {
    if (glint.life < 0) continue;
    glint.age += dt;
    if (glint.age >= glint.life) {
      glint.life = -1;
      glint.group.visible = false;
      continue;
    }
    const progress = glint.age / glint.life;
    const envelope = Math.sin(Math.min(1, progress * 1.15) * Math.PI);
    glint.group.scale.setScalar(Math.max(0.01, glint.scale * envelope));
    glint.group.quaternion.copy(camera.quaternion);
    glint.group.rotation.z += dt * 3;
    for (const material of glint.materials) {
      material.color.copy(glint.color).multiplyScalar(envelope);
    }
  }
}

export function resetEffects() {
  shards.length = 0;
  if (shardMesh) shardMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
}

function randomUnit(): Vector3 {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
