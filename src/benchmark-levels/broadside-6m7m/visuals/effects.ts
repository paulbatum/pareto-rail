import {
  Camera,
  CircleGeometry,
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

// Vacuum particle language: sparks fly straight (nothing pulls them down),
// hull shards tumble and cool from molten to black, shockwaves are thin
// rings, explosions are soft discs that bloom and die, and player-side
// impacts are four-point cyan glints.

const SPARK_CAPACITY = 1600;
const RING_CAPACITY = 32;
const FLASH_CAPACITY = 40;
const GLINT_CAPACITY = 16;

export type ShardSpec = { direction: Vector3; color: Color; size: number };

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
};

type RingEffect = { mesh: Mesh; color: Color; age: number; life: number; fromScale: number; toScale: number };
type FlashEffect = { mesh: Mesh; color: Color; age: number; life: number; scale: number };
type GlintEffect = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };

const sparks: Spark[] = [];
const rings: RingEffect[] = [];
const flashes: FlashEffect[] = [];
const glints: GlintEffect[] = [];
let sparkMesh: InstancedMesh | null = null;
let root: Group | null = null;

const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const SHARD_DARK = new Color(0.02, 0.014, 0.02);

export function createEffects(scene: Scene) {
  disposeEffects();
  root = new Group();
  root.userData.raildIgnoreOcclusion = true;

  sparkMesh = new InstancedMesh(new TetrahedronGeometry(0.13, 0), createAdditiveBasicMaterial({ color: 0xffffff }), SPARK_CAPACITY);
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  root.add(sparkMesh);

  const ringGeometry = new RingGeometry(0.95, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    root.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  const flashGeometry = new CircleGeometry(1, 24);
  for (let i = 0; i < FLASH_CAPACITY; i += 1) {
    const mesh = new Mesh(flashGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    root.add(mesh);
    flashes.push({ mesh, color: new Color(), age: 0, life: -1, scale: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.8, 0.05);
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

  scene.add(root);
}

export function disposeEffects() {
  if (root) {
    root.removeFromParent();
    root.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
    });
  }
  root = null;
  sparkMesh = null;
  sparks.length = 0;
  rings.length = 0;
  flashes.length = 0;
  glints.length = 0;
}

function pushSpark(spark: Spark) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(spark);
}

/** Hot sparks flying straight out in vacuum. */
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, life = 0.5, bias?: Vector3) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    if (bias) direction.addScaledVector(bias, 0.8).normalize();
    pushSpark({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.35 + Math.random() * 0.9)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 8 + Math.random() * 14,
      color: color.clone(),
      coolTo: null,
      size: 0.35 + Math.random() * 0.5,
      age: 0,
      life: life * (0.6 + Math.random() * 0.7),
      drag: 0.9,
    });
  }
}

/** The target comes apart into its own plates, which tumble and cool to black. */
export function burstShards(position: Vector3, specs: ShardSpec[], speed = 8) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.3),
      velocity: outward.multiplyScalar(speed * (0.7 + Math.random() * 0.8)).add(randomUnit(Math.random).multiplyScalar(2)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 3 + Math.random() * 8,
      color: spec.color.clone(),
      coolTo: SHARD_DARK.clone(),
      size: 1 + spec.size * 2,
      age: 0,
      life: 0.9 + Math.random() * 0.6,
      drag: 0.6,
    });
  }
}

/** Cold trail dropped behind player shots and hot trail behind hostile bolts. */
export function dropTrail(position: Vector3, color: Color, size = 0.45) {
  pushSpark({
    position: position.clone(),
    velocity: randomUnit(Math.random).multiplyScalar(0.6),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 2,
    color: color.clone(),
    coolTo: null,
    size,
    age: 0,
    life: 0.24,
    drag: 0.5,
  });
}

export function spawnRing(position: Vector3, color: Color, toScale: number, life: number) {
  const ring = rings.find((item) => item.life < 0);
  if (!ring) return;
  ring.mesh.position.copy(position);
  ring.mesh.scale.setScalar(0.01);
  (ring.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  ring.mesh.visible = true;
  ring.color.copy(color);
  ring.age = 0;
  ring.life = life;
  ring.fromScale = toScale * 0.1;
  ring.toScale = toScale;
}

/** A soft explosion disc: pops to full size fast, then fades. */
export function spawnFlash(position: Vector3, color: Color, scale: number, life: number) {
  const flash = flashes.find((item) => item.life < 0);
  if (!flash) return;
  flash.mesh.position.copy(position);
  flash.mesh.scale.setScalar(0.01);
  (flash.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  flash.mesh.visible = true;
  flash.color.copy(color);
  flash.age = 0;
  flash.life = life;
  flash.scale = scale;
}

export function spawnGlint(position: Vector3, color: Color, scale = 1, life = 0.18) {
  const glint = glints.find((item) => item.life < 0);
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

  for (const flash of flashes) {
    if (flash.life < 0) continue;
    flash.age += dt;
    if (flash.age >= flash.life) {
      flash.life = -1;
      flash.mesh.visible = false;
      continue;
    }
    const progress = flash.age / flash.life;
    const pop = Math.min(1, progress * 6);
    const fade = (1 - progress) ** 1.8;
    flash.mesh.scale.setScalar(Math.max(0.01, flash.scale * (0.4 + 0.6 * pop) * (0.6 + 0.4 * (1 - progress))));
    flash.mesh.quaternion.copy(camera.quaternion);
    (flash.mesh.material as MeshBasicMaterial).color.copy(flash.color).multiplyScalar(fade * pop);
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
    glint.group.rotation.z += dt * 2.5;
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }
}

export function resetEffects() {
  sparks.length = 0;
  if (sparkMesh) sparkMesh.count = 0;
  for (const ring of rings) { ring.life = -1; ring.mesh.visible = false; }
  for (const flash of flashes) { flash.life = -1; flash.mesh.visible = false; }
  for (const glint of glints) { glint.life = -1; glint.group.visible = false; }
}

export function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
