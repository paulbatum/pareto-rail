import {
  BoxGeometry,
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
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';

// Skyhook's particle language is wreckage, not fire. Everything that comes off a
// kill is a piece of panel: it tumbles, it catches the light for a moment, and
// then gravity takes it down and out of frame — which is also the level's main
// reminder that there is a very long way to fall.

const DEBRIS_CAPACITY = 1200;
const RING_CAPACITY = 26;
const GLINT_CAPACITY = 14;

export type ShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type DebrisParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // unit length — feeds setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  color: Color;
  fadeTo: Color | null;
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

const debris: DebrisParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];

let debrisMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const COLD_STEEL = new Color(0.05, 0.055, 0.065);

export function createEffects(scene: Scene) {
  const chip = new BoxGeometry(0.2, 0.2, 0.06);
  debrisMesh = new InstancedMesh(chip, createAdditiveBasicMaterial({ color: 0xffffff, fog: false }), DEBRIS_CAPACITY);
  debrisMesh.count = 0;
  debrisMesh.frustumCulled = false;
  scene.add(debrisMesh);

  const ringGeometry = new RingGeometry(0.95, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide, fog: false }));
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  // Impact glints are a hard four-point cross: a strike on metal, not a spark.
  const bladeGeometry = new PlaneGeometry(1.9, 0.045);
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
    scene.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }
}

function push(particle: DebrisParticle) {
  if (debris.length >= DEBRIS_CAPACITY) debris.shift();
  debris.push(particle);
}

/** Sparks off a strike: fast, bright, and immediately falling. */
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, gravity = 16) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    push({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.35 + Math.random() * 0.95)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 10 + Math.random() * 18,
      color: color.clone(),
      fadeTo: null,
      size: 0.35 + Math.random() * 0.45,
      age: 0,
      life: 0.28 + Math.random() * 0.36,
      drag: 1.5,
      gravity,
    });
  }
}

/** A kill decompresses into its own plating, which then tumbles away and cools. */
export function burstPlating(position: Vector3, specs: ShardSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    push({
      position: position.clone().addScaledVector(outward, 0.4),
      velocity: outward
        .clone()
        .multiplyScalar(6 + rng() * 9)
        .add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(3.4)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 3 + rng() * 9,
      color: spec.color.clone(),
      fadeTo: COLD_STEEL.clone(),
      size: 1.1 + spec.size * 2.4,
      age: 0,
      life: 0.85 + rng() * 0.6,
      drag: 1.3,
      gravity: 20,
    });
  }
}

/** Ionised wake behind a shot in flight. Weightless — it is plasma, not panel. */
export function dropTrail(position: Vector3, color: Color) {
  push({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 3,
    color: color.clone(),
    fadeTo: null,
    size: 0.45,
    age: 0,
    life: 0.24,
    drag: 1,
    gravity: 0,
  });
}

export function spawnRing(position: Vector3, color: Color, toScale: number, life: number) {
  const ring = rings.find((candidate) => candidate.life < 0);
  if (!ring) return;
  ring.mesh.position.copy(position);
  ring.mesh.scale.setScalar(0.01);
  (ring.mesh.material as MeshBasicMaterial).color.setRGB(0, 0, 0);
  ring.mesh.visible = true;
  ring.color.copy(color);
  ring.age = 0;
  ring.life = life;
  ring.fromScale = toScale * 0.1;
  ring.toScale = toScale;
}

export function spawnGlint(position: Vector3, color: Color, scale = 1, life = 0.18) {
  const glint = glints.find((candidate) => candidate.life < 0);
  if (!glint) return;
  glint.group.position.copy(position);
  glint.group.scale.setScalar(0.01);
  for (const material of glint.materials) material.color.setRGB(0, 0, 0);
  glint.group.visible = true;
  glint.color.copy(color);
  glint.age = 0;
  glint.life = life;
  glint.scale = scale;
}

export function updateEffects(dt: number, camera: Camera) {
  if (debrisMesh) {
    let count = 0;
    for (let i = debris.length - 1; i >= 0; i -= 1) {
      const particle = debris[i];
      particle.age += dt;
      if (particle.age >= particle.life) {
        debris.splice(i, 1);
        continue;
      }
      particle.velocity.y -= particle.gravity * dt;
      particle.velocity.multiplyScalar(Math.max(0, 1 - particle.drag * dt));
      particle.position.addScaledVector(particle.velocity, dt);
      scratchQuaternion.setFromAxisAngle(particle.axis, particle.spin * dt);
      particle.rotation.premultiply(scratchQuaternion).normalize();

      const fade = 1 - particle.age / particle.life;
      scratchScale.setScalar(particle.size * (0.4 + fade * 0.6));
      scratchMatrix.compose(particle.position, particle.rotation, scratchScale);
      debrisMesh.setMatrixAt(count, scratchMatrix);
      // Additive blending fades to nothing at black; plating cools on the way.
      if (particle.fadeTo) scratchColor.copy(particle.color).lerp(particle.fadeTo, 1 - fade).multiplyScalar(0.3 + fade * 0.7);
      else scratchColor.copy(particle.color).multiplyScalar(fade * fade);
      debrisMesh.setColorAt(count, scratchColor);
      count += 1;
    }
    debrisMesh.count = count;
    debrisMesh.instanceMatrix.needsUpdate = true;
    if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
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
    (ring.mesh.material as MeshBasicMaterial).color.copy(ring.color).multiplyScalar((1 - progress) ** 1.6);
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
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }
}

export function resetEffects() {
  debris.length = 0;
  if (debrisMesh) debrisMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
}
