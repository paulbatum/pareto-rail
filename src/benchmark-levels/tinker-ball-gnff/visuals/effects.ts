import {
  AdditiveBlending,
  Camera,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { TINKER_TABLE_Y } from '../gameplay';
import { LAMP } from './palette';

// Effect pools: additive spark shards, ring ripples, star glints, and — the
// Tinker-specific one — scatter debris that flies out of a broken glue body,
// tumbles, settles onto the table, and lingers as rescued clutter.

const SHARD_CAPACITY = 768;
const DEBRIS_CAPACITY = 512;
const RING_CAPACITY = 24;
const GLINT_CAPACITY = 12;

const DEBRIS_LINGER = 3.4; // seconds a settled piece stays visible after landing

type ShardParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // unit length: feeds setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
};

type DebrisPiece = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  spin: number;
  color: Color;
  scale: number;
  age: number;
  life: number;
  landed: boolean;
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

const shards: ShardParticle[] = [];
const debris: DebrisPiece[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];

let shardMesh: InstancedMesh | null = null;
let debrisMesh: InstancedMesh | null = null;

const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

export function createEffects(scene: Scene) {
  shardMesh = new InstancedMesh(
    new TetrahedronGeometry(0.12, 0),
    new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false }),
    SHARD_CAPACITY,
  );
  shardMesh.count = 0;
  shardMesh.frustumCulled = false;
  scene.add(shardMesh);

  debrisMesh = new InstancedMesh(
    new OctahedronGeometry(0.16, 0),
    new MeshBasicMaterial({ blending: NormalBlending, depthWrite: true }),
    DEBRIS_CAPACITY,
  );
  debrisMesh.count = 0;
  debrisMesh.frustumCulled = false;
  debrisMesh.userData.raildIgnoreOcclusion = true;
  scene.add(debrisMesh);

  const ringGeometry = new RingGeometry(0.965, 1, 48);
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
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}

export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    shards.push({
      position: position.clone(),
      velocity: direction.clone().multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: direction,
      rotation: new Quaternion(),
      spin: 8 + Math.random() * 14,
      color: color.clone(),
      size: 0.45 + Math.random() * 0.5,
      age: 0,
      life: 0.25 + Math.random() * 0.25,
      drag: 3.5,
    });
    if (shards.length > SHARD_CAPACITY) shards.shift();
  }
}

// A broken glue body sheds its stolen supplies: pieces fly outward, tumble,
// fall to the table, and rest there for a moment — rescued clutter the ball
// is about to roll through.
export function burstScatter(position: Vector3, specs: Array<{ direction: Vector3; color: Color; size: number }> | undefined, accent: Color) {
  const sources = specs && specs.length > 0
    ? specs
    : Array.from({ length: 9 }, () => ({ direction: randomUnit(Math.random), color: accent, size: 0.4 + Math.random() * 0.4 }));
  for (const spec of sources) {
    const outward = spec.direction.clone().normalize();
    const size = Math.max(0.16, Math.min(0.42, spec.size * 0.5));
    debris.push({
      position: position.clone().addScaledVector(outward, 0.3),
      velocity: outward
        .clone()
        .multiplyScalar(3.6 + Math.random() * 3.4 + size * 2)
        .add(randomUnit(Math.random).multiplyScalar(1.1)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion().setFromAxisAngle(randomUnit(Math.random), Math.random() * Math.PI * 2),
      spin: 4 + Math.random() * 7,
      color: spec.color.clone().lerp(accent, 0.25),
      scale: size * (0.8 + Math.random() * 0.5),
      age: 0,
      life: 2.2 + Math.random() * 0.8 + DEBRIS_LINGER,
      landed: false,
    });
    if (debris.length > DEBRIS_CAPACITY) debris.shift();
  }
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

export function dropTrail(position: Vector3, color: Color) {
  shards.push({
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
  if (shards.length > SHARD_CAPACITY) shards.shift();
}

function updateDebrisPiece(piece: DebrisPiece, dt: number) {
  piece.age += dt;
  if (!piece.landed) {
    piece.velocity.y -= 7.5 * dt;
    piece.velocity.multiplyScalar(Math.max(0, 1 - 1.6 * dt));
    piece.position.addScaledVector(piece.velocity, dt);
    if (piece.position.y <= TINKER_TABLE_Y + piece.scale * 0.5) {
      piece.position.y = TINKER_TABLE_Y + piece.scale * 0.5;
      piece.landed = true;
      piece.velocity.set(0, 0, 0);
      piece.spin = 0;
    }
    scratchQuaternion.setFromAxisAngle(piece.axis, piece.spin * dt);
    piece.rotation.premultiply(scratchQuaternion).normalize();
  }
}

export function updateEffects(dt: number, camera: Camera) {
  if (debrisMesh) {
    let count = 0;
    for (let i = debris.length - 1; i >= 0; i -= 1) {
      const piece = debris[i];
      updateDebrisPiece(piece, dt);
      if (piece.age >= piece.life) {
        debris.splice(i, 1);
        continue;
      }
      // Fade out late in life; pieces linger on the table before dissolving.
      const fadeStart = piece.life - DEBRIS_LINGER;
      const fade = piece.age < fadeStart ? 1 : Math.max(0, 1 - (piece.age - fadeStart) / DEBRIS_LINGER);
      scratchScale.setScalar(piece.scale * (0.6 + 0.4 * fade));
      scratchMatrix.compose(piece.position, piece.rotation, scratchScale);
      debrisMesh.setMatrixAt(count, scratchMatrix);
      scratchColor.copy(piece.color).multiplyScalar(0.35 + 0.65 * fade);
      debrisMesh.setColorAt(count, scratchColor);
      count += 1;
    }
    debrisMesh.count = count;
    debrisMesh.instanceMatrix.needsUpdate = true;
    if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
  }

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
      shard.position.addScaledVector(shard.velocity, dt);
      scratchQuaternion.setFromAxisAngle(shard.axis, shard.spin * dt);
      shard.rotation.premultiply(scratchQuaternion).normalize();
      const fade = 1 - shard.age / shard.life;
      scratchScale.setScalar(shard.size * (0.35 + fade * 0.65));
      scratchMatrix.compose(shard.position, shard.rotation, scratchScale);
      shardMesh.setMatrixAt(count, scratchMatrix);
      scratchColor.copy(shard.color).multiplyScalar(fade * fade);
      shardMesh.setColorAt(count, scratchColor);
      count += 1;
    }
    shardMesh.count = count;
    shardMesh.instanceMatrix.needsUpdate = true;
    if (shardMesh.instanceColor) shardMesh.instanceColor.needsUpdate = true;
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
    for (const material of glint.materials) {
      material.color.copy(glint.color).multiplyScalar(envelope);
    }
  }
}

export function resetEffects() {
  shards.length = 0;
  debris.length = 0;
  if (shardMesh) shardMesh.count = 0;
  if (debrisMesh) {
    debrisMesh.count = 0;
    if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
  }
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
}
