import {
  BufferGeometry,
  Camera,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { LineBasicNodeMaterial } from 'three/webgpu';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';

// Space battle effects: sparks drift ballistically (no gravity out here), slag
// cools from molten to black, shockwaves are thin rings, locks and hits flash
// cold, and the fleet's fire exchange is a pool of tracer streaks and beam
// ribbons. All pooled; nothing allocates at runtime.

const SPARK_CAPACITY = 1300;
const RING_CAPACITY = 30;
const GLINT_CAPACITY = 16;
const FLASH_CAPACITY = 24;
const FIREBALL_CAPACITY = 14;
const TRACER_CAPACITY = 64;
const BEAM_CAPACITY = 16;

export type SparkSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type Spark = {
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

type RingEffect = { mesh: Mesh; color: Color; age: number; life: number; fromScale: number; toScale: number };
type GlintEffect = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };
type FlashEffect = { mesh: Mesh; color: Color; age: number; life: number; scale: number };
type FireballEffect = { mesh: Mesh; color: Color; age: number; life: number; scale: number };
type BeamEffect = { mesh: Mesh; color: Color; age: number; life: number };

type Tracer = {
  from: Vector3;
  to: Vector3;
  color: Color;
  age: number;
  life: number;
  head: number; // 0..1+ position of the streak head
  span: number; // streak length as a fraction of the path
};

const sparks: Spark[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const flashes: FlashEffect[] = [];
const fireballs: FireballEffect[] = [];
const beams: BeamEffect[] = [];
const tracers: Tracer[] = [];

let sparkMesh: InstancedMesh | null = null;
let tracerGeometry: BufferGeometry | null = null;
let tracerPositions: Float32Array | null = null;
let tracerColors: Float32Array | null = null;

const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const SLAG_DARK = new Color(0.02, 0.014, 0.016);
const UP = new Vector3(0, 1, 0);

export function createEffects(scene: Scene) {
  sparkMesh = new InstancedMesh(new TetrahedronGeometry(0.12, 0), createAdditiveBasicMaterial({ color: 0xffffff }), SPARK_CAPACITY);
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  const ringGeometry = new RingGeometry(0.96, 1, 56);
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

  // Muzzle/hit flashes: camera-facing additive discs.
  const flashGeometry = new CircleGeometry(0.5, 20);
  for (let i = 0; i < FLASH_CAPACITY; i += 1) {
    const mesh = new Mesh(flashGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide, opacity: 0.9 }));
    mesh.visible = false;
    scene.add(mesh);
    flashes.push({ mesh, color: new Color(), age: 0, life: -1, scale: 1 });
  }

  // Fireballs: low-poly additive spheres that swell and die.
  const fireballGeometry = new SphereGeometry(0.6, 10, 8);
  for (let i = 0; i < FIREBALL_CAPACITY; i += 1) {
    const mesh = new Mesh(fireballGeometry, createAdditiveBasicMaterial({ color: 0x000000, opacity: 0.85 }));
    mesh.visible = false;
    scene.add(mesh);
    fireballs.push({ mesh, color: new Color(), age: 0, life: -1, scale: 1 });
  }

  // Beam ribbons: close-range broadside streaks with real volume.
  const beamGeometry = new CylinderGeometry(0.5, 0.5, 1, 6, 1, true);
  for (let i = 0; i < BEAM_CAPACITY; i += 1) {
    const mesh = new Mesh(beamGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide, opacity: 0.8 }));
    mesh.visible = false;
    scene.add(mesh);
    beams.push({ mesh, color: new Color(), age: 0, life: -1 });
  }

  // Distant fire exchange: one LineSegments pool; two verts per tracer.
  tracerGeometry = new BufferGeometry();
  tracerPositions = new Float32Array(TRACER_CAPACITY * 2 * 3);
  tracerColors = new Float32Array(TRACER_CAPACITY * 2 * 3);
  tracerGeometry.setAttribute('position', new Float32BufferAttribute(tracerPositions, 3));
  tracerGeometry.setAttribute('color', new Float32BufferAttribute(tracerColors, 3));
  const tracerMaterial = new LineBasicNodeMaterial(additiveMaterialParameters({ vertexColors: true }));
  const tracerLines = new LineSegments(tracerGeometry, tracerMaterial);
  tracerLines.frustumCulled = false;
  scene.add(tracerLines);
  for (let i = 0; i < TRACER_CAPACITY; i += 1) {
    tracers.push({ from: new Vector3(), to: new Vector3(), color: new Color(), age: 0, life: -1, head: 0, span: 0.1 });
  }
}

function pushSpark(spark: Spark) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(spark);
}

// Hot sparks: fast, bright, drifting straight (vacuum — no gravity curve).
export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushSpark({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 8 + Math.random() * 14,
      color: color.clone(),
      coolTo: null,
      size: 0.4 + Math.random() * 0.5,
      age: 0,
      life: 0.35 + Math.random() * 0.4,
      drag: 1.4,
    });
  }
}

// The enemy decompresses into its own facets; the pieces cool to black.
export function burstSlag(position: Vector3, specs: SparkSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.35),
      velocity: outward
        .clone()
        .multiplyScalar(7 + rng() * 8)
        .add(new Vector3(rng() - 0.5, rng() * 0.6, rng() - 0.5).multiplyScalar(3)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 4 + rng() * 9,
      color: spec.color.clone(),
      coolTo: SLAG_DARK.clone(),
      size: 1.1 + spec.size * 2.1,
      age: 0,
      life: 0.8 + rng() * 0.5,
      drag: 1.7,
    });
  }
}

// Cold, quick-fading mote dropped behind player shots and hostile bolts.
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

// A short hot disc flash: muzzle flashes, hit sparks, distant battle pops.
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

// A swelling fireball: kills on big targets, the flagship breakup.
export function spawnFireball(position: Vector3, color: Color, scale: number, life: number) {
  const fireball = fireballs.find((f) => f.life < 0);
  if (!fireball) return;
  fireball.mesh.position.copy(position);
  fireball.mesh.scale.setScalar(0.01);
  (fireball.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  fireball.mesh.visible = true;
  fireball.color.copy(color);
  fireball.age = 0;
  fireball.life = life;
  fireball.scale = scale;
}

// A fast luminous bolt with volume — close broadside shots, heavy exchanges.
export function spawnBeam(from: Vector3, to: Vector3, color: Color, radius: number, life: number) {
  const beam = beams.find((b) => b.life < 0);
  if (!beam) return;
  const direction = to.clone().sub(from);
  const length = direction.length();
  if (length < 0.01) return;
  beam.mesh.position.copy(from).addScaledVector(direction, 0.5);
  beam.mesh.scale.set(radius * 2, length, radius * 2);
  beam.mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  (beam.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  beam.mesh.visible = true;
  beam.color.copy(color);
  beam.age = 0;
  beam.life = life;
}

// A tracer streak crossing between distant ships. `duration` is flight time.
export function spawnTracer(from: Vector3, to: Vector3, color: Color, duration: number, span = 0.08) {
  const tracer = tracers.find((t) => t.life < 0);
  if (!tracer) return;
  tracer.from.copy(from);
  tracer.to.copy(to);
  tracer.color.copy(color);
  tracer.age = 0;
  tracer.life = duration + span * duration + 0.25;
  tracer.head = 0;
  tracer.span = span;
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

  for (const flash of flashes) {
    if (flash.life < 0) continue;
    flash.age += dt;
    if (flash.age >= flash.life) {
      flash.life = -1;
      flash.mesh.visible = false;
      continue;
    }
    const progress = flash.age / flash.life;
    const envelope = Math.sin(Math.min(1, progress * 1.3) * Math.PI);
    flash.mesh.scale.setScalar(Math.max(0.01, flash.scale * (0.4 + progress * 0.9)));
    flash.mesh.quaternion.copy(camera.quaternion);
    (flash.mesh.material as MeshBasicMaterial).color.copy(flash.color).multiplyScalar(envelope);
  }

  for (const fireball of fireballs) {
    if (fireball.life < 0) continue;
    fireball.age += dt;
    if (fireball.age >= fireball.life) {
      fireball.life = -1;
      fireball.mesh.visible = false;
      continue;
    }
    const progress = fireball.age / fireball.life;
    const swell = 1 - (1 - progress) ** 2.4;
    const envelope = progress < 0.18 ? progress / 0.18 : (1 - progress) / 0.82;
    fireball.mesh.scale.setScalar(Math.max(0.01, fireball.scale * (0.25 + swell * 0.75)));
    (fireball.mesh.material as MeshBasicMaterial).color.copy(fireball.color).multiplyScalar(envelope * envelope);
  }

  for (const beam of beams) {
    if (beam.life < 0) continue;
    beam.age += dt;
    if (beam.age >= beam.life) {
      beam.life = -1;
      beam.mesh.visible = false;
      continue;
    }
    const progress = beam.age / beam.life;
    (beam.mesh.material as MeshBasicMaterial).color.copy(beam.color).multiplyScalar((1 - progress) ** 1.4);
  }

  if (tracerGeometry && tracerPositions && tracerColors) {
    for (const [slot, tracer] of tracers.entries()) {
      const base = slot * 6;
      if (tracer.life < 0) {
        tracerPositions.fill(0, base, base + 6);
        continue;
      }
      tracer.age += dt;
      if (tracer.age >= tracer.life) {
        tracer.life = -1;
        tracerPositions.fill(0, base, base + 6);
        continue;
      }
      const flight = tracer.life - 0.25;
      tracer.head = Math.min(1 + tracer.span, tracer.age / (flight / (1 + tracer.span)));
      const headT = Math.min(1, tracer.head);
      const tailT = Math.max(0, tracer.head - tracer.span);
      const fade = Math.min(1, tracer.age / 0.06) * Math.max(0, 1 - Math.max(0, tracer.head - 1) / tracer.span);
      const head = tracer.from.clone().lerp(tracer.to, headT);
      const tail = tracer.from.clone().lerp(tracer.to, tailT);
      tracerPositions[base] = tail.x;
      tracerPositions[base + 1] = tail.y;
      tracerPositions[base + 2] = tail.z;
      tracerPositions[base + 3] = head.x;
      tracerPositions[base + 4] = head.y;
      tracerPositions[base + 5] = head.z;
      tracerColors[base] = tracer.color.r * fade * 0.4;
      tracerColors[base + 1] = tracer.color.g * fade * 0.4;
      tracerColors[base + 2] = tracer.color.b * fade * 0.4;
      tracerColors[base + 3] = tracer.color.r * fade;
      tracerColors[base + 4] = tracer.color.g * fade;
      tracerColors[base + 5] = tracer.color.b * fade;
    }
    tracerGeometry.attributes.position.needsUpdate = true;
    tracerGeometry.attributes.color.needsUpdate = true;
  }
}

export function resetEffects() {
  sparks.length = 0;
  if (sparkMesh) sparkMesh.count = 0;
  for (const pool of [rings, glints, flashes, fireballs, beams] as const) {
    for (const effect of pool) {
      effect.life = -1;
      (effect as RingEffect).mesh.visible = false;
    }
  }
  for (const glint of glints) glint.group.visible = false;
  for (const tracer of tracers) tracer.life = -1;
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
