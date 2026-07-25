import {
  Camera,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import type { MeshBasicNodeMaterial } from 'three/webgpu';
import { ARM_SEGMENTS, SEGMENT_GEOMETRY } from './creatures';
import { modalMesh } from './materials';
import { poseLimb, type LimbShape } from './octopus-body';

// Transient matter: ichor and chips off the creature, pressure rings, the
// sodium glint off a struck lamp, and the limbs it loses. Everything here is
// pooled and instanced, and every pool is a modal material — a spray of ichor
// in the murk is a spray of heat in the imager.

const SPRAY_CAPACITY = 384;
const CHUNK_CAPACITY = 192;
const RING_CAPACITY = 18;
const GLINT_CAPACITY = 10;
const CORPSE_CAPACITY = 4;

const matrix = new Matrix4();
const spin = new Quaternion();
const scratchScale = new Vector3();

export type EffectPalette = {
  ichorMurk: Color;
  ichorThermal: Color;
  searMurk: Color;
  searThermal: Color;
  chunkMurk: Color;
  chunkThermal: Color;
  limbMurk: Color;
  limbThermal: Color;
};

type Particle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  spin: number;
  size: number;
  age: number;
  life: number;
  drag: number;
  gravity: number;
};

type RingEffect = {
  mesh: Mesh;
  material: MeshBasicNodeMaterial;
  murk: Color;
  thermal: Color;
  age: number;
  life: number;
  from: number;
  to: number;
};

type GlintEffect = {
  group: Group;
  materials: MeshBasicNodeMaterial[];
  murk: Color;
  thermal: Color;
  age: number;
  life: number;
  scale: number;
};

type CorpseEffect = {
  limb: InstancedMesh;
  material: MeshBasicNodeMaterial;
  shape: LimbShape;
  sink: Vector3;
  age: number;
  life: number;
};

const ichor: Particle[] = [];
const sear: Particle[] = [];
const chunks: Particle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const corpses: CorpseEffect[] = [];

let ichorMesh: InstancedMesh | null = null;
let searMesh: InstancedMesh | null = null;
let chunkMesh: InstancedMesh | null = null;
let palette: EffectPalette | null = null;
const origin = new Vector3();

export function createEffects(scene: Scene, colors: EffectPalette) {
  palette = colors;
  ichorMesh = new InstancedMesh(
    new TetrahedronGeometry(0.16, 0),
    modalMesh(colors.ichorMurk, colors.ichorThermal, { swallow: 0.55, additive: true }),
    SPRAY_CAPACITY,
  );
  searMesh = new InstancedMesh(
    new TetrahedronGeometry(0.2, 0),
    modalMesh(colors.searMurk, colors.searThermal, { swallow: 0.45, additive: true }),
    SPRAY_CAPACITY,
  );
  chunkMesh = new InstancedMesh(
    new TetrahedronGeometry(0.42, 0),
    modalMesh(colors.chunkMurk, colors.chunkThermal, { swallow: 0.9 }),
    CHUNK_CAPACITY,
  );
  for (const mesh of [ichorMesh, searMesh, chunkMesh]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
  }

  const ringGeometry = new RingGeometry(0.955, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const material = modalMesh(colors.searMurk, colors.searThermal, { swallow: 0.2, additive: true, side: DoubleSide });
    const mesh = new Mesh(ringGeometry, material);
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    rings.push({ mesh, material, murk: new Color(), thermal: new Color(), age: 0, life: -1, from: 0, to: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.9, 0.05);
  for (let i = 0; i < GLINT_CAPACITY; i += 1) {
    const group = new Group();
    const materials: MeshBasicNodeMaterial[] = [];
    for (const rotation of [0, Math.PI / 2]) {
      const material = modalMesh(colors.searMurk, colors.searThermal, { swallow: 0.2, additive: true, side: DoubleSide });
      const blade = new Mesh(bladeGeometry, material);
      blade.rotation.z = rotation;
      group.add(blade);
      materials.push(material);
    }
    group.visible = false;
    group.userData.raildIgnoreOcclusion = true;
    scene.add(group);
    glints.push({ group, materials, murk: new Color(), thermal: new Color(), age: 0, life: -1, scale: 1 });
  }

  for (let i = 0; i < CORPSE_CAPACITY; i += 1) {
    const material = modalMesh(colors.limbMurk, colors.limbThermal, { swallow: 0.94 });
    const limb = new InstancedMesh(SEGMENT_GEOMETRY, material, ARM_SEGMENTS);
    limb.count = 0;
    limb.frustumCulled = false;
    limb.visible = false;
    limb.userData.raildIgnoreOcclusion = true;
    scene.add(limb);
    corpses.push({
      limb,
      material,
      shape: {
        tip: new Vector3(),
        bulge: new Vector3(),
        shoulder: new Vector3(),
        thickness: 1,
        wobble: 0.3,
        time: 0,
      },
      sink: new Vector3(),
      age: 0,
      life: -1,
    });
  }
}

function push(pool: Particle[], capacity: number, particle: Particle) {
  if (pool.length >= capacity) pool.shift();
  pool.push(particle);
}

function randomUnit(): Vector3 {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
}

export function sprayIchor(position: Vector3, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit();
    push(ichor, SPRAY_CAPACITY, {
      position: position.clone(),
      velocity: direction.clone().multiplyScalar(speed * (0.35 + Math.random() * 0.9)),
      axis: direction,
      rotation: new Quaternion(),
      spin: 6 + Math.random() * 10,
      size: 0.6 + Math.random() * 0.7,
      age: 0,
      life: 0.42 + Math.random() * 0.4,
      drag: 2.6,
      gravity: -1.9,
    });
  }
}

export function spraySear(position: Vector3, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit();
    push(sear, SPRAY_CAPACITY, {
      position: position.clone(),
      velocity: direction.clone().multiplyScalar(speed * (0.5 + Math.random())),
      axis: direction,
      rotation: new Quaternion(),
      spin: 10 + Math.random() * 16,
      size: 0.5 + Math.random() * 0.8,
      age: 0,
      life: 0.26 + Math.random() * 0.3,
      drag: 3.6,
      gravity: -0.4,
    });
  }
}

export function burstChunks(position: Vector3, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit();
    push(chunks, CHUNK_CAPACITY, {
      position: position.clone(),
      velocity: direction.clone().multiplyScalar(speed * (0.4 + Math.random() * 0.8)),
      axis: randomUnit(),
      rotation: new Quaternion(),
      spin: 3 + Math.random() * 7,
      size: 0.55 + Math.random() * 0.8,
      age: 0,
      life: 0.85 + Math.random() * 0.5,
      drag: 1.8,
      gravity: -3.4,
    });
  }
}

export function spawnRing(position: Vector3, murk: Color, thermal: Color, toScale: number, life: number) {
  const ring = rings.find((candidate) => candidate.life < 0);
  if (!ring) return;
  ring.mesh.position.copy(position);
  ring.mesh.scale.setScalar(0.01);
  ring.mesh.visible = true;
  ring.murk.copy(murk);
  ring.thermal.copy(thermal);
  ring.age = 0;
  ring.life = life;
  ring.from = toScale * 0.14;
  ring.to = toScale;
}

export function spawnGlint(position: Vector3, murk: Color, thermal: Color, scale: number, life: number) {
  const glint = glints.find((candidate) => candidate.life < 0);
  if (!glint) return;
  glint.group.position.copy(position);
  glint.group.scale.setScalar(0.01);
  glint.group.visible = true;
  glint.murk.copy(murk);
  glint.thermal.copy(thermal);
  glint.age = 0;
  glint.life = life;
  glint.scale = scale;
}

/** A severed limb keeps its last shape, then sinks out of the lamp light. */
export function releaseSeveredArm(shape: LimbShape, drift: Vector3) {
  const corpse = corpses.find((candidate) => candidate.life < 0);
  if (!corpse) return;
  corpse.shape.tip.copy(shape.tip);
  corpse.shape.bulge.copy(shape.bulge);
  corpse.shape.shoulder.copy(shape.shoulder);
  corpse.shape.thickness = shape.thickness;
  corpse.shape.wobble = shape.wobble;
  corpse.shape.time = 0;
  corpse.sink.copy(drift);
  corpse.age = 0;
  corpse.life = 2.6;
  corpse.limb.visible = true;
}

function advance(particle: Particle, dt: number) {
  particle.age += dt;
  particle.velocity.multiplyScalar(Math.max(0, 1 - particle.drag * dt));
  particle.velocity.y += particle.gravity * dt;
  particle.position.addScaledVector(particle.velocity, dt);
  spin.setFromAxisAngle(particle.axis, particle.spin * dt);
  particle.rotation.premultiply(spin).normalize();
}

function writeParticles(mesh: InstancedMesh | null, pool: Particle[], dt: number, shrink: number) {
  if (!mesh) return;
  let count = 0;
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    const particle = pool[i];
    advance(particle, dt);
    if (particle.age >= particle.life) {
      pool.splice(i, 1);
      continue;
    }
    const fade = 1 - particle.age / particle.life;
    scratchScale.setScalar(particle.size * (shrink + (1 - shrink) * fade));
    matrix.compose(particle.position, particle.rotation, scratchScale);
    mesh.setMatrixAt(count, matrix);
    count += 1;
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
}

const scratchColor = new Color();

function fadeModal(material: MeshBasicNodeMaterial, murk: Color, thermal: Color, amount: number) {
  const modal = material.userData.modal as { murk: { value: Color }; thermal: { value: Color } } | undefined;
  if (!modal) return;
  modal.murk.value.copy(scratchColor.copy(murk).multiplyScalar(amount));
  modal.thermal.value.copy(scratchColor.copy(thermal).multiplyScalar(amount));
}

export function updateEffects(dt: number, camera: Camera) {
  writeParticles(ichorMesh, ichor, dt, 0.25);
  writeParticles(searMesh, sear, dt, 0.2);
  writeParticles(chunkMesh, chunks, dt, 0.3);

  for (const ring of rings) {
    if (ring.life < 0) continue;
    ring.age += dt;
    if (ring.age >= ring.life) {
      ring.life = -1;
      ring.mesh.visible = false;
      continue;
    }
    const progress = ring.age / ring.life;
    const eased = 1 - (1 - progress) ** 2;
    ring.mesh.scale.setScalar(ring.from + (ring.to - ring.from) * eased);
    ring.mesh.quaternion.copy(camera.quaternion);
    fadeModal(ring.material, ring.murk, ring.thermal, (1 - progress) ** 1.6);
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
    glint.group.rotation.z += dt * 2.4;
    for (const material of glint.materials) fadeModal(material, glint.murk, glint.thermal, envelope);
  }

  for (const corpse of corpses) {
    if (corpse.life < 0) continue;
    corpse.age += dt;
    if (corpse.age >= corpse.life) {
      corpse.life = -1;
      corpse.limb.visible = false;
      corpse.limb.count = 0;
      continue;
    }
    const progress = corpse.age / corpse.life;
    corpse.shape.time += dt;
    corpse.shape.tip.addScaledVector(corpse.sink, dt * (1 + progress * 2.2));
    corpse.shape.bulge.addScaledVector(corpse.sink, dt * 0.7);
    corpse.shape.fade = 1 - progress * 0.55;
    poseLimb(corpse.limb, origin, corpse.shape);
    fadeModal(corpse.material, palette?.limbMurk ?? scratchColor, palette?.limbThermal ?? scratchColor, (1 - progress) ** 0.8);
  }
}

export function resetEffects() {
  ichor.length = 0;
  sear.length = 0;
  chunks.length = 0;
  for (const mesh of [ichorMesh, searMesh, chunkMesh]) if (mesh) mesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
  for (const corpse of corpses) {
    corpse.life = -1;
    corpse.limb.visible = false;
    corpse.limb.count = 0;
  }
}
