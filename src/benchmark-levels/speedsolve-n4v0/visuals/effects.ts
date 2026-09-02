import {
  Camera,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { HOT_WHITE, SOLVE_COLORS } from './palette';

// Leaf: transient effect pools. Loose cubies (lit, coloured, tumbling) are the
// level's signature debris; confetti is the same pool at a tiny scale. Square
// rings echo the sticker shape; sparks and glints are hot white.

const CUBIE_CAPACITY = 900;
const SPARK_CAPACITY = 700;
const RING_CAPACITY = 28;
const GLINT_CAPACITY = 12;

type CubieParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // unit length; feeds setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  color: Color;
  scale: Vector3;
  age: number;
  life: number;
  drag: number;
  gravity: number;
};

type SparkParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  spin: number;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
};

type RingEffect = { mesh: Mesh; color: Color; age: number; life: number; fromScale: number; toScale: number };
type GlintEffect = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };

const cubies: CubieParticle[] = [];
const sparks: SparkParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
let cubieMesh: InstancedMesh | null = null;
let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

export function createEffects(scene: Scene) {
  cubieMesh = new InstancedMesh(
    new RoundedBoxGeometry(1, 1, 1, 2, 0.12),
    new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.05 }),
    CUBIE_CAPACITY,
  );
  cubieMesh.count = 0;
  cubieMesh.frustumCulled = false;
  cubieMesh.userData.raildIgnoreOcclusion = true;
  cubieMesh.name = 'loose-cubies';
  scene.add(cubieMesh);

  sparkMesh = new InstancedMesh(new TetrahedronGeometry(0.12, 0), createAdditiveBasicMaterial({ color: 0xffffff }), SPARK_CAPACITY);
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  // Square rings (four segments): the sticker silhouette as a ripple.
  const ringGeometry = new RingGeometry(0.94, 1, 4, 1);
  ringGeometry.rotateZ(Math.PI / 4);
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
}

function pushCubie(particle: CubieParticle) {
  if (cubies.length >= CUBIE_CAPACITY) cubies.shift();
  cubies.push(particle);
}

function pushSpark(particle: SparkParticle) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(particle);
}

export type LooseCubieOptions = {
  size: number;
  speed: number;
  spread: number;
  life: number;
  drag?: number;
  gravity?: number;
  colors?: readonly Color[];
  /** Flat plates rather than cubes (sticker debris). */
  flat?: boolean;
  rng?: () => number;
};

/** A shower of loose cubies flying out from `position` around `direction`. */
export function burstLooseCubies(position: Vector3, direction: Vector3, count: number, options: LooseCubieOptions) {
  const rng = options.rng ?? Math.random;
  const colors = options.colors ?? SOLVE_COLORS;
  for (let i = 0; i < count; i += 1) {
    const jitter = randomUnit(rng).multiplyScalar(options.spread);
    const velocity = direction.clone().multiplyScalar(options.speed * (0.55 + rng() * 0.9)).add(jitter);
    const size = options.size * (0.7 + rng() * 0.6);
    pushCubie({
      position: position.clone().add(randomUnit(rng).multiplyScalar(options.size * 0.6)),
      velocity,
      axis: randomUnit(rng),
      rotation: new Quaternion().setFromAxisAngle(randomUnit(rng), rng() * Math.PI),
      spin: 3 + rng() * 9,
      color: colors[Math.floor(rng() * colors.length)].clone(),
      scale: options.flat ? new Vector3(size, size, size * 0.18) : new Vector3(size, size, size),
      age: 0,
      life: options.life * (0.75 + rng() * 0.5),
      drag: options.drag ?? 1.1,
      gravity: options.gravity ?? 0,
    });
  }
}

/** One authored cubie (a real piece of the cube) thrown loose with its colours. */
export function throwCubie(position: Vector3, velocity: Vector3, size: number, color: Color, life: number, rng: () => number = Math.random) {
  pushCubie({
    position: position.clone(),
    velocity: velocity.clone(),
    axis: randomUnit(rng),
    rotation: new Quaternion(),
    spin: 2 + rng() * 5,
    color: color.clone(),
    scale: new Vector3(size, size, size),
    age: 0,
    life,
    drag: 0.55,
    gravity: 0,
  });
}

export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushSpark({
      position: position.clone(),
      velocity: direction.clone().multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: direction,
      rotation: new Quaternion(),
      spin: 8 + Math.random() * 14,
      color: color.clone(),
      size: 0.5 + Math.random() * 0.5,
      age: 0,
      life: 0.22 + Math.random() * 0.25,
      drag: 3.4,
    });
  }
}

export function dropTrail(position: Vector3, color: Color) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 1.1, (Math.random() - 0.5) * 1.1, (Math.random() - 0.5) * 1.1),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 4,
    color: color.clone(),
    size: 0.5,
    age: 0,
    life: 0.26,
    drag: 1,
  });
}

export function spawnRing(position: Vector3, color: Color, toScale: number, life: number, quaternion?: Quaternion) {
  const ring = rings.find((candidate) => candidate.life < 0);
  if (!ring) return;
  ring.mesh.position.copy(position);
  ring.mesh.scale.setScalar(0.01);
  (ring.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  ring.mesh.visible = true;
  ring.mesh.userData.fixedQuaternion = quaternion ? quaternion.clone() : null;
  ring.color.copy(color);
  ring.age = 0;
  ring.life = life;
  ring.fromScale = toScale * 0.15;
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
  if (cubieMesh) {
    let count = 0;
    for (let i = cubies.length - 1; i >= 0; i -= 1) {
      const particle = cubies[i];
      particle.age += dt;
      if (particle.age >= particle.life) {
        cubies.splice(i, 1);
        continue;
      }
      particle.velocity.multiplyScalar(Math.max(0, 1 - particle.drag * dt));
      particle.velocity.y -= particle.gravity * dt;
      particle.position.addScaledVector(particle.velocity, dt);
      scratchQuaternion.setFromAxisAngle(particle.axis, particle.spin * dt);
      particle.rotation.premultiply(scratchQuaternion).normalize();
      const progress = particle.age / particle.life;
      const shrink = progress < 0.72 ? 1 : Math.max(0.01, (1 - progress) / 0.28);
      scratchScale.copy(particle.scale).multiplyScalar(shrink);
      scratchMatrix.compose(particle.position, particle.rotation, scratchScale);
      cubieMesh.setMatrixAt(count, scratchMatrix);
      cubieMesh.setColorAt(count, particle.color);
      count += 1;
    }
    cubieMesh.count = count;
    cubieMesh.instanceMatrix.needsUpdate = true;
    if (cubieMesh.instanceColor) cubieMesh.instanceColor.needsUpdate = true;
  }

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
    const fixed = ring.mesh.userData.fixedQuaternion as Quaternion | null;
    if (fixed) ring.mesh.quaternion.copy(fixed);
    else ring.mesh.quaternion.copy(camera.quaternion);
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
}

export function resetEffects() {
  cubies.length = 0;
  sparks.length = 0;
  if (cubieMesh) cubieMesh.count = 0;
  if (sparkMesh) sparkMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
}

export function hotWhite(intensity: number) {
  return HOT_WHITE.clone().multiplyScalar(intensity);
}

export function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
