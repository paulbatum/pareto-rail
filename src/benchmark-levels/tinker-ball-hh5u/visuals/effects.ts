import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  BufferGeometry,
} from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, float, positionLocal, smoothstep, uv, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Leaf: pooled, instanced effects. Rings, sparkles, glue droplets, glue
// splats on the table, and soft contact shadows. Callers decide every colour,
// size, and lifetime; pools only integrate and draw.

const ZERO = new Matrix4().makeScale(0, 0, 0);
const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _v = new Vector3();
const FLAT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

type Pool<T> = { items: T[]; mesh: InstancedMesh; next: number };

function instanced(geometry: BufferGeometry, material: MeshBasicMaterial | MeshBasicNodeMaterial | MeshStandardNodeMaterial, capacity: number, parent: Object3D) {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = 'effect';
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  for (let i = 0; i < capacity; i += 1) mesh.setMatrixAt(i, ZERO);
  parent.add(mesh);
  return mesh;
}

function claim<T extends { life: number }>(pool: Pool<T>) {
  const index = pool.next;
  pool.next = (pool.next + 1) % pool.items.length;
  return { item: pool.items[index], index };
}

type Ring = { life: number; age: number; position: Vector3; from: number; to: number; color: Color; flat: boolean };
type Spark = { life: number; age: number; position: Vector3; velocity: Vector3; size: number; color: Color; spin: number };
type Drop = { life: number; age: number; position: Vector3; velocity: Vector3; size: number; splat: number };
type Splat = { life: number; age: number; position: Vector3; size: number; spin: number };

export type Effects = ReturnType<typeof createEffects>;

export function createEffects(parent: Object3D, options: { glue: Color; glueSheen: Color }) {
  const ringMaterial = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
  const sparkMaterial = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
  const dropMaterial = new MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0.2 });
  dropMaterial.color = options.glue.clone();
  const splatMaterial = new MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0.15, transparent: true, depthWrite: false });
  splatMaterial.color = options.glue.clone();
  // Soft glossy puddle edge.
  splatMaterial.opacityNode = smoothstep(float(1.0), float(0.62), uv().sub(0.5).length().mul(2));
  splatMaterial.polygonOffset = true;
  splatMaterial.polygonOffsetFactor = -2;

  const ringGeometry = new RingGeometry(0.92, 1, 48);
  const sparkGeometry = mergeGeometries([
    new PlaneGeometry(1, 0.09),
    new PlaneGeometry(0.09, 1),
  ]);
  const dropGeometry = new SphereGeometry(1, 8, 6);
  const splatGeometry = new CircleGeometry(1, 20);

  const RING_CAP = 48;
  const SPARK_CAP = 320;
  const DROP_CAP = 200;
  const SPLAT_CAP = 48;

  const rings: Pool<Ring> = {
    mesh: instanced(ringGeometry, ringMaterial, RING_CAP, parent),
    items: Array.from({ length: RING_CAP }, () => ({ life: 0, age: 1, position: new Vector3(), from: 1, to: 2, color: new Color(), flat: false })),
    next: 0,
  };
  const sparks: Pool<Spark> = {
    mesh: instanced(sparkGeometry, sparkMaterial, SPARK_CAP, parent),
    items: Array.from({ length: SPARK_CAP }, () => ({ life: 0, age: 1, position: new Vector3(), velocity: new Vector3(), size: 1, color: new Color(), spin: 0 })),
    next: 0,
  };
  const drops: Pool<Drop> = {
    mesh: instanced(dropGeometry, dropMaterial, DROP_CAP, parent),
    items: Array.from({ length: DROP_CAP }, () => ({ life: 0, age: 1, position: new Vector3(), velocity: new Vector3(), size: 1, splat: 0 })),
    next: 0,
  };
  const splats: Pool<Splat> = {
    mesh: instanced(splatGeometry, splatMaterial, SPLAT_CAP, parent),
    items: Array.from({ length: SPLAT_CAP }, () => ({ life: 0, age: 1, position: new Vector3(), size: 1, spin: 0 })),
    next: 0,
  };
  for (const mesh of [rings.mesh, sparks.mesh]) {
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(mesh.count * 3), 3);
    mesh.instanceColor.setUsage(DynamicDrawUsage);
  }

  function ring(position: Vector3, color: Color, from: number, to: number, life: number, flat = false) {
    const { item } = claim(rings);
    item.position.copy(position);
    item.color.copy(color);
    item.from = from;
    item.to = to;
    item.life = life;
    item.age = 0;
    item.flat = flat;
  }

  function sparkle(position: Vector3, color: Color, count: number, speed: number, size: number, life = 0.6) {
    for (let i = 0; i < count; i += 1) {
      const { item } = claim(sparks);
      item.position.copy(position);
      item.velocity.set(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      item.size = size * (0.6 + Math.random() * 0.7);
      item.color.copy(color);
      item.life = life * (0.7 + Math.random() * 0.6);
      item.age = 0;
      item.spin = (Math.random() - 0.5) * 8;
    }
  }

  function droplets(position: Vector3, count: number, speed: number, size: number, splatSize: number) {
    for (let i = 0; i < count; i += 1) {
      const { item } = claim(drops);
      item.position.copy(position);
      item.velocity.set(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.8));
      item.size = size * (0.5 + Math.random() * 0.8);
      item.life = 2.2;
      item.age = 0;
      item.splat = splatSize * (0.6 + Math.random() * 0.6);
    }
  }

  function splat(position: Vector3, size: number, life = 1.6) {
    const { item } = claim(splats);
    item.position.set(position.x, 0.02 + Math.random() * 0.02, position.z);
    item.size = size;
    item.life = life;
    item.age = 0;
    item.spin = Math.random() * Math.PI * 2;
  }

  function update(dt: number, cameraQuaternion: Quaternion, gravity: number) {
    rings.items.forEach((item, index) => {
      if (item.age >= item.life) {
        rings.mesh.setMatrixAt(index, ZERO);
        return;
      }
      item.age += dt;
      const t = Math.min(1, item.age / item.life);
      const radius = item.from + (item.to - item.from) * (1 - (1 - t) ** 3);
      const fade = (1 - t) ** 1.5;
      _q.copy(item.flat ? FLAT : cameraQuaternion);
      rings.mesh.setMatrixAt(index, _m.compose(item.position, _q, _s.setScalar(radius)));
      rings.mesh.setColorAt(index, _tmpColor.copy(item.color).multiplyScalar(fade));
    });
    sparks.items.forEach((item, index) => {
      if (item.age >= item.life) {
        sparks.mesh.setMatrixAt(index, ZERO);
        return;
      }
      item.age += dt;
      item.velocity.y -= gravity * 0.35 * dt;
      item.velocity.multiplyScalar(Math.exp(-2.2 * dt));
      item.position.addScaledVector(item.velocity, dt);
      const t = item.age / item.life;
      const size = item.size * Math.sin(Math.PI * Math.min(1, t)) * 1.2;
      _q.copy(cameraQuaternion).multiply(_q2.setFromAxisAngle(_z, item.spin * item.age));
      sparks.mesh.setMatrixAt(index, _m.compose(item.position, _q, _s.setScalar(Math.max(0.0001, size))));
      sparks.mesh.setColorAt(index, _tmpColor.copy(item.color).multiplyScalar(1 - t * 0.5));
    });
    drops.items.forEach((item, index) => {
      if (item.age >= item.life) {
        drops.mesh.setMatrixAt(index, ZERO);
        return;
      }
      item.age += dt;
      item.velocity.y -= gravity * dt;
      item.position.addScaledVector(item.velocity, dt);
      if (item.position.y <= 0) {
        splat(item.position, item.splat, 0.7 + Math.random() * 0.4);
        item.age = item.life;
        drops.mesh.setMatrixAt(index, ZERO);
        return;
      }
      const stretch = 1 + Math.min(2, item.velocity.length() * 0.05);
      _v.copy(item.velocity).normalize();
      _q.setFromUnitVectors(_y, _v.lengthSq() > 0 ? _v : _y);
      drops.mesh.setMatrixAt(index, _m.compose(item.position, _q, _s.set(item.size, item.size * stretch, item.size)));
    });
    splats.items.forEach((item, index) => {
      if (item.age >= item.life) {
        splats.mesh.setMatrixAt(index, ZERO);
        return;
      }
      item.age += dt;
      const t = item.age / item.life;
      // Spread fast, sit, then shrink away as the glue evaporates clean.
      const grow = Math.min(1, item.age / 0.12);
      const shrink = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
      const size = item.size * grow * Math.max(0, shrink);
      _q.copy(FLAT).premultiply(_q2.setFromAxisAngle(_y, item.spin));
      splats.mesh.setMatrixAt(index, _m.compose(item.position, _q, _s.set(Math.max(0.0001, size), Math.max(0.0001, size * 0.8), 1)));
    });
    for (const pool of [rings, sparks, drops, splats]) pool.mesh.instanceMatrix.needsUpdate = true;
    if (rings.mesh.instanceColor) rings.mesh.instanceColor.needsUpdate = true;
    if (sparks.mesh.instanceColor) sparks.mesh.instanceColor.needsUpdate = true;
  }

  function clear() {
    for (const pool of [rings, sparks, drops, splats] as Array<Pool<{ life: number; age: number }>>) {
      pool.items.forEach((item, index) => {
        item.age = item.life = 0;
        pool.mesh.setMatrixAt(index, ZERO);
      });
      pool.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return { ring, sparkle, droplets, splat, update, clear };
}

const _tmpColor = new Color();
const _q2 = new Quaternion();
const _z = new Vector3(0, 0, 1);
const _y = new Vector3(0, 1, 0);

/** Soft contact shadows: blurred dark discs whose strength is per instance. */
export function createShadows(parent: Object3D, capacity: number, color: Color) {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.colorNode = vec3(color.r, color.g, color.b);
  const strength = attribute<'float'>('strength', 'float');
  const r = positionLocal.xy.length();
  material.opacityNode = smoothstep(float(1), float(0.15), r).mul(strength);
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  const geometry = new CircleGeometry(1, 24);
  const strengthAttribute = new InstancedBufferAttribute(new Float32Array(capacity), 1);
  strengthAttribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute('strength', strengthAttribute);
  const mesh = instanced(geometry, material as unknown as MeshBasicNodeMaterial, capacity, parent);
  mesh.renderOrder = -1;
  mesh.userData.raildIgnoreOcclusion = true;
  let used = 0;

  return {
    begin() {
      used = 0;
    },
    /** Place a shadow for an object at `position` hovering `height` above the table. */
    cast(position: Vector3, radius: number, height: number, lampOffset: Vector3, darkness = 0.55) {
      if (used >= capacity) return;
      const lift = Math.max(0, height);
      const spread = radius * (1 + lift * 0.05);
      const fade = darkness / (1 + lift * 0.06);
      _v.set(position.x + lampOffset.x * lift, 0.035, position.z + lampOffset.z * lift);
      _q.copy(FLAT);
      mesh.setMatrixAt(used, _m.compose(_v, _q, _s.set(spread * 1.25, spread, 1)));
      strengthAttribute.setX(used, fade);
      used += 1;
    },
    end() {
      for (let i = used; i < capacity; i += 1) {
        mesh.setMatrixAt(i, ZERO);
        strengthAttribute.setX(i, 0);
      }
      mesh.count = Math.max(1, used);
      mesh.instanceMatrix.needsUpdate = true;
      strengthAttribute.needsUpdate = true;
    },
  };
}
