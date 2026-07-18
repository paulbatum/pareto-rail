import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { Object3D } from 'three';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';

// Everything a hit throws off in this level is electrical, and the barrel is a
// vacuum: NO GRAVITY on any particle. Splinters fly straight, aligned to their
// own travel, and wink out fast.

const SPLINTER_CAPACITY = 900;
const RING_CAPACITY = 28;
const GLINT_CAPACITY = 14;
const BOLT_CAPACITY = 22;
const BOLT_POINTS = 9;
const DISC_CAPACITY = 6;

const UP = new Vector3(0, 1, 0);
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

type Splinter = {
  position: Vector3;
  velocity: Vector3;
  rotation: Quaternion;
  color: Color;
  length: number;
  width: number;
  age: number;
  life: number;
  drag: number;
};

type ShockRing = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  fromScale: number;
  toScale: number;
};

type Glint = {
  group: Group;
  materials: MeshBasicMaterial[];
  color: Color;
  age: number;
  life: number;
  scale: number;
};

type ArcBolt = {
  line: Line;
  material: LineBasicMaterial;
  positions: BufferAttribute;
  from: Vector3;
  to: Vector3;
  color: Color;
  jitter: number;
  age: number;
  life: number;
};

type FlashDisc = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  scale: number;
};

const splinters: Splinter[] = [];
const rings: ShockRing[] = [];
const glints: Glint[] = [];
const bolts: ArcBolt[] = [];
const discs: FlashDisc[] = [];

let splinterMesh: InstancedMesh | null = null;

export function createEffects(scene: Scene) {
  // Pools are module state, so a re-mounted level must reclaim the previous
  // scene's objects rather than stacking a second set on top of them.
  disposeEffects();

  // A splinter is a thin unit-length sliver along +Y; the instance quaternion
  // aims it down its own velocity, so sparks read as streaks, not dots.
  splinterMesh = new InstancedMesh(
    new PlaneGeometry(1, 1),
    createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide }),
    SPLINTER_CAPACITY,
  );
  splinterMesh.count = 0;
  splinterMesh.frustumCulled = false;
  scene.add(splinterMesh);

  // Thin rings only: a fat ring under bloom becomes a wall of light.
  const ringGeometry = new RingGeometry(0.962, 1, 64);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  // Cross-glints mark the player's own impacts: tiny screen area, so bloom
  // turns them into a sharp four-point sparkle instead of a white wash.
  const bladeGeometry = new PlaneGeometry(1.8, 0.05);
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

  // The signature effect: a jagged polyline that snaps between two points and
  // flickers as it dies. Kills, armor chips, capacitor crackle, denials.
  for (let i = 0; i < BOLT_CAPACITY; i += 1) {
    const geometry = new BufferGeometry();
    const positions = new BufferAttribute(new Float32Array(BOLT_POINTS * 3), 3);
    positions.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', positions);
    const material = new LineBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false });
    const line = new Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    bolts.push({
      line,
      material,
      positions,
      from: new Vector3(),
      to: new Vector3(),
      color: new Color(),
      jitter: 1,
      age: 0,
      life: -1,
    });
  }

  // Camera-facing flash discs: the muzzle whiteout and the detonation.
  const discGeometry = new CircleGeometry(1, 40);
  for (let i = 0; i < DISC_CAPACITY; i += 1) {
    const mesh = new Mesh(discGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    discs.push({ mesh, color: new Color(), age: 0, life: -1, scale: 1 });
  }
}

function randomUnit(): Vector3 {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}

/** Straight-flying sparks that align to their travel. `directions` seeds the level's per-kind facets. */
export function burstSplinters(
  position: Vector3,
  color: Color,
  count: number,
  speed: number,
  directions?: readonly Vector3[],
) {
  for (let i = 0; i < count; i += 1) {
    const base = directions && directions.length > 0
      ? directions[i % directions.length].clone().normalize()
      : randomUnit();
    const direction = base.addScaledVector(randomUnit(), 0.34).normalize();
    const velocity = direction.clone().multiplyScalar(speed * (0.5 + Math.random() * 0.85));
    if (splinters.length >= SPLINTER_CAPACITY) splinters.shift();
    splinters.push({
      position: position.clone(),
      velocity,
      rotation: new Quaternion().setFromUnitVectors(UP, direction),
      color: color.clone(),
      length: 0.9 + Math.random() * 1.5,
      width: 0.035 + Math.random() * 0.03,
      age: 0,
      life: 0.2 + Math.random() * 0.22,
      drag: 1.2,
    });
  }
}

/** A short dim streak dropped behind a player shot each frame. */
export function dropTrail(position: Vector3, direction: Vector3, color: Color) {
  if (splinters.length >= SPLINTER_CAPACITY) splinters.shift();
  const aim = direction.lengthSq() > 0.0001 ? direction.clone().normalize() : randomUnit();
  splinters.push({
    position: position.clone(),
    velocity: aim.clone().multiplyScalar(-2.5),
    rotation: new Quaternion().setFromUnitVectors(UP, aim),
    color: color.clone(),
    length: 1.5,
    width: 0.05,
    age: 0,
    life: 0.16,
    drag: 3,
  });
}

export function spawnShock(position: Vector3, color: Color, toScale: number, life: number) {
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

export function spawnGlint(position: Vector3, color: Color, scale = 1, life = 0.16) {
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

function spawnArcBolt(from: Vector3, to: Vector3, color: Color, jitter = 1, life = 0.2) {
  const bolt = bolts.find((candidate) => candidate.life < 0);
  if (!bolt) return;
  bolt.from.copy(from);
  bolt.to.copy(to);
  bolt.color.copy(color);
  bolt.jitter = jitter;
  bolt.age = 0;
  bolt.life = life;
  bolt.line.visible = true;
  writeBolt(bolt);
}

/** A whip of lightning lashing outward from a point in `count` directions. */
export function burstArcWhip(position: Vector3, color: Color, count: number, reach: number, jitter = 1) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit().multiplyScalar(reach * (0.6 + Math.random() * 0.7));
    spawnArcBolt(position, position.clone().add(direction), color, jitter, 0.16 + Math.random() * 0.14);
  }
}

export function spawnFlashDisc(position: Vector3, color: Color, scale: number, life: number) {
  const disc = discs.find((candidate) => candidate.life < 0);
  if (!disc) return;
  disc.mesh.position.copy(position);
  disc.mesh.scale.setScalar(0.01);
  (disc.mesh.material as MeshBasicMaterial).color.setRGB(0, 0, 0);
  disc.mesh.visible = true;
  disc.color.copy(color);
  disc.age = 0;
  disc.life = life;
  disc.scale = scale;
}

function writeBolt(bolt: ArcBolt) {
  const array = bolt.positions.array as Float32Array;
  const span = bolt.to.clone().sub(bolt.from);
  // A stable perpendicular basis so the kink stays in a readable plane.
  const axis = span.clone().normalize();
  const side = Math.abs(axis.y) > 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(axis, side).normalize();
  const up = new Vector3().crossVectors(right, axis).normalize();
  const amplitude = span.length() * 0.16 * bolt.jitter;
  for (let i = 0; i < BOLT_POINTS; i += 1) {
    const t = i / (BOLT_POINTS - 1);
    const taper = Math.sin(t * Math.PI);
    const point = bolt.from.clone().addScaledVector(span, t);
    point.addScaledVector(right, (Math.random() * 2 - 1) * amplitude * taper);
    point.addScaledVector(up, (Math.random() * 2 - 1) * amplitude * taper);
    array[i * 3] = point.x;
    array[i * 3 + 1] = point.y;
    array[i * 3 + 2] = point.z;
  }
  bolt.positions.needsUpdate = true;
}

export function updateEffects(dt: number, camera: Camera) {
  if (splinterMesh) {
    let count = 0;
    for (let i = splinters.length - 1; i >= 0; i -= 1) {
      const splinter = splinters[i];
      splinter.age += dt;
      if (splinter.age >= splinter.life) {
        splinters.splice(i, 1);
        continue;
      }
      // Vacuum: drag only, never gravity.
      splinter.velocity.multiplyScalar(Math.max(0, 1 - splinter.drag * dt));
      splinter.position.addScaledVector(splinter.velocity, dt);
      const fade = 1 - splinter.age / splinter.life;
      scratchScale.set(splinter.width, splinter.length * (0.4 + fade * 0.6), 1);
      scratchMatrix.compose(splinter.position, splinter.rotation, scratchScale);
      splinterMesh.setMatrixAt(count, scratchMatrix);
      scratchColor.copy(splinter.color).multiplyScalar(fade * fade);
      splinterMesh.setColorAt(count, scratchColor);
      count += 1;
    }
    splinterMesh.count = count;
    splinterMesh.instanceMatrix.needsUpdate = true;
    if (splinterMesh.instanceColor) splinterMesh.instanceColor.needsUpdate = true;
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
    const eased = 1 - (1 - progress) ** 2;
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
    const envelope = Math.sin(Math.min(1, (glint.age / glint.life) * 1.15) * Math.PI);
    glint.group.scale.setScalar(Math.max(0.01, glint.scale * envelope));
    glint.group.quaternion.copy(camera.quaternion);
    glint.group.rotation.z += dt * 3.4;
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }

  for (const bolt of bolts) {
    if (bolt.life < 0) continue;
    bolt.age += dt;
    if (bolt.age >= bolt.life) {
      bolt.life = -1;
      bolt.line.visible = false;
      continue;
    }
    // Re-kink every other frame: the flicker is the tell that it is unstable.
    if (Math.random() < 0.55) writeBolt(bolt);
    const fade = 1 - bolt.age / bolt.life;
    bolt.material.color.copy(bolt.color);
    bolt.material.opacity = fade * (0.55 + Math.random() * 0.45);
  }

  for (const disc of discs) {
    if (disc.life < 0) continue;
    disc.age += dt;
    if (disc.age >= disc.life) {
      disc.life = -1;
      disc.mesh.visible = false;
      continue;
    }
    const progress = disc.age / disc.life;
    disc.mesh.scale.setScalar(disc.scale * (0.25 + progress * 1.35));
    disc.mesh.quaternion.copy(camera.quaternion);
    (disc.mesh.material as MeshBasicMaterial).color.copy(disc.color).multiplyScalar((1 - progress) ** 2.2);
  }
}

/** Tear the pools down: removes every pooled object from its scene and frees it. */
export function disposeEffects() {
  const owned: Object3D[] = [
    ...(splinterMesh ? [splinterMesh as Object3D] : []),
    ...rings.map((ring) => ring.mesh),
    ...glints.map((glint) => glint.group),
    ...bolts.map((bolt) => bolt.line),
    ...discs.map((disc) => disc.mesh),
  ];
  for (const object of owned) {
    object.removeFromParent();
    disposeObject3D(object);
  }
  splinterMesh = null;
  splinters.length = 0;
  rings.length = 0;
  glints.length = 0;
  bolts.length = 0;
  discs.length = 0;
}

export function resetEffects() {
  splinters.length = 0;
  if (splinterMesh) splinterMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
  for (const bolt of bolts) {
    bolt.life = -1;
    bolt.line.visible = false;
  }
  for (const disc of discs) {
    disc.life = -1;
    disc.mesh.visible = false;
  }
}
