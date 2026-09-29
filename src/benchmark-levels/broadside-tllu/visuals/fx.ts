import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { float, uv, vec3, length, smoothstep } from 'three/tsl';

// Instanced, additive effect pools for everything that flashes, streaks, or
// expands: ship-to-ship fire, hull hits, explosion cores, spark showers, and
// shockwave rings. One draw call per pool regardless of how loud the battle gets.

type Sprite = { position: Vector3; color: Color; size: number; grow: number; life: number; age: number; fade: number; cap: number };
type Streak = {
  position: Vector3;
  velocity: Vector3;
  color: Color;
  width: number;
  length: number;
  life: number;
  age: number;
  /** Shrinks toward the end of life when true. */
  taper: boolean;
  /** For beams: on arrival at `to`, run the callback and retire. */
  to?: Vector3;
  arriveAt?: number;
  onArrive?: () => void;
};
type Ring = { position: Vector3; color: Color; size: number; grow: number; life: number; age: number };

export type Fx = ReturnType<typeof createFx>;

const UP = new Vector3(0, 0, 1);
const matrix = new Matrix4();
const quaternion = new Quaternion();
const scale = new Vector3();
const tint = new Color();
const direction = new Vector3();

/** Soft radial glow for billboard sprites: hot core, long feathered falloff. Instance color tints it. */
export function createGlowMaterial() {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.depthWrite = false;
  material.fog = false;
  material.side = DoubleSide;
  const radius = length(uv().sub(0.5)).mul(2);
  const falloff = float(1).sub(smoothstep(float(0.0), float(1.0), radius));
  const glow = falloff.pow(2.4).add(falloff.pow(9).mul(1.4));
  material.colorNode = vec3(1, 1, 1).mul(glow);
  material.opacityNode = glow.min(1);
  return material;
}

function additive() {
  return new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
}

/**
 * An empty pool keeps one zero-scale instance drawing. A zero-instance draw is legal but not worth trusting
 * across backends, and drawing from the first frame compiles the pool's pipeline during the attract screen
 * instead of at the first explosion.
 */
function park(mesh: InstancedMesh) {
  mesh.setMatrixAt(0, matrix.makeScale(0, 0, 0));
  mesh.setColorAt(0, tint.setRGB(0, 0, 0));
  mesh.count = 1;
  mesh.visible = true;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function pool(mesh: InstancedMesh) {
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  mesh.setColorAt(0, new Color(0, 0, 0));
  park(mesh);
  return mesh;
}

export function createFx(limits = { sprites: 320, streaks: 900, rings: 80 }) {
  const group = new Group();
  const spriteMesh = pool(new InstancedMesh(new PlaneGeometry(2, 2), createGlowMaterial(), limits.sprites));
  const streakMesh = pool(new InstancedMesh(new BoxGeometry(1, 1, 1), additive(), limits.streaks));
  const ringMesh = pool(new InstancedMesh(new RingGeometry(0.9, 1, 48), additive(), limits.rings));
  group.add(spriteMesh, streakMesh, ringMesh);

  const sprites: Sprite[] = [];
  const streaks: Streak[] = [];
  const rings: Ring[] = [];

  /** Expanding glow ball: explosion cores, muzzle flashes, impact flares. */
  /** `cap` limits the on-screen radius to a fraction of the distance to the camera so nothing whites out the frame. */
  function flash(position: Vector3, color: Color, size: number, life: number, grow = 2.4, fade = 1.6, cap = 0.13) {
    if (sprites.length >= limits.sprites) sprites.shift();
    sprites.push({ position: position.clone(), color: color.clone(), size, grow, life, age: 0, fade, cap });
  }

  function ring(position: Vector3, color: Color, size: number, life: number, grow = 3.2) {
    if (rings.length >= limits.rings) rings.shift();
    rings.push({ position: position.clone(), color: color.clone(), size, grow, life, age: 0 });
  }

  function spark(position: Vector3, velocity: Vector3, color: Color, life: number, length: number, width: number, taper = true) {
    if (streaks.length >= limits.streaks) streaks.shift();
    streaks.push({ position: position.clone(), velocity: velocity.clone(), color: color.clone(), width, length, life, age: 0, taper });
  }

  /** Radial shower of streaks. */
  function burst(position: Vector3, color: Color, count: number, speed: number, life: number, length = 1.2, width = 0.16) {
    for (let i = 0; i < count; i += 1) {
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const velocity = new Vector3(s * Math.cos(phi), u, s * Math.sin(phi)).multiplyScalar(speed * (0.35 + Math.random() * 0.8));
      spark(position, velocity, color, life * (0.6 + Math.random() * 0.6), length * (0.6 + Math.random()), width);
    }
  }

  /** A long tracer that travels from `from` to `to`, then calls `onArrive`. */
  function bolt(from: Vector3, to: Vector3, color: Color, travelSeconds: number, length: number, width: number, onArrive?: () => void) {
    if (streaks.length >= limits.streaks) streaks.shift();
    const velocity = to.clone().sub(from).multiplyScalar(1 / travelSeconds);
    streaks.push({
      position: from.clone(),
      velocity,
      color: color.clone(),
      width,
      length,
      life: travelSeconds + 0.02,
      age: 0,
      taper: false,
      to: to.clone(),
      arriveAt: travelSeconds,
      onArrive,
    });
  }

  function update(dt: number, camera: Camera) {
    // sprites
    let write = 0;
    for (let i = 0; i < sprites.length; i += 1) {
      const s = sprites[i];
      s.age += dt;
      if (s.age >= s.life) continue;
      sprites[write] = s;
      const t = s.age / s.life;
      const grown = s.size * (1 + s.grow * (1 - (1 - t) ** 2));
      const size = Math.min(grown, Math.max(0.6, s.position.distanceTo(camera.position) * s.cap));
      matrix.compose(s.position, camera.quaternion, scale.setScalar(size));
      spriteMesh.setMatrixAt(write, matrix);
      spriteMesh.setColorAt(write, tint.copy(s.color).multiplyScalar((1 - t) ** s.fade));
      write += 1;
    }
    sprites.length = write;
    if (write === 0) park(spriteMesh);
    else spriteMesh.count = write;
    spriteMesh.instanceMatrix.needsUpdate = true;
    if (spriteMesh.instanceColor) spriteMesh.instanceColor.needsUpdate = true;

    // streaks (arrival callbacks run after compaction: they spawn more streaks)
    write = 0;
    const arrivals: Array<() => void> = [];
    for (let i = 0; i < streaks.length; i += 1) {
      const s = streaks[i];
      s.age += dt;
      s.position.addScaledVector(s.velocity, dt);
      if (s.age >= s.life) {
        if (s.onArrive && s.arriveAt !== undefined) arrivals.push(s.onArrive);
        continue;
      }
      streaks[write] = s;
      const t = s.age / s.life;
      const speed = s.velocity.length();
      if (speed > 1e-4) {
        direction.copy(s.velocity).multiplyScalar(1 / speed);
        quaternion.setFromUnitVectors(UP, direction);
      } else quaternion.identity();
      const shrink = s.taper ? 1 - t : 1;
      // Streaks that pass close to the lens thin out and dim so a shower never smears the frame white.
      const near = Math.min(1, Math.max(0, (s.position.distanceTo(camera.position) - 1.5) / 14));
      scale.set(s.width * shrink * (0.2 + 0.8 * near), s.width * shrink * (0.2 + 0.8 * near), Math.max(0.01, s.length * (s.taper ? 0.4 + 0.6 * (1 - t) : 1)));
      matrix.compose(s.position, quaternion, scale);
      streakMesh.setMatrixAt(write, matrix);
      streakMesh.setColorAt(write, tint.copy(s.color).multiplyScalar((s.taper ? 1 - t * t : 1) * (0.25 + 0.75 * near)));
      write += 1;
    }
    streaks.length = write;
    if (write === 0) park(streakMesh);
    else streakMesh.count = write;
    // Arrivals may append new streaks (impact sparks); those render from the next update.
    for (const arrive of arrivals) arrive();
    streakMesh.instanceMatrix.needsUpdate = true;
    if (streakMesh.instanceColor) streakMesh.instanceColor.needsUpdate = true;

    // rings (billboarded)
    write = 0;
    for (let i = 0; i < rings.length; i += 1) {
      const r = rings[i];
      r.age += dt;
      if (r.age >= r.life) continue;
      rings[write] = r;
      const t = r.age / r.life;
      const grownRing = r.size * (1 + r.grow * (1 - (1 - t) ** 3));
      const size = Math.min(grownRing, Math.max(0.6, r.position.distanceTo(camera.position) * 0.12));
      matrix.compose(r.position, camera.quaternion, scale.setScalar(size));
      ringMesh.setMatrixAt(write, matrix);
      ringMesh.setColorAt(write, tint.copy(r.color).multiplyScalar((1 - t) ** 1.4));
      write += 1;
    }
    rings.length = write;
    if (write === 0) park(ringMesh);
    else ringMesh.count = write;
    ringMesh.instanceMatrix.needsUpdate = true;
    if (ringMesh.instanceColor) ringMesh.instanceColor.needsUpdate = true;
  }

  function clear() {
    sprites.length = 0;
    streaks.length = 0;
    rings.length = 0;
    for (const mesh of [spriteMesh, streakMesh, ringMesh]) park(mesh);
  }

  function dispose() {
    clear();
    for (const mesh of [spriteMesh, streakMesh, ringMesh]) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      mesh.dispose();
    }
    group.removeFromParent();
  }

  return {
    group,
    flash,
    ring,
    spark,
    burst,
    bolt,
    update,
    clear,
    dispose,
    get counts() {
      return { sprites: sprites.length, streaks: streaks.length, rings: rings.length };
    },
  };
}
