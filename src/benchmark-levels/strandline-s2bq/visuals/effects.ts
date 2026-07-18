import {
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
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { PARASITE_MURK, PARASITE_VIOLET } from './palette';

// Strandline's particle language: nothing falls — everything DRIFTS. Sparks
// bloom outward and hang, braked hard by the water; burst parasites leave a
// violet ink cloud that slowly thins; dead husks sink, tumbling, out of the
// sunlight. The debris field is the water made visible.

const SPARK_CAPACITY = 1000;
const RING_CAPACITY = 24;
const GLINT_CAPACITY = 12;
const INK_CAPACITY = 20;
const HUSK_CAPACITY = 5;

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
  buoyancy: number; // +up per second — bubbles rise, husk-flecks sink
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
  fromScale: number;
  toScale: number;
  opacity: number;
};

type HuskEffect = {
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
const inks: InkEffect[] = [];
const husks: HuskEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const COOL_MURK = new Color(0.04, 0.05, 0.07);

export function createEffects(scene: Scene) {
  sparkMesh = new InstancedMesh(
    new TetrahedronGeometry(0.11, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  const ringGeometry = new RingGeometry(0.96, 1, 48);
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

  // Ink pool: soft dark billboards that expand and thin — a parasite's last
  // stain on the clean water. Normal blending; the murk must darken.
  const inkGeometry = new PlaneGeometry(1, 1);
  for (let i = 0; i < INK_CAPACITY; i += 1) {
    const material = new MeshBasicMaterial({
      color: PARASITE_MURK.clone(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(inkGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    inks.push({ mesh, material, age: 0, life: -1, fromScale: 1, toScale: 3, opacity: 0.5 });
  }

  // Husk pool: dead parasites sink out of the light, tumbling.
  for (let i = 0; i < HUSK_CAPACITY; i += 1) {
    const group = new Group();
    const dark = new MeshBasicMaterial({ color: PARASITE_MURK.clone().multiplyScalar(1.6) });
    const dim = new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(0.16) });
    const body = new Mesh(new SphereGeometry(0.5, 8, 6), dark);
    body.scale.set(1, 0.7, 1.3);
    group.add(body);
    for (const side of [-1, 1]) {
      const hook = new Mesh(new TetrahedronGeometry(0.3, 0), dim);
      hook.position.set(side * 0.55, -0.15, 0.2);
      group.add(hook);
    }
    group.visible = false;
    scene.add(group);
    husks.push({ group, velocity: new Vector3(), spinAxis: new Vector3(1, 0, 0), spin: 2, age: 0, life: -1 });
  }
}

function pushSpark(particle: SparkParticle) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(particle);
}

// Motes of light shed into the water: quick bloom, then the water brakes
// them to a hang and they gutter out in place.
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, buoyancy = 1.6) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushSpark({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 6 + Math.random() * 10,
      color: color.clone(),
      coolTo: null,
      size: 0.36 + Math.random() * 0.42,
      age: 0,
      life: 0.5 + Math.random() * 0.5,
      drag: 3.2,
      buoyancy,
    });
  }
}

// The target comes apart into its own plates; pieces cool to murk and drift
// down and away — parasite matter does not float.
export function burstShards(position: Vector3, specs: ShardSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.3),
      velocity: outward
        .clone()
        .multiplyScalar(5 + rng() * 7)
        .add(new Vector3(rng() - 0.5, rng() - 0.6, rng() - 0.5).multiplyScalar(2.4)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 3 + rng() * 7,
      color: spec.color.clone(),
      coolTo: COOL_MURK.clone(),
      size: 1.0 + spec.size * 2.0,
      age: 0,
      life: 0.9 + rng() * 0.6,
      drag: 2.6,
      buoyancy: -3.2,
    });
  }
}

// Soft wake dropped behind shots — a thread of sunlight through the water.
export function dropTrail(position: Vector3, color: Color) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6 + 0.4, (Math.random() - 0.5) * 0.6),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 3,
    color: color.clone(),
    coolTo: null,
    size: 0.42,
    age: 0,
    life: 0.3,
    drag: 2,
    buoyancy: 0.8,
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

export function spawnInk(position: Vector3, scale: number, life = 1.6, opacity = 0.5) {
  const ink = inks.find((i) => i.life < 0);
  if (!ink) return;
  ink.mesh.position.copy(position);
  ink.mesh.scale.setScalar(scale * 0.4);
  ink.mesh.rotation.z = Math.random() * Math.PI * 2;
  ink.mesh.visible = true;
  ink.age = 0;
  ink.life = life;
  ink.fromScale = scale * 0.4;
  ink.toScale = scale;
  ink.opacity = opacity;
}

// A dead parasite lets go and sinks out of the sunlight.
export function spawnSinkingHusk(position: Vector3, scale: number, sideways: number) {
  const husk = husks.find((h) => h.life < 0);
  if (!husk) return;
  husk.group.position.copy(position);
  husk.group.scale.setScalar(scale);
  husk.group.visible = true;
  husk.velocity.set(sideways, -1.5 - Math.random() * 1.5, 0);
  husk.spinAxis.copy(randomUnit(Math.random));
  husk.spin = 0.8 + Math.random() * 1.6;
  husk.age = 0;
  husk.life = 4;
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
      spark.velocity.y += spark.buoyancy * dt;
      spark.velocity.multiplyScalar(Math.max(0, 1 - spark.drag * dt));
      spark.position.addScaledVector(spark.velocity, dt);
      scratchQuaternion.setFromAxisAngle(spark.axis, spark.spin * dt);
      spark.rotation.premultiply(scratchQuaternion).normalize();

      const fade = 1 - spark.age / spark.life;
      scratchScale.setScalar(spark.size * (0.35 + fade * 0.65));
      scratchMatrix.compose(spark.position, spark.rotation, scratchScale);
      sparkMesh.setMatrixAt(count, scratchMatrix);
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
    glint.group.rotation.z += dt * 2.2;
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
    ink.mesh.scale.setScalar(ink.fromScale + (ink.toScale - ink.fromScale) * (1 - (1 - progress) ** 2));
    ink.mesh.quaternion.copy(camera.quaternion);
    ink.mesh.rotation.z += dt * 0.3;
    ink.mesh.position.y -= dt * 0.5;
    ink.material.opacity = ink.opacity * Math.sin(Math.min(1, progress * 1.25) * Math.PI);
  }

  for (const husk of husks) {
    if (husk.life < 0) continue;
    husk.age += dt;
    if (husk.age >= husk.life) {
      husk.life = -1;
      husk.group.visible = false;
      continue;
    }
    husk.velocity.y -= 2.4 * dt;
    husk.velocity.multiplyScalar(Math.max(0, 1 - 0.5 * dt));
    husk.group.position.addScaledVector(husk.velocity, dt);
    scratchQuaternion.setFromAxisAngle(husk.spinAxis, husk.spin * dt);
    husk.group.quaternion.premultiply(scratchQuaternion);
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
