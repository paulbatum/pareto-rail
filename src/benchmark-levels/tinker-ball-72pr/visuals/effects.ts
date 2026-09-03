import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  TetrahedronGeometry,
  Vector3,
  type Camera,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { createPlayerBall, debrisGeometries, debrisGeometryFor } from './enemies';
import { AMBER, CREAM, hdr } from './palette';
import type { ShardSpec } from './enemies';

// Transient rings/glints/sparks, persistent table debris, and the player's
// rolling ball (which grows across the run and keeps every kill stuck to
// its surface). Debris chunks fall with gravity, rest on the tabletop, and
// remain there — the ball scoops through fresh fields as the camera
// advances over them.

type Ring = { mesh: Mesh; material: MeshBasicMaterial; age: number; life: number; grow: number };
type Glint = { mesh: Mesh; material: MeshBasicMaterial; age: number; life: number };
type Shard = { mesh: Mesh; velocity: Vector3; spin: Vector3; age: number; life: number };
type Chunk = { mesh: Mesh; velocity: Vector3; spin: Vector3; resting: boolean; size: number };

const MAX_CHUNKS = 170;
const MAX_STUCK_BITS = 130;

let parent: Scene | Group | null = null;
const rings: Ring[] = [];
const glints: Glint[] = [];
const shards: Shard[] = [];
const chunks: Chunk[] = [];

const ringGeo = new RingGeometry(0.85, 1, 40);
const glintGeo = new OctahedronGeometry(0.5);
const shardGeo = new TetrahedronGeometry(0.3);

// --- Recycled spark points (additive: fade by scaling color to black) ---------
const SPARK_MAX = 700;
let sparkPoints: Points | null = null;
let sparkCursor = 0;
const sparkPos = new Float32Array(SPARK_MAX * 3);
const sparkCol = new Float32Array(SPARK_MAX * 3);
const sparkVel: Vector3[] = [];
const sparkLife = new Float32Array(SPARK_MAX);
const sparkMaxLife = new Float32Array(SPARK_MAX);
const sparkBase: Color[] = [];
const sparkGravity = new Float32Array(SPARK_MAX);

function initSparks(scene: Scene) {
  for (let i = 0; i < SPARK_MAX; i += 1) {
    sparkVel.push(new Vector3());
    sparkBase.push(new Color(0, 0, 0));
    sparkPos[i * 3 + 1] = -999;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(sparkPos, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(sparkCol, 3));
  sparkPoints = new Points(
    geometry,
    new PointsMaterial({
      size: 0.24,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  sparkPoints.frustumCulled = false;
  scene.add(sparkPoints);
}

export function burstSparks(position: Vector3, color: Color, count: number, speed: number, gravity = 6) {
  for (let n = 0; n < count; n += 1) {
    const i = sparkCursor;
    sparkCursor = (sparkCursor + 1) % SPARK_MAX;
    sparkPos[i * 3] = position.x;
    sparkPos[i * 3 + 1] = position.y;
    sparkPos[i * 3 + 2] = position.z;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const v = speed * (0.4 + Math.random() * 0.9);
    sparkVel[i].set(
      Math.sin(phi) * Math.cos(theta) * v,
      Math.abs(Math.cos(phi)) * v * 0.9,
      Math.sin(phi) * Math.sin(theta) * v,
    );
    sparkBase[i].copy(color);
    sparkLife[i] = sparkMaxLife[i] = 0.4 + Math.random() * 0.45;
    sparkGravity[i] = gravity;
  }
}

// --- Rings and glints ------------------------------------------------------------
export function spawnRing(position: Vector3, color: Color, size: number, life: number) {
  if (!parent) return;
  let ring = rings.find((r) => r.age >= r.life);
  if (!ring) {
    if (rings.length >= 26) return;
    const material = createAdditiveBasicMaterial({ color: color.clone(), side: DoubleSide, opacity: 0.9 });
    const mesh = new Mesh(ringGeo, material);
    parent.add(mesh);
    ring = { mesh, material, age: 0, life: 1, grow: 1 };
    rings.push(ring);
  }
  ring.material.color.copy(color);
  ring.mesh.position.copy(position);
  ring.age = 0;
  ring.life = life;
  ring.grow = size / life;
  ring.mesh.scale.setScalar(0.2);
  ring.mesh.visible = true;
}

export function spawnGlint(position: Vector3, color: Color, size: number, life: number) {
  if (!parent) return;
  let glint = glints.find((g) => g.age >= g.life);
  if (!glint) {
    if (glints.length >= 26) return;
    const material = createAdditiveBasicMaterial({ color: color.clone(), opacity: 1 });
    const mesh = new Mesh(glintGeo, material);
    parent.add(mesh);
    glint = { mesh, material, age: 0, life: 1 };
    glints.push(glint);
  }
  glint.material.color.copy(color);
  glint.mesh.position.copy(position);
  glint.age = 0;
  glint.life = life;
  glint.mesh.scale.setScalar(size);
  glint.mesh.visible = true;
}

// --- Shard bursts (transient, shrink out) ------------------------------------------
export function burstShards(position: Vector3, specs: ShardSpec[] | undefined, accent: Color, perSpec = 1) {
  if (!parent) return;
  const list = specs && specs.length ? specs : [{ direction: new Vector3(0, 1, 0), color: accent, size: 0.3 }];
  for (const spec of list) {
    for (let n = 0; n < perSpec; n += 1) {
      if (shards.length >= 70) return;
      const material = new MeshBasicMaterial({ color: spec.color.clone() });
      const mesh = new Mesh(shardGeo, material);
      mesh.position.copy(position);
      mesh.scale.setScalar(spec.size * (0.8 + Math.random() * 0.6));
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      parent.add(mesh);
      shards.push({
        mesh,
        velocity: spec.direction.clone().multiplyScalar(4 + Math.random() * 5).add(new Vector3((Math.random() - 0.5) * 3, 3, (Math.random() - 0.5) * 3)),
        spin: new Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
        age: 0,
        life: 0.5 + Math.random() * 0.2,
      });
    }
  }
}

// --- Persistent table debris --------------------------------------------------------
const chunkMaterials = new Map<string, MeshBasicMaterial>();
function chunkMaterial(color: Color) {
  const key = `${color.r.toFixed(2)}|${color.g.toFixed(2)}|${color.b.toFixed(2)}`;
  let material = chunkMaterials.get(key);
  if (!material) {
    material = new MeshBasicMaterial({ color: color.clone() });
    chunkMaterials.set(key, material);
  }
  return material;
}

function dropChunk(position: Vector3, velocity: Vector3, color: Color, geometry: BufferGeometry = debrisGeometries.box, scale = 1) {
  if (!parent) return;
  if (chunks.length >= MAX_CHUNKS) {
    const oldest = chunks.shift();
    if (oldest && parent) parent.remove(oldest.mesh);
  }
  const mesh = new Mesh(geometry, chunkMaterial(color));
  mesh.position.copy(position);
  mesh.scale.setScalar(scale);
  mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  parent.add(mesh);
  chunks.push({
    mesh,
    velocity: velocity.clone(),
    spin: new Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
    resting: false,
    size: 0.24 * scale,
  });
}

/** A kill breaks into pieces that scatter onto the table and stay there. */
export function scatterDebris(position: Vector3, kind: string, accent: Color, count: number) {
  const geometry = debrisGeometryFor(kind);
  for (let n = 0; n < count; n += 1) {
    const landing = new Vector3(
      position.x + (Math.random() - 0.5) * 10,
      0.15,
      position.z - 4 - Math.random() * 14,
    );
    const flight = landing.clone().sub(position);
    const time = 0.55 + Math.random() * 0.3;
    const velocity = new Vector3(flight.x / time, (landing.y - position.y) / time + 0.5 * 14 * time, flight.z / time);
    const tint = Math.random() < 0.45 ? accent : Math.random() < 0.5 ? CREAM : AMBER;
    dropChunk(position, velocity, tint, geometry, 0.8 + Math.random() * 0.7);
  }
}

/** A cracked spill core showers the route with rescued pieces. */
export function showerDebris(position: Vector3, count: number) {
  const geos = [debrisGeometries.box, debrisGeometries.tetra, debrisGeometries.octa, debrisGeometries.button];
  const palette = [new Color(0.9, 0.16, 0.22), CREAM.clone(), AMBER.clone(), new Color(0.12, 0.72, 0.66)];
  for (let n = 0; n < count; n += 1) {
    const landing = new Vector3(
      position.x + (Math.random() - 0.5) * 16,
      0.15,
      position.z - Math.random() * 26,
    );
    const time = 0.6 + Math.random() * 0.4;
    const velocity = new Vector3(
      (landing.x - position.x) / time,
      (landing.y - position.y) / time + 0.5 * 14 * time,
      (landing.z - position.z) / time,
    );
    dropChunk(position, velocity, palette[n % palette.length], geos[n % geos.length], 0.9 + Math.random() * 0.9);
  }
}

// --- Player ball ----------------------------------------------------------------------
let ball: Group | null = null;
let ballKills = 0;
let dipUntil = -1;

export function initBall(scene: Scene) {
  const group = createPlayerBall();
  scene.add(group);
  ball = group;
}

export function ballDipUntil(elapsed: number, duration: number) {
  dipUntil = elapsed + duration;
}

/** Every kill visibly sticks to the ball. */
export function feedBall(count: number) {
  if (!ball) return;
  ballKills += 1;
  const bits = ball.userData.stuckBits as Mesh[];
  for (let n = 0; n < count; n += 1) {
    if (bits.length >= MAX_STUCK_BITS) {
      const oldest = bits.shift();
      if (oldest) ball.remove(oldest);
    }
    const bit = new Mesh(
      [debrisGeometries.box, debrisGeometries.tetra, debrisGeometries.button][(Math.random() * 3) | 0],
      chunkMaterial([new Color(0.9, 0.16, 0.22), new Color(0.12, 0.72, 0.66), new Color(1.0, 0.78, 0.18), new Color(0.25, 0.45, 0.95), CREAM.clone()][(Math.random() * 5) | 0]),
    );
    const dir = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    bit.position.copy(dir).multiplyScalar(0.98);
    bit.scale.setScalar(0.16 + Math.random() * 0.16);
    bit.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    ball.add(bit);
    bits.push(bit);
  }
}

const _forward = new Vector3();
const _down = new Vector3();
const _right = new Vector3();

function updateBall(dt: number, camera: Camera, runProgress: number, elapsed: number) {
  if (!ball) return;
  _forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _down.set(0, -1, 0).applyQuaternion(camera.quaternion);
  const dipping = elapsed < dipUntil ? 1 : 0;
  ball.position
    .copy(camera.position)
    .addScaledVector(_forward, 4.1)
    .addScaledVector(_down, 1.75 - dipping * 0.6);
  // Marble → tennis → melon across the three acts, plus a little per kill.
  // Kept compact and low so low-band targets stay readable above it.
  const growth = runProgress < 0.33
    ? 0.32 + (runProgress / 0.33) * 0.1
    : runProgress < 0.66
      ? 0.42 + ((runProgress - 0.33) / 0.33) * 0.18
      : 0.6 + ((runProgress - 0.66) / 0.34) * 0.32;
  ball.scale.setScalar(growth + Math.min(0.1, ballKills * 0.003));
  // Roll forward.
  ball.rotateOnWorldAxis(_right, -dt * (2.2 + runProgress * 2.5));
}

// --- Lifecycle ----------------------------------------------------------------------------
export function createEffects(scene: Scene) {
  parent = scene;
  initSparks(scene);
  initBall(scene);
}

export function resetEffects() {
  for (const ring of rings) {
    ring.age = ring.life;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.age = glint.life;
    glint.mesh.visible = false;
  }
  for (const shard of shards) {
    if (parent) parent.remove(shard.mesh);
    (shard.mesh.material as MeshBasicMaterial).dispose();
  }
  shards.length = 0;
  for (const chunk of chunks) {
    if (parent) parent.remove(chunk.mesh);
  }
  chunks.length = 0;
  for (let i = 0; i < SPARK_MAX; i += 1) {
    sparkLife[i] = 0;
    sparkPos[i * 3 + 1] = -999;
    sparkCol[i * 3] = sparkCol[i * 3 + 1] = sparkCol[i * 3 + 2] = 0;
  }
  if (sparkPoints) {
    (sparkPoints.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
    (sparkPoints.geometry.getAttribute('color') as Float32BufferAttribute).needsUpdate = true;
  }
  if (ball) {
    const bits = ball.userData.stuckBits as Mesh[];
    for (const bit of bits) ball.remove(bit);
    bits.length = 0;
    ballKills = 0;
    dipUntil = -1;
  }
}

export function updateEffects(dt: number, camera: Camera, elapsed: number, runProgress: number) {
  for (const ring of rings) {
    if (ring.age >= ring.life) {
      ring.mesh.visible = false;
      continue;
    }
    ring.age += dt;
    const t = Math.min(1, ring.age / ring.life);
    ring.mesh.scale.setScalar(0.2 + ring.grow * ring.age);
    ring.material.opacity = 0.9 * (1 - t);
    ring.mesh.quaternion.copy(camera.quaternion);
  }
  for (const glint of glints) {
    if (glint.age >= glint.life) {
      glint.mesh.visible = false;
      continue;
    }
    glint.age += dt;
    const t = Math.min(1, glint.age / glint.life);
    glint.material.opacity = 1 - t;
    glint.mesh.rotation.y += dt * 6;
    glint.mesh.rotation.x += dt * 4;
  }
  for (let i = shards.length - 1; i >= 0; i -= 1) {
    const shard = shards[i];
    shard.age += dt;
    if (shard.age >= shard.life) {
      if (parent) parent.remove(shard.mesh);
      (shard.mesh.material as MeshBasicMaterial).dispose();
      shards.splice(i, 1);
      continue;
    }
    shard.velocity.y -= 12 * dt;
    shard.mesh.position.addScaledVector(shard.velocity, dt);
    shard.mesh.rotation.x += shard.spin.x * dt;
    shard.mesh.rotation.y += shard.spin.y * dt;
    shard.mesh.rotation.z += shard.spin.z * dt;
    if (shard.age > shard.life * 0.6) {
      shard.mesh.scale.multiplyScalar(1 - dt * 4);
    }
  }
  for (const chunk of chunks) {
    if (chunk.resting) continue;
    chunk.velocity.y -= 14 * dt;
    chunk.mesh.position.addScaledVector(chunk.velocity, dt);
    chunk.mesh.rotation.x += chunk.spin.x * dt;
    chunk.mesh.rotation.y += chunk.spin.y * dt;
    if (chunk.mesh.position.y <= 0.12) {
      chunk.mesh.position.y = 0.12;
      if (Math.abs(chunk.velocity.y) > 2.5) {
        chunk.velocity.y *= -0.3;
        chunk.velocity.x *= 0.6;
        chunk.velocity.z *= 0.6;
      } else {
        chunk.resting = true;
        chunk.mesh.rotation.x = Math.round(chunk.mesh.rotation.x / (Math.PI / 2)) * (Math.PI / 2);
      }
    }
  }
  // Sparks.
  if (sparkPoints) {
    for (let i = 0; i < SPARK_MAX; i += 1) {
      if (sparkLife[i] <= 0) continue;
      sparkLife[i] -= dt;
      if (sparkLife[i] <= 0) {
        sparkPos[i * 3 + 1] = -999;
        sparkCol[i * 3] = sparkCol[i * 3 + 1] = sparkCol[i * 3 + 2] = 0;
        continue;
      }
      sparkVel[i].y -= sparkGravity[i] * dt;
      sparkPos[i * 3] += sparkVel[i].x * dt;
      sparkPos[i * 3 + 1] += sparkVel[i].y * dt;
      sparkPos[i * 3 + 2] += sparkVel[i].z * dt;
      const fade = sparkLife[i] / sparkMaxLife[i];
      sparkCol[i * 3] = sparkBase[i].r * fade;
      sparkCol[i * 3 + 1] = sparkBase[i].g * fade;
      sparkCol[i * 3 + 2] = sparkBase[i].b * fade;
    }
    (sparkPoints.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
    (sparkPoints.geometry.getAttribute('color') as Float32BufferAttribute).needsUpdate = true;
  }
  updateBall(dt, camera, runProgress, elapsed);
}
