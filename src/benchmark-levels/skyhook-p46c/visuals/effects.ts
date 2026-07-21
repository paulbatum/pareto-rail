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
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { CLIMB_AXIS } from '../gameplay';

// Skyhook particle language: sparks are shredded metal that FALLS — gravity is
// down the climb axis, so every kill sheds debris that streaks away below the
// car, feeding the "world falling away" read. Shockwaves are thin rings,
// player impacts are small cross glints, and cloud hits puff vapor wisps.

const SPARK_CAPACITY = 1200;
const RING_CAPACITY = 24;
const GLINT_CAPACITY = 14;
const WISP_CAPACITY = 30;

export type ShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type Spark = {
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
  fall: number;
};

type RingEffect = { mesh: Mesh; color: Color; age: number; life: number; fromScale: number; toScale: number };
type GlintEffect = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };
type WispEffect = { mesh: Mesh; color: Color; age: number; life: number; scale: number; drift: Vector3 };

const sparks: Spark[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const wisps: WispEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const COOL_DARK = new Color(0.015, 0.016, 0.02);

export function createEffects(scene: Scene) {
  sparkMesh = new InstancedMesh(
    new TetrahedronGeometry(0.12, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  sparkMesh.raycast = () => undefined;
  scene.add(sparkMesh);

  const ringGeometry = new RingGeometry(0.96, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    mesh.raycast = () => undefined;
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
      blade.raycast = () => undefined;
      group.add(blade);
      materials.push(material);
    }
    group.visible = false;
    scene.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }

  const wispGeometry = new PlaneGeometry(1, 1);
  for (let i = 0; i < WISP_CAPACITY; i += 1) {
    const mesh = new Mesh(wispGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide, opacity: 0.5 }));
    mesh.visible = false;
    mesh.raycast = () => undefined;
    scene.add(mesh);
    wisps.push({ mesh, color: new Color(), age: 0, life: -1, scale: 1, drift: new Vector3() });
  }
}

function pushSpark(particle: Spark) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(particle);
}

/** Fast bright metal chips. `fall` is acceleration down the climb axis — pass ~10 in air, ~2 in vacuum. */
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, fall = 10) {
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
      size: 0.4 + Math.random() * 0.5,
      age: 0,
      life: 0.35 + Math.random() * 0.4,
      drag: 1.5,
      fall,
    });
  }
}

/** The target breaks into its own panels; pieces cool dark as they drop away below. */
export function burstShards(position: Vector3, specs: ShardSpec[], fall = 14, rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.35),
      velocity: outward
        .clone()
        .multiplyScalar(6 + rng() * 8)
        .add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(3)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 4 + rng() * 9,
      color: spec.color.clone(),
      coolTo: COOL_DARK.clone(),
      size: 1.1 + spec.size * 2.1,
      age: 0,
      life: 0.9 + rng() * 0.6,
      drag: 1.3,
      fall,
    });
  }
}

/** Short cold streak dropped behind player shots. */
export function dropTrail(position: Vector3, color: Color) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 3,
    color: color.clone(),
    coolTo: null,
    size: 0.5,
    age: 0,
    life: 0.24,
    drag: 1,
    fall: 0,
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

/** Soft vapor puff — cloud hits, kite kills in the weather, the deck punch. */
export function spawnWisp(position: Vector3, color: Color, scale: number, life: number, drift?: Vector3) {
  const wisp = wisps.find((w) => w.life < 0);
  if (!wisp) return;
  wisp.mesh.position.copy(position);
  wisp.mesh.scale.setScalar(0.01);
  (wisp.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  wisp.mesh.visible = true;
  wisp.color.copy(color);
  wisp.age = 0;
  wisp.life = life;
  wisp.scale = scale;
  wisp.drift.copy(drift ?? new Vector3().copy(CLIMB_AXIS).multiplyScalar(-6));
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
      spark.velocity.addScaledVector(CLIMB_AXIS, -spark.fall * dt);
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
    glint.group.rotation.z += dt * 3;
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }

  for (const wisp of wisps) {
    if (wisp.life < 0) continue;
    wisp.age += dt;
    if (wisp.age >= wisp.life) {
      wisp.life = -1;
      wisp.mesh.visible = false;
      continue;
    }
    const progress = wisp.age / wisp.life;
    wisp.mesh.position.addScaledVector(wisp.drift, dt);
    wisp.mesh.scale.setScalar(wisp.scale * (0.35 + progress * 0.65));
    wisp.mesh.quaternion.copy(camera.quaternion);
    (wisp.mesh.material as MeshBasicMaterial).color.copy(wisp.color).multiplyScalar(Math.sin(Math.min(1, progress * 1.2) * Math.PI) * 0.5);
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
  for (const wisp of wisps) {
    wisp.life = -1;
    wisp.mesh.visible = false;
  }
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
