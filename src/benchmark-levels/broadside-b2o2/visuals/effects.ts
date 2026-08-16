import {
  BoxGeometry,
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
  SRGBColorSpace,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { OBSIDIAN, OBSIDIAN_LIT } from './palette';

// Broadside's particle language is gunfire and wreckage. Sparks kick off
// impacts in faction colors and drift weightless (there is no down here);
// killed craft decompress into their own armor shards; rings and glints mark
// locks and hits; blooms are the big soft flashes of capital ordnance going
// off far away; hulks are dead machines tumbling out of the fight.

const SPARK_CAPACITY = 1400;
const RING_CAPACITY = 28;
const GLINT_CAPACITY = 14;
const HULK_CAPACITY = 5;
const BLOOM_CAPACITY = 14;

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

type BloomEffect = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  color: Color;
  age: number;
  life: number;
  scale: number;
};

const sparks: SparkParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const hulks: HulkEffect[] = [];
const blooms: BloomEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const COOL_OBSIDIAN = new Color().setRGB(0.05, 0.045, 0.06, SRGBColorSpace);

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

  // Dead-hulk pool: dark tumbling fighter wrecks that drift out of the fight.
  for (let i = 0; i < HULK_CAPACITY; i += 1) {
    const group = new Group();
    const dark = new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.8) });
    const mid = new MeshBasicMaterial({ color: OBSIDIAN_LIT.clone().multiplyScalar(0.8) });
    group.add(new Mesh(new BoxGeometry(1, 0.5, 1.8), dark));
    const wing = new Mesh(new BoxGeometry(2.4, 0.12, 0.8), mid);
    wing.position.y = 0.16;
    group.add(wing);
    const tail = new Mesh(new BoxGeometry(0.26, 1.0, 0.26), dark);
    tail.position.set(0.3, -0.4, -0.4);
    group.add(tail);
    group.visible = false;
    scene.add(group);
    hulks.push({ group, velocity: new Vector3(), spinAxis: new Vector3(1, 0, 0), spin: 2, age: 0, life: -1 });
  }

  // Bloom pool: big soft ordnance flashes, from fighter kills to distant
  // capital-ship hits. A soft disc that swells and dies.
  const bloomGeometry = new CircleGeometry(1, 24);
  for (let i = 0; i < BLOOM_CAPACITY; i += 1) {
    const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
    const mesh = new Mesh(bloomGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    blooms.push({ mesh, material, color: new Color(), age: 0, life: -1, scale: 1 });
  }
}

function pushSpark(particle: SparkParticle) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(particle);
}

// Hot sparks: fast, bright, weightless — they kick out and hang.
export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
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
      drag: 1.6,
    });
  }
}

// The target decompresses into its own armor; pieces cool to dead obsidian.
export function burstShards(position: Vector3, specs: ShardSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.3),
      velocity: outward
        .clone()
        .multiplyScalar(5 + rng() * 8)
        .add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(3)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 4 + rng() * 9,
      color: spec.color.clone(),
      coolTo: COOL_OBSIDIAN.clone(),
      size: 1.1 + spec.size * 2.1,
      age: 0,
      life: 0.75 + rng() * 0.5,
      drag: 1.4,
    });
  }
}

// Tracer wake dropped behind shots and fast craft.
export function dropTrail(position: Vector3, color: Color, size = 0.45) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 3,
    color: color.clone(),
    coolTo: null,
    size,
    age: 0,
    life: 0.26,
    drag: 1,
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

// Ordnance flash: a soft swelling disc of light, camera-facing.
export function spawnBloom(position: Vector3, color: Color, scale: number, life = 0.6) {
  const bloom = blooms.find((b) => b.life < 0);
  if (!bloom) return;
  bloom.mesh.position.copy(position);
  bloom.mesh.scale.setScalar(0.01);
  bloom.material.color.set(0, 0, 0);
  bloom.mesh.visible = true;
  bloom.color.copy(color);
  bloom.age = 0;
  bloom.life = life;
  bloom.scale = scale;
}

// A dead fighter drifts out of the battle, tumbling.
export function spawnFallingHulk(position: Vector3, scale: number, velocity: Vector3) {
  const hulk = hulks.find((h) => h.life < 0);
  if (!hulk) return;
  hulk.group.position.copy(position);
  hulk.group.scale.setScalar(scale);
  hulk.group.visible = true;
  hulk.velocity.copy(velocity);
  hulk.spinAxis.copy(randomUnit(Math.random));
  hulk.spin = 1.5 + Math.random() * 2.5;
  hulk.age = 0;
  hulk.life = 2.6;
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
    hulk.group.position.addScaledVector(hulk.velocity, dt);
    scratchQuaternion.setFromAxisAngle(hulk.spinAxis, hulk.spin * dt);
    hulk.group.quaternion.premultiply(scratchQuaternion);
  }

  for (const bloom of blooms) {
    if (bloom.life < 0) continue;
    bloom.age += dt;
    if (bloom.age >= bloom.life) {
      bloom.life = -1;
      bloom.mesh.visible = false;
      continue;
    }
    const progress = bloom.age / bloom.life;
    const swell = 1 - (1 - Math.min(1, progress * 2.4)) ** 2;
    bloom.mesh.scale.setScalar(Math.max(0.01, bloom.scale * (0.25 + swell * 0.75)));
    bloom.mesh.quaternion.copy(camera.quaternion);
    bloom.material.color.copy(bloom.color).multiplyScalar((1 - progress) ** 1.7);
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
  for (const hulk of hulks) {
    hulk.life = -1;
    hulk.group.visible = false;
  }
  for (const bloom of blooms) {
    bloom.life = -1;
    bloom.mesh.visible = false;
  }
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
