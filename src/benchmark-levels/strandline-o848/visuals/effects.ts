import {
  Camera,
  CircleGeometry,
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
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';

// Underwater particle language: motes drift and *rise* (buoyancy, not
// gravity), rings expand like pressure waves, glints are four-point light
// catches, and beams are shafts of sunlight or bioluminescent surges.

const MOTE_CAPACITY = 1200;
const RING_CAPACITY = 26;
const GLINT_CAPACITY = 14;
const BEAM_CAPACITY = 8;

export type MoteSpec = {
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
  fadeTo: Color | null;
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

type BeamEffect = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  height: number;
};

const motes: MoteParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const beams: BeamEffect[] = [];

let moteMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const DISSOLVE = new Color(0.01, 0.03, 0.045);

export function createEffects(scene: Scene) {
  moteMesh = new InstancedMesh(
    new TetrahedronGeometry(0.12, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    MOTE_CAPACITY,
  );
  moteMesh.count = 0;
  moteMesh.frustumCulled = false;
  scene.add(moteMesh);

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

  // Vertical column: spawn telegraphs and the parent's surges.
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

function pushMote(particle: MoteParticle) {
  if (motes.length >= MOTE_CAPACITY) motes.shift();
  motes.push(particle);
}

// Bioluminescent sparks: they scatter and hang, drifting slowly upward.
export function burstMotes(position: Vector3, color: Color, count: number, speed: number, buoyancy = 2.2) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushMote({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.35 + Math.random() * 0.85)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 5 + Math.random() * 11,
      color: color.clone(),
      fadeTo: null,
      size: 0.35 + Math.random() * 0.5,
      age: 0,
      life: 0.5 + Math.random() * 0.6,
      drag: 1.9,
      buoyancy,
    });
  }
}

// The enemy dissolves into its own pieces, which sink away into the blue.
export function burstShards(position: Vector3, specs: MoteSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushMote({
      position: position.clone().addScaledVector(outward, 0.35),
      velocity: outward
        .clone()
        .multiplyScalar(6 + rng() * 7)
        .add(new Vector3(rng() - 0.5, rng() + 0.4, rng() - 0.5).multiplyScalar(2.4)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 3 + rng() * 7,
      color: spec.color.clone(),
      fadeTo: DISSOLVE.clone(),
      size: 1.1 + spec.size * 2.0,
      age: 0,
      life: 0.9 + rng() * 0.5,
      drag: 1.6,
      buoyancy: -3.4,
    });
  }
}

// Slow-fading wake dropped behind player shots.
export function dropTrail(position: Vector3, color: Color) {
  pushMote({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 2.4,
    color: color.clone(),
    fadeTo: null,
    size: 0.45,
    age: 0,
    life: 0.32,
    drag: 1,
    buoyancy: 0,
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
      scratchScale.setScalar(mote.size * (0.35 + fade * 0.65));
      scratchMatrix.compose(mote.position, mote.rotation, scratchScale);
      moteMesh.setMatrixAt(count, scratchMatrix);
      if (mote.fadeTo) scratchColor.copy(mote.color).lerp(mote.fadeTo, 1 - fade).multiplyScalar(0.3 + fade * 0.7);
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
    glint.group.rotation.z += dt * 2.6;
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
