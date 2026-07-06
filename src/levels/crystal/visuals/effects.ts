import {
  Camera,
  Color,
  DoubleSide,
  Group,
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
import type { ShardSpec } from './crystal';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { AMBER, CYAN, MAGENTA } from './palette';

const SHARD_CAPACITY = 1024;
const DEBRIS_CAPACITY = 256;
const RING_CAPACITY = 24;
const GLINT_CAPACITY = 12;

const UP = new Vector3(0, 1, 0);

type ShardParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // must be unit length: it feeds setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
};

export type DebrisParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // must be unit length: it feeds setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  palette: DebrisPalette;
  scale: Vector3;
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
const debris: DebrisParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];

let shardMesh: InstancedMesh | null = null;
type DebrisPalette = 'cyan' | 'magenta' | 'amber';

type DebrisMeshSet = Record<DebrisPalette, InstancedMesh>;

let debrisMeshes: DebrisMeshSet | null = null;
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
    cyan: createDebrisInstancedMesh(DEBRIS_CAPACITY, CYAN),
    magenta: createDebrisInstancedMesh(DEBRIS_CAPACITY, MAGENTA),
    amber: createDebrisInstancedMesh(DEBRIS_CAPACITY, AMBER),
  };
  for (const mesh of Object.values(debrisMeshes)) scene.add(mesh);

  // Thin ring: reads as a clean expanding ripple; a fat ring under bloom
  // reads as a wall of light.
  const ringGeometry = new RingGeometry(0.965, 1, 56);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(
      ringGeometry,
      createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }),
    );
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  // Star glint: two crossed thin quads, billboarded. Tiny screen area means
  // bloom turns it into a sharp four-point sparkle instead of a white wash.
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

export function createDebrisInstancedMesh(capacity: number, color: Color = CYAN): InstancedMesh {
  const mesh = new InstancedMesh(
    new OctahedronGeometry(0.5, 0),
    new MeshBasicMaterial({
      color: color.clone().multiplyScalar(0.65),
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

function spawnDebris(particle: DebrisParticle) {
  if (debris.length >= DEBRIS_CAPACITY) debris.shift();
  debris.push(particle);
}

// The enemy decompresses into its *own* facets: each debris piece flies outward
// along the direction it was mounted on, tumbling as it fades. These are larger
// normal-blended crystal slivers, separate from the tiny additive spark pool.
export function burstShatter(
  position: Vector3,
  specs: ShardSpec[] | undefined,
  accent: Color,
  rng: () => number = Math.random,
) {
  for (const particle of makeShatterDebris(position, specs, accent, rng)) spawnDebris(particle);
}

export function makeShatterDebris(
  position: Vector3,
  specs: ShardSpec[] | undefined,
  accent: Color,
  rng: () => number,
): DebrisParticle[] {
  const sourceSpecs = specs && specs.length > 0 ? specs : makeFallbackSpecs(accent, rng);
  return sourceSpecs.map((spec) => makeDebrisParticle(position, spec, rng));
}

export function createFrozenShatterDebris(
  position: Vector3,
  specs: ShardSpec[] | undefined,
  accent: Color,
  age: number,
  rng: () => number,
): Group {
  const particles = makeShatterDebris(position, specs, accent, rng);
  const group = new Group();
  const meshes: DebrisMeshSet = {
    cyan: createDebrisInstancedMesh(Math.max(1, particles.length), CYAN),
    magenta: createDebrisInstancedMesh(Math.max(1, particles.length), MAGENTA),
    amber: createDebrisInstancedMesh(Math.max(1, particles.length), AMBER),
  };
  for (const particle of particles) advanceDebrisToAge(particle, age);
  writeDebrisMeshSet(meshes, particles);
  group.add(...Object.values(meshes));
  return group;
}

function makeDebrisParticle(position: Vector3, spec: ShardSpec, rng: () => number): DebrisParticle {
  const outward = spec.direction.clone().normalize();
  const jitter = randomUnit(rng).multiplyScalar(1.2 + rng() * 1.8);
  const size = Math.max(0.28, spec.size);
  const length = 0.38 + size * 0.64;
  const width = 0.12 + size * 0.12;
  const depth = 0.08 + size * 0.08;
  const rotation = new Quaternion().setFromUnitVectors(UP, outward);
  rotation.premultiply(new Quaternion().setFromAxisAngle(outward, rng() * Math.PI * 2));
  rotation.premultiply(new Quaternion().setFromAxisAngle(randomUnit(rng), (rng() - 0.5) * 0.65));
  return {
    position: position.clone().addScaledVector(outward, 0.28 + Math.min(0.42, size * 0.16)),
    velocity: outward
      .clone()
      .multiplyScalar(5.8 + rng() * 5.2 + Math.min(2.4, size * 0.8))
      .add(jitter),
    axis: randomUnit(rng),
    rotation,
    spin: 4.5 + rng() * 8.5,
    palette: nearestDebrisPalette(spec.color),
    scale: new Vector3(width * (0.85 + rng() * 0.35), length * (0.85 + rng() * 0.3), depth * (0.9 + rng() * 0.35)),
    age: 0,
    life: 0.78 + rng() * 0.32,
    drag: 2.05,
  };
}

function makeFallbackSpecs(accent: Color, rng: () => number): ShardSpec[] {
  const specs: ShardSpec[] = [];
  for (let i = 0; i < 10; i += 1) {
    specs.push({
      direction: randomUnit(rng),
      color: accent.clone(),
      size: 0.45 + rng() * 0.45,
    });
  }
  return specs;
}

function advanceDebrisToAge(particle: DebrisParticle, targetAge: number) {
  let remaining = Math.max(0, targetAge);
  while (remaining > 0) {
    const step = Math.min(1 / 120, remaining);
    advanceDebris(particle, step);
    remaining -= step;
  }
}

function advanceDebris(particle: DebrisParticle, dt: number) {
  particle.age += dt;
  particle.velocity.multiplyScalar(Math.max(0, 1 - particle.drag * dt));
  particle.position.addScaledVector(particle.velocity, dt);
  scratchQuaternion.setFromAxisAngle(particle.axis, particle.spin * dt);
  particle.rotation.premultiply(scratchQuaternion).normalize();
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

// Tiny slow shard dropped behind a projectile each frame: reads as a trail.
export function dropTrail(position: Vector3, color: Color) {
  spawnShard({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2),
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
  if (debrisMeshes) {
    for (let i = debris.length - 1; i >= 0; i -= 1) {
      const particle = debris[i];
      advanceDebris(particle, dt);
      if (particle.age >= particle.life) {
        debris.splice(i, 1);
      }
    }
    writeDebrisMeshSet(debrisMeshes, debris);
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

  for (const glint of glints) {
    if (glint.life < 0) continue;
    glint.age += dt;
    if (glint.age >= glint.life) {
      glint.life = -1;
      glint.group.visible = false;
      continue;
    }
    const progress = glint.age / glint.life;
    // Sharp pop out, quick shrink back: a camera-flash sparkle.
    const envelope = Math.sin(Math.min(1, progress * 1.15) * Math.PI);
    glint.group.scale.setScalar(Math.max(0.01, glint.scale * envelope));
    glint.group.quaternion.copy(camera.quaternion);
    glint.group.rotation.z += dt * 3;
    for (const material of glint.materials) {
      material.color.copy(glint.color).multiplyScalar(envelope);
    }
  }
}

function writeDebrisMeshSet(meshes: DebrisMeshSet, particles: DebrisParticle[]) {
  writeDebrisInstances(
    meshes.cyan,
    particles.filter((particle) => particle.palette === 'cyan'),
  );
  writeDebrisInstances(
    meshes.magenta,
    particles.filter((particle) => particle.palette === 'magenta'),
  );
  writeDebrisInstances(
    meshes.amber,
    particles.filter((particle) => particle.palette === 'amber'),
  );
}

function writeDebrisInstances(mesh: InstancedMesh, particles: DebrisParticle[]) {
  let count = 0;
  for (const particle of particles) {
    if (particle.age >= particle.life) continue;
    const progress = particle.age / particle.life;
    const endShrink = progress < 0.68 ? 1 : Math.max(0.01, (1 - progress) / 0.32);
    const earlySettle = 1 - Math.min(progress, 0.68) * 0.12;
    scratchScale.copy(particle.scale).multiplyScalar(endShrink * earlySettle);
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

function nearestDebrisPalette(color: Color): DebrisPalette {
  let best: DebrisPalette = 'cyan';
  let bestDistance = colorDistanceSquared(color, CYAN);
  const magentaDistance = colorDistanceSquared(color, MAGENTA);
  if (magentaDistance < bestDistance) {
    best = 'magenta';
    bestDistance = magentaDistance;
  }
  const amberDistance = colorDistanceSquared(color, AMBER);
  if (amberDistance < bestDistance) best = 'amber';
  return best;
}

function colorDistanceSquared(a: Color, b: Color): number {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
