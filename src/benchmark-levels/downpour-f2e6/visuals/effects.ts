import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { createAdditiveBasicMaterial, createTransientEffectPool } from '../../../engine/visual-kit';
import { hdr } from './palette';

export type ShardSpec = { direction: Vector3; color: Color; size: number };

type Ring = { age: number; life: number; mesh: Mesh; material: MeshBasicMaterial; from: number; to: number };
type Glint = { age: number; life: number; mesh: Mesh; material: MeshBasicMaterial; from: number; to: number };
type Spark = { age: number; life: number; position: Vector3; velocity: Vector3; color: Color; size: number };
type DisposableObject = Object3D & { geometry: { dispose(): void }; material: { dispose(): void; opacity: number } };
type Beam = { age: number; life: number; mesh: DisposableObject };

let rings: ReturnType<typeof createTransientEffectPool<Ring, undefined>>;
let glints: ReturnType<typeof createTransientEffectPool<Glint, undefined>>;
let beams: ReturnType<typeof createTransientEffectPool<Beam, undefined>>;
let sparkGroup: Points;
let sparkPositions: Float32Array;
let sparkColors: Float32Array;
let sparks: Spark[] = [];
const MAX_SPARKS = 900;

let trailGeometry: BufferGeometry;
let trailPositions: Float32Array;
let trailColors: Float32Array;
let trailMesh: Points;
let trailWrite = 0;
const TRAIL_CAPACITY = 480;
const trailAges = new Float32Array(TRAIL_CAPACITY).fill(Infinity);
const TRAIL_LIFE = 0.4;

let root: Group;

export function createEffects(scene: Scene) {
  root = new Group();
  scene.add(root);

  rings = createTransientEffectPool<Ring, undefined>({
    update(effect, progress) {
      const scale = effect.from + (effect.to - effect.from) * progress;
      effect.mesh.scale.setScalar(scale);
      effect.material.opacity = (1 - progress) * 0.85;
    },
    dispose(effect) {
      effect.mesh.removeFromParent();
      effect.mesh.geometry.dispose();
      effect.material.dispose();
    },
  });

  glints = createTransientEffectPool<Glint, undefined>({
    update(effect, progress) {
      const scale = effect.from + (effect.to - effect.from) * progress;
      effect.mesh.scale.setScalar(scale);
      effect.material.opacity = (1 - progress) ** 1.5;
    },
    dispose(effect) {
      effect.mesh.removeFromParent();
      effect.mesh.geometry.dispose();
      effect.material.dispose();
    },
  });

  beams = createTransientEffectPool<Beam, undefined>({
    update(effect, progress) {
      effect.mesh.material.opacity = (1 - progress) * 0.6;
      effect.mesh.scale.y = 1 + progress * 0.6;
    },
    dispose(effect) {
      effect.mesh.removeFromParent();
      effect.mesh.geometry.dispose();
      effect.mesh.material.dispose();
    },
  });

  sparkPositions = new Float32Array(MAX_SPARKS * 3);
  sparkColors = new Float32Array(MAX_SPARKS * 3);
  const sparkGeometry = new BufferGeometry();
  sparkGeometry.setAttribute('position', new Float32BufferAttribute(sparkPositions, 3));
  sparkGeometry.setAttribute('color', new Float32BufferAttribute(sparkColors, 3));
  sparkGroup = new Points(sparkGeometry, new PointsMaterial({
    size: 0.13,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }));
  sparkGroup.frustumCulled = false;
  root.add(sparkGroup);

  trailPositions = new Float32Array(TRAIL_CAPACITY * 3);
  trailColors = new Float32Array(TRAIL_CAPACITY * 3);
  trailGeometry = new BufferGeometry();
  trailGeometry.setAttribute('position', new Float32BufferAttribute(trailPositions, 3));
  trailGeometry.setAttribute('color', new Float32BufferAttribute(trailColors, 3));
  trailMesh = new Points(trailGeometry, new PointsMaterial({
    size: 0.16,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }));
  trailMesh.frustumCulled = false;
  root.add(trailMesh);

  return root;
}

export function spawnRing(position: Vector3, color: Color, scale: number, life: number, thickness = 0.08) {
  const material = createAdditiveBasicMaterial({ color, side: 2 });
  material.opacity = 0.85;
  const mesh = new Mesh(new RingGeometry(1 - thickness, 1, 40), material);
  mesh.position.copy(position);
  mesh.lookAt(position.clone().add(new Vector3(0, 0, 1)));
  mesh.scale.setScalar(0.15);
  root.add(mesh);
  rings.add({ age: 0, life, mesh, material, from: 0.15, to: scale });
}

export function spawnGlint(position: Vector3, color: Color, scale: number, life: number) {
  const material = createAdditiveBasicMaterial({ color });
  const mesh = new Mesh(new RingGeometry(0, 1, 4), material);
  mesh.position.copy(position);
  mesh.rotation.z = Math.random() * Math.PI;
  root.add(mesh);
  glints.add({ age: 0, life, mesh, material, from: 0.1, to: scale });
}

export function spawnBeam(position: Vector3, color: Color, height: number, life: number) {
  const material = createAdditiveBasicMaterial({ color, opacity: 0.6 });
  const mesh = new Mesh(new CylinderGeometry(0.05, 0.9, height, 6, 1, true), material);
  mesh.position.copy(position);
  mesh.position.y += height / 2;
  root.add(mesh);
  beams.add({ age: 0, life, mesh: mesh as DisposableObject });
}

export function burstSparks(position: Vector3, color: Color, count: number, speed: number, size = 1) {
  for (let i = 0; i < count && sparks.length < MAX_SPARKS; i += 1) {
    const direction = new Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    sparks.push({
      age: 0,
      life: 0.28 + Math.random() * 0.3,
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.5 + Math.random() * 0.6)),
      color: color.clone(),
      size: size * (0.7 + Math.random() * 0.6),
    });
  }
}

export function burstShrapnel(position: Vector3, specs: readonly ShardSpec[]) {
  for (const spec of specs) {
    sparks.push({
      age: 0,
      life: 0.4 + Math.random() * 0.25,
      position: position.clone(),
      velocity: spec.direction.clone().multiplyScalar(6 + Math.random() * 4),
      color: spec.color.clone(),
      size: spec.size,
    });
  }
}

export function dropTrail(position: Vector3, color: Color) {
  trailWrite = (trailWrite + 1) % TRAIL_CAPACITY;
  trailPositions[trailWrite * 3] = position.x;
  trailPositions[trailWrite * 3 + 1] = position.y;
  trailPositions[trailWrite * 3 + 2] = position.z;
  trailColors[trailWrite * 3] = color.r;
  trailColors[trailWrite * 3 + 1] = color.g;
  trailColors[trailWrite * 3 + 2] = color.b;
  trailAges[trailWrite] = 0;
}

export function updateEffects(dt: number, camera: Camera) {
  rings.update(dt, undefined);
  glints.update(dt, undefined);
  beams.update(dt, undefined);

  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const spark = sparks[i];
    spark.age += dt;
    if (spark.age >= spark.life) {
      sparks.splice(i, 1);
      continue;
    }
    spark.velocity.y -= dt * 3.2;
    spark.position.addScaledVector(spark.velocity, dt);
  }
  const attrPos = sparkGroup.geometry.getAttribute('position') as Float32BufferAttribute;
  const attrCol = sparkGroup.geometry.getAttribute('color') as Float32BufferAttribute;
  for (let i = 0; i < MAX_SPARKS; i += 1) {
    if (i < sparks.length) {
      const spark = sparks[i];
      const fade = 1 - spark.age / spark.life;
      attrPos.setXYZ(i, spark.position.x, spark.position.y, spark.position.z);
      attrCol.setXYZ(i, spark.color.r * fade, spark.color.g * fade, spark.color.b * fade);
    } else {
      attrCol.setXYZ(i, 0, 0, 0);
    }
  }
  attrPos.needsUpdate = true;
  attrCol.needsUpdate = true;

  const trailAttrCol = trailMesh.geometry.getAttribute('color') as Float32BufferAttribute;
  for (let i = 0; i < TRAIL_CAPACITY; i += 1) {
    trailAges[i] += dt;
    const fade = Math.max(0, 1 - trailAges[i] / TRAIL_LIFE);
    trailAttrCol.setXYZ(i, trailColors[i * 3] * fade, trailColors[i * 3 + 1] * fade, trailColors[i * 3 + 2] * fade);
  }
  trailAttrCol.needsUpdate = true;

  void camera;
}

export function resetEffects() {
  rings.clear(undefined);
  glints.clear(undefined);
  beams.clear(undefined);
  sparks = [];
  trailAges.fill(Infinity);
}

export function spawnLightningLine(from: Vector3, to: Vector3, color: Color) {
  const points = [from.clone()];
  const segments = 6;
  for (let i = 1; i < segments; i += 1) {
    const t = i / segments;
    const point = from.clone().lerp(to, t);
    point.x += (Math.random() - 0.5) * 3 * (1 - t);
    point.y += (Math.random() - 0.5) * 3 * (1 - t);
    points.push(point);
  }
  points.push(to.clone());
  const geometry = new BufferGeometry().setFromPoints(points);
  const material = new LineBasicMaterial({ color: hdr(color, 2), transparent: true, opacity: 0.9 });
  const line = new Line(geometry, material);
  root.add(line);
  beams.add({ age: 0, life: 0.18, mesh: line as unknown as DisposableObject });
}
