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
import { GUNMETAL, PANEL_SHADOW } from './palette';

// Skyhook's particle language: everything broken FALLS. Sparks streak down
// under heavy gravity, sheared panels tumble away below the frame, and dead
// hulks drop past the camera — the debris field is the climb made visible.

const SPARK_CAPACITY = 1200;
const RING_CAPACITY = 24;
const GLINT_CAPACITY = 12;
const HULK_CAPACITY = 4;

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

type HulkEffect = {
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
const hulks: HulkEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
let effectsScene: Scene | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const COOL_GREY = new Color(0.05, 0.055, 0.06);

export function createEffects(scene: Scene) {
  effectsScene = scene;
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

  // Dead-hulk pool: dark tumbling wrecks that drop past the camera.
  for (let i = 0; i < HULK_CAPACITY; i += 1) {
    const group = new Group();
    const dark = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(0.5) });
    const mid = new MeshBasicMaterial({ color: PANEL_SHADOW.clone().multiplyScalar(0.5) });
    group.add(new Mesh(new BoxGeometry(1, 0.6, 1.6), dark));
    const wing = new Mesh(new BoxGeometry(2.2, 0.16, 0.7), mid);
    wing.position.y = 0.2;
    group.add(wing);
    const tail = new Mesh(new BoxGeometry(0.3, 1.1, 0.3), dark);
    tail.position.set(0.3, -0.5, 0);
    group.add(tail);
    group.visible = false;
    scene.add(group);
    hulks.push({ group, velocity: new Vector3(), spinAxis: new Vector3(1, 0, 0), spin: 2, age: 0, life: -1 });
  }
}

function pushSpark(particle: SparkParticle) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(particle);
}

// Hot sparks: fast, bright, and immediately falling — the sky owns them.
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, gravity = 16) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushSpark({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 9 + Math.random() * 14,
      color: color.clone(),
      coolTo: null,
      size: 0.38 + Math.random() * 0.45,
      age: 0,
      life: 0.32 + Math.random() * 0.38,
      drag: 1.4,
      gravity,
    });
  }
}

// The target decompresses into its own paneling; pieces cool to dead grey as
// they drop away below the frame.
export function burstShards(position: Vector3, specs: ShardSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.3),
      velocity: outward
        .clone()
        .multiplyScalar(6 + rng() * 8)
        .add(new Vector3(rng() - 0.5, rng() - 0.8, rng() - 0.5).multiplyScalar(3)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 4 + rng() * 9,
      color: spec.color.clone(),
      coolTo: COOL_GREY.clone(),
      size: 1.1 + spec.size * 2.1,
      age: 0,
      life: 0.75 + rng() * 0.5,
      drag: 1.5,
      gravity: 22,
    });
  }
}

// Tracer wake dropped behind shots.
export function dropTrail(position: Vector3, color: Color) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 3,
    color: color.clone(),
    coolTo: null,
    size: 0.45,
    age: 0,
    life: 0.24,
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

// A dead machine drops out of the fight, tumbling past the car.
export function spawnFallingHulk(position: Vector3, scale: number, sideways: number) {
  const hulk = hulks.find((h) => h.life < 0);
  if (!hulk) return;
  hulk.group.position.copy(position);
  hulk.group.scale.setScalar(scale);
  hulk.group.visible = true;
  hulk.velocity.set(sideways, 2 + Math.random() * 2, 0);
  hulk.spinAxis.copy(randomUnit(Math.random));
  hulk.spin = 1.5 + Math.random() * 2.5;
  hulk.age = 0;
  hulk.life = 3;
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
      // Additive fades to invisible at black; shards cool to dead grey first.
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

  for (const hulk of hulks) {
    if (hulk.life < 0) continue;
    hulk.age += dt;
    if (hulk.age >= hulk.life) {
      hulk.life = -1;
      hulk.group.visible = false;
      continue;
    }
    hulk.velocity.y -= 32 * dt;
    hulk.group.position.addScaledVector(hulk.velocity, dt);
    scratchQuaternion.setFromAxisAngle(hulk.spinAxis, hulk.spin * dt);
    hulk.group.quaternion.premultiply(scratchQuaternion);
  }
  void effectsScene;
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
  for (const hulk of hulks) {
    hulk.life = -1;
    hulk.group.visible = false;
  }
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
