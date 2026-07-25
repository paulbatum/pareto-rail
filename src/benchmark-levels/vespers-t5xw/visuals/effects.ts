import {
  Camera,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';

// Leaf: transient effect pools. Sparks are hot additive motes; light streams
// carry a kill's colour home to its window along an arcing path; ash is the
// one NORMAL-blended pool — the dark counterpart for misses and gloom.

const SPARK_CAPACITY = 900;
const ASH_CAPACITY = 220;
const RING_CAPACITY = 20;
const GLINT_CAPACITY = 10;

type SparkParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // unit length: feeds setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
};

type StreamParticle = {
  from: Vector3;
  control: Vector3;
  to: Vector3;
  color: Color;
  delay: number;
  travel: number;
  age: number;
  size: number;
};

type AshParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  spin: number;
  size: number;
  age: number;
  life: number;
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

const sparks: SparkParticle[] = [];
const streams: StreamParticle[] = [];
const ashes: AshParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
let ashMesh: InstancedMesh | null = null;

const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const scratchPosition = new Vector3();

export function createEffects(scene: Scene) {
  sparks.length = 0;
  streams.length = 0;
  ashes.length = 0;
  rings.length = 0;
  glints.length = 0;

  sparkMesh = new InstancedMesh(
    new TetrahedronGeometry(0.12, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  ashMesh = new InstancedMesh(
    new OctahedronGeometry(0.22, 0),
    new MeshBasicMaterial({ color: 0x0c0c12, blending: NormalBlending, depthWrite: true }),
    ASH_CAPACITY,
  );
  ashMesh.count = 0;
  ashMesh.frustumCulled = false;
  scene.add(ashMesh);

  // Thin ring: an expanding ripple, not a wall of light.
  const ringGeometry = new RingGeometry(0.96, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  // Crossed-blade glint: tiny screen area, so bloom makes a sharp star.
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
}

export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    if (sparks.length + streams.length >= SPARK_CAPACITY) sparks.shift();
    const direction = randomUnit();
    sparks.push({
      position: position.clone(),
      velocity: direction.clone().multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: direction,
      rotation: new Quaternion(),
      spin: 7 + Math.random() * 12,
      color: color.clone(),
      size: 0.5 + Math.random() * 0.6,
      age: 0,
      life: 0.28 + Math.random() * 0.3,
      drag: 3.2,
    });
  }
}

/** The stolen light going home: motes arc from the kill to the window. Returns the flight time of the slowest mote. */
export function streamLight(from: Vector3, to: Vector3, color: Color, count = 12) {
  const mid = from.clone().lerp(to, 0.45);
  mid.y += from.distanceTo(to) * 0.16;
  let longest = 0;
  for (let i = 0; i < count; i += 1) {
    if (sparks.length + streams.length >= SPARK_CAPACITY) sparks.shift();
    const delay = i * 0.024;
    const travel = 0.42 + Math.random() * 0.14;
    longest = Math.max(longest, delay + travel);
    streams.push({
      from: from.clone().add(randomUnit().multiplyScalar(0.5)),
      control: mid.clone().add(randomUnit().multiplyScalar(1.4)),
      to: to.clone(),
      color: color.clone(),
      delay,
      travel,
      age: 0,
      size: 0.55 + Math.random() * 0.5,
    });
  }
  return longest;
}

/** Dark counterpart: the gloom swallowing a light that got away. */
export function puffAsh(position: Vector3, count: number) {
  for (let i = 0; i < count; i += 1) {
    if (ashes.length >= ASH_CAPACITY) ashes.shift();
    const direction = randomUnit();
    ashes.push({
      position: position.clone(),
      velocity: direction.clone().multiplyScalar(1.4 + Math.random() * 2.2).add(new Vector3(0, -0.8, 0)),
      axis: direction,
      rotation: new Quaternion(),
      spin: 2 + Math.random() * 4,
      size: 0.6 + Math.random() * 0.8,
      age: 0,
      life: 0.6 + Math.random() * 0.4,
    });
  }
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
  ring.fromScale = toScale * 0.12;
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
      scratchScale.setScalar(spark.size * (0.35 + fade * 0.65));
      scratchMatrix.compose(spark.position, spark.rotation, scratchScale);
      sparkMesh.setMatrixAt(count, scratchMatrix);
      scratchColor.copy(spark.color).multiplyScalar(fade * fade);
      sparkMesh.setColorAt(count, scratchColor);
      count += 1;
    }

    for (let i = streams.length - 1; i >= 0; i -= 1) {
      const mote = streams[i];
      mote.age += dt;
      const t = (mote.age - mote.delay) / mote.travel;
      if (t >= 1) {
        streams.splice(i, 1);
        continue;
      }
      if (t < 0 || count >= SPARK_CAPACITY) continue;
      // Ease-in along a quadratic arc: the light gathers itself, then goes.
      const eased = t * t * (3 - 2 * t);
      const inv = 1 - eased;
      scratchPosition
        .copy(mote.from)
        .multiplyScalar(inv * inv)
        .addScaledVector(mote.control, 2 * inv * eased)
        .addScaledVector(mote.to, eased * eased);
      scratchScale.setScalar(mote.size * (0.5 + 0.5 * (1 - t)));
      scratchMatrix.compose(scratchPosition, scratchQuaternion.identity(), scratchScale);
      sparkMesh.setMatrixAt(count, scratchMatrix);
      scratchColor.copy(mote.color).multiplyScalar(0.6 + 0.8 * t);
      sparkMesh.setColorAt(count, scratchColor);
      count += 1;
    }

    sparkMesh.count = count;
    sparkMesh.instanceMatrix.needsUpdate = true;
    if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;
  }

  if (ashMesh) {
    let count = 0;
    for (let i = ashes.length - 1; i >= 0; i -= 1) {
      const ash = ashes[i];
      ash.age += dt;
      if (ash.age >= ash.life) {
        ashes.splice(i, 1);
        continue;
      }
      ash.velocity.multiplyScalar(Math.max(0, 1 - 1.6 * dt));
      ash.position.addScaledVector(ash.velocity, dt);
      scratchQuaternion.setFromAxisAngle(ash.axis, ash.spin * dt);
      ash.rotation.premultiply(scratchQuaternion).normalize();
      const fade = 1 - ash.age / ash.life;
      scratchScale.setScalar(ash.size * fade);
      scratchMatrix.compose(ash.position, ash.rotation, scratchScale);
      ashMesh.setMatrixAt(count, scratchMatrix);
      count += 1;
    }
    ashMesh.count = count;
    ashMesh.instanceMatrix.needsUpdate = true;
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
}

export function resetEffects() {
  sparks.length = 0;
  streams.length = 0;
  ashes.length = 0;
  if (sparkMesh) sparkMesh.count = 0;
  if (ashMesh) ashMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
}

function randomUnit(): Vector3 {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
