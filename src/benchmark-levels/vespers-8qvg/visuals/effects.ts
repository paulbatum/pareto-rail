import {
  Camera,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';

// Transient effect pools: additive sparks, normal glass slivers (a pane kill
// shatters into the glass it was made of), expanding rings, camera glints,
// and the signature "light returns" streak that flies from a kill back to the
// window it stripped.

const SPARK_CAPACITY = 900;
const GLASS_CAPACITY = 320;
const RING_CAPACITY = 28;
const GLINT_CAPACITY = 14;
const STREAK_CAPACITY = 10;

const UP = new Vector3(0, 1, 0);

type Spark = {
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

type GlassSliver = {
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

type StreakEffect = {
  mesh: Mesh;
  from: Vector3;
  to: Vector3;
  color: Color;
  age: number;
  life: number;
};

const sparks: Spark[] = [];
const glass: GlassSliver[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const streaks: StreakEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
let glassMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

export function createEffects(scene: Scene) {
  sparkMesh = new InstancedMesh(
    new OctahedronGeometry(0.14, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  glassMesh = new InstancedMesh(
    new OctahedronGeometry(0.16, 0),
    new MeshBasicMaterial({ color: 0xffffff }),
    GLASS_CAPACITY,
  );
  glassMesh.count = 0;
  glassMesh.frustumCulled = false;
  scene.add(glassMesh);

  const ringGeometry = new RingGeometry(0.965, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(
      ringGeometry,
      createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }),
    );
    mesh.visible = false;
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
    scene.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }

  const streakGeometry = new PlaneGeometry(1, 0.09);
  for (let i = 0; i < STREAK_CAPACITY; i += 1) {
    const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
    const mesh = new Mesh(streakGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    streaks.push({ mesh, from: new Vector3(), to: new Vector3(), color: new Color(), age: 0, life: -1 });
  }
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

// A pane kill shatters into normal-blended glass slivers in its colour — the
// one opaque burst in the level, so the kill reads as breaking something.
export function burstGlass(position: Vector3, color: Color, count = 9) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    glass.push({
      position: position.clone().addScaledVector(direction, 0.2),
      velocity: direction.clone().multiplyScalar(3.2 + Math.random() * 4.6),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 3 + Math.random() * 7,
      color: color.clone(),
      size: 0.4 + Math.random() * 0.55,
      age: 0,
      life: 0.7 + Math.random() * 0.35,
      drag: 2.2,
    });
  }
}

export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    sparks.push({
      position: position.clone(),
      velocity: direction.clone().multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: direction,
      rotation: new Quaternion(),
      spin: 8 + Math.random() * 14,
      color: color.clone(),
      size: 0.4 + Math.random() * 0.5,
      age: 0,
      life: 0.25 + Math.random() * 0.3,
      drag: 3.4,
    });
  }
}

export function dropTrail(position: Vector3, color: Color) {
  sparks.push({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 5,
    color: color.clone(),
    size: 0.5,
    age: 0,
    life: 0.3,
    drag: 1,
  });
}

// The light returns: a bright streak flies from the kill back to the window
// it stripped, and the window lights as it arrives.
export function spawnStreak(from: Vector3, to: Vector3, color: Color, life = 0.42) {
  const streak = streaks.find((s) => s.life < 0);
  if (!streak) return;
  streak.mesh.visible = true;
  streak.from.copy(from);
  streak.to.copy(to);
  streak.color.copy(color);
  streak.age = 0;
  streak.life = life;
  streak.mesh.position.copy(from);
}

export function updateEffects(dt: number, camera: Camera) {
  if (sparkMesh) writeInstanced(sparkMesh, sparks, dt, 1.0);
  if (glassMesh) writeInstanced(glassMesh, glass, dt, 0.0);

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

  for (const streak of streaks) {
    if (streak.life < 0) continue;
    streak.age += dt;
    if (streak.age >= streak.life) {
      streak.life = -1;
      streak.mesh.visible = false;
      continue;
    }
    const t = streak.age / streak.life;
    const eased = t * t * (3 - 2 * t);
    streak.mesh.position.lerpVectors(streak.from, streak.to, eased);
    streak.mesh.quaternion.copy(camera.quaternion);
    // Align the quad's long axis with the screen-space direction of flight.
    const from = streak.from.clone().project(camera);
    const to = streak.to.clone().project(camera);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    streak.mesh.rotation.z = angle;
    const length = Math.max(0.05, 1 - eased) * 4.5;
    streak.mesh.scale.set(length, 1, 1);
    (streak.mesh.material as MeshBasicMaterial).color.copy(streak.color).multiplyScalar((1 - t) * 1.4);
  }
}

function writeInstanced(mesh: InstancedMesh, particles: Spark[] | GlassSliver[], dt: number, alphaAdd: number) {
  let count = 0;
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.age += dt;
    if (particle.age >= particle.life) {
      particles.splice(i, 1);
      continue;
    }
    particle.velocity.multiplyScalar(Math.max(0, 1 - particle.drag * dt));
    particle.position.addScaledVector(particle.velocity, dt);
    scratchQuaternion.setFromAxisAngle(particle.axis, particle.spin * dt);
    particle.rotation.premultiply(scratchQuaternion).normalize();

    const fade = 1 - particle.age / particle.life;
    scratchScale.setScalar(particle.size * (0.35 + fade * 0.65));
    scratchMatrix.compose(particle.position, particle.rotation, scratchScale);
    mesh.setMatrixAt(count, scratchMatrix);
    if (mesh.instanceColor) {
      scratchColor.copy(particle.color).multiplyScalar(fade * fade + alphaAdd);
      mesh.setColorAt(count, scratchColor);
    }
    count += 1;
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function resetEffects() {
  sparks.length = 0;
  glass.length = 0;
  if (sparkMesh) sparkMesh.count = 0;
  if (glassMesh) glassMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
  for (const streak of streaks) {
    streak.life = -1;
    streak.mesh.visible = false;
  }
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
