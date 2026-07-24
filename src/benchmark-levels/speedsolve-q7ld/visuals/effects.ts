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
import { SOLVE_COLORS } from './palette';

// Speedsolve's particle language is confetti physics: everything broken is a
// small bright cube. Debris tumbles with real spin, floats more than it
// falls (the void is kind), and keeps its saturated color — on the pale
// ground, chips of solid color read louder than any additive glow.

const CHIP_CAPACITY = 1600;
const RING_CAPACITY = 24;
const GLINT_CAPACITY = 12;

export type ChipSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type Chip = {
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

const chips: Chip[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];

let chipMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

export function createEffects(scene: Scene) {
  chipMesh = new InstancedMesh(
    new BoxGeometry(0.34, 0.34, 0.1),
    new MeshBasicMaterial({ color: 0xffffff }),
    CHIP_CAPACITY,
  );
  chipMesh.count = 0;
  chipMesh.frustumCulled = false;
  // Sub-second cosmetic debris must not read as cover in the occlusion gate.
  chipMesh.userData.raildIgnoreOcclusion = true;
  scene.add(chipMesh);

  const ringGeometry = new RingGeometry(0.96, 1, 48);
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
}

function pushChip(chip: Chip) {
  if (chips.length >= CHIP_CAPACITY) chips.shift();
  chips.push(chip);
}

/** Hot fragments off an impact — quick, small, colored. */
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, gravity = 7) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushChip({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 9 + Math.random() * 14,
      color: color.clone(),
      size: 0.5 + Math.random() * 0.5,
      age: 0,
      life: 0.3 + Math.random() * 0.35,
      drag: 1.5,
      gravity,
    });
  }
}

/** A target decompresses into its own colored shell pieces. */
export function burstShards(position: Vector3, specs: ChipSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushChip({
      position: position.clone().addScaledVector(outward, 0.3),
      velocity: outward
        .clone()
        .multiplyScalar(7 + rng() * 9)
        .add(new Vector3(rng() - 0.5, rng() - 0.4, rng() - 0.5).multiplyScalar(3)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 4 + rng() * 9,
      color: spec.color.clone(),
      size: 1.0 + spec.size * 2.0,
      age: 0,
      life: 0.8 + rng() * 0.5,
      drag: 1.3,
      gravity: 10,
    });
  }
}

/** The finale: a storm of tiny cubes in all six solve colors. */
export function burstConfetti(position: Vector3, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushChip({
      position: position.clone().addScaledVector(direction, 1.5),
      velocity: direction.multiplyScalar(speed * (0.35 + Math.random())),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 6 + Math.random() * 16,
      color: SOLVE_COLORS[i % SOLVE_COLORS.length].clone(),
      size: 0.9 + Math.random() * 1.3,
      age: 0,
      life: 2.4 + Math.random() * 1.8,
      drag: 1.05,
      gravity: 2.6,
    });
  }
}

/** Tracer wake dropped behind shots. */
export function dropTrail(position: Vector3, color: Color) {
  pushChip({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 3,
    color: color.clone(),
    size: 0.42,
    age: 0,
    life: 0.2,
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

export function updateEffects(dt: number, camera: Camera) {
  if (chipMesh) {
    let count = 0;
    for (let i = chips.length - 1; i >= 0; i -= 1) {
      const chip = chips[i];
      chip.age += dt;
      if (chip.age >= chip.life) {
        chips.splice(i, 1);
        continue;
      }
      chip.velocity.y -= chip.gravity * dt;
      chip.velocity.multiplyScalar(Math.max(0, 1 - chip.drag * dt));
      chip.position.addScaledVector(chip.velocity, dt);
      scratchQuaternion.setFromAxisAngle(chip.axis, chip.spin * dt);
      chip.rotation.premultiply(scratchQuaternion).normalize();

      const fade = 1 - chip.age / chip.life;
      scratchScale.setScalar(chip.size * (0.4 + Math.min(1, fade * 1.6) * 0.6));
      scratchMatrix.compose(chip.position, chip.rotation, scratchScale);
      chipMesh.setMatrixAt(count, scratchMatrix);
      // Opaque confetti reads by shrinking, not fading; a slight lift toward
      // the void color at the very end sells dissolve on the pale ground.
      scratchColor.copy(chip.color).lerp(new Color(0.9, 0.89, 0.87), Math.max(0, 1 - fade * 4));
      chipMesh.setColorAt(count, scratchColor);
      count += 1;
    }
    chipMesh.count = count;
    chipMesh.instanceMatrix.needsUpdate = true;
    if (chipMesh.instanceColor) chipMesh.instanceColor.needsUpdate = true;
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
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }
}

export function resetEffects() {
  chips.length = 0;
  if (chipMesh) chipMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
}

export function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
