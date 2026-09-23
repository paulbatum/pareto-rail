import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';
import type { Camera, Scene } from 'three';

// Leaf: two pools. Every particle in Speedsolve is a tiny cube (sticker
// shards, loose cubies, confetti, dart trails), drawn from one instanced
// mesh; rings are flat camera-facing outlines. Callers pass every color,
// size, speed and lifetime.

export type CubeBurst = {
  position: Vector3;
  colors: readonly Color[];
  count: number;
  speed: number;
  size: number;
  life: number;
  /** Bias direction for the burst (e.g. a face normal); omitted = spherical. */
  direction?: Vector3;
  spread?: number;
  gravity?: Vector3;
  drag?: number;
  spin?: number;
  jitter?: number;
};

type Particle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  angle: number;
  spin: number;
  size: number;
  age: number;
  life: number;
  gravity: Vector3;
  drag: number;
};

type Ring = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  age: number;
  life: number;
  radius: number;
  active: boolean;
};

const CAPACITY = 2400;
const RING_CAPACITY = 32;
const matrix = new Matrix4();
const quaternion = new Quaternion();
const scale = new Vector3();
const scratch = new Vector3();
const ZERO = new Vector3();
const WHITE = new Color(1, 1, 1);

export function createEffects(scene: Scene) {
  const root = new Group();
  root.userData.raildIgnoreOcclusion = true;
  scene.add(root);

  const material = new MeshStandardMaterial({ roughness: 0.4, metalness: 0 });
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, CAPACITY);
  mesh.frustumCulled = false;
  // Allocate the per-instance color buffer up front so the material compiles with it.
  for (let i = 0; i < CAPACITY; i += 1) mesh.setColorAt(i, WHITE);
  mesh.count = 0;
  mesh.userData.raildIgnoreOcclusion = true;
  root.add(mesh);
  const particles: Particle[] = [];
  const colors: Color[] = [];

  const rings: Ring[] = [];
  const ringGeometry = new RingGeometry(0.9, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const ringMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
    const ring = new Mesh(ringGeometry, ringMaterial);
    ring.visible = false;
    ring.renderOrder = 5;
    root.add(ring);
    rings.push({ mesh: ring, material: ringMaterial, age: 0, life: 1, radius: 1, active: false });
  }

  function burst(options: CubeBurst) {
    const spread = options.spread ?? 1;
    for (let i = 0; i < options.count; i += 1) {
      if (particles.length >= CAPACITY) break;
      const dir = randomUnit(new Vector3());
      if (options.direction) dir.multiplyScalar(spread).add(options.direction).normalize();
      const speed = options.speed * (0.45 + Math.random() * 0.75);
      const position = options.position.clone();
      if (options.jitter) position.add(randomUnit(scratch).multiplyScalar(options.jitter * Math.random()));
      particles.push({
        position,
        velocity: dir.multiplyScalar(speed),
        axis: randomUnit(new Vector3()),
        angle: Math.random() * Math.PI * 2,
        spin: (options.spin ?? 6) * (0.5 + Math.random()),
        size: options.size * (0.6 + Math.random() * 0.6),
        age: 0,
        life: options.life * (0.7 + Math.random() * 0.5),
        gravity: options.gravity ?? ZERO,
        drag: options.drag ?? 1.5,
      });
      colors.push(options.colors[i % options.colors.length]);
    }
  }

  /** A single resting cube (trails, specks) that just shrinks away. */
  function speck(position: Vector3, color: Color, size: number, life: number) {
    if (particles.length >= CAPACITY) return;
    particles.push({
      position: position.clone(),
      velocity: new Vector3(),
      axis: randomUnit(new Vector3()),
      angle: Math.random() * Math.PI,
      spin: 2,
      size,
      age: 0,
      life,
      gravity: ZERO,
      drag: 0,
    });
    colors.push(color);
  }

  function ring(position: Vector3, color: Color, radius: number, life: number, opacity = 1) {
    const slot = rings.find((candidate) => !candidate.active) ?? rings.reduce((oldest, candidate) => (candidate.age / candidate.life > oldest.age / oldest.life ? candidate : oldest));
    slot.active = true;
    slot.age = 0;
    slot.life = life;
    slot.radius = radius;
    slot.material.color.copy(color);
    slot.material.opacity = opacity;
    slot.mesh.position.copy(position);
    slot.mesh.visible = true;
    slot.mesh.userData.baseOpacity = opacity;
  }

  function update(dt: number, camera: Camera) {
    let write = 0;
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.velocity.addScaledVector(p.gravity, dt);
      p.velocity.multiplyScalar(Math.exp(-p.drag * dt));
      p.position.addScaledVector(p.velocity, dt);
      p.angle += p.spin * dt;
      const t = p.age / p.life;
      const s = p.size * (1 - t * t * t);
      quaternion.setFromAxisAngle(p.axis, p.angle);
      scale.setScalar(Math.max(0.0001, s));
      matrix.compose(p.position, quaternion, scale);
      mesh.setMatrixAt(write, matrix);
      mesh.setColorAt(write, colors[i]);
      particles[write] = p;
      colors[write] = colors[i];
      write += 1;
    }
    particles.length = write;
    colors.length = write;
    mesh.count = write;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    for (const r of rings) {
      if (!r.active) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const eased = 1 - (1 - t) ** 3;
      r.mesh.scale.setScalar(r.radius * (0.35 + eased * 0.65));
      r.mesh.quaternion.copy(camera.quaternion);
      r.material.opacity = (r.mesh.userData.baseOpacity as number) * (1 - t);
    }
  }

  function clear() {
    particles.length = 0;
    colors.length = 0;
    mesh.count = 0;
    for (const r of rings) {
      r.active = false;
      r.mesh.visible = false;
    }
  }

  return { root, burst, speck, ring, update, clear, get particleCount() { return particles.length; } };
}

export type Effects = ReturnType<typeof createEffects>;

function randomUnit(out: Vector3) {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return out.set(r * Math.cos(theta), r * Math.sin(theta), u);
}
