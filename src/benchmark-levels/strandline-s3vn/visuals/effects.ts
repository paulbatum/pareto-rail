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
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { LUME_GOLD, LUME_GREEN, SICK_DARK, SICK_VIOLET } from './palette';

// Strandline's particle language: nothing falls. Water holds everything, so
// debris slows to a stop and fades, luminous flecks hang and drift upward, and
// the one violent gesture in the level — a strand flushing clean when the thing
// eating it is cut off — is a wave of green light running both ways along it.

const SPARK_CAPACITY = 900;
const RING_CAPACITY = 22;
const GLINT_CAPACITY = 12;
const HEAL_CAPACITY = 16;
const VEIL_CAPACITY = 5;

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
  buoyancy: number;
};

type RingEffect = { mesh: Mesh; color: Color; age: number; life: number; fromScale: number; toScale: number };
type GlintEffect = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };
type HealEffect = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; reach: number };
type VeilEffect = { mesh: Mesh; color: Color; age: number; life: number; toScale: number };

const sparks: SparkParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const heals: HealEffect[] = [];
const veils: VeilEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const scratchVector = new Vector3();
const ROT_GREY = new Color(0.06, 0.03, 0.09);

export function createEffects(scene: Scene) {
  sparkMesh = new InstancedMesh(
    new OctahedronGeometry(0.1, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  const ringGeometry = new RingGeometry(0.93, 1, 44);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.5, 0.045);
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
    group.frustumCulled = false;
    scene.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }

  // Strand flush: two tapered bars racing away from the wound in both
  // directions along the strand, plus a bright knot at the contact point.
  const barGeometry = new BoxGeometry(0.5, 0.5, 1);
  const knotGeometry = new SphereGeometry(0.6, 10, 8);
  for (let i = 0; i < HEAL_CAPACITY; i += 1) {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    for (const direction of [1, -1]) {
      const material = createAdditiveBasicMaterial({ color: 0x000000 });
      const bar = new Mesh(barGeometry, material);
      bar.position.z = direction * 0.5;
      group.add(bar);
      materials.push(material);
    }
    const knotMaterial = createAdditiveBasicMaterial({ color: 0x000000 });
    group.add(new Mesh(knotGeometry, knotMaterial));
    materials.push(knotMaterial);
    group.visible = false;
    group.frustumCulled = false;
    scene.add(group);
    heals.push({ group, materials, color: new Color(), age: 0, life: -1, reach: 20 });
  }

  // Soft pressure fronts for boss beats: a wide disc of light that swells past you.
  const veilGeometry = new RingGeometry(0.05, 1, 40);
  for (let i = 0; i < VEIL_CAPACITY; i += 1) {
    const mesh = new Mesh(veilGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    veils.push({ mesh, color: new Color(), age: 0, life: -1, toScale: 1 });
  }
}

function pushSpark(particle: SparkParticle) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(particle);
}

/** Luminous flecks knocked loose; the water stops them almost immediately. */
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, buoyancy = 1.2) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushSpark({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.35 + Math.random() * 0.95)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 4 + Math.random() * 9,
      color: color.clone(),
      coolTo: null,
      size: 0.45 + Math.random() * 0.55,
      age: 0,
      life: 0.5 + Math.random() * 0.6,
      drag: 3.4,
      buoyancy,
    });
  }
}

/** The parasite comes apart into its own plating and the pieces rot dark. */
export function burstShards(position: Vector3, specs: ShardSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.25),
      velocity: outward
        .clone()
        .multiplyScalar(4 + rng() * 6)
        .add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(2.4)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 2.5 + rng() * 6,
      color: spec.color.clone(),
      coolTo: ROT_GREY.clone(),
      size: 1.2 + spec.size * 2.4,
      age: 0,
      life: 0.9 + rng() * 0.6,
      drag: 2.6,
      buoyancy: -0.4,
    });
  }
}

/** Wake dropped behind shots and spores. */
export function dropTrail(position: Vector3, color: Color, size = 0.5) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 2,
    color: color.clone(),
    coolTo: null,
    size,
    age: 0,
    life: 0.3,
    drag: 1.6,
    buoyancy: 0.2,
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

export function spawnGlint(position: Vector3, color: Color, scale = 1, life = 0.18) {
  const glint = glints.find((candidate) => candidate.life < 0);
  if (!glint) return;
  glint.group.position.copy(position);
  glint.group.scale.setScalar(0.01);
  for (const material of glint.materials) material.color.setRGB(0, 0, 0);
  glint.group.visible = true;
  glint.color.copy(color);
  glint.age = 0;
  glint.life = life;
  glint.scale = scale;
}

/** A strand flushing clean: light races away from where the parasite let go. */
export function spawnStrandFlush(position: Vector3, direction: Vector3, reach = 26, life = 0.8) {
  const heal = heals.find((candidate) => candidate.life < 0);
  if (!heal) return;
  heal.group.position.copy(position);
  const forward = direction.lengthSq() < 1e-6 ? scratchVector.set(0, 0, 1) : scratchVector.copy(direction).normalize();
  heal.group.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), forward);
  for (const material of heal.materials) material.color.setRGB(0, 0, 0);
  heal.group.visible = true;
  heal.color.copy(LUME_GREEN);
  heal.age = 0;
  heal.life = life;
  heal.reach = reach;
}

/** A wide pressure front for boss beats. */
export function spawnVeil(position: Vector3, color: Color, toScale: number, life: number) {
  const veil = veils.find((candidate) => candidate.life < 0);
  if (!veil) return;
  veil.mesh.position.copy(position);
  veil.mesh.scale.setScalar(0.01);
  (veil.mesh.material as MeshBasicMaterial).color.setRGB(0, 0, 0);
  veil.mesh.visible = true;
  veil.color.copy(color);
  veil.age = 0;
  veil.life = life;
  veil.toScale = toScale;
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
      spark.velocity.y += spark.buoyancy * dt;
      spark.velocity.multiplyScalar(Math.max(0, 1 - spark.drag * dt));
      spark.position.addScaledVector(spark.velocity, dt);
      scratchQuaternion.setFromAxisAngle(spark.axis, spark.spin * dt);
      spark.rotation.premultiply(scratchQuaternion).normalize();

      const fade = 1 - spark.age / spark.life;
      scratchScale.setScalar(spark.size * (0.4 + fade * 0.6));
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
    const eased = 1 - (1 - progress) ** 2.4;
    ring.mesh.scale.setScalar(ring.fromScale + (ring.toScale - ring.fromScale) * eased);
    ring.mesh.quaternion.copy(camera.quaternion);
    (ring.mesh.material as MeshBasicMaterial).color.copy(ring.color).multiplyScalar((1 - progress) ** 1.6);
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
    glint.group.rotation.z += dt * 2.4;
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }

  for (const heal of heals) {
    if (heal.life < 0) continue;
    heal.age += dt;
    if (heal.age >= heal.life) {
      heal.life = -1;
      heal.group.visible = false;
      continue;
    }
    const progress = heal.age / heal.life;
    const eased = 1 - (1 - progress) ** 2.2;
    const reach = heal.reach * eased;
    const thickness = 1.1 * (1 - progress * 0.7);
    for (const [index, child] of heal.group.children.entries()) {
      if (index < 2) {
        child.scale.set(thickness, thickness, Math.max(0.01, reach));
        child.position.z = (index === 0 ? 1 : -1) * reach * 0.5;
      } else {
        child.scale.setScalar(Math.max(0.01, (1 - progress) * 2.6));
      }
    }
    const brightness = (1 - progress) ** 1.4;
    heal.materials[0].color.copy(heal.color).multiplyScalar(brightness * 1.1);
    heal.materials[1].color.copy(heal.color).multiplyScalar(brightness * 1.1);
    heal.materials[2].color.copy(LUME_GOLD).multiplyScalar(brightness * 2.0);
  }

  for (const veil of veils) {
    if (veil.life < 0) continue;
    veil.age += dt;
    if (veil.age >= veil.life) {
      veil.life = -1;
      veil.mesh.visible = false;
      continue;
    }
    const progress = veil.age / veil.life;
    const eased = 1 - (1 - progress) ** 3;
    veil.mesh.scale.setScalar(Math.max(0.01, veil.toScale * eased));
    veil.mesh.quaternion.copy(camera.quaternion);
    (veil.mesh.material as MeshBasicMaterial).color.copy(veil.color).multiplyScalar((1 - progress) ** 2);
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
  for (const heal of heals) {
    heal.life = -1;
    heal.group.visible = false;
  }
  for (const veil of veils) {
    veil.life = -1;
    veil.mesh.visible = false;
  }
}

/** Default rot palette for a parasite coming apart. */
export const ROT_SHARD_COLORS = [SICK_VIOLET, SICK_DARK] as const;

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
