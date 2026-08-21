import {
  Camera,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  COBALT,
  CRIMSON,
  EMERALD,
  GOLD,
  hdr,
  LEAD_CAME,
  PURE_LIGHT,
  type GlassColorName,
} from './palette';
import { getCathedralEnvironment } from './environment';

const SHARD_CAPACITY = 1024;
const BEAM_CAPACITY = 32;
const RING_CAPACITY = 24;

type ShardParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  spin: number;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
};

type LightBeamEffect = {
  mesh: Mesh;
  origin: Vector3;
  target: Vector3;
  color: Color;
  age: number;
  life: number;
  colorName: GlassColorName;
};

type RingEffect = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  fromScale: number;
  toScale: number;
};

const shards: ShardParticle[] = [];
const beams: LightBeamEffect[] = [];
const rings: RingEffect[] = [];

let shardMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

const cylinderGeom = new CylinderGeometry(0.12, 0.4, 1.0, 6, 1);
cylinderGeom.rotateX(Math.PI / 2);

export function createVisualEffects(scene: Scene) {
  // Instanced jewel glass shards
  shardMesh = new InstancedMesh(
    new TetrahedronGeometry(0.18, 0),
    createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide }),
    SHARD_CAPACITY,
  );
  shardMesh.count = 0;
  shardMesh.frustumCulled = false;
  shardMesh.userData.raildIgnoreOcclusion = true;
  scene.add(shardMesh);

  // Pool of light beam rays (return of stolen light to windows)
  const beamGeom = new CylinderGeometry(0.1, 0.6, 1.0, 8, 1);
  for (let i = 0; i < BEAM_CAPACITY; i += 1) {
    const mesh = new Mesh(
      beamGeom,
      createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }),
    );
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    beams.push({
      mesh,
      origin: new Vector3(),
      target: new Vector3(),
      color: new Color(),
      age: 0,
      life: -1,
      colorName: 'gold',
    });
  }

  // Expanding shockwave rings
  const ringGeom = new RingGeometry(0.95, 1.0, 32);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(
      ringGeom,
      createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }),
    );
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    rings.push({
      mesh,
      color: new Color(),
      age: 0,
      life: -1,
      fromScale: 0,
      toScale: 1,
    });
  }
}

export function spawnGlassShards(position: Vector3, color: Color, count = 28, speed = 12) {
  for (let i = 0; i < count && shards.length < SHARD_CAPACITY; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const elevation = (Math.random() - 0.5) * Math.PI;
    const vSpeed = (0.5 + Math.random() * 0.8) * speed;

    const velocity = new Vector3(
      Math.cos(elevation) * Math.cos(angle) * vSpeed,
      Math.sin(elevation) * vSpeed,
      Math.cos(elevation) * Math.sin(angle) * vSpeed,
    );

    const axis = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    if (axis.lengthSq() < 0.01) axis.set(0, 1, 0);

    shards.push({
      position: position.clone(),
      velocity,
      axis,
      rotation: new Quaternion(),
      spin: (Math.random() - 0.5) * 16,
      color: color.clone(),
      size: 0.8 + Math.random() * 0.7,
      age: 0,
      life: 0.6 + Math.random() * 0.5,
      drag: 0.94,
    });
  }
}

// "The light goes back where it belongs"
// Shoots a brilliant jewel-colored ray of light from the dying shadow to the nearest dark window!
export function triggerLightReturn(origin: Vector3, color: Color, colorName: GlassColorName = 'gold') {
  // Find nearest window on cathedral wall
  const env = getCathedralEnvironment();
  let targetPos = new Vector3(origin.x > 0 ? 15 : -15, 16, origin.z);
  if (env) {
    env.restoreWindow(colorName, origin);
  }

  // Find free beam from pool
  const beam = beams.find((b) => b.life <= 0);
  if (beam) {
    beam.origin.copy(origin);
    beam.target.copy(targetPos);
    beam.color.copy(color);
    beam.colorName = colorName;
    beam.age = 0;
    beam.life = 0.55;
    beam.mesh.visible = true;
  }

  // Spawn shockwave ring
  const ring = rings.find((r) => r.life <= 0);
  if (ring) {
    ring.mesh.position.copy(origin);
    ring.mesh.quaternion.set(0, 0, 0, 1);
    ring.color.copy(color);
    ring.age = 0;
    ring.life = 0.45;
    ring.fromScale = 0.3;
    ring.toScale = 3.5;
    ring.mesh.visible = true;
  }
}

export function updateVisualEffects(dt: number, camera: Camera) {
  // 1. Update Shards
  let activeShards = 0;
  for (let i = 0; i < shards.length; i += 1) {
    const s = shards[i];
    s.age += dt;
    if (s.age >= s.life) continue;

    s.position.addScaledVector(s.velocity, dt);
    s.velocity.multiplyScalar(Math.pow(s.drag, dt * 60));
    scratchQuaternion.setFromAxisAngle(s.axis, s.spin * dt);
    s.rotation.multiply(scratchQuaternion);

    const progress = s.age / s.life;
    const fade = Math.max(0, 1 - progress);
    const scale = s.size * fade;

    scratchScale.set(scale, scale, scale);
    scratchMatrix.compose(s.position, s.rotation, scratchScale);

    if (shardMesh) {
      shardMesh.setMatrixAt(activeShards, scratchMatrix);
      scratchColor.copy(s.color).multiplyScalar(fade * 2.0);
      shardMesh.setColorAt(activeShards, scratchColor);
    }
    activeShards += 1;
  }

  // Compact dead shards
  for (let i = shards.length - 1; i >= 0; i -= 1) {
    if (shards[i].age >= shards[i].life) shards.splice(i, 1);
  }

  if (shardMesh) {
    shardMesh.count = activeShards;
    shardMesh.instanceMatrix.needsUpdate = true;
    if (shardMesh.instanceColor) shardMesh.instanceColor.needsUpdate = true;
  }

  // 2. Update Beams (Shooting stolen light back to windows)
  for (const b of beams) {
    if (b.life <= 0) continue;
    b.age += dt;
    if (b.age >= b.life) {
      b.life = -1;
      b.mesh.visible = false;
      continue;
    }

    const progress = b.age / b.life;
    // Ray interpolates from origin to target
    const currentHead = new Vector3().lerpVectors(b.origin, b.target, Math.min(1.0, progress * 1.5));
    const currentTail = new Vector3().lerpVectors(b.origin, b.target, Math.max(0.0, (progress - 0.2) * 1.5));
    
    const beamMid = new Vector3().addVectors(currentHead, currentTail).multiplyScalar(0.5);
    const length = Math.max(0.1, currentHead.distanceTo(currentTail));

    b.mesh.position.copy(beamMid);
    b.mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3().subVectors(currentHead, currentTail).normalize());
    b.mesh.scale.set(1.0, length, 1.0);

    const fade = Math.sin(progress * Math.PI);
    const mat = b.mesh.material as MeshBasicMaterial;
    mat.color.copy(b.color).multiplyScalar(fade * 3.5);
  }

  // 3. Update Rings
  for (const r of rings) {
    if (r.life <= 0) continue;
    r.age += dt;
    if (r.age >= r.life) {
      r.life = -1;
      r.mesh.visible = false;
      continue;
    }

    const progress = r.age / r.life;
    r.mesh.quaternion.copy(camera.quaternion);
    const currentScale = r.fromScale + (r.toScale - r.fromScale) * Math.sin(progress * Math.PI * 0.5);
    r.mesh.scale.setScalar(currentScale);

    const fade = (1 - progress) ** 1.5;
    const mat = r.mesh.material as MeshBasicMaterial;
    mat.color.copy(r.color).multiplyScalar(fade * 2.2);
  }
}
