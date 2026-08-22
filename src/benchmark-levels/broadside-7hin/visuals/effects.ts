import {
  Camera,
  Color,
  Group,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { CYAN, EMBER, GOLD, hdr, ICE } from './palette';

// Effect pools: additive spark shards, normal-blended tumbling debris in the
// two fleet palettes, thin expanding rings, and crossed-blade glints. Small
// screen area per element keeps bloom crisp instead of washing the frame.

const SHARD_CAPACITY = 900;
const DEBRIS_CAPACITY = 220;
const RING_CAPACITY = 24;
const GLINT_CAPACITY = 14;

const UP = new Vector3(0, 1, 0);

type ShardParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // unit length: feeds setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
};

type DebrisParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  spin: number;
  palette: 'ice' | 'ember' | 'gold';
  scale: Vector3;
  age: number;
  life: number;
  drag: number;
};

type RingEffect = { mesh: Mesh; color: Color; age: number; life: number; fromScale: number; toScale: number };
type GlintEffect = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };

const shards: ShardParticle[] = [];
const debris: DebrisParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];

let shardMesh: InstancedMesh | null = null;
let debrisMeshes: Record<'ice' | 'ember' | 'gold', InstancedMesh> | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

export function createEffects(scene: Scene) {
  shardMesh = new InstancedMesh(
    new TetrahedronGeometry(0.13, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SHARD_CAPACITY,
  );
  shardMesh.count = 0;
  shardMesh.frustumCulled = false;
  scene.add(shardMesh);

  debrisMeshes = {
    ice: createDebrisMesh(DEBRIS_CAPACITY, ICE),
    ember: createDebrisMesh(DEBRIS_CAPACITY, EMBER),
    gold: createDebrisMesh(DEBRIS_CAPACITY, GOLD),
  };
  for (const mesh of Object.values(debrisMeshes)) scene.add(mesh);

  const ringGeometry = new RingGeometry(0.965, 1, 56);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.7, 0.055);
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
    scene.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }
}

function createDebrisMesh(capacity: number, color: Color): InstancedMesh {
  const mesh = new InstancedMesh(
    new OctahedronGeometry(0.5, 0),
    new MeshBasicMaterial({
      color: color.clone().multiplyScalar(0.6),
      blending: NormalBlending,
      depthWrite: true,
    }),
    capacity,
  );
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

function spawnShard(particle: ShardParticle) {
  if (shards.length >= SHARD_CAPACITY) shards.shift();
  shards.push(particle);
}

export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
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

// A kill scatters tumbling hull fragments in the victim's own palette.
export function burstDebris(
  position: Vector3,
  specs: Array<{ direction: Vector3; size: number }> | undefined,
  palette: 'ice' | 'ember' | 'gold',
  rng: () => number = Math.random,
) {
  const sourceSpecs = specs && specs.length > 0
    ? specs
    : Array.from({ length: 9 }, () => ({ direction: randomUnit(rng), size: 0.45 + rng() * 0.45 }));
  for (const spec of sourceSpecs) {
    const outward = spec.direction.clone().normalize();
    const size = Math.max(0.28, spec.size);
    const jitter = randomUnit(rng).multiplyScalar(1.2 + rng() * 1.8);
    const rotation = new Quaternion().setFromUnitVectors(UP, outward);
    rotation.premultiply(new Quaternion().setFromAxisAngle(outward, rng() * Math.PI * 2));
    rotation.premultiply(new Quaternion().setFromAxisAngle(randomUnit(rng), (rng() - 0.5) * 0.65));
    debris.push({
      position: position.clone().addScaledVector(outward, 0.28 + Math.min(0.42, size * 0.16)),
      velocity: outward
        .clone()
        .multiplyScalar(5.6 + rng() * 5 + Math.min(2.4, size * 0.8))
        .add(jitter),
      axis: randomUnit(rng),
      rotation,
      spin: 4.5 + rng() * 8.5,
      palette,
      scale: new Vector3(0.12 + size * 0.12, 0.38 + size * 0.6, 0.08 + size * 0.08),
      age: 0,
      life: 0.75 + rng() * 0.35,
      drag: 2.05,
    });
  }
  if (debris.length > DEBRIS_CAPACITY) debris.splice(0, debris.length - DEBRIS_CAPACITY);
}

export function dropTrail(position: Vector3, color: Color) {
  spawnShard({
    position: position.clone(),
    velocity: new Vector3(
      (Math.random() - 0.5) * 1.2,
      (Math.random() - 0.5) * 1.2,
      (Math.random() - 0.5) * 1.2,
    ),
    axis: randomUnit(Math.random),
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
  const ring = rings.find((candidate) => candidate.life < 0);
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
  const glint = glints.find((candidate) => candidate.life < 0);
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
  if (debrisMeshes) {
    const meshes = debrisMeshes;
    const buckets: Record<'ice' | 'ember' | 'gold', DebrisParticle[]> = { ice: [], ember: [], gold: [] };
    for (let i = debris.length - 1; i >= 0; i -= 1) {
      const particle = debris[i];
      advance(particle, dt);
      if (particle.age >= particle.life) {
        debris.splice(i, 1);
        continue;
      }
      buckets[particle.palette].push(particle);
    }
    (Object.keys(buckets) as Array<'ice' | 'ember' | 'gold'>).forEach((key) =>
      writeInstances(meshes[key], buckets[key]),
    );
  }

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

function advance(particle: DebrisParticle, dt: number) {
  particle.age += dt;
  particle.velocity.multiplyScalar(Math.max(0, 1 - particle.drag * dt));
  particle.position.addScaledVector(particle.velocity, dt);
  scratchQuaternion.setFromAxisAngle(particle.axis, particle.spin * dt);
  particle.rotation.premultiply(scratchQuaternion).normalize();
}

function writeInstances(mesh: InstancedMesh, particles: DebrisParticle[]) {
  let count = 0;
  for (const particle of particles) {
    const progress = particle.age / particle.life;
    const endShrink = progress < 0.68 ? 1 : Math.max(0.01, (1 - progress) / 0.32);
    scratchScale.copy(particle.scale).multiplyScalar(endShrink);
    scratchMatrix.compose(particle.position, particle.rotation, scratchScale);
    mesh.setMatrixAt(count, scratchMatrix);
    count += 1;
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
}

export function resetEffects() {
  shards.length = 0;
  debris.length = 0;
  if (shardMesh) shardMesh.count = 0;
  if (debrisMeshes) for (const mesh of Object.values(debrisMeshes)) mesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
}

export function paletteOf(color: Color): 'ice' | 'ember' | 'gold' {
  const d = (c: Color) => (color.r - c.r) ** 2 + (color.g - c.g) ** 2 + (color.b - c.b) ** 2;
  const ice = d(ICE);
  const ember = d(EMBER);
  const gold = d(GOLD);
  const cyan = d(CYAN);
  if (cyan < ice && cyan < ember && cyan < gold) return 'ice';
  if (gold < ember) return 'gold';
  return ember < ice ? 'ember' : 'ice';
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
