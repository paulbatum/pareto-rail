import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './enemies';

// Particle language for a vacuum inside a gun: nothing falls. Sparks fly dead
// straight and are washed backward by the payload's own speed, so every burst
// smears into the barrel behind you. Debris cools from white arc to dead steel.
// The signature effect is the discharge arc — a jagged crackle thrown between
// two points whenever current goes somewhere it should not.

// Pool sizes are draw calls: every live ring, arc and flash is its own mesh, and
// the barrel is at its busiest exactly when the frame can least afford them.
// These are sized so a full-screen moment (a six-kill volley landing on top of
// an interlock detonation) still fits inside the level's draw budget.
const SPARK_CAPACITY = 1500;
const RING_CAPACITY = 12;
const ARC_CAPACITY = 10;
const FLASH_CAPACITY = 8;

type Spark = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // unit length — feeds setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  color: Color;
  coolTo: Color | null;
  size: number;
  stretch: number;
  age: number;
  life: number;
  drag: number;
  /** How hard the payload's slipstream drags this particle back down the barrel. */
  wash: number;
};

type RingEffect = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  fromScale: number;
  toScale: number;
};

type ArcEffect = {
  group: Group;
  materials: MeshBasicMaterial[];
  color: Color;
  age: number;
  life: number;
  from: Vector3;
  to: Vector3;
  width: number;
};

type FlashEffect = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  color: Color;
  age: number;
  life: number;
  scale: number;
};

const sparks: Spark[] = [];
const rings: RingEffect[] = [];
const arcs: ArcEffect[] = [];
const flashes: FlashEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const scratchForward = new Vector3();
const DEAD_STEEL = new Color(0.03, 0.035, 0.05);

let washSpeed = 0;

export function createEffects(scene: Scene) {
  const sparkGeometry = new OctahedronGeometry(0.1, 0);
  sparkGeometry.scale(0.5, 0.5, 1);
  sparkMesh = new InstancedMesh(sparkGeometry, createAdditiveBasicMaterial({ color: 0xffffff }), SPARK_CAPACITY);
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  (sparkMesh.material as MeshBasicMaterial).toneMapped = false;
  scene.add(sparkMesh);

  const ringGeometry = new RingGeometry(0.955, 1, 64);
  for (let index = 0; index < RING_CAPACITY; index += 1) {
    const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
    material.toneMapped = false;
    const mesh = new Mesh(ringGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  // Four jagged profiles, each a cross of two perpendicular strips so a
  // discharge reads from any viewing angle without billboarding maths.
  const arcGeometries = [0, 1, 2, 3].map((seed) => crossArcGeometry(seed));
  for (let index = 0; index < ARC_CAPACITY; index += 1) {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
    material.toneMapped = false;
    group.add(new Mesh(arcGeometries[index % arcGeometries.length], material));
    materials.push(material);
    group.visible = false;
    scene.add(group);
    arcs.push({ group, materials, color: new Color(), age: 0, life: -1, from: new Vector3(), to: new Vector3(), width: 1 });
  }

  // One mesh, not four: the star's blades are baked into a single geometry so a
  // screen full of impacts costs one draw call each.
  const starGeometry = crossStarGeometry();
  for (let index = 0; index < FLASH_CAPACITY; index += 1) {
    const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
    material.toneMapped = false;
    const mesh = new Mesh(starGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    flashes.push({ mesh, material, color: new Color(), age: 0, life: -1, scale: 1 });
  }
}

/**
 * Four-point star: two long blades on the axes and two short ones on the
 * diagonals, so an impact reads as a cross with a flare rather than an
 * eight-spoke asterisk.
 */
function crossStarGeometry() {
  const positions: number[] = [];
  const blade = (angle: number, length: number, width: number) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const point = (along: number, across: number) => [along * cos - across * sin, along * sin + across * cos, 0];
    const a = point(-length, -width);
    const b = point(length, -width);
    const c = point(length, width);
    const d = point(-length, width);
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  blade(0, 1, 0.0225);
  blade(Math.PI / 2, 1, 0.0225);
  blade(Math.PI / 4, 0.45, 0.0225);
  blade(-Math.PI / 4, 0.45, 0.0225);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

function crossArcGeometry(seed: number) {
  const steps = 9;
  const rng = pseudoRandom(seed * 977 + 13);
  const jitter = Array.from({ length: steps + 1 }, (_value, index) => (index === 0 || index === steps ? 0 : (rng() - 0.5) * 0.34));
  const positions: number[] = [];
  const pushStrip = (axis: 'x' | 'y') => {
    for (let index = 0; index < steps; index += 1) {
      const z0 = index / steps;
      const z1 = (index + 1) / steps;
      const o0 = jitter[index];
      const o1 = jitter[index + 1];
      const half = 0.5;
      const point = (z: number, offset: number, side: number) => (
        axis === 'x'
          ? [offset + side * half, 0, z]
          : [0, offset + side * half, z]
      );
      const a = point(z0, o0, -1);
      const b = point(z0, o0, 1);
      const c = point(z1, o1, 1);
      const d = point(z1, o1, -1);
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  };
  pushStrip('x');
  pushStrip('y');
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

function pseudoRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pushSpark(spark: Spark) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(spark);
}

/** Straight-line electrical spray. No gravity — this is a vacuum. */
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, wash = 26) {
  for (let index = 0; index < count; index += 1) {
    const direction = randomUnit(Math.random);
    pushSpark({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.35 + Math.random() * 1.1)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 10 + Math.random() * 20,
      color: color.clone(),
      coolTo: null,
      size: 0.4 + Math.random() * 0.55,
      stretch: 2.2 + Math.random() * 2.4,
      age: 0,
      life: 0.22 + Math.random() * 0.32,
      drag: 1.1,
      wash,
    });
  }
}

/** The hull comes apart into its own facets, which cool to dead steel. */
export function burstShards(position: Vector3, specs: readonly ShardSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const direction = randomUnit(rng);
    pushSpark({
      position: position.clone().addScaledVector(direction, 0.3),
      velocity: direction.clone().multiplyScalar(spec.speed * (0.7 + rng() * 0.8)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: spec.spin,
      color: spec.color.clone(),
      coolTo: DEAD_STEEL,
      size: 1.4 + spec.size * 4,
      stretch: 1.1,
      age: 0,
      life: 0.55 + rng() * 0.45,
      drag: 0.9,
      wash: 32,
    });
  }
}

/** Ionised wake dropped behind a shot. */
export function dropTrail(position: Vector3, color: Color) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 4,
    color: color.clone(),
    coolTo: null,
    size: 0.55,
    stretch: 3.4,
    age: 0,
    life: 0.24,
    drag: 0.6,
    wash: 8,
  });
}

export function spawnRing(position: Vector3, color: Color, toScale: number, life: number) {
  const ring = rings.find((candidate) => candidate.life < 0);
  if (!ring) return;
  ring.mesh.position.copy(position);
  ring.mesh.scale.setScalar(0.01);
  (ring.mesh.material as MeshBasicMaterial).color.setRGB(0, 0, 0);
  ring.mesh.visible = true;
  ring.color.copy(color);
  ring.age = 0;
  ring.life = life;
  ring.fromScale = toScale * 0.1;
  ring.toScale = toScale;
}

/** Discharge arc: current jumping from `from` to `to`. */
export function spawnArc(from: Vector3, to: Vector3, color: Color, life = 0.16, width = 0.5) {
  const arc = arcs.find((candidate) => candidate.life < 0);
  if (!arc) return;
  arc.from.copy(from);
  arc.to.copy(to);
  arc.color.copy(color);
  arc.age = 0;
  arc.life = life;
  arc.width = width;
  arc.group.visible = true;
  for (const material of arc.materials) material.color.setRGB(0, 0, 0);
}

export function spawnFlash(position: Vector3, color: Color, scale = 1, life = 0.18) {
  const flash = flashes.find((candidate) => candidate.life < 0);
  if (!flash) return;
  flash.mesh.position.copy(position);
  flash.mesh.scale.setScalar(0.01);
  flash.material.color.setRGB(0, 0, 0);
  flash.mesh.visible = true;
  flash.color.copy(color);
  flash.age = 0;
  flash.life = life;
  flash.scale = scale;
}

/** How fast the payload is moving; sets how hard debris is washed backward. */
export function setEffectWash(speed: number) {
  washSpeed = speed;
}

export function updateEffects(dt: number, camera: Camera) {
  camera.getWorldDirection(scratchForward);

  if (sparkMesh) {
    let count = 0;
    for (let index = sparks.length - 1; index >= 0; index -= 1) {
      const spark = sparks[index];
      spark.age += dt;
      if (spark.age >= spark.life) {
        sparks.splice(index, 1);
        continue;
      }
      spark.velocity.multiplyScalar(Math.max(0, 1 - spark.drag * dt));
      spark.position.addScaledVector(spark.velocity, dt);
      // Slipstream: the faster the payload goes, the harder its own wake pulls
      // debris back down the barrel. This is most of the felt speed.
      spark.position.addScaledVector(scratchForward, -washSpeed * spark.wash * dt * 0.012);
      scratchQuaternion.setFromAxisAngle(spark.axis, spark.spin * dt);
      spark.rotation.premultiply(scratchQuaternion).normalize();

      const fade = 1 - spark.age / spark.life;
      const size = spark.size * (0.3 + fade * 0.7);
      scratchScale.set(size, size, size * spark.stretch);
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

  for (const arc of arcs) {
    if (arc.life < 0) continue;
    arc.age += dt;
    if (arc.age >= arc.life) {
      arc.life = -1;
      arc.group.visible = false;
      continue;
    }
    const progress = arc.age / arc.life;
    // Discharges do not fade smoothly, they stutter out.
    const flicker = progress > 0.55 ? (Math.floor(arc.age * 90) % 2 === 0 ? 0.35 : 1) : 1;
    const envelope = (1 - progress) ** 0.6 * flicker;
    const length = arc.from.distanceTo(arc.to);
    arc.group.position.copy(arc.from);
    arc.group.lookAt(arc.to);
    arc.group.scale.set(arc.width * (0.5 + envelope), arc.width * (0.5 + envelope), Math.max(0.01, length));
    for (const material of arc.materials) material.color.copy(arc.color).multiplyScalar(envelope);
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
    const envelope = Math.sin(Math.min(1, progress * 1.15) * Math.PI);
    flash.mesh.scale.setScalar(Math.max(0.01, flash.scale * envelope));
    flash.mesh.quaternion.copy(camera.quaternion);
    flash.mesh.rotateZ(flash.age * 2.2);
    flash.material.color.copy(flash.color).multiplyScalar(envelope);
  }
}

export function resetEffects() {
  sparks.length = 0;
  if (sparkMesh) sparkMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const arc of arcs) {
    arc.life = -1;
    arc.group.visible = false;
  }
  for (const flash of flashes) {
    flash.life = -1;
    flash.mesh.visible = false;
  }
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
}
