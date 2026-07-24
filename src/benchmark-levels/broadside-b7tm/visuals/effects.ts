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
import { OBSIDIAN_EDGE } from './palette';

// BROADSIDE's particle language is vacuum: nothing falls. Debris keeps the
// velocity it was given and tumbles forever, so a kill leaves a expanding shell
// of glowing plate rather than a shower. The signature effect is the tracer —
// a kilometre-long bolt of light crossing the frame between two capital ships,
// fired on the beat.

const SPARK_CAPACITY = 1400;
const RING_CAPACITY = 30;
const GLINT_CAPACITY = 14;
const HULK_CAPACITY = 6;
const TRACER_CAPACITY = 56;
const FLARE_CAPACITY = 26;

export type ShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type SparkParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  spin: number;
  color: Color;
  coolTo: Color | null;
  size: number;
  age: number;
  life: number;
  drag: number;
};

type RingEffect = { mesh: Mesh; color: Color; age: number; life: number; fromScale: number; toScale: number; billboard: boolean };
type GlintEffect = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };
type HulkEffect = { group: Group; velocity: Vector3; spinAxis: Vector3; spin: number; age: number; life: number };
type TracerEffect = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  from: Vector3;
  direction: Vector3;
  color: Color;
  length: number;
  speed: number;
  distance: number;
  travelled: number;
  age: number;
  life: number;
};
type FlareEffect = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };

const sparks: SparkParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const hulks: HulkEffect[] = [];
const tracers: TracerEffect[] = [];
const flares: FlareEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const scratchVector = new Vector3();
const COOL_DARK = new Color(0.04, 0.03, 0.05);

export function createEffects(scene: Scene) {
  const root = new Group();
  // Every pool here is light, not matter: it must never count as an occluder.
  root.userData.raildIgnoreOcclusion = true;
  scene.add(root);

  sparkMesh = new InstancedMesh(
    new TetrahedronGeometry(0.16, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  root.add(sparkMesh);

  const ringGeometry = new RingGeometry(0.95, 1, 44);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    root.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1, billboard: true });
  }

  const bladeGeometry = new PlaneGeometry(1.8, 0.045);
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
    root.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }

  for (let i = 0; i < HULK_CAPACITY; i += 1) {
    const group = new Group();
    const dark = new MeshBasicMaterial({ color: OBSIDIAN_EDGE.clone().multiplyScalar(0.6) });
    group.add(new Mesh(new BoxGeometry(1.1, 0.7, 2.0), dark));
    const wing = new Mesh(new BoxGeometry(2.6, 0.14, 0.8), dark);
    wing.position.y = 0.15;
    group.add(wing);
    const fin = new Mesh(new BoxGeometry(0.24, 1.0, 0.5), dark);
    fin.position.set(0.2, -0.5, 0.5);
    group.add(fin);
    group.visible = false;
    root.add(group);
    hulks.push({ group, velocity: new Vector3(), spinAxis: new Vector3(1, 0, 0), spin: 2, age: 0, life: -1 });
  }

  // Tracer bolts: a unit box stretched along local Z, so one geometry serves
  // every calibre from point-defence to a cruiser's main battery.
  const boltGeometry = new BoxGeometry(1, 1, 1);
  for (let i = 0; i < TRACER_CAPACITY; i += 1) {
    const material = createAdditiveBasicMaterial({ color: 0x000000 });
    const mesh = new Mesh(boltGeometry, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    root.add(mesh);
    tracers.push({
      mesh,
      material,
      from: new Vector3(),
      direction: new Vector3(0, 0, -1),
      color: new Color(),
      length: 20,
      speed: 400,
      distance: 100,
      travelled: 0,
      age: 0,
      life: -1,
    });
  }

  const flareDisc = new PlaneGeometry(1, 1);
  for (let i = 0; i < FLARE_CAPACITY; i += 1) {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    for (const [w, h, rotation] of [[1, 1, 0], [2.6, 0.18, 0], [0.18, 2.6, 0]] as const) {
      const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
      const plane = new Mesh(flareDisc, material);
      plane.scale.set(w, h, 1);
      plane.rotation.z = rotation;
      group.add(plane);
      materials.push(material);
    }
    group.visible = false;
    root.add(group);
    flares.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }
}

function pushSpark(particle: SparkParticle) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(particle);
}

/** Hot debris in vacuum: it keeps going, cooling as it tumbles. */
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, life = 0.6) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushSpark({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.35 + Math.random() * 1.0)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 6 + Math.random() * 16,
      color: color.clone(),
      coolTo: null,
      size: 0.42 + Math.random() * 0.5,
      age: 0,
      life: life * (0.7 + Math.random() * 0.6),
      drag: 0.25,
    });
  }
}

/** A killed hull decompresses into its own plating, which cools to dead black. */
export function burstShards(position: Vector3, specs: ShardSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.4),
      velocity: outward
        .clone()
        .multiplyScalar(7 + rng() * 11)
        .add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(4)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 3 + rng() * 8,
      color: spec.color.clone(),
      coolTo: COOL_DARK.clone(),
      size: 1.2 + spec.size * 2.4,
      age: 0,
      life: 0.9 + rng() * 0.7,
      drag: 0.3,
    });
  }
}

export function dropTrail(position: Vector3, color: Color) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 2,
    color: color.clone(),
    coolTo: null,
    size: 0.5,
    age: 0,
    life: 0.26,
    drag: 0.4,
  });
}

export function spawnRing(position: Vector3, color: Color, toScale: number, life: number, billboard = true, orientation?: Quaternion) {
  const ring = rings.find((candidate) => candidate.life < 0);
  if (!ring) return;
  ring.mesh.position.copy(position);
  ring.mesh.scale.setScalar(0.01);
  (ring.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  ring.mesh.visible = true;
  ring.billboard = billboard;
  if (!billboard && orientation) ring.mesh.quaternion.copy(orientation);
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
  for (const material of glint.materials) material.color.set(0, 0, 0);
  glint.group.visible = true;
  glint.color.copy(color);
  glint.age = 0;
  glint.life = life;
  glint.scale = scale;
}

/** Muzzle flash / hull impact bloom: a disc with a four-point star. */
export function spawnFlare(position: Vector3, color: Color, scale: number, life = 0.3) {
  const flare = flares.find((candidate) => candidate.life < 0);
  if (!flare) return;
  flare.group.position.copy(position);
  flare.group.scale.setScalar(0.01);
  for (const material of flare.materials) material.color.set(0, 0, 0);
  flare.group.visible = true;
  flare.color.copy(color);
  flare.age = 0;
  flare.life = life;
  flare.scale = scale;
}

export function spawnHulk(position: Vector3, scale: number, drift: Vector3) {
  const hulk = hulks.find((candidate) => candidate.life < 0);
  if (!hulk) return;
  hulk.group.position.copy(position);
  hulk.group.scale.setScalar(scale);
  hulk.group.visible = true;
  hulk.velocity.copy(drift);
  hulk.spinAxis.copy(randomUnit(Math.random));
  hulk.spin = 1.2 + Math.random() * 2.4;
  hulk.age = 0;
  hulk.life = 3.4;
}

/** The level's signature: a bolt of light crossing the battle between hulls. */
export function spawnTracer(from: Vector3, to: Vector3, color: Color, options: { length?: number; speed?: number; width?: number } = {}) {
  const tracer = tracers.find((candidate) => candidate.life < 0);
  if (!tracer) return;
  scratchVector.copy(to).sub(from);
  const distance = scratchVector.length();
  if (distance < 0.001) return;
  tracer.direction.copy(scratchVector).multiplyScalar(1 / distance);
  tracer.from.copy(from);
  tracer.distance = distance;
  tracer.length = options.length ?? Math.min(180, distance * 0.35);
  tracer.speed = options.speed ?? 900;
  tracer.travelled = 0;
  tracer.age = 0;
  tracer.life = distance / tracer.speed + 0.12;
  tracer.color.copy(color);
  const width = options.width ?? 1.1;
  tracer.mesh.scale.set(width, width, tracer.length);
  tracer.mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), tracer.direction);
  tracer.mesh.position.copy(from);
  tracer.mesh.visible = true;
  tracer.material.color.copy(color);
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
      spark.velocity.multiplyScalar(Math.max(0, 1 - spark.drag * dt));
      spark.position.addScaledVector(spark.velocity, dt);
      scratchQuaternion.setFromAxisAngle(spark.axis, spark.spin * dt);
      spark.rotation.premultiply(scratchQuaternion).normalize();

      const fade = 1 - spark.age / spark.life;
      scratchScale.setScalar(spark.size * (0.4 + fade * 0.6));
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
    if (ring.billboard) ring.mesh.quaternion.copy(camera.quaternion);
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

  for (const flare of flares) {
    if (flare.life < 0) continue;
    flare.age += dt;
    if (flare.age >= flare.life) {
      flare.life = -1;
      flare.group.visible = false;
      continue;
    }
    const progress = flare.age / flare.life;
    const envelope = (1 - progress) ** 1.7;
    flare.group.scale.setScalar(Math.max(0.01, flare.scale * (0.5 + progress * 0.9)));
    flare.group.quaternion.copy(camera.quaternion);
    for (const material of flare.materials) material.color.copy(flare.color).multiplyScalar(envelope);
  }

  for (const hulk of hulks) {
    if (hulk.life < 0) continue;
    hulk.age += dt;
    if (hulk.age >= hulk.life) {
      hulk.life = -1;
      hulk.group.visible = false;
      continue;
    }
    hulk.group.position.addScaledVector(hulk.velocity, dt);
    scratchQuaternion.setFromAxisAngle(hulk.spinAxis, hulk.spin * dt);
    hulk.group.quaternion.premultiply(scratchQuaternion);
  }

  for (const tracer of tracers) {
    if (tracer.life < 0) continue;
    tracer.age += dt;
    tracer.travelled += tracer.speed * dt;
    if (tracer.age >= tracer.life || tracer.travelled > tracer.distance + tracer.length) {
      tracer.life = -1;
      tracer.mesh.visible = false;
      continue;
    }
    tracer.mesh.position
      .copy(tracer.from)
      .addScaledVector(tracer.direction, Math.min(tracer.travelled, tracer.distance) - tracer.length * 0.5);
    const fade = 1 - Math.max(0, tracer.travelled - tracer.distance) / Math.max(1, tracer.length);
    tracer.material.color.copy(tracer.color).multiplyScalar(Math.max(0, fade));
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
  for (const flare of flares) {
    flare.life = -1;
    flare.group.visible = false;
  }
  for (const hulk of hulks) {
    hulk.life = -1;
    hulk.group.visible = false;
  }
  for (const tracer of tracers) {
    tracer.life = -1;
    tracer.mesh.visible = false;
  }
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
