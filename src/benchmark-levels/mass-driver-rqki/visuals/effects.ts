import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './drones';

// Every effect in this level is a discharge of some kind: a shock ring off the
// coils, shrapnel, a jagged arc dumping charge into the barrel wall, a glint on
// the muzzle of a shot. All of it runs out of fixed-capacity pools that are
// allocated once, so a heavy boss volley costs the same draw calls as an empty
// frame and the performance gates stay flat across the run.

const RING_SLOTS = 26;
const BOLT_SLOTS = 22;
const GLINT_SLOTS = 24;
const SHARD_SLOTS = 320;
const TRAIL_SLOTS = 260;
const BOLT_POINTS = 9;

type Slot = { age: number; life: number; active: boolean };

type RingEffect = Slot & { mesh: Mesh; material: MeshBasicMaterial; radius: number; color: Color };
type BoltEffect = Slot & { line: LineSegments; material: LineBasicMaterial; color: Color };
type GlintEffect = Slot & { mesh: Mesh; material: MeshBasicMaterial; size: number; color: Color };
type ShardEffect = Slot & { index: number; position: Vector3; velocity: Vector3; spin: number; size: number; color: Color };
type TrailEffect = Slot & { index: number; position: Vector3; size: number; color: Color };

let root: Group | null = null;
let rings: RingEffect[] = [];
let bolts: BoltEffect[] = [];
let glints: GlintEffect[] = [];
let shards: ShardEffect[] = [];
let trails: TrailEffect[] = [];
let shardMesh: InstancedMesh | null = null;
let trailMesh: InstancedMesh | null = null;

const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

export function createEffects(scene: Scene) {
  disposeEffects();
  root = new Group();
  root.frustumCulled = false;

  rings = Array.from({ length: RING_SLOTS }, () => {
    const material = createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide });
    material.fog = false;
    const mesh = new Mesh(new RingGeometry(0.86, 1, 40), material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    root!.add(mesh);
    return { age: 0, life: 1, active: false, mesh, material, radius: 1, color: new Color() };
  });

  bolts = Array.from({ length: BOLT_SLOTS }, () => {
    const material = new LineBasicMaterial(additiveMaterialParameters({ color: 0xffffff }));
    material.fog = false;
    const line = new LineSegments(createBoltGeometry(), material);
    line.visible = false;
    line.frustumCulled = false;
    root!.add(line);
    return { age: 0, life: 1, active: false, line, material, color: new Color() };
  });

  glints = Array.from({ length: GLINT_SLOTS }, () => {
    const material = createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide });
    material.fog = false;
    const mesh = new Mesh(createGlintGeometry(), material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    root!.add(mesh);
    return { age: 0, life: 1, active: false, mesh, material, size: 1, color: new Color() };
  });

  const shardGeometry = new OctahedronGeometry(0.5, 0);
  shardGeometry.scale(0.4, 0.4, 1.6);
  shardMesh = new InstancedMesh(shardGeometry, createAdditiveBasicMaterial({ color: 0xffffff }), SHARD_SLOTS);
  (shardMesh.material as MeshBasicMaterial).fog = false;
  shardMesh.frustumCulled = false;
  root.add(shardMesh);
  shards = Array.from({ length: SHARD_SLOTS }, (_unused, index) => ({
    age: 0,
    life: 1,
    active: false,
    index,
    position: new Vector3(),
    velocity: new Vector3(),
    spin: 0,
    size: 1,
    color: new Color(),
  }));

  const trailGeometry = new OctahedronGeometry(0.16, 0);
  trailMesh = new InstancedMesh(trailGeometry, createAdditiveBasicMaterial({ color: 0xffffff }), TRAIL_SLOTS);
  (trailMesh.material as MeshBasicMaterial).fog = false;
  trailMesh.frustumCulled = false;
  root.add(trailMesh);
  trails = Array.from({ length: TRAIL_SLOTS }, (_unused, index) => ({
    age: 0,
    life: 1,
    active: false,
    index,
    position: new Vector3(),
    size: 1,
    color: new Color(),
  }));

  for (let i = 0; i < SHARD_SLOTS; i += 1) shardMesh.setMatrixAt(i, HIDDEN);
  for (let i = 0; i < TRAIL_SLOTS; i += 1) trailMesh.setMatrixAt(i, HIDDEN);
  shardMesh.instanceMatrix.needsUpdate = true;
  trailMesh.instanceMatrix.needsUpdate = true;

  scene.add(root);
  return root;
}

export function resetEffects() {
  for (const ring of rings) deactivate(ring, ring.mesh);
  for (const bolt of bolts) deactivate(bolt, bolt.line);
  for (const glint of glints) deactivate(glint, glint.mesh);
  for (const shard of shards) {
    shard.active = false;
    shardMesh?.setMatrixAt(shard.index, HIDDEN);
  }
  for (const trail of trails) {
    trail.active = false;
    trailMesh?.setMatrixAt(trail.index, HIDDEN);
  }
  if (shardMesh) shardMesh.instanceMatrix.needsUpdate = true;
  if (trailMesh) trailMesh.instanceMatrix.needsUpdate = true;
}

export function disposeEffects() {
  root?.removeFromParent();
  root = null;
  rings = [];
  bolts = [];
  glints = [];
  shards = [];
  trails = [];
  shardMesh = null;
  trailMesh = null;
}

/** An expanding shock ring, aligned to face the camera each frame. */
export function spawnShock(position: Vector3, color: Color, radius: number, life: number) {
  const slot = claim(rings);
  if (!slot) return;
  slot.mesh.position.copy(position);
  slot.mesh.visible = true;
  slot.radius = radius;
  slot.color.copy(color);
  slot.age = 0;
  slot.life = life;
  slot.active = true;
}

/**
 * A jagged arc from a point out along a direction — charge dumping into the
 * bore. Kills throw one of these at the nearest wall, which is the level's
 * most-repeated visual sentence.
 */
export function spawnArc(position: Vector3, direction: Vector3, length: number, color: Color, life: number) {
  const slot = claim(bolts);
  if (!slot) return;
  if (direction.lengthSq() < 0.0001) return;
  slot.line.position.copy(position);
  slot.line.quaternion.setFromUnitVectors(FORWARD, direction.clone().normalize());
  slot.line.scale.set(1 + Math.random() * 0.5, 1 + Math.random() * 0.5, length);
  slot.line.visible = true;
  slot.color.copy(color);
  slot.age = 0;
  slot.life = life;
  slot.active = true;
}

/** A four-point star flash: muzzle glints, impact sparks, coil strikes. */
export function spawnGlint(position: Vector3, color: Color, size: number, life: number) {
  const slot = claim(glints);
  if (!slot) return;
  slot.mesh.position.copy(position);
  slot.mesh.visible = true;
  slot.size = size;
  slot.color.copy(color);
  slot.age = 0;
  slot.life = life;
  slot.active = true;
}

/** Shrapnel from a destroyed target, thrown along its own authored shard set. */
export function burstShards(position: Vector3, specs: readonly ShardSpec[], speed: number, life = 0.6) {
  for (const spec of specs) {
    const slot = claim(shards);
    if (!slot) return;
    slot.position.copy(position);
    slot.velocity.copy(spec.direction).multiplyScalar(speed * (0.55 + Math.random() * 0.9));
    slot.spin = (Math.random() - 0.5) * 16;
    slot.size = spec.size;
    slot.color.copy(spec.color);
    slot.age = 0;
    slot.life = life * (0.7 + Math.random() * 0.6);
    slot.active = true;
  }
}

/** Generic spark spray for hits and intercepts. */
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, life = 0.34) {
  for (let i = 0; i < count; i += 1) {
    const slot = claim(shards);
    if (!slot) return;
    slot.position.copy(position);
    slot.velocity.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
      .normalize()
      .multiplyScalar(speed * (0.4 + Math.random()));
    slot.spin = (Math.random() - 0.5) * 20;
    slot.size = 0.16 + Math.random() * 0.16;
    slot.color.copy(color);
    slot.age = 0;
    slot.life = life * (0.6 + Math.random() * 0.8);
    slot.active = true;
  }
}

/** Drop one fading mote at a moving object's position. */
export function dropTrail(position: Vector3, color: Color, size = 1) {
  const slot = claim(trails);
  if (!slot) return;
  slot.position.copy(position);
  slot.size = size;
  slot.color.copy(color);
  slot.age = 0;
  slot.life = 0.3;
  slot.active = true;
}

export function updateEffects(dt: number, camera: Camera) {
  for (const ring of rings) {
    if (!step(ring, dt)) continue;
    const t = ring.age / ring.life;
    ring.mesh.quaternion.copy(camera.quaternion);
    ring.mesh.scale.setScalar(ring.radius * (0.12 + t * 0.88));
    ring.material.color.copy(ring.color).multiplyScalar(1 - t);
    ring.material.opacity = (1 - t) ** 1.5;
    if (!ring.active) ring.mesh.visible = false;
  }

  for (const bolt of bolts) {
    if (!step(bolt, dt)) continue;
    const t = bolt.age / bolt.life;
    // Arcs do not fade smoothly; they stutter out like a real discharge.
    const flicker = t > 0.55 ? (Math.random() > 0.4 ? 1 : 0.15) : 1;
    bolt.material.color.copy(bolt.color).multiplyScalar((1 - t) * flicker);
    bolt.material.opacity = (1 - t) * flicker;
    if (!bolt.active) bolt.line.visible = false;
  }

  for (const glint of glints) {
    if (!step(glint, dt)) continue;
    const t = glint.age / glint.life;
    glint.mesh.quaternion.copy(camera.quaternion);
    glint.mesh.rotateZ(t * 1.4);
    glint.mesh.scale.setScalar(glint.size * (0.3 + (1 - (1 - t) ** 3) * 1.1));
    glint.material.color.copy(glint.color).multiplyScalar(1 - t);
    glint.material.opacity = (1 - t) ** 2;
    if (!glint.active) glint.mesh.visible = false;
  }

  if (shardMesh) {
    let dirty = false;
    for (const shard of shards) {
      if (!shard.active) continue;
      dirty = true;
      shard.age += dt;
      if (shard.age >= shard.life) {
        shard.active = false;
        shardMesh.setMatrixAt(shard.index, HIDDEN);
        continue;
      }
      const t = shard.age / shard.life;
      shard.position.addScaledVector(shard.velocity, dt);
      shard.velocity.multiplyScalar(1 - Math.min(1, dt * 2.2));
      scratchQuaternion.copy(camera.quaternion);
      scratchScale.setScalar(shard.size * (1 - t * 0.6));
      scratchMatrix.compose(shard.position, scratchQuaternion, scratchScale);
      shardMesh.setMatrixAt(shard.index, scratchMatrix);
      shardMesh.setColorAt(shard.index, scratchColor.copy(shard.color).multiplyScalar((1 - t) ** 1.4));
      void shard.spin;
    }
    if (dirty) {
      shardMesh.instanceMatrix.needsUpdate = true;
      if (shardMesh.instanceColor) shardMesh.instanceColor.needsUpdate = true;
    }
  }

  if (trailMesh) {
    let dirty = false;
    for (const trail of trails) {
      if (!trail.active) continue;
      dirty = true;
      trail.age += dt;
      if (trail.age >= trail.life) {
        trail.active = false;
        trailMesh.setMatrixAt(trail.index, HIDDEN);
        continue;
      }
      const t = trail.age / trail.life;
      scratchQuaternion.copy(camera.quaternion);
      scratchScale.setScalar(trail.size * (1 - t) * 1.3);
      scratchMatrix.compose(trail.position, scratchQuaternion, scratchScale);
      trailMesh.setMatrixAt(trail.index, scratchMatrix);
      trailMesh.setColorAt(trail.index, scratchColor.copy(trail.color).multiplyScalar((1 - t) ** 1.6));
    }
    if (dirty) {
      trailMesh.instanceMatrix.needsUpdate = true;
      if (trailMesh.instanceColor) trailMesh.instanceColor.needsUpdate = true;
    }
  }
}

const FORWARD = new Vector3(0, 0, 1);

function claim<T extends Slot>(pool: T[]): T | null {
  let oldest: T | null = null;
  for (const slot of pool) {
    if (!slot.active) return slot;
    if (!oldest || slot.age > oldest.age) oldest = slot;
  }
  return oldest;
}

function step(slot: Slot, dt: number) {
  if (!slot.active) return false;
  slot.age += dt;
  if (slot.age >= slot.life) slot.active = false;
  return true;
}

function deactivate(slot: Slot, object: { visible: boolean }) {
  slot.active = false;
  slot.age = slot.life;
  object.visible = false;
}

/** A zig-zag polyline along +Z, unit length, jittered off-axis. */
function createBoltGeometry() {
  const positions: number[] = [];
  let previous = new Vector3(0, 0, 0);
  for (let i = 1; i <= BOLT_POINTS; i += 1) {
    const t = i / BOLT_POINTS;
    const spread = Math.sin(t * Math.PI) * 0.22;
    const next = new Vector3((Math.random() * 2 - 1) * spread, (Math.random() * 2 - 1) * spread, t);
    positions.push(previous.x, previous.y, previous.z, next.x, next.y, next.z);
    previous = next;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

/** Four-point star: two crossed slivers, cheaper and sharper than a sprite. */
function createGlintGeometry() {
  const positions: number[] = [];
  const push = (x: number, y: number) => positions.push(x, y, 0);
  const arm = (angle: number, long: number, wide: number) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const tip = [cos * long, sin * long];
    const left = [-sin * wide, cos * wide];
    const right = [sin * wide, -cos * wide];
    push(left[0], left[1]);
    push(tip[0], tip[1]);
    push(right[0], right[1]);
  };
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    arm(angle, i % 2 === 0 ? 1 : 0.55, 0.075);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}
