import {
  BoxGeometry,
  Camera,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
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
import { GUNMETAL, HAZARD, PANEL_WHITE } from './palette';

// Effect language. Sparks are hot and additive; chips are the paneling itself
// flying apart; smoke only exists where there is air. In the storm and the
// sunlit sky debris falls and drags; above the Karman line it flies straight,
// tumbling, forever — the level's one physics rule, and it reads in every kill.

const SPARK_CAPACITY = 1400;
const CHIP_CAPACITY = 320;
const SMOKE_CAPACITY = 150;
const RING_CAPACITY = 30;
const GLINT_CAPACITY = 16;
const BEAM_CAPACITY = 8;

type Particle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // unit length: feeds setFromAxisAngle
  rotation: Quaternion;
  spin: number;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
  gravity: number;
  fadeTo?: Color;
};

type RingEffect = { mesh: Mesh; color: Color; age: number; life: number; fromScale: number; toScale: number };
type GlintEffect = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };
type BeamEffect = { mesh: Mesh; color: Color; age: number; life: number; height: number };

const sparks: Particle[] = [];
const chips: Particle[] = [];
const smoke: Particle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const beams: BeamEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
let chipMesh: InstancedMesh | null = null;
let smokeMesh: InstancedMesh | null = null;

const scratchMatrix = new Matrix4();
const scratchQuat = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const DOWN = new Vector3(0, -1, 0);

export function createEffects(scene: Scene) {
  // The app can mount the level more than once in one page: start from a clean pool.
  for (const list of [sparks, chips, smoke]) list.length = 0;
  for (const list of [rings, glints, beams] as unknown[][]) list.length = 0;
  sparkMesh = new InstancedMesh(new TetrahedronGeometry(0.12, 0), createAdditiveBasicMaterial({ color: 0xffffff }), SPARK_CAPACITY);
  chipMesh = new InstancedMesh(new BoxGeometry(1, 0.12, 0.8), new MeshBasicMaterial({ color: 0xffffff }), CHIP_CAPACITY);
  smokeMesh = new InstancedMesh(new IcosahedronGeometry(1, 0), new MeshBasicMaterial({ color: 0xffffff }), SMOKE_CAPACITY);
  for (const mesh of [sparkMesh, chipMesh, smokeMesh]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
  }
  (sparkMesh.material as MeshBasicMaterial).fog = false;

  const ringGeometry = new RingGeometry(0.96, 1, 56);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide, fog: false }));
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.8, 0.05);
  for (let i = 0; i < GLINT_CAPACITY; i += 1) {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    for (const rotation of [0, Math.PI / 2]) {
      const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide, fog: false });
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

  // Light columns: warnings and the punch through the deck.
  const beamGeometry = new CylinderGeometry(0.5, 0.9, 1, 10, 1, true);
  for (let i = 0; i < BEAM_CAPACITY; i += 1) {
    const mesh = new Mesh(beamGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide, fog: false }));
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    beams.push({ mesh, color: new Color(), age: 0, life: -1, height: 10 });
  }
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}

function push(list: Particle[], capacity: number, particle: Particle) {
  if (list.length >= capacity) list.shift();
  list.push(particle);
}

export type SparkOptions = { gravity?: number; drag?: number; size?: number; life?: number; bias?: Vector3; biasAmount?: number };

/** Hot sparks: fast, bright, arcing (in air) or flying straight (in vacuum, gravity 0, drag 0). */
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, options: SparkOptions = {}) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    if (options.bias) direction.addScaledVector(options.bias, options.biasAmount ?? 1).normalize();
    push(sparks, SPARK_CAPACITY, {
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.35 + Math.random() * 0.95)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 9 + Math.random() * 14,
      color: color.clone(),
      size: (options.size ?? 1) * (0.4 + Math.random() * 0.6),
      age: 0,
      life: (options.life ?? 0.5) * (0.6 + Math.random() * 0.7),
      drag: options.drag ?? 1.4,
      gravity: options.gravity ?? 8,
    });
  }
}

/** Paneling flying apart: white plate, dark plating, hazard scrap. */
export function burstChips(position: Vector3, count: number, speed: number, options: { gravity?: number; drag?: number; size?: number; hazard?: number } = {}) {
  const hazardShare = options.hazard ?? 0.25;
  for (let i = 0; i < count; i += 1) {
    const roll = Math.random();
    const base = roll < hazardShare ? HAZARD : roll < hazardShare + 0.32 ? GUNMETAL : PANEL_WHITE;
    const scale = base === HAZARD ? 1.15 : base === GUNMETAL ? 1.7 : 0.95;
    push(chips, CHIP_CAPACITY, {
      position: position.clone(),
      velocity: randomUnit(Math.random).multiplyScalar(speed * (0.3 + Math.random() * 0.9)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion().setFromAxisAngle(randomUnit(Math.random), Math.random() * 6),
      spin: 2 + Math.random() * 9,
      color: base.clone().multiplyScalar(scale),
      size: (options.size ?? 1) * (0.35 + Math.random() * 0.75),
      age: 0,
      life: 1.4 + Math.random() * 1.6,
      drag: options.drag ?? 0.5,
      gravity: options.gravity ?? 6,
    });
  }
}

/** Smoke and dust: only meaningful where there is air. */
export function puffSmoke(position: Vector3, count: number, size: number, color: Color, life = 1.4) {
  for (let i = 0; i < count; i += 1) {
    push(smoke, SMOKE_CAPACITY, {
      position: position.clone().add(randomUnit(Math.random).multiplyScalar(size * 0.3)),
      velocity: randomUnit(Math.random).multiplyScalar(2 + Math.random() * 4),
      axis: new Vector3(0, 1, 0),
      rotation: new Quaternion(),
      spin: 0,
      color: color.clone(),
      size: size * (0.5 + Math.random() * 0.7),
      age: 0,
      life: life * (0.7 + Math.random() * 0.6),
      drag: 1.6,
      gravity: -1.5,
    });
  }
}

/** Cold, short streak dropped behind player shots. */
export function dropTrail(position: Vector3, color: Color) {
  push(sparks, SPARK_CAPACITY, {
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 3,
    color: color.clone(),
    size: 0.55,
    age: 0,
    life: 0.24,
    drag: 1,
    gravity: 0,
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

export function spawnBeam(position: Vector3, direction: Vector3, color: Color, height: number, life: number) {
  const beam = beams.find((b) => b.life < 0);
  if (!beam) return;
  beam.mesh.position.copy(position).addScaledVector(direction, height / 2);
  beam.mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction);
  beam.mesh.scale.set(1, height, 1);
  (beam.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  beam.mesh.visible = true;
  beam.color.copy(color);
  beam.age = 0;
  beam.life = life;
  beam.height = height;
}

function stepParticles(list: Particle[], dt: number, atmosphere: number, mesh: InstancedMesh | null, mode: 'spark' | 'chip' | 'smoke') {
  if (!mesh) return;
  let count = 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const p = list[i];
    p.age += dt;
    if (p.age >= p.life) {
      list.splice(i, 1);
      continue;
    }
    // Vacuum: no gravity, no drag. The world's rule changes with altitude.
    p.velocity.addScaledVector(DOWN, p.gravity * atmosphere * dt);
    p.velocity.multiplyScalar(Math.max(0, 1 - p.drag * atmosphere * dt));
    p.position.addScaledVector(p.velocity, dt);
    if (p.spin !== 0) {
      scratchQuat.setFromAxisAngle(p.axis, p.spin * dt);
      p.rotation.premultiply(scratchQuat).normalize();
    }
    const fade = 1 - p.age / p.life;
    let size = p.size;
    if (mode === 'spark') size *= 0.35 + fade * 0.65;
    else if (mode === 'chip') size *= fade < 0.2 ? fade / 0.2 : 1;
    else size *= 0.6 + (1 - fade) * 1.5;
    scratchScale.setScalar(size);
    scratchMatrix.compose(p.position, p.rotation, scratchScale);
    mesh.setMatrixAt(count, scratchMatrix);
    if (mode === 'spark') scratchColor.copy(p.color).multiplyScalar(fade * fade);
    else if (mode === 'smoke') scratchColor.copy(p.color).multiplyScalar(0.25 + fade * 0.75);
    else scratchColor.copy(p.color);
    mesh.setColorAt(count, scratchColor);
    count += 1;
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** `atmosphere` is 1 in air, 0 in vacuum: it scales gravity and drag. */
export function updateEffects(dt: number, camera: Camera, atmosphere: number) {
  stepParticles(sparks, dt, atmosphere, sparkMesh, 'spark');
  stepParticles(chips, dt, atmosphere, chipMesh, 'chip');
  stepParticles(smoke, dt, 1, smokeMesh, 'smoke');

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
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }

  for (const beam of beams) {
    if (beam.life < 0) continue;
    beam.age += dt;
    if (beam.age >= beam.life) {
      beam.life = -1;
      beam.mesh.visible = false;
      continue;
    }
    const progress = beam.age / beam.life;
    const envelope = Math.sin(Math.min(1, progress * 1.1) * Math.PI) ** 0.7;
    beam.mesh.scale.set(0.4 + envelope, beam.height * (0.5 + progress * 0.5), 0.4 + envelope);
    (beam.mesh.material as MeshBasicMaterial).color.copy(beam.color).multiplyScalar(envelope * 0.8);
  }
}

export function resetEffects() {
  sparks.length = 0;
  chips.length = 0;
  smoke.length = 0;
  for (const mesh of [sparkMesh, chipMesh, smokeMesh]) if (mesh) mesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
  for (const beam of beams) {
    beam.life = -1;
    beam.mesh.visible = false;
  }
}
