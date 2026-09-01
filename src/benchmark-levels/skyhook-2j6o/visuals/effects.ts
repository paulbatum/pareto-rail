import {
  BoxGeometry,
  BufferGeometry,
  Camera,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
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
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';

// Hardware coming apart: opaque panel shards that tumble and fall under real
// gravity, hot sparks that arc and die, thin shockwave rings, four-point
// glints on the player's side, and jagged lightning in the weather.

const SPARK_CAPACITY = 1200;
const SHARD_CAPACITY = 320;
const RING_CAPACITY = 24;
const GLINT_CAPACITY = 12;
const BOLT_CAPACITY = 6;
const BOLT_SEGMENTS = 14;

export type ShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type Particle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // unit length — feeds setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
  gravity: number;
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

type LightningEffect = {
  lines: LineSegments;
  color: Color;
  age: number;
  life: number;
};

const sparks: Particle[] = [];
const shards: Particle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const bolts: LightningEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
let shardMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

export function createEffects(scene: Scene) {
  sparkMesh = new InstancedMesh(
    new TetrahedronGeometry(0.1, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  sparkMesh.userData.raildIgnoreOcclusion = true;
  scene.add(sparkMesh);

  const shardGeometry = new BoxGeometry(0.34, 0.22, 0.08);
  shardMesh = new InstancedMesh(shardGeometry, new MeshBasicMaterial({ color: 0xffffff }), SHARD_CAPACITY);
  shardMesh.count = 0;
  shardMesh.frustumCulled = false;
  shardMesh.userData.raildIgnoreOcclusion = true;
  scene.add(shardMesh);

  const ringGeometry = new RingGeometry(0.95, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.6, 0.05);
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

  for (let i = 0; i < BOLT_CAPACITY; i += 1) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(BOLT_SEGMENTS * 2 * 3), 3));
    const lines = new LineSegments(geometry, new LineBasicMaterial(additiveMaterialParameters({ color: 0x000000 })));
    lines.visible = false;
    lines.frustumCulled = false;
    lines.userData.raildIgnoreOcclusion = true;
    scene.add(lines);
    bolts.push({ lines, color: new Color(), age: 0, life: -1 });
  }
}

// Particle records are pooled: bursts and trails run every frame, and fresh
// vectors per particle would be the level's biggest source of frame garbage.
const freeParticles: Particle[] = [];

function acquireParticle(): Particle {
  const recycled = freeParticles.pop();
  if (recycled) return recycled;
  return {
    position: new Vector3(),
    velocity: new Vector3(),
    axis: new Vector3(0, 1, 0),
    rotation: new Quaternion(),
    spin: 0,
    color: new Color(),
    size: 1,
    age: 0,
    life: 1,
    drag: 1,
    gravity: 0,
  };
}

function releaseParticle(particle: Particle) {
  if (freeParticles.length < SPARK_CAPACITY + SHARD_CAPACITY) freeParticles.push(particle);
}

function push(list: Particle[], capacity: number, particle: Particle) {
  if (list.length >= capacity) releaseParticle(list.shift()!);
  list.push(particle);
}

function randomUnitInto(target: Vector3, rng: () => number) {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return target.set(Math.cos(angle) * r, Math.sin(angle) * r, z);
}

/** Hot sparks: fast, bright, arcing down. */
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, gravity = 12) {
  for (let i = 0; i < count; i += 1) {
    const particle = acquireParticle();
    particle.position.copy(position);
    randomUnitInto(particle.velocity, Math.random).multiplyScalar(speed * (0.35 + Math.random() * 0.9));
    randomUnitInto(particle.axis, Math.random);
    particle.rotation.identity();
    particle.spin = 8 + Math.random() * 14;
    particle.color.copy(color);
    particle.size = 0.35 + Math.random() * 0.5;
    particle.age = 0;
    particle.life = 0.3 + Math.random() * 0.4;
    particle.drag = 1.4;
    particle.gravity = gravity;
    push(sparks, SPARK_CAPACITY, particle);
  }
}

/** Panel shards: opaque chunks tumbling away, falling under gravity, fading by shrinking. */
const scratchOutward = new Vector3();

export function burstShards(position: Vector3, specs: ShardSpec[], rng: () => number = Math.random, gravity = 11) {
  for (const spec of specs) {
    const outward = scratchOutward.copy(spec.direction).normalize();
    const particle = acquireParticle();
    particle.position.copy(position).addScaledVector(outward, 0.3);
    particle.velocity.copy(outward).multiplyScalar(5 + rng() * 7);
    particle.velocity.x += (rng() - 0.5) * 2.5;
    particle.velocity.y += (rng() + 0.3) * 2.5;
    particle.velocity.z += (rng() - 0.5) * 2.5;
    randomUnitInto(particle.axis, rng);
    particle.rotation.identity();
    particle.spin = 5 + rng() * 10;
    particle.color.copy(spec.color);
    particle.size = 0.9 + spec.size * 1.8;
    particle.age = 0;
    particle.life = 0.9 + rng() * 0.6;
    particle.drag = 0.9;
    particle.gravity = gravity;
    push(shards, SHARD_CAPACITY, particle);
  }
}

/** Cold trail dropped behind player shots. */
export function dropTrail(position: Vector3, color: Color) {
  const particle = acquireParticle();
  particle.position.copy(position);
  particle.velocity.set((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8);
  randomUnitInto(particle.axis, Math.random);
  particle.rotation.identity();
  particle.spin = 3;
  particle.color.copy(color);
  particle.size = 0.45;
  particle.age = 0;
  particle.life = 0.22;
  particle.drag = 1;
  particle.gravity = 0;
  push(sparks, SPARK_CAPACITY, particle);
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

/** Jagged lightning between two points; the storm's own light. */
export function spawnLightning(from: Vector3, to: Vector3, color: Color, life = 0.16, jitter = 4) {
  const bolt = bolts.find((candidate) => candidate.life < 0);
  if (!bolt) return;
  const attribute = bolt.lines.geometry.getAttribute('position') as Float32BufferAttribute;
  const points: Vector3[] = [];
  const span = to.clone().sub(from);
  const side = new Vector3(span.z, 0, -span.x).normalize();
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i <= BOLT_SEGMENTS; i += 1) {
    const t = i / BOLT_SEGMENTS;
    const envelope = Math.sin(t * Math.PI);
    const point = from.clone().addScaledVector(span, t)
      .addScaledVector(side, (Math.random() - 0.5) * jitter * envelope)
      .addScaledVector(up, (Math.random() - 0.5) * jitter * 0.5 * envelope);
    points.push(point);
  }
  for (let i = 0; i < BOLT_SEGMENTS; i += 1) {
    attribute.setXYZ(i * 2, points[i].x, points[i].y, points[i].z);
    attribute.setXYZ(i * 2 + 1, points[i + 1].x, points[i + 1].y, points[i + 1].z);
  }
  attribute.needsUpdate = true;
  bolt.lines.visible = true;
  bolt.color.copy(color);
  bolt.age = 0;
  bolt.life = life;
}

function updateParticles(list: Particle[], mesh: InstancedMesh | null, dt: number, additive: boolean) {
  if (!mesh) return;
  let count = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const particle = list[i];
    particle.age += dt;
    if (particle.age >= particle.life) {
      list.splice(i, 1);
      releaseParticle(particle);
      continue;
    }
    particle.velocity.y -= particle.gravity * dt;
    particle.velocity.multiplyScalar(Math.max(0, 1 - particle.drag * dt));
    particle.position.addScaledVector(particle.velocity, dt);
    scratchQuaternion.setFromAxisAngle(particle.axis, particle.spin * dt);
    particle.rotation.premultiply(scratchQuaternion).normalize();

    const fade = 1 - particle.age / particle.life;
    scratchScale.setScalar(particle.size * (additive ? 0.35 + fade * 0.65 : 0.2 + Math.min(1, fade * 1.6) * 0.8));
    scratchMatrix.compose(particle.position, particle.rotation, scratchScale);
    mesh.setMatrixAt(count, scratchMatrix);
    if (additive) scratchColor.copy(particle.color).multiplyScalar(fade * fade);
    else scratchColor.copy(particle.color).multiplyScalar(0.5 + fade * 0.5);
    mesh.setColorAt(count, scratchColor);
    count += 1;
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function updateEffects(dt: number, camera: Camera) {
  updateParticles(sparks, sparkMesh, dt, true);
  updateParticles(shards, shardMesh, dt, false);

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
    glint.group.rotation.z += dt * 2.5;
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }

  for (const bolt of bolts) {
    if (bolt.life < 0) continue;
    bolt.age += dt;
    if (bolt.age >= bolt.life) {
      bolt.life = -1;
      bolt.lines.visible = false;
      continue;
    }
    const progress = bolt.age / bolt.life;
    const flicker = 0.55 + 0.45 * Math.abs(Math.sin(bolt.age * 90));
    (bolt.lines.material as LineBasicMaterial).color.copy(bolt.color).multiplyScalar((1 - progress) * flicker);
  }
}

export function resetEffects() {
  for (const particle of sparks) releaseParticle(particle);
  for (const particle of shards) releaseParticle(particle);
  sparks.length = 0;
  shards.length = 0;
  if (sparkMesh) sparkMesh.count = 0;
  if (shardMesh) shardMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
  for (const bolt of bolts) {
    bolt.life = -1;
    bolt.lines.visible = false;
  }
}

