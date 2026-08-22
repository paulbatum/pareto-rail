import {
  Camera,
  Color,
  CylinderGeometry,
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
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';

// Harbor particle language: ochre sparks arc and sink, debris chunks cool to
// rust-dark as they tumble, ink bursts bloom as cold black smoke that lingers
// longer than fire, shockwaves are thin rings, and player-side impacts are
// sea-glass glints.

const EMBER_CAPACITY = 1200;
const RING_CAPACITY = 28;
const GLINT_CAPACITY = 14;
const BEAM_CAPACITY = 10;
const INK_PUFF_CAPACITY = 42;

export type DebrisSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type EmberParticle = {
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
  gravity: number;
};

type InkPuff = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  velocity: Vector3;
  age: number;
  life: number;
  fromScale: number;
  toScale: number;
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

type BeamEffect = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  height: number;
};

const embers: EmberParticle[] = [];
const puffs: InkPuff[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const beams: BeamEffect[] = [];

let emberMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const DEBRIS_DARK = new Color(0.05, 0.025, 0.015);
const INK_BLACK = new Color(0.008, 0.008, 0.01);

export function createEffects(scene: Scene) {
  emberMesh = new InstancedMesh(
    new TetrahedronGeometry(0.12, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    EMBER_CAPACITY,
  );
  emberMesh.count = 0;
  emberMesh.frustumCulled = false;
  scene.add(emberMesh);

  const puffGeometry = new SphereGeometry(1, 7, 5);
  for (let i = 0; i < INK_PUFF_CAPACITY; i += 1) {
    const material = new MeshBasicMaterial({
      color: INK_BLACK.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new Mesh(puffGeometry, material);
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true; // ink smoke never hides targets honestly
    scene.add(mesh);
    puffs.push({ mesh, material, velocity: new Vector3(), age: 0, life: -1, fromScale: 1, toScale: 2 });
  }

  const ringGeometry = new RingGeometry(0.96, 1, 56);
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

  // Vertical light column: lamp shafts and hatchling telegraphs.
  const beamGeometry = new CylinderGeometry(0.5, 0.9, 1, 10, 1, true);
  for (let i = 0; i < BEAM_CAPACITY; i += 1) {
    const mesh = new Mesh(
      beamGeometry,
      createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }),
    );
    mesh.visible = false;
    scene.add(mesh);
    beams.push({ mesh, color: new Color(), age: 0, life: -1, height: 10 });
  }
}

function pushEmber(particle: EmberParticle) {
  if (embers.length >= EMBER_CAPACITY) embers.shift();
  embers.push(particle);
}

// Hot sparks: fast, bright, sinking through the murk.
export function burstEmbers(position: Vector3, color: Color, count: number, speed: number, gravity = 6) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushEmber({
      position: position.clone(),
      velocity: direction.normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 9 + Math.random() * 15,
      color: color.clone(),
      coolTo: null,
      size: 0.4 + Math.random() * 0.5,
      age: 0,
      life: 0.35 + Math.random() * 0.45,
      drag: 1.7,
      gravity,
    });
  }
}

// The enemy comes apart into its own facets; the pieces cool to rust-dark.
export function burstDebris(position: Vector3, specs: DebrisSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushEmber({
      position: position.clone().addScaledVector(outward, 0.35),
      velocity: outward
        .clone()
        .multiplyScalar(6 + rng() * 7)
        .add(new Vector3(rng() - 0.5, rng() + 0.2, rng() - 0.5).multiplyScalar(3)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 4 + rng() * 9,
      color: spec.color.clone(),
      coolTo: DEBRIS_DARK.clone(),
      size: 1.2 + spec.size * 2,
      age: 0,
      life: 0.8 + rng() * 0.5,
      drag: 1.8,
      gravity: 10,
    });
  }
}

// Ink smoke: blooms out, hangs in the water, thins late. Cold black against
// everything — even the thermal display keeps it black.
export function burstInk(position: Vector3, count = 6, spread = 3, scale = 1) {
  for (let i = 0; i < count; i += 1) {
    const puff = puffs.find((p) => p.life < 0);
    if (!puff) return;
    puff.mesh.position.copy(position)
      .add(new Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread));
    puff.velocity.set((Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 0.9, (Math.random() - 0.5) * 1.6);
    puff.age = 0;
    puff.life = 1.1 + Math.random() * 0.9;
    puff.fromScale = (0.9 + Math.random() * 0.8) * scale;
    puff.toScale = puff.fromScale * (2.1 + Math.random());
    puff.mesh.visible = true;
    puff.material.opacity = 0.72;
    puff.mesh.scale.setScalar(0.01);
  }
}

// Small dark wisp behind hostile gobs.
export function dropInkTrail(position: Vector3) {
  burstInk(position, 1, 0.4, 0.22);
}

// Cold, slow-fading streak dropped behind player shots.
export function dropTrail(position: Vector3, color: Color) {
  pushEmber({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 3,
    color: color.clone(),
    coolTo: null,
    size: 0.5,
    age: 0,
    life: 0.26,
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

export function spawnBeam(position: Vector3, color: Color, height: number, life: number) {
  const beam = beams.find((b) => b.life < 0);
  if (!beam) return;
  beam.mesh.position.copy(position);
  beam.mesh.position.y += height / 2;
  beam.mesh.scale.set(1, height, 1);
  (beam.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  beam.mesh.visible = true;
  beam.color.copy(color);
  beam.age = 0;
  beam.life = life;
  beam.height = height;
}

export function updateEffects(dt: number, camera: Camera) {
  if (emberMesh) {
    let count = 0;
    for (let i = embers.length - 1; i >= 0; i -= 1) {
      const ember = embers[i];
      ember.age += dt;
      if (ember.age >= ember.life) {
        embers.splice(i, 1);
        continue;
      }
      ember.velocity.y -= ember.gravity * dt;
      ember.velocity.multiplyScalar(Math.max(0, 1 - ember.drag * dt));
      ember.position.addScaledVector(ember.velocity, dt);
      scratchQuaternion.setFromAxisAngle(ember.axis, ember.spin * dt);
      ember.rotation.premultiply(scratchQuaternion).normalize();

      const fade = 1 - ember.age / ember.life;
      scratchScale.setScalar(ember.size * (0.35 + fade * 0.65));
      scratchMatrix.compose(ember.position, ember.rotation, scratchScale);
      emberMesh.setMatrixAt(count, scratchMatrix);
      if (ember.coolTo) scratchColor.copy(ember.color).lerp(ember.coolTo, 1 - fade).multiplyScalar(0.3 + fade * 0.7);
      else scratchColor.copy(ember.color).multiplyScalar(fade * fade);
      emberMesh.setColorAt(count, scratchColor);
      count += 1;
    }
    emberMesh.count = count;
    emberMesh.instanceMatrix.needsUpdate = true;
    if (emberMesh.instanceColor) emberMesh.instanceColor.needsUpdate = true;
  }

  for (const puff of puffs) {
    if (puff.life < 0) continue;
    puff.age += dt;
    if (puff.age >= puff.life) {
      puff.life = -1;
      puff.mesh.visible = false;
      continue;
    }
    const progress = puff.age / puff.life;
    puff.mesh.position.addScaledVector(puff.velocity, dt);
    puff.velocity.multiplyScalar(Math.max(0, 1 - 1.4 * dt));
    const eased = 1 - (1 - progress) * (1 - progress);
    puff.mesh.scale.setScalar(puff.fromScale + (puff.toScale - puff.fromScale) * eased);
    puff.mesh.rotation.y += dt * 0.4;
    // Hold nearly solid while young, thin out only at the end.
    puff.material.opacity = progress < 0.55 ? 0.72 : 0.72 * (1 - (progress - 0.55) / 0.45);
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
  embers.length = 0;
  if (emberMesh) emberMesh.count = 0;
  for (const puff of puffs) {
    puff.life = -1;
    puff.mesh.visible = false;
  }
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

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
