import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { hdr } from './palette';

// Strandline's transient effect pool: spawn rings, lock glints, hit sparks,
// kill shatter, projectile trails, and drifting spore motes. All pooled and
// recyclable; the level's choreography decides color and number.

export type ShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type Ring = { mesh: Mesh; life: number; maxLife: number; grow: number };
type Glint = { mesh: Mesh; life: number; maxLife: number };
type Spark = { points: Points; velocities: Float32Array; life: number; maxLife: number };
type Shard = { mesh: Mesh; velocity: Vector3; spin: Vector3; life: number; maxLife: number };
type Trail = { mesh: Mesh; life: number; maxLife: number };

const rings: Ring[] = [];
const glints: Glint[] = [];
const sparks: Spark[] = [];
const shards: Shard[] = [];
const trails: Trail[] = [];
let sceneRef: Scene | null = null;

const ringGeometry = new RingGeometry(0.86, 0.94, 40);
const glintGeometry = new OctahedronGeometry(0.3, 0);
const trailGeometry = new SphereGeometry(0.12, 6, 5);

export function createEffects(scene: Scene) {
  sceneRef = scene;
}

export function resetEffects() {
  for (const ring of rings) sceneRef?.remove(ring.mesh);
  for (const glint of glints) sceneRef?.remove(glint.mesh);
  for (const spark of sparks) sceneRef?.remove(spark.points);
  for (const shard of shards) sceneRef?.remove(shard.mesh);
  for (const trail of trails) sceneRef?.remove(trail.mesh);
  rings.length = 0;
  glints.length = 0;
  sparks.length = 0;
  shards.length = 0;
  trails.length = 0;
}

export function spawnRing(position: Vector3, color: Color, size: number, seconds: number) {
  if (!sceneRef) return;
  const mesh = new Mesh(
    ringGeometry,
    createAdditiveBasicMaterial({ color, opacity: 0.9 }),
  );
  mesh.position.copy(position);
  mesh.scale.setScalar(size * 0.3);
  mesh.userData.targetSize = size;
  sceneRef.add(mesh);
  rings.push({ mesh, life: 0, maxLife: seconds, grow: size });
}

export function spawnGlint(position: Vector3, color: Color, size: number, seconds: number) {
  if (!sceneRef) return;
  const mesh = new Mesh(glintGeometry, new MeshBasicMaterial({ color }));
  mesh.position.copy(position);
  mesh.scale.setScalar(size);
  sceneRef.add(mesh);
  glints.push({ mesh, life: 0, maxLife: seconds });
}

export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
  if (!sceneRef) return;
  const geometry = new BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = position.x;
    positions[i * 3 + 1] = position.y;
    positions[i * 3 + 2] = position.z;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const v = speed * (0.4 + Math.random() * 0.6);
    velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * v;
    velocities[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * v;
    velocities[i * 3 + 2] = Math.cos(phi) * v;
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const points = new Points(
    geometry,
    new PointsMaterial({ color, size: 0.22, transparent: true, opacity: 1, blending: AdditiveBlending, depthWrite: false }),
  );
  sceneRef.add(points);
  sparks.push({ points, velocities, life: 0, maxLife: 0.7 });
}

export function burstShards(position: Vector3, specs: ShardSpec[] | undefined, accent: Color) {
  if (!sceneRef) return;
  const list = specs && specs.length > 0 ? specs : defaultShardSpecs(accent);
  for (const spec of list.slice(0, 14)) {
    const mesh = new Mesh(
      glintGeometry,
      new MeshBasicMaterial({ color: hdr(spec.color, 1.1) }),
    );
    mesh.position.copy(position);
    mesh.scale.setScalar(spec.size * (0.7 + Math.random() * 0.6));
    sceneRef.add(mesh);
    shards.push({
      mesh,
      velocity: spec.direction.clone().multiplyScalar(4 + Math.random() * 5),
      spin: new Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3),
      life: 0,
      maxLife: 0.9 + Math.random() * 0.4,
    });
  }
}

function defaultShardSpecs(accent: Color): ShardSpec[] {
  const specs: ShardSpec[] = [];
  for (let i = 0; i < 8; i += 1) {
    const theta = (i / 8) * Math.PI * 2;
    specs.push({
      direction: new Vector3(Math.cos(theta), Math.sin(theta), (Math.random() - 0.5) * 0.8).normalize(),
      color: accent.clone(),
      size: 0.3,
    });
  }
  return specs;
}

export function dropTrail(position: Vector3, color: Color) {
  if (!sceneRef) return;
  if (trails.length > 220) return;
  const mesh = new Mesh(
    trailGeometry,
    createAdditiveBasicMaterial({ color, opacity: 0.7 }),
  );
  mesh.position.copy(position);
  sceneRef.add(mesh);
  trails.push({ mesh, life: 0, maxLife: 0.45 });
}

/** A slow-falling husk: used when a web plate withers or the parent dies. */
export function spawnFallingHusk(position: Vector3, color: Color, size: number) {
  if (!sceneRef) return;
  const mesh = new Mesh(
    new OctahedronGeometry(size, 0),
    createAdditiveBasicMaterial({ color, opacity: 0.85 }),
  );
  mesh.position.copy(position);
  sceneRef.add(mesh);
  shards.push({
    mesh,
    velocity: new Vector3((Math.random() - 0.5) * 2, -3.5, (Math.random() - 0.5) * 2),
    spin: new Vector3(1.5, 2.2, 0.8),
    life: 0,
    maxLife: 2.2,
  });
}

export function updateEffects(dt: number, camera: Camera) {
  for (let i = rings.length - 1; i >= 0; i -= 1) {
    const ring = rings[i];
    ring.life += dt;
    const t = ring.life / ring.maxLife;
    if (t >= 1) {
      sceneRef?.remove(ring.mesh);
      (ring.mesh.material as MeshBasicMaterial).dispose();
      rings.splice(i, 1);
      continue;
    }
    const target = (ring.mesh.userData.targetSize as number | undefined) ?? ring.grow;
    ring.mesh.scale.setScalar(target * (0.3 + 0.7 * t));
    (ring.mesh.material as MeshBasicMaterial).opacity = 0.9 * (1 - t);
    ring.mesh.quaternion.copy(camera.quaternion);
  }
  for (let i = glints.length - 1; i >= 0; i -= 1) {
    const glint = glints[i];
    glint.life += dt;
    const t = glint.life / glint.maxLife;
    if (t >= 1) {
      sceneRef?.remove(glint.mesh);
      (glint.mesh.material as MeshBasicMaterial).dispose();
      glints.splice(i, 1);
      continue;
    }
    glint.mesh.scale.multiplyScalar(1 - dt * 2);
    glint.mesh.rotation.y += dt * 7;
    glint.mesh.rotation.x += dt * 5;
  }
  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const spark = sparks[i];
    spark.life += dt;
    const t = spark.life / spark.maxLife;
    if (t >= 1) {
      sceneRef?.remove(spark.points);
      spark.points.geometry.dispose();
      (spark.points.material as PointsMaterial).dispose();
      sparks.splice(i, 1);
      continue;
    }
    const positions = spark.points.geometry.getAttribute('position') as Float32BufferAttribute;
    for (let j = 0; j < positions.count; j += 1) {
      positions.setXYZ(
        j,
        positions.getX(j) + spark.velocities[j * 3] * dt,
        positions.getY(j) + spark.velocities[j * 3 + 1] * dt,
        positions.getZ(j) + spark.velocities[j * 3 + 2] * dt,
      );
      spark.velocities[j * 3] *= 1 - dt * 2.2;
      spark.velocities[j * 3 + 1] *= 1 - dt * 2.2;
      spark.velocities[j * 3 + 2] *= 1 - dt * 2.2;
    }
    positions.needsUpdate = true;
    (spark.points.material as PointsMaterial).opacity = 1 - t;
  }
  for (let i = shards.length - 1; i >= 0; i -= 1) {
    const shard = shards[i];
    shard.life += dt;
    const t = shard.life / shard.maxLife;
    if (t >= 1) {
      sceneRef?.remove(shard.mesh);
      (shard.mesh.material as MeshBasicMaterial).dispose();
      shards.splice(i, 1);
      continue;
    }
    shard.mesh.position.addScaledVector(shard.velocity, dt);
    shard.velocity.multiplyScalar(1 - dt * 1.6);
    shard.mesh.rotation.x += shard.spin.x * dt;
    shard.mesh.rotation.y += shard.spin.y * dt;
    shard.mesh.rotation.z += shard.spin.z * dt;
    shard.mesh.scale.multiplyScalar(1 - dt * 0.8);
  }
  for (let i = trails.length - 1; i >= 0; i -= 1) {
    const trail = trails[i];
    trail.life += dt;
    const t = trail.life / trail.maxLife;
    if (t >= 1) {
      sceneRef?.remove(trail.mesh);
      (trail.mesh.material as MeshBasicMaterial).dispose();
      trails.splice(i, 1);
      continue;
    }
    (trail.mesh.material as MeshBasicMaterial).opacity = 0.7 * (1 - t);
    trail.mesh.scale.setScalar(1 - t * 0.6);
  }
}

/** A faint volumetric-looking motile field: points slowly drifting upward. */
export function createMoteField(count: number, spread: number): Group {
  const group = new Group();
  const geometry = new BufferGeometry();
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * spread;
    positions[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.6;
    positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const points = new Points(
    geometry,
    new PointsMaterial({
      color: new Color(0.4, 0.85, 0.75),
      size: 0.14,
      transparent: true,
      opacity: 0.55,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  group.add(points);
  group.userData.points = points;
  return group;
}
