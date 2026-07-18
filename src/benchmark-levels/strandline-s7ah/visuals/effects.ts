import {
  Camera,
  CircleGeometry,
  Color,
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
  SphereGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { HUSK_GREY, PARASITE_BRUISE } from './palette';

// Strandline's particle language: this is water. Everything hot RISES —
// spores, bubbles, and light drift buoyantly upward and drag kills them fast;
// dead parasites shed dark ink that hangs and spreads; husks sink. The debris
// field is the current made visible.

const MOTE_CAPACITY = 1000;
const RING_CAPACITY = 24;
const GLINT_CAPACITY = 12;
const INK_CAPACITY = 14;
const HUSK_CAPACITY = 5;

export type ShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type MoteParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // unit length — feeds setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  color: Color;
  coolTo: Color | null;
  size: number;
  age: number;
  life: number;
  drag: number;
  buoyancy: number;
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

type InkEffect = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  age: number;
  life: number;
  toScale: number;
};

type HuskEffect = {
  group: Group;
  velocity: Vector3;
  spinAxis: Vector3;
  spin: number;
  age: number;
  life: number;
};

const motes: MoteParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const inks: InkEffect[] = [];
const husks: HuskEffect[] = [];

let moteMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

export function createEffects(scene: Scene) {
  moteMesh = new InstancedMesh(
    new IcosahedronGeometry(0.1, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    MOTE_CAPACITY,
  );
  moteMesh.count = 0;
  moteMesh.frustumCulled = false;
  scene.add(moteMesh);

  const ringGeometry = new RingGeometry(0.94, 1, 40);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(
      ringGeometry,
      createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }),
    );
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.7, 0.05);
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

  // Ink pool: the one non-additive effect — a dark stain that spreads and
  // thins, so parasite deaths leave a bruise on the water for a moment.
  const inkGeometry = new CircleGeometry(1, 24);
  for (let i = 0; i < INK_CAPACITY; i += 1) {
    const material = new MeshBasicMaterial({
      color: PARASITE_BRUISE.clone().multiplyScalar(0.35),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(inkGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    inks.push({ mesh, material, age: 0, life: -1, toScale: 1 });
  }

  // Husk pool: shrivelled parasite remains sinking out of the light.
  for (let i = 0; i < HUSK_CAPACITY; i += 1) {
    const group = new Group();
    const dark = new MeshBasicMaterial({ color: HUSK_GREY });
    const body = new Mesh(new SphereGeometry(0.8, 8, 6), dark);
    body.scale.set(1, 1.3, 0.8);
    group.add(body);
    for (let leg = 0; leg < 4; leg += 1) {
      const limb = new Mesh(new SphereGeometry(0.22, 5, 4), dark);
      limb.scale.set(0.6, 2.2, 0.6);
      const angle = (leg / 4) * Math.PI * 2;
      limb.position.set(Math.cos(angle) * 0.8, -0.9, Math.sin(angle) * 0.8);
      limb.rotation.z = Math.cos(angle) * 0.5;
      group.add(limb);
    }
    group.visible = false;
    // Not scene-added yet; spawnSinkingHusk parents it.
    husks.push({ group, velocity: new Vector3(), spinAxis: new Vector3(1, 0, 0), spin: 1, age: 0, life: -1 });
    scene.add(group);
  }
}

function pushMote(particle: MoteParticle) {
  if (motes.length >= MOTE_CAPACITY) motes.shift();
  motes.push(particle);
}

// Hot spores: a burst of glowing points that scatter, then float upward.
export function burstSpores(position: Vector3, color: Color, count: number, speed: number, buoyancy = 5) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushMote({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.35 + Math.random() * 0.9)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 5 + Math.random() * 9,
      color: color.clone(),
      coolTo: null,
      size: 0.4 + Math.random() * 0.5,
      age: 0,
      life: 0.5 + Math.random() * 0.5,
      drag: 2.6,
      buoyancy,
    });
  }
}

// The target decompresses into its own tissue; pieces dim to bruise-dark as
// the water takes them.
export function burstShards(position: Vector3, specs: ShardSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushMote({
      position: position.clone().addScaledVector(outward, 0.3),
      velocity: outward
        .clone()
        .multiplyScalar(5 + rng() * 7)
        .add(new Vector3(rng() - 0.5, rng() - 0.2, rng() - 0.5).multiplyScalar(2.5)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 3 + rng() * 7,
      color: spec.color.clone(),
      coolTo: HUSK_GREY.clone(),
      size: 1.0 + spec.size * 2.0,
      age: 0,
      life: 0.8 + rng() * 0.5,
      drag: 2.8,
      buoyancy: -2.5,
    });
  }
}

// Bubble wake dropped behind shots and swimmers.
export function dropTrail(position: Vector3, color: Color) {
  pushMote({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 0.7, 0.6 + Math.random() * 0.7, (Math.random() - 0.5) * 0.7),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 2,
    color: color.clone(),
    coolTo: null,
    size: 0.42,
    age: 0,
    life: 0.3,
    drag: 1.2,
    buoyancy: 2,
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

export function spawnInk(position: Vector3, toScale: number, life = 1.1) {
  const ink = inks.find((i) => i.life < 0);
  if (!ink) return;
  ink.mesh.position.copy(position);
  ink.mesh.scale.setScalar(toScale * 0.2);
  ink.mesh.visible = true;
  ink.material.opacity = 0;
  ink.age = 0;
  ink.life = life;
  ink.toScale = toScale;
}

// A dead thing lets go and sinks out of the sunlight.
export function spawnSinkingHusk(position: Vector3, scale: number, sideways: number) {
  const husk = husks.find((h) => h.life < 0);
  if (!husk) return;
  husk.group.position.copy(position);
  husk.group.scale.setScalar(scale);
  husk.group.visible = true;
  husk.velocity.set(sideways, 1 + Math.random(), 0);
  husk.spinAxis.copy(randomUnit(Math.random));
  husk.spin = 0.8 + Math.random() * 1.4;
  husk.age = 0;
  husk.life = 4;
}

export function updateEffects(dt: number, camera: Camera) {
  if (moteMesh) {
    let count = 0;
    for (let i = motes.length - 1; i >= 0; i -= 1) {
      const mote = motes[i];
      mote.age += dt;
      if (mote.age >= mote.life) {
        motes.splice(i, 1);
        continue;
      }
      mote.velocity.y += mote.buoyancy * dt;
      mote.velocity.multiplyScalar(Math.max(0, 1 - mote.drag * dt));
      mote.position.addScaledVector(mote.velocity, dt);
      scratchQuaternion.setFromAxisAngle(mote.axis, mote.spin * dt);
      mote.rotation.premultiply(scratchQuaternion).normalize();

      const fade = 1 - mote.age / mote.life;
      scratchScale.setScalar(mote.size * (0.4 + fade * 0.6));
      scratchMatrix.compose(mote.position, mote.rotation, scratchScale);
      moteMesh.setMatrixAt(count, scratchMatrix);
      // Additive fades to invisible at black; shards dim to husk-dark first.
      if (mote.coolTo) scratchColor.copy(mote.color).lerp(mote.coolTo, 1 - fade).multiplyScalar(0.25 + fade * 0.75);
      else scratchColor.copy(mote.color).multiplyScalar(fade * fade);
      moteMesh.setColorAt(count, scratchColor);
      count += 1;
    }
    moteMesh.count = count;
    moteMesh.instanceMatrix.needsUpdate = true;
    if (moteMesh.instanceColor) moteMesh.instanceColor.needsUpdate = true;
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
    glint.group.rotation.z += dt * 2.4;
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }

  for (const ink of inks) {
    if (ink.life < 0) continue;
    ink.age += dt;
    if (ink.age >= ink.life) {
      ink.life = -1;
      ink.mesh.visible = false;
      continue;
    }
    const progress = ink.age / ink.life;
    const spread = ink.toScale * (0.2 + 0.8 * (1 - (1 - progress) ** 2));
    ink.mesh.scale.setScalar(spread);
    ink.mesh.quaternion.copy(camera.quaternion);
    ink.material.opacity = Math.sin(Math.min(1, progress * 1.2) * Math.PI) * 0.5;
  }

  for (const husk of husks) {
    if (husk.life < 0) continue;
    husk.age += dt;
    if (husk.age >= husk.life) {
      husk.life = -1;
      husk.group.visible = false;
      continue;
    }
    // Sinking, not falling: water resistance caps the drop speed fast.
    husk.velocity.y = Math.max(husk.velocity.y - 7 * dt, -6.5);
    husk.velocity.x *= Math.max(0, 1 - 1.2 * dt);
    husk.group.position.addScaledVector(husk.velocity, dt);
    scratchQuaternion.setFromAxisAngle(husk.spinAxis, husk.spin * dt);
    husk.group.quaternion.premultiply(scratchQuaternion);
  }
}

export function resetEffects() {
  motes.length = 0;
  if (moteMesh) moteMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
  for (const ink of inks) {
    ink.life = -1;
    ink.mesh.visible = false;
  }
  for (const husk of husks) {
    husk.life = -1;
    husk.group.visible = false;
  }
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
