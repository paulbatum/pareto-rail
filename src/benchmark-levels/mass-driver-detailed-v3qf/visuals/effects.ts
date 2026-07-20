import {
  BufferGeometry,
  Camera,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Line,
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

// Everything a hit throws off is electrical: sparks are thin shards that fly
// straight and wink out (no gravity — this is a vacuum barrel), ring pulses are
// thin shockwaves off the coils, arc-lightning is a jagged polyline that snaps
// between two points for a frame or two, glints are cold four-point flares on
// the player's own impacts, and the flash disc is the muzzle whiteout / the
// detonation core. All pooled, all additive, all reset between runs.

const SPARK_CAPACITY = 1200;
const RING_CAPACITY = 30;
const GLINT_CAPACITY = 16;
const ARC_CAPACITY = 24;
const ARC_POINTS = 9;
const FLASH_CAPACITY = 6;

export type SparkSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type SparkParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // unit length — setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  color: Color;
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

type ArcEffect = {
  line: Line;
  material: MeshBasicMaterial;
  color: Color;
  age: number;
  life: number;
};

type FlashEffect = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  scale: number;
};

const sparks: SparkParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const arcs: ArcEffect[] = [];
const flashes: FlashEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const scratchA = new Vector3();
const scratchB = new Vector3();
const scratchPerp = new Vector3();
const UP = new Vector3(0, 1, 0);

export function createEffects(scene: Scene) {
  const shard = new TetrahedronGeometry(0.14, 0);
  shard.scale(0.4, 0.4, 1.7); // a splinter, not a chunk
  sparkMesh = new InstancedMesh(shard, createAdditiveBasicMaterial({ color: 0xffffff }), SPARK_CAPACITY);
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  const ringGeometry = new RingGeometry(0.95, 1, 52);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.6, 0.045);
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

  for (let i = 0; i < ARC_CAPACITY; i += 1) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(ARC_POINTS * 3), 3));
    const material = createAdditiveBasicMaterial({ color: 0x000000 });
    const line = new Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    arcs.push({ line, material, color: new Color(), age: 0, life: -1 });
  }

  const flashGeometry = new CircleGeometry(1, 28);
  for (let i = 0; i < FLASH_CAPACITY; i += 1) {
    const mesh = new Mesh(flashGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    scene.add(mesh);
    flashes.push({ mesh, color: new Color(), age: 0, life: -1, scale: 1 });
  }
}

function pushSpark(particle: SparkParticle) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(particle);
}

// Omnidirectional spray of hot splinters — the generic "something got hit" spark.
export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushSpark({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.5 + Math.random())),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 10 + Math.random() * 18,
      color: color.clone(),
      size: 0.5 + Math.random() * 0.7,
      age: 0,
      life: 0.22 + Math.random() * 0.3,
      drag: 2.2,
    });
  }
}

// The enemy blows apart along its own facet directions, then the shards wink out.
export function burstShatter(position: Vector3, specs: SparkSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.3),
      velocity: outward
        .clone()
        .multiplyScalar(9 + rng() * 10)
        .add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(4)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 6 + rng() * 12,
      color: spec.color.clone(),
      size: 0.9 + spec.size * 2.4,
      age: 0,
      life: 0.4 + rng() * 0.4,
      drag: 2.4,
    });
  }
}

// A cold, fast-fading streak dropped behind player shots and hostile bolts.
export function dropTrail(position: Vector3, color: Color) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 4,
    color: color.clone(),
    size: 0.55,
    age: 0,
    life: 0.24,
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

export function spawnGlint(position: Vector3, color: Color, scale = 1, life = 0.16) {
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

// A jagged bolt snapping between two world points: kill flashes, capacitor crackle.
export function spawnArc(from: Vector3, to: Vector3, color: Color, life = 0.16, jag = 0.5) {
  const arc = arcs.find((a) => a.life < 0);
  if (!arc) return;
  scratchA.copy(from);
  scratchB.copy(to);
  scratchPerp.subVectors(scratchB, scratchA);
  const span = Math.max(0.001, scratchPerp.length());
  scratchPerp.cross(Math.abs(scratchPerp.y) > 0.9 * span ? new Vector3(1, 0, 0) : UP).normalize();
  const attribute = arc.line.geometry.getAttribute('position') as Float32BufferAttribute;
  const array = attribute.array as Float32Array;
  for (let i = 0; i < ARC_POINTS; i += 1) {
    const t = i / (ARC_POINTS - 1);
    const edge = Math.sin(t * Math.PI); // no kink at the endpoints
    const kick = (Math.random() - 0.5) * jag * span * 0.14 * edge;
    const twist = (Math.random() - 0.5) * jag * span * 0.14 * edge;
    scratchA.copy(from).lerp(to, t)
      .addScaledVector(scratchPerp, kick)
      .addScaledVector(UP, twist);
    array[i * 3] = scratchA.x;
    array[i * 3 + 1] = scratchA.y;
    array[i * 3 + 2] = scratchA.z;
  }
  attribute.needsUpdate = true;
  arc.material.color.set(0, 0, 0);
  arc.line.visible = true;
  arc.color.copy(color);
  arc.age = 0;
  arc.life = life;
}

// A camera-facing disc that punches bright and expands: muzzle whiteout, detonation core.
export function spawnFlash(position: Vector3, color: Color, scale: number, life: number) {
  const flash = flashes.find((f) => f.life < 0);
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
      // Point the shard along its own velocity so it reads as a streak, then spin it.
      if (spark.velocity.lengthSq() > 0.0001) {
        scratchA.copy(spark.velocity).normalize();
        scratchQuaternion.setFromUnitVectors(FORWARD, scratchA);
        spark.rotation.copy(scratchQuaternion);
      }
      scratchQuaternion.setFromAxisAngle(spark.axis, spark.spin * dt);
      spark.rotation.multiply(scratchQuaternion).normalize();

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

  for (const arc of arcs) {
    if (arc.life < 0) continue;
    arc.age += dt;
    if (arc.age >= arc.life) {
      arc.life = -1;
      arc.line.visible = false;
      continue;
    }
    const progress = arc.age / arc.life;
    // Flicker: the bolt stutters as it dies rather than fading smoothly.
    const flicker = 0.55 + 0.45 * Math.sin(progress * 47);
    arc.material.color.copy(arc.color).multiplyScalar((1 - progress) * flicker);
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
    const envelope = (1 - progress) ** 1.4;
    flash.mesh.scale.setScalar(flash.scale * (0.3 + progress * 0.7));
    flash.mesh.quaternion.copy(camera.quaternion);
    (flash.mesh.material as MeshBasicMaterial).color.copy(flash.color).multiplyScalar(envelope);
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
  for (const arc of arcs) {
    arc.life = -1;
    arc.line.visible = false;
  }
  for (const flash of flashes) {
    flash.life = -1;
    flash.mesh.visible = false;
  }
}

const FORWARD = new Vector3(0, 0, 1);

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
