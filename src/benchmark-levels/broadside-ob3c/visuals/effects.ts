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
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { CRIMSON, EMBER, ICE_SHADOW, OBSIDIAN, hdr } from './palette';

// Broadside's particle language is vacuum: nothing falls. Debris leaves on the
// vector it was given and keeps going, sparks cool from white through molten to
// dead as they travel, and shockwaves are perfect expanding rings because there
// is no air to deform them. Wrecks tumble away in a straight line forever.

const SPARK_CAPACITY = 1400;
const RING_CAPACITY = 28;
const GLINT_CAPACITY = 14;
const WRECK_CAPACITY = 5;

export type ShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type SparkParticle = {
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

type WreckEffect = {
  group: Group;
  velocity: Vector3;
  spinAxis: Vector3;
  spin: number;
  age: number;
  life: number;
};

const sparks: SparkParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const wrecks: WreckEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const DEAD_IRON = new Color(0.035, 0.03, 0.04);

export function createEffects(scene: Scene) {
  sparkMesh = new InstancedMesh(
    new TetrahedronGeometry(0.12, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.name = 'fx-sparks';
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  const ringGeometry = new RingGeometry(0.955, 1, 56);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.name = 'fx-ring';
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  // Glints are the four-point star off a hot muzzle or a fresh kill.
  const bladeGeometry = new PlaneGeometry(2.0, 0.04);
  for (let i = 0; i < GLINT_CAPACITY; i += 1) {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    for (const rotation of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
      const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
      const blade = new Mesh(bladeGeometry, material);
      blade.rotation.z = rotation;
      if (rotation === Math.PI / 4 || rotation === -Math.PI / 4) blade.scale.x = 0.45;
      group.add(blade);
      materials.push(material);
    }
    group.name = 'fx-glint';
    group.traverse((child) => { child.name = 'fx-glint'; });
    group.visible = false;
    group.frustumCulled = false;
    scene.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }

  // Wreck pool: a dead hull section, still on its last vector.
  for (let i = 0; i < WRECK_CAPACITY; i += 1) {
    const group = new Group();
    const dark = new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(1.6) });
    const trim = new MeshBasicMaterial({ color: ICE_SHADOW.clone().multiplyScalar(0.5) });
    group.add(new Mesh(new BoxGeometry(1.2, 0.7, 2.4), dark));
    const wing = new Mesh(new BoxGeometry(2.8, 0.14, 0.8), trim);
    wing.position.set(0.2, 0.15, -0.2);
    wing.rotation.z = 0.3;
    group.add(wing);
    const spar = new Mesh(new BoxGeometry(0.28, 1.3, 0.28), dark);
    spar.position.set(-0.4, -0.5, 0.5);
    group.add(spar);
    group.traverse((child) => { child.name = 'fx-wreck'; });
    group.visible = false;
    scene.add(group);
    wrecks.push({ group, velocity: new Vector3(), spinAxis: new Vector3(1, 0, 0), spin: 2, age: 0, life: -1 });
  }
}

function pushSpark(particle: SparkParticle) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(particle);
}

/** Hot sparks: straight lines out of an impact, cooling as they run. */
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, spread = 0.9) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushSpark({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.35 + Math.random() * spread)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 8 + Math.random() * 16,
      color: color.clone(),
      coolTo: null,
      size: 0.34 + Math.random() * 0.42,
      age: 0,
      life: 0.3 + Math.random() * 0.4,
      drag: 0.55,
    });
  }
}

/** The target comes apart into its own plating; the pieces cool to dead iron. */
export function burstShards(position: Vector3, specs: ShardSpec[], scale = 1, rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.35 * scale),
      velocity: outward
        .clone()
        .multiplyScalar((7 + rng() * 9) * scale)
        .add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(3.5)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 3 + rng() * 8,
      color: spec.color.clone(),
      coolTo: DEAD_IRON.clone(),
      size: (1.0 + spec.size * 2.4) * scale,
      age: 0,
      life: 0.8 + rng() * 0.7,
      drag: 0.35,
    });
  }
}

/** Tracer wake dropped behind a shot in flight. */
export function dropTrail(position: Vector3, color: Color, size = 0.42) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 2,
    color: color.clone(),
    coolTo: null,
    size,
    age: 0,
    life: 0.22,
    drag: 0.9,
  });
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
  ring.fromScale = toScale * 0.08;
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

/** A dead hull section leaves the fight on the vector it was hit with. */
export function spawnWreck(position: Vector3, drift: Vector3, scale: number, life = 4) {
  const wreck = wrecks.find((candidate) => candidate.life < 0);
  if (!wreck) return;
  wreck.group.position.copy(position);
  wreck.group.scale.setScalar(scale);
  wreck.group.visible = true;
  wreck.velocity.copy(drift);
  wreck.spinAxis.copy(randomUnit(Math.random));
  wreck.spin = 1.2 + Math.random() * 2.6;
  wreck.age = 0;
  wreck.life = life;
}

/** A capital-ship muzzle: a hot cross plus a shock ring on the gun's own axis. */
export function muzzleFlash(position: Vector3, color: Color, scale: number) {
  spawnGlint(position, hdr(color, 1.8), scale, 0.16);
  spawnRing(position, hdr(color, 1.2), scale * 1.6, 0.3);
  burstSparks(position, hdr(color, 1.1), 4, scale * 5, 0.4);
}

export function updateEffects(dt: number, camera: Camera) {
  if (sparkMesh) {
    let count = 0;
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.age += dt;
      if (spark.age >= spark.life) {
        sparks.splice(i, 1);
        continue;
      }
      // No gravity: vacuum. A little drag only so bursts read as a puff.
      spark.velocity.multiplyScalar(Math.max(0, 1 - spark.drag * dt));
      spark.position.addScaledVector(spark.velocity, dt);
      scratchQuaternion.setFromAxisAngle(spark.axis, spark.spin * dt);
      spark.rotation.premultiply(scratchQuaternion).normalize();

      const fade = 1 - spark.age / spark.life;
      scratchScale.setScalar(spark.size * (0.3 + fade * 0.7));
      scratchMatrix.compose(spark.position, spark.rotation, scratchScale);
      sparkMesh.setMatrixAt(count, scratchMatrix);
      if (spark.coolTo) scratchColor.copy(spark.color).lerp(spark.coolTo, 1 - fade).multiplyScalar(0.25 + fade * 0.75);
      else scratchColor.copy(spark.color).multiplyScalar(fade * fade);
      sparkMesh.setColorAt(count, scratchColor);
      count += 1;
    }
    sparkMesh.count = count;
    sparkMesh.instanceMatrix.needsUpdate = true;
    if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;
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
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }

  for (const wreck of wrecks) {
    if (wreck.life < 0) continue;
    wreck.age += dt;
    if (wreck.age >= wreck.life) {
      wreck.life = -1;
      wreck.group.visible = false;
      continue;
    }
    wreck.group.position.addScaledVector(wreck.velocity, dt);
    scratchQuaternion.setFromAxisAngle(wreck.spinAxis, wreck.spin * dt);
    wreck.group.quaternion.premultiply(scratchQuaternion);
  }
}

export function resetEffects() {
  sparks.length = 0;
  if (sparkMesh) sparkMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
  for (const wreck of wrecks) {
    wreck.life = -1;
    wreck.group.visible = false;
  }
}

/** Standard enemy death: plating outward, embers, one crimson shock ring. */
export function enemyDeath(position: Vector3, specs: ShardSpec[] | undefined, accent: Color, scale = 1) {
  if (specs) burstShards(position, specs, scale);
  burstSparks(position, hdr(EMBER, 1.2), Math.round(9 * scale), 13 * scale);
  spawnRing(position, hdr(accent, 0.95), 4.4 * scale, 0.4);
  spawnGlint(position, hdr(CRIMSON, 1.4), 1.2 * scale, 0.15);
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
