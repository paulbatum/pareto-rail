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

// Skyhook's particle language: kills throw hard metal sparks and tumbling
// debris that cool from hazard-orange to dead steel; the car and bursts trail
// thin vapour that expands and fades like contrails in the thinning air;
// shockwaves are clean rings; player hits are cold four-point glints.

const SPARK_CAPACITY = 1200;
const RING_CAPACITY = 30;
const GLINT_CAPACITY = 16;
const PUFF_CAPACITY = 90;

export type DebrisSpec = {
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
  gravity: number;
};

type RingEffect = { mesh: Mesh; color: Color; age: number; life: number; fromScale: number; toScale: number };
type GlintEffect = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };
type PuffEffect = { mesh: Mesh; material: MeshBasicMaterial; color: Color; age: number; life: number; fromScale: number; toScale: number };

const sparks: SparkParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const puffs: PuffEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const STEEL_DARK = new Color(0.02, 0.022, 0.028);

export function createEffects(scene: Scene) {
  sparkMesh = new InstancedMesh(
    new TetrahedronGeometry(0.12, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  const ringGeometry = new RingGeometry(0.95, 1, 56);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
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

  const puffGeometry = new PlaneGeometry(1, 1);
  for (let i = 0; i < PUFF_CAPACITY; i += 1) {
    const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide, opacity: 0.5 });
    const mesh = new Mesh(puffGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    puffs.push({ mesh, material, color: new Color(), age: 0, life: -1, fromScale: 1, toScale: 3 });
  }
}

function pushSpark(particle: SparkParticle) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(particle);
}

// Hard metal sparks — fast, bright, arcing under a little gravity.
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, gravity = 7) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushSpark({
      position: position.clone(),
      velocity: direction.normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 9 + Math.random() * 16,
      color: color.clone(),
      coolTo: null,
      size: 0.35 + Math.random() * 0.5,
      age: 0,
      life: 0.32 + Math.random() * 0.4,
      drag: 1.7,
      gravity,
    });
  }
}

// The target flies apart into its own facets, which tumble and cool to steel.
export function burstDebris(position: Vector3, specs: DebrisSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.35),
      velocity: outward.clone().multiplyScalar(6 + rng() * 8).add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(3)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 4 + rng() * 9,
      color: spec.color.clone(),
      coolTo: STEEL_DARK.clone(),
      size: 1.1 + spec.size * 2.2,
      age: 0,
      life: 0.85 + rng() * 0.5,
      drag: 1.8,
      gravity: 9,
    });
  }
}

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

// Soft vapour puff — contrail wisps, cloud break, thin-air breath.
export function spawnPuff(position: Vector3, color: Color, fromScale: number, toScale: number, life: number) {
  const puff = puffs.find((p) => p.life < 0);
  if (!puff) return;
  puff.mesh.position.copy(position);
  puff.mesh.scale.setScalar(fromScale);
  puff.material.color.set(0, 0, 0);
  puff.mesh.visible = true;
  puff.color.copy(color);
  puff.age = 0;
  puff.life = life;
  puff.fromScale = fromScale;
  puff.toScale = toScale;
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

  for (const puff of puffs) {
    if (puff.life < 0) continue;
    puff.age += dt;
    if (puff.age >= puff.life) {
      puff.life = -1;
      puff.mesh.visible = false;
      continue;
    }
    const progress = puff.age / puff.life;
    const eased = 1 - (1 - progress) ** 2;
    puff.mesh.scale.setScalar(puff.fromScale + (puff.toScale - puff.fromScale) * eased);
    puff.mesh.quaternion.copy(camera.quaternion);
    puff.material.color.copy(puff.color).multiplyScalar(Math.sin(progress * Math.PI) * 0.7);
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
  for (const puff of puffs) {
    puff.life = -1;
    puff.mesh.visible = false;
  }
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
