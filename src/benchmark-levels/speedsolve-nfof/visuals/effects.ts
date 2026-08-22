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
import { MACH_DARK, SOLVE_COLORS } from './palette';

// Effect language: the void has almost no gravity — sparks and confetti drift
// and tumble rather than rain down, so bursts read as weightless puzzle pieces.
// Machinery shards cool from their candy colour to dark iron.

const SPARK_CAPACITY = 900;
const CANDY_CAPACITY = 420;
const RING_CAPACITY = 26;
const GLINT_CAPACITY = 16;

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
  gravity: number;
};

type CandyCube = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  spin: number;
  color: Color;
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

const sparks: Spark[] = [];
const candies: CandyCube[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
let candyMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const IRON_DARK = MACH_DARK.clone().multiplyScalar(0.5);

export function createEffects(scene: Scene) {
  sparkMesh = new InstancedMesh(
    new TetrahedronGeometry(0.12, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  candyMesh = new InstancedMesh(
    new BoxGeometry(0.34, 0.34, 0.34),
    new MeshBasicMaterial({ color: 0xffffff }),
    CANDY_CAPACITY,
  );
  candyMesh.count = 0;
  candyMesh.frustumCulled = false;
  scene.add(candyMesh);

  const ringGeometry = new RingGeometry(0.95, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
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
}

function pushSpark(spark: Spark) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(spark);
}

function pushCandy(cube: CandyCube) {
  if (candies.length >= CANDY_CAPACITY) candies.shift();
  candies.push(cube);
}

// Hot sparks: fast, bright, weightless.
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, gravity = 2.2) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
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
      life: 0.35 + Math.random() * 0.45,
      drag: 1.6,
      gravity,
    });
  }
}

// Machinery decompresses into its own facets, cooling to dark iron as they
// tumble away.
export function burstSlag(position: Vector3, specs: ShardSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.35),
      velocity: outward
        .clone()
        .multiplyScalar(5 + rng() * 6)
        .add(new Vector3(rng() - 0.5, (rng() - 0.3) * 2.4, rng() - 0.5).multiplyScalar(2.4)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 4 + rng() * 9,
      color: spec.color.clone(),
      coolTo: IRON_DARK.clone(),
      size: 1 + spec.size * 2,
      age: 0,
      life: 0.9 + rng() * 0.5,
      drag: 1.7,
      gravity: 3.5,
    });
  }
}

// The confetti storm: tiny cubes in the six solve colours, weightless.
export function burstCandy(position: Vector3, count: number, speed: number, life = 2.2) {
  for (let i = 0; i < count; i += 1) {
    const color = SOLVE_COLORS[Math.floor(Math.random() * SOLVE_COLORS.length)];
    pushCandy({
      position: position.clone().addScaledVector(randomUnit(Math.random), Math.random() * 1.4),
      velocity: randomUnit(Math.random).multiplyScalar(speed * (0.35 + Math.random() * 0.85)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 3 + Math.random() * 8,
      color: color.clone().multiplyScalar(0.85 + Math.random() * 0.3),
      size: 0.55 + Math.random() * 0.85,
      age: 0,
      life: life * (0.7 + Math.random() * 0.6),
    });
  }
}

// Cold, slow-fading streak dropped behind player shots.
export function dropTrail(position: Vector3, color: Color) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 3,
    color: color.clone(),
    coolTo: null,
    size: 0.45,
    age: 0,
    life: 0.22,
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

  if (candyMesh) {
    let count = 0;
    for (let i = candies.length - 1; i >= 0; i -= 1) {
      const cube = candies[i];
      cube.age += dt;
      if (cube.age >= cube.life) {
        candies.splice(i, 1);
        continue;
      }
      cube.velocity.multiplyScalar(Math.max(0, 1 - 1.1 * dt));
      cube.velocity.y -= 1.4 * dt;
      cube.position.addScaledVector(cube.velocity, dt);
      scratchQuaternion.setFromAxisAngle(cube.axis, cube.spin * dt);
      cube.rotation.premultiply(scratchQuaternion).normalize();
      const progress = cube.age / cube.life;
      const fade = progress < 0.75 ? 1 : 1 - (progress - 0.75) / 0.25;
      scratchScale.setScalar(cube.size * (0.5 + fade * 0.5));
      scratchMatrix.compose(cube.position, cube.rotation, scratchScale);
      candyMesh.setMatrixAt(count, scratchMatrix);
      candyMesh.setColorAt(count, scratchColor.copy(cube.color).multiplyScalar(0.4 + fade * 0.6));
      count += 1;
    }
    candyMesh.count = count;
    candyMesh.instanceMatrix.needsUpdate = true;
    if (candyMesh.instanceColor) candyMesh.instanceColor.needsUpdate = true;
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
}

export function resetEffects() {
  sparks.length = 0;
  candies.length = 0;
  if (sparkMesh) sparkMesh.count = 0;
  if (candyMesh) candyMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
