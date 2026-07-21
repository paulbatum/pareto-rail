import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { createTransientEffectPool, disposeObject3D } from '../../../engine/visual-kit';

// Everything that happens in this barrel is an electrical discharge, so the
// effect vocabulary is deliberately narrow: shock rings (a pressure wave down
// the bore), sparks (blown hardware), glints (a contact making), and arcs
// (current jumping a gap). Levels of violence are expressed by how many of
// each, never by inventing a new shape.

type ShockRing = { age: number; life: number; mesh: Mesh; from: number; to: number; color: Color };
type Spark = { age: number; life: number; mesh: Mesh; velocity: Vector3; spin: number };
type Glint = { age: number; life: number; mesh: Mesh; size: number };
type Arc = { age: number; life: number; line: Line };
type TrailDot = { age: number; life: number; mesh: Mesh };

let root: Group | null = null;

const ringGeometry = new RingGeometry(0.86, 1, 40);
const sparkGeometry = new OctahedronGeometry(0.16, 0);
const glintGeometry = new PlaneGeometry(1, 1);
const trailGeometry = new OctahedronGeometry(0.11, 0);

const additive = (color: Color, opacity = 1) => new MeshBasicMaterial({
  color,
  transparent: true,
  opacity,
  blending: AdditiveBlending,
  depthWrite: false,
  side: DoubleSide,
});

const shockRings = createTransientEffectPool<ShockRing, Camera>({
  update(effect, progress, _dt, camera) {
    const scale = effect.from + (effect.to - effect.from) * (1 - (1 - progress) ** 2.2);
    effect.mesh.scale.setScalar(scale);
    effect.mesh.quaternion.copy(camera.quaternion);
    (effect.mesh.material as MeshBasicMaterial).opacity = (1 - progress) ** 1.6;
  },
  dispose: (effect) => detach(effect.mesh),
});

const sparks = createTransientEffectPool<Spark, Camera>({
  update(effect, progress, dt) {
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    effect.velocity.multiplyScalar(1 - Math.min(1, dt * 1.7));
    effect.mesh.rotation.x += effect.spin * dt;
    effect.mesh.rotation.z += effect.spin * dt * 0.7;
    effect.mesh.scale.setScalar(1 - progress * 0.7);
    (effect.mesh.material as MeshBasicMaterial).opacity = 1 - progress;
  },
  dispose: (effect) => detach(effect.mesh),
});

const glints = createTransientEffectPool<Glint, Camera>({
  update(effect, progress, _dt, camera) {
    effect.mesh.quaternion.copy(camera.quaternion);
    // A contact striking: snap wide, collapse to a line.
    const flare = progress < 0.25 ? progress / 0.25 : 1 - (progress - 0.25) / 0.75;
    effect.mesh.scale.set(effect.size * (0.4 + flare * 1.6), effect.size * flare * 0.28, 1);
    (effect.mesh.material as MeshBasicMaterial).opacity = flare;
  },
  dispose: (effect) => detach(effect.mesh),
});

const arcs = createTransientEffectPool<Arc, Camera>({
  update(effect, progress) {
    const material = effect.line.material as LineBasicMaterial;
    // Current does not fade smoothly; it stutters and then breaks.
    material.opacity = (1 - progress) * (0.55 + 0.45 * Math.sin(progress * 43));
  },
  dispose: (effect) => detach(effect.line),
});

const trails = createTransientEffectPool<TrailDot, Camera>({
  update(effect, progress) {
    effect.mesh.scale.setScalar(1 - progress);
    (effect.mesh.material as MeshBasicMaterial).opacity = (1 - progress) * 0.8;
  },
  dispose: (effect) => detach(effect.mesh),
});

function detach(object: Mesh | Line) {
  object.removeFromParent();
  disposeObject3D(object);
}

export function createEffects(scene: Scene) {
  root = new Group();
  root.name = 'mass-driver-effects';
  scene.add(root);
  return root;
}

export function resetEffects(camera: Camera) {
  shockRings.clear(camera);
  sparks.clear(camera);
  glints.clear(camera);
  arcs.clear(camera);
  trails.clear(camera);
}

export function updateEffects(dt: number, camera: Camera) {
  shockRings.update(dt, camera);
  sparks.update(dt, camera);
  glints.update(dt, camera);
  arcs.update(dt, camera);
  trails.update(dt, camera);
}

export function spawnShockRing(position: Vector3, color: Color, to: number, life: number, from = to * 0.12) {
  if (!root) return;
  const mesh = new Mesh(ringGeometry, additive(color));
  mesh.position.copy(position);
  mesh.scale.setScalar(from);
  root.add(mesh);
  shockRings.add({ age: 0, life, mesh, from, to, color });
}

export function burstSparks(position: Vector3, color: Color, count: number, speed: number, life = 0.5) {
  if (!root) return;
  for (let i = 0; i < count; i += 1) {
    const mesh = new Mesh(sparkGeometry, additive(color));
    mesh.position.copy(position);
    root.add(mesh);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const velocity = new Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi),
    ).multiplyScalar(speed * (0.45 + Math.random() * 0.85));
    sparks.add({ age: 0, life: life * (0.7 + Math.random() * 0.6), mesh, velocity, spin: 6 + Math.random() * 12 });
  }
}

export function spawnGlint(position: Vector3, color: Color, size: number, life: number) {
  if (!root) return;
  const mesh = new Mesh(glintGeometry, additive(color));
  mesh.position.copy(position);
  root.add(mesh);
  glints.add({ age: 0, life, mesh, size });
}

/** A jagged current path between two points — the level's kill and discharge signature. */
export function spawnArc(from: Vector3, to: Vector3, color: Color, life = 0.22, jitter = 1) {
  if (!root) return;
  const segments = 9;
  const positions = new Float32Array((segments + 1) * 3);
  const span = to.clone().sub(from);
  const side = new Vector3(span.y, -span.x, span.z * 0.3).normalize();
  const other = new Vector3().crossVectors(span, side).normalize();
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const taper = Math.sin(t * Math.PI);
    const point = from.clone().addScaledVector(span, t)
      .addScaledVector(side, (Math.random() - 0.5) * jitter * taper * 2)
      .addScaledVector(other, (Math.random() - 0.5) * jitter * taper * 2);
    positions.set([point.x, point.y, point.z], i * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const line = new Line(geometry, new LineBasicMaterial({
    color,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  }));
  root.add(line);
  arcs.add({ age: 0, life, line });
}

export function dropTrail(position: Vector3, color: Color, life = 0.2) {
  if (!root) return;
  const mesh = new Mesh(trailGeometry, additive(color, 0.8));
  mesh.position.copy(position);
  root.add(mesh);
  trails.add({ age: 0, life, mesh });
}

export function effectLoad() {
  return shockRings.size + sparks.size + glints.size + arcs.size + trails.size;
}
