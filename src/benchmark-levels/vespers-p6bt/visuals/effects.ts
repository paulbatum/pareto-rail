import {
  BufferGeometry,
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
  ShapeGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { mergeParts, vesicaShape } from './shapes';

// Four transient effects, all pooled, all in the level's own language:
// broken glass, a halo, a cross of light, and — the one that carries the
// level's idea — a thread of light running from a kill back to the window it
// was taken from.

const SPLINTER_CAPACITY = 900;
const HALO_CAPACITY = 20;
const CROSS_CAPACITY = 10;
const RETURN_CAPACITY = 14;

export type Splinter = {
  direction: Vector3;
  size: number;
};

type GlassShard = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  spin: number;
  colour: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
  gravity: number;
};

type Halo = { mesh: Mesh; colour: Color; age: number; life: number; from: number; to: number };
type Cross = { group: Group; materials: MeshBasicMaterial[]; colour: Color; age: number; life: number; scale: number };
type Return = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  colour: Color;
  from: Vector3;
  to: Vector3;
  age: number;
  life: number;
};

const shards: GlassShard[] = [];
const halos: Halo[] = [];
const crosses: Cross[] = [];
const returns: Return[] = [];

let shardMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColour = new Color();
const scratchVector = new Vector3();

const FORWARD = new Vector3(0, 0, 1);

export function createEffects(scene: Scene) {
  shardMesh = new InstancedMesh(
    new ShapeGeometry(vesicaShape(0.11, 0.3), 4),
    createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide }),
    SPLINTER_CAPACITY,
  );
  shardMesh.count = 0;
  shardMesh.frustumCulled = false;
  shardMesh.userData.raildIgnoreOcclusion = true;
  scene.add(shardMesh);

  const haloGeometry = new RingGeometry(0.955, 1, 48);
  for (let i = 0; i < HALO_CAPACITY; i += 1) {
    const mesh = new Mesh(haloGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    halos.push({ mesh, colour: new Color(), age: 0, life: -1, from: 0, to: 1 });
  }

  // A cross of light: the long arm down, so a kill flash reads as a mark and
  // not as a generic four-point sparkle.
  const armGeometry = new PlaneGeometry(0.05, 2.4);
  const barGeometry = new PlaneGeometry(1.4, 0.05);
  for (let i = 0; i < CROSS_CAPACITY; i += 1) {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    for (const [geometry, y] of [[armGeometry, -0.25] as const, [barGeometry, 0.35] as const]) {
      const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
      const blade = new Mesh(geometry, material);
      blade.position.y = y;
      group.add(blade);
      materials.push(material);
    }
    group.visible = false;
    group.userData.raildIgnoreOcclusion = true;
    scene.add(group);
    crosses.push({ group, materials, colour: new Color(), age: 0, life: -1, scale: 1 });
  }

  const beamGeometry = buildBeamGeometry();
  for (let i = 0; i < RETURN_CAPACITY; i += 1) {
    const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
    const mesh = new Mesh(beamGeometry, material);
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    returns.push({ mesh, material, colour: new Color(), from: new Vector3(), to: new Vector3(), age: 0, life: -1 });
  }
}

/** Glass coming apart along the leads it was held by. */
export function shatter(position: Vector3, specs: Splinter[] | undefined, colour: Color, energy = 1) {
  const source = specs ?? FALLBACK_SPLINTERS;
  for (const spec of source) {
    pushShard({
      position: position.clone().addScaledVector(spec.direction, 0.3),
      velocity: spec.direction.clone().multiplyScalar((5.5 + spec.size * 5) * energy),
      axis: spec.direction.clone(),
      rotation: new Quaternion(),
      spin: 5 + spec.size * 9,
      colour: colour.clone(),
      size: spec.size * 1.5,
      age: 0,
      life: 0.75 + spec.size * 0.5,
      drag: 1.9,
      gravity: 5.2,
    });
  }
}

/** A short spray: non-lethal chips, lock ticks, and shot impacts. */
export function chips(position: Vector3, colour: Color, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit();
    pushShard({
      position: position.clone(),
      velocity: direction.clone().multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: direction,
      rotation: new Quaternion(),
      spin: 9 + Math.random() * 12,
      colour: colour.clone(),
      size: 0.4 + Math.random() * 0.4,
      age: 0,
      life: 0.22 + Math.random() * 0.24,
      drag: 3.4,
      gravity: 1.2,
    });
  }
}

/** Sooty motes shed by a projectile as it flies. */
export function ember(position: Vector3, colour: Color) {
  pushShard({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4),
    axis: randomUnit(),
    rotation: new Quaternion(),
    spin: 3,
    colour: colour.clone(),
    size: 0.42,
    age: 0,
    life: 0.26,
    drag: 1,
    gravity: 0,
  });
}

export function halo(position: Vector3, colour: Color, toScale: number, life: number) {
  const slot = halos.find((entry) => entry.life < 0);
  if (!slot) return;
  slot.mesh.position.copy(position);
  slot.mesh.scale.setScalar(toScale * 0.1);
  (slot.mesh.material as MeshBasicMaterial).color.setRGB(0, 0, 0);
  slot.mesh.visible = true;
  slot.colour.copy(colour);
  slot.age = 0;
  slot.life = life;
  slot.from = toScale * 0.1;
  slot.to = toScale;
}

export function cross(position: Vector3, colour: Color, scale: number, life: number) {
  const slot = crosses.find((entry) => entry.life < 0);
  if (!slot) return;
  slot.group.position.copy(position);
  slot.group.scale.setScalar(0.01);
  for (const material of slot.materials) material.color.setRGB(0, 0, 0);
  slot.group.visible = true;
  slot.colour.copy(colour);
  slot.age = 0;
  slot.life = life;
  slot.scale = scale;
}

/** The light going home: a thread that runs from the kill to the window. */
export function returnLight(from: Vector3, to: Vector3, colour: Color, life = 0.55) {
  const slot = returns.find((entry) => entry.life < 0);
  if (!slot) return;
  slot.from.copy(from);
  slot.to.copy(to);
  slot.colour.copy(colour);
  slot.material.color.setRGB(0, 0, 0);
  slot.mesh.visible = true;
  slot.age = 0;
  slot.life = life;
}

export function updateEffects(dt: number, camera: Camera) {
  if (shardMesh) {
    let count = 0;
    for (let i = shards.length - 1; i >= 0; i -= 1) {
      const shard = shards[i];
      shard.age += dt;
      if (shard.age >= shard.life) {
        shards.splice(i, 1);
        continue;
      }
      shard.velocity.multiplyScalar(Math.max(0, 1 - shard.drag * dt));
      shard.velocity.y -= shard.gravity * dt;
      shard.position.addScaledVector(shard.velocity, dt);
      scratchQuaternion.setFromAxisAngle(shard.axis, shard.spin * dt);
      shard.rotation.premultiply(scratchQuaternion).normalize();

      const fade = 1 - shard.age / shard.life;
      scratchScale.setScalar(shard.size * (0.4 + fade * 0.6));
      scratchMatrix.compose(shard.position, shard.rotation, scratchScale);
      shardMesh.setMatrixAt(count, scratchMatrix);
      scratchColour.copy(shard.colour).multiplyScalar(fade * fade * 2.4);
      shardMesh.setColorAt(count, scratchColour);
      count += 1;
    }
    shardMesh.count = count;
    shardMesh.instanceMatrix.needsUpdate = true;
    if (shardMesh.instanceColor) shardMesh.instanceColor.needsUpdate = true;
  }

  for (const slot of halos) {
    if (slot.life < 0) continue;
    slot.age += dt;
    if (slot.age >= slot.life) {
      slot.life = -1;
      slot.mesh.visible = false;
      continue;
    }
    const progress = slot.age / slot.life;
    const eased = 1 - (1 - progress) ** 2;
    slot.mesh.scale.setScalar(slot.from + (slot.to - slot.from) * eased);
    slot.mesh.quaternion.copy(camera.quaternion);
    (slot.mesh.material as MeshBasicMaterial).color.copy(slot.colour).multiplyScalar((1 - progress) ** 1.6);
  }

  for (const slot of crosses) {
    if (slot.life < 0) continue;
    slot.age += dt;
    if (slot.age >= slot.life) {
      slot.life = -1;
      slot.group.visible = false;
      continue;
    }
    const progress = slot.age / slot.life;
    const envelope = Math.sin(Math.min(1, progress * 1.15) * Math.PI);
    slot.group.scale.setScalar(Math.max(0.01, slot.scale * envelope));
    slot.group.quaternion.copy(camera.quaternion);
    for (const material of slot.materials) material.color.copy(slot.colour).multiplyScalar(envelope);
  }

  for (const slot of returns) {
    if (slot.life < 0) continue;
    slot.age += dt;
    if (slot.age >= slot.life) {
      slot.life = -1;
      slot.mesh.visible = false;
      continue;
    }
    const progress = slot.age / slot.life;
    const head = Math.min(1, progress * 1.7);
    scratchVector.copy(slot.to).sub(slot.from);
    const distance = scratchVector.length();
    if (distance < 0.001) continue;
    scratchVector.divideScalar(distance);
    const length = Math.max(0.01, distance * head);
    slot.mesh.position.copy(slot.from).addScaledVector(scratchVector, length / 2);
    slot.mesh.quaternion.setFromUnitVectors(FORWARD, scratchVector);
    slot.mesh.scale.set(0.5 + (1 - progress) * 0.9, 0.5 + (1 - progress) * 0.9, length);
    slot.material.color.copy(slot.colour).multiplyScalar((1 - progress) ** 1.4 * 2.6);
  }
}

export function resetEffects() {
  shards.length = 0;
  if (shardMesh) shardMesh.count = 0;
  for (const slot of halos) {
    slot.life = -1;
    slot.mesh.visible = false;
  }
  for (const slot of crosses) {
    slot.life = -1;
    slot.group.visible = false;
  }
  for (const slot of returns) {
    slot.life = -1;
    slot.mesh.visible = false;
  }
}

function pushShard(shard: GlassShard) {
  if (shards.length >= SPLINTER_CAPACITY) shards.shift();
  shards.push(shard);
}

/** Crossed quads along the beam axis so a thread never vanishes edge-on. */
function buildBeamGeometry() {
  const parts: BufferGeometry[] = [];
  for (const roll of [0, Math.PI / 2]) {
    parts.push(new PlaneGeometry(0.34, 1).rotateX(Math.PI / 2).rotateZ(roll));
  }
  return mergeParts(parts);
}

const FALLBACK_SPLINTERS: Splinter[] = Array.from({ length: 8 }, (_, i) => ({
  direction: new Vector3(Math.cos((i / 8) * Math.PI * 2), Math.sin((i / 8) * Math.PI * 2), 0).normalize(),
  size: 0.5,
}));

function randomUnit() {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
}
