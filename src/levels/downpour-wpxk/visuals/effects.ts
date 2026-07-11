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
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { INK } from './palette';

// Rain-world particle language: electric sparks arc down and die fast, kill
// debris is slapped down by the rain and cools to wet black, shockwaves are
// thin rings, player-side impacts are cold cross-blade glints, vertical beams
// stab up as searchlight/signage flares, and low deaths over the flooded canal
// throw a flat horizontal ripple.

const SPARK_CAPACITY = 1400;
const RING_CAPACITY = 28;
const GLINT_CAPACITY = 14;
const BEAM_CAPACITY = 10;
const SPLASH_CAPACITY = 16;

export type DebrisSpec = {
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

type BeamEffect = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  height: number;
};

type SplashEffect = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  toScale: number;
};

const sparks: SparkParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const beams: BeamEffect[] = [];
const splashes: SplashEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
// Debris cools to wet ink-black as the rain drags it down.
const WET_DARK = INK.clone().multiplyScalar(0.6);

export function createEffects(scene: Scene) {
  sparkMesh = new InstancedMesh(
    new TetrahedronGeometry(0.12, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

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

  // Vertical light column: searchlight stabs and signage flares.
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

  // Flat ripple ring that lies in the XZ plane (not camera-facing) for deaths
  // low over the flooded canal.
  const splashGeometry = new RingGeometry(0.9, 1, 48);
  for (let i = 0; i < SPLASH_CAPACITY; i += 1) {
    const mesh = new Mesh(
      splashGeometry,
      createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2; // lie flat on the water
    mesh.visible = false;
    scene.add(mesh);
    splashes.push({ mesh, color: new Color(), age: 0, life: -1, toScale: 1 });
  }
}

function pushSpark(particle: SparkParticle) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(particle);
}

// Electric sparks: fast, bright, arcing down under gravity with a slight
// downward bias — rain slaps them out of the air quickly.
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, gravity = 11) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    direction.y = direction.y * 0.5 - 0.15; // slight downward bias
    pushSpark({
      position: position.clone(),
      velocity: direction.normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 9 + Math.random() * 15,
      color: color.clone(),
      coolTo: null,
      size: 0.4 + Math.random() * 0.5,
      age: 0,
      life: 0.3 + Math.random() * 0.35,
      drag: 1.8,
      gravity,
    });
  }
}

// The enemy shatters into its own facets; the rain drags the chunks down hard
// and they cool from their color to wet black as they fall.
export function burstDebris(position: Vector3, specs: DebrisSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.35),
      velocity: outward
        .clone()
        .multiplyScalar(6 + rng() * 7)
        .add(new Vector3(rng() - 0.5, rng() * 0.6 - 0.1, rng() - 0.5).multiplyScalar(3)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 4 + rng() * 9,
      color: spec.color.clone(),
      coolTo: WET_DARK.clone(),
      size: 1.2 + spec.size * 2.2,
      age: 0,
      life: 0.75 + rng() * 0.5,
      drag: 1.7,
      gravity: 17,
    });
  }
}

// Cold, short-lived streak puff dropped behind player shots.
export function dropTrail(position: Vector3, color: Color) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 1, (Math.random() - 0.5) * 1, (Math.random() - 0.5) * 1),
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

// Flat horizontal ripple over the water — expands in the XZ plane.
export function spawnSplash(position: Vector3, color: Color, life = 0.5) {
  const splash = splashes.find((s) => s.life < 0);
  if (!splash) return;
  splash.mesh.position.copy(position);
  splash.mesh.scale.setScalar(0.01);
  (splash.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  splash.mesh.visible = true;
  splash.color.copy(color);
  splash.age = 0;
  splash.life = life;
  splash.toScale = 3 + Math.random() * 2;
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
      spark.velocity.y -= spark.gravity * dt;
      spark.velocity.multiplyScalar(Math.max(0, 1 - spark.drag * dt));
      spark.position.addScaledVector(spark.velocity, dt);
      scratchQuaternion.setFromAxisAngle(spark.axis, spark.spin * dt);
      spark.rotation.premultiply(scratchQuaternion).normalize();

      const fade = 1 - spark.age / spark.life;
      scratchScale.setScalar(spark.size * (0.35 + fade * 0.65));
      scratchMatrix.compose(spark.position, spark.rotation, scratchScale);
      sparkMesh.setMatrixAt(count, scratchMatrix);
      // Additive blending fades to invisible at black; debris cools through its
      // color toward wet ink on the way there.
      if (spark.coolTo) scratchColor.copy(spark.color).lerp(spark.coolTo, 1 - fade).multiplyScalar(0.3 + fade * 0.7);
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

  for (const splash of splashes) {
    if (splash.life < 0) continue;
    splash.age += dt;
    if (splash.age >= splash.life) {
      splash.life = -1;
      splash.mesh.visible = false;
      continue;
    }
    const progress = splash.age / splash.life;
    const eased = 1 - (1 - progress) * (1 - progress);
    // Stays flat on the water (rotation.x fixed at -PI/2); only scales outward.
    splash.mesh.scale.setScalar(0.2 + splash.toScale * eased);
    (splash.mesh.material as MeshBasicMaterial).color.copy(splash.color).multiplyScalar((1 - progress) ** 1.5);
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
  for (const beam of beams) {
    beam.life = -1;
    beam.mesh.visible = false;
  }
  for (const splash of splashes) {
    splash.life = -1;
    splash.mesh.visible = false;
  }
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
