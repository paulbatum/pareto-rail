import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
  type Camera,
  type Object3D,
} from 'three';

// Leaf: transient effects. Sparks of coloured light (one additive instanced
// mesh), black fragments of shattered creatures (one opaque instanced mesh),
// thin shock rings, and streaks — light travelling along an arc from one
// point to another, used for a window's colour being pulled out of it and
// for the colour going home again after a kill.

const SPARK_CAPACITY = 1800;
const FRAGMENT_CAPACITY = 380;
const RING_CAPACITY = 28;

type Spark = {
  position: Vector3;
  velocity: Vector3;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
  gravity: number;
};

type Fragment = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  spin: number;
  angle: number;
  size: number;
  age: number;
  life: number;
};

type Ring = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  color: Color;
  from: number;
  to: number;
  age: number;
  life: number;
};

type Streak = {
  from: Vector3;
  control: Vector3;
  to: Vector3;
  color: Color;
  age: number;
  duration: number;
  width: number;
  onArrive?: () => void;
};

export type Effects = ReturnType<typeof createEffects>;

const MATRIX = new Matrix4();
const QUATERNION = new Quaternion();
const SCALE = new Vector3();
const COLOR = new Color();
const HEAD = new Vector3();

function bezier(out: Vector3, p0: Vector3, p1: Vector3, p2: Vector3, t: number) {
  const u = 1 - t;
  return out.set(
    u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z,
  );
}

function randomUnit(rng: () => number) {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}

export function createEffects(parent: Object3D) {
  const sparks: Spark[] = [];
  const fragments: Fragment[] = [];
  const rings: Ring[] = [];
  const streaks: Streak[] = [];

  const sparkMesh = new InstancedMesh(
    new OctahedronGeometry(0.14, 0),
    new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  sparkMesh.userData.raildIgnoreOcclusion = true;
  sparkMesh.setColorAt(0, COLOR.setScalar(0));
  parent.add(sparkMesh);

  const fragmentGeometry = new BufferGeometry();
  fragmentGeometry.setAttribute('position', new Float32BufferAttribute([0, 0.6, 0, -0.45, -0.35, 0, 0.5, -0.3, 0], 3));
  fragmentGeometry.computeVertexNormals();
  const fragmentMesh = new InstancedMesh(fragmentGeometry, new MeshBasicMaterial({ color: new Color(0.006, 0.006, 0.008), side: DoubleSide }), FRAGMENT_CAPACITY);
  fragmentMesh.count = 0;
  fragmentMesh.frustumCulled = false;
  fragmentMesh.userData.raildIgnoreOcclusion = true;
  parent.add(fragmentMesh);

  const ringGeometry = new RingGeometry(0.93, 1, 56);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const material = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    const mesh = new Mesh(ringGeometry, material);
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    parent.add(mesh);
    rings.push({ mesh, material, color: new Color(), from: 0, to: 1, age: 0, life: -1 });
  }

  function spark(position: Vector3, velocity: Vector3, color: Color, size = 1, life = 0.6, drag = 1.6, gravity = 0) {
    if (sparks.length >= SPARK_CAPACITY) sparks.shift();
    sparks.push({ position: position.clone(), velocity: velocity.clone(), color: color.clone(), size, age: 0, life, drag, gravity });
  }

  function burst(position: Vector3, color: Color, count: number, speed: number, options: { size?: number; life?: number; gravity?: number } = {}) {
    for (let i = 0; i < count; i += 1) {
      const direction = randomUnit(Math.random);
      spark(position, direction.multiplyScalar(speed * (0.35 + Math.random() * 0.8)), color, (options.size ?? 1) * (0.6 + Math.random() * 0.7), (options.life ?? 0.7) * (0.6 + Math.random() * 0.6), 1.8, options.gravity ?? 0);
    }
  }

  /** Black pieces of a silhouette, tumbling and falling toward the candles. */
  function shatter(position: Vector3, count: number, speed: number, size = 1) {
    for (let i = 0; i < count; i += 1) {
      if (fragments.length >= FRAGMENT_CAPACITY) fragments.shift();
      const direction = randomUnit(Math.random);
      fragments.push({
        position: position.clone().addScaledVector(direction, 0.4 * size),
        velocity: direction.multiplyScalar(speed * (0.4 + Math.random() * 0.8)).add(new Vector3(0, 2.5, 0)),
        axis: randomUnit(Math.random),
        spin: 3 + Math.random() * 9,
        angle: Math.random() * Math.PI,
        size: size * (0.5 + Math.random() * 0.8),
        age: 0,
        life: 1.6 + Math.random() * 1.4,
      });
    }
  }

  function ring(position: Vector3, facing: Quaternion, color: Color, from: number, to: number, life: number) {
    const slot = rings.find((candidate) => candidate.life < 0) ?? rings.reduce((oldest, candidate) => (candidate.age / candidate.life > oldest.age / oldest.life ? candidate : oldest));
    slot.mesh.position.copy(position);
    slot.mesh.quaternion.copy(facing);
    slot.color.copy(color);
    slot.from = from;
    slot.to = to;
    slot.age = 0;
    slot.life = life;
    slot.mesh.visible = true;
  }

  /** Light carried along an arc; `onArrive` fires when it lands. */
  function streak(from: Vector3, to: Vector3, color: Color, duration: number, lift: number, width = 1, onArrive?: () => void) {
    const control = from.clone().lerp(to, 0.5);
    control.y += lift;
    streaks.push({ from: from.clone(), control, to: to.clone(), color: color.clone(), age: 0, duration, width, onArrive });
  }

  function update(dt: number, _camera: Camera) {
    // Streaks: a bright head leaving a fading wake of sparks.
    for (let i = streaks.length - 1; i >= 0; i -= 1) {
      const trail = streaks[i];
      const previous = Math.min(1, trail.age / trail.duration);
      trail.age += dt;
      const t = Math.min(1, trail.age / trail.duration);
      const eased = t * t * (3 - 2 * t);
      const steps = 3;
      for (let s = 0; s < steps; s += 1) {
        const local = previous + ((eased - previous) * (s + 1)) / steps;
        bezier(HEAD, trail.from, trail.control, trail.to, local);
        spark(HEAD, randomUnit(Math.random).multiplyScalar(0.6), trail.color, 1.3 * trail.width, 0.45, 2.5, 0);
      }
      bezier(HEAD, trail.from, trail.control, trail.to, eased);
      spark(HEAD, new Vector3(), trail.color.clone().multiplyScalar(1.6), 2.6 * trail.width, 0.06, 0, 0);
      if (t >= 1) {
        streaks.splice(i, 1);
        trail.onArrive?.();
      }
    }

    let index = 0;
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const particle = sparks[i];
      particle.age += dt;
      if (particle.age >= particle.life) {
        sparks.splice(i, 1);
        continue;
      }
      particle.velocity.multiplyScalar(Math.exp(-particle.drag * dt));
      particle.velocity.y -= particle.gravity * dt;
      particle.position.addScaledVector(particle.velocity, dt);
      const fade = 1 - particle.age / particle.life;
      SCALE.setScalar(particle.size * (0.4 + 0.6 * fade));
      MATRIX.compose(particle.position, QUATERNION.identity(), SCALE);
      sparkMesh.setMatrixAt(index, MATRIX);
      sparkMesh.setColorAt(index, COLOR.copy(particle.color).multiplyScalar(fade * fade));
      index += 1;
    }
    sparkMesh.count = index;
    sparkMesh.instanceMatrix.needsUpdate = true;
    if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;

    let fragmentIndex = 0;
    for (let i = fragments.length - 1; i >= 0; i -= 1) {
      const piece = fragments[i];
      piece.age += dt;
      if (piece.age >= piece.life) {
        fragments.splice(i, 1);
        continue;
      }
      piece.velocity.multiplyScalar(Math.exp(-0.9 * dt));
      piece.velocity.y -= 9 * dt;
      piece.position.addScaledVector(piece.velocity, dt);
      piece.angle += piece.spin * dt;
      QUATERNION.setFromAxisAngle(piece.axis, piece.angle);
      SCALE.setScalar(piece.size * Math.min(1, (piece.life - piece.age) * 2));
      MATRIX.compose(piece.position, QUATERNION, SCALE);
      fragmentMesh.setMatrixAt(fragmentIndex, MATRIX);
      fragmentIndex += 1;
    }
    fragmentMesh.count = fragmentIndex;
    fragmentMesh.instanceMatrix.needsUpdate = true;

    for (const slot of rings) {
      if (slot.life < 0) continue;
      slot.age += dt;
      const t = slot.age / slot.life;
      if (t >= 1) {
        slot.life = -1;
        slot.mesh.visible = false;
        continue;
      }
      const eased = 1 - (1 - t) ** 3;
      slot.mesh.scale.setScalar(slot.from + (slot.to - slot.from) * eased);
      slot.material.color.copy(slot.color).multiplyScalar((1 - t) ** 1.5);
    }
  }

  function clear() {
    sparks.length = 0;
    fragments.length = 0;
    streaks.length = 0;
    for (const slot of rings) {
      slot.life = -1;
      slot.mesh.visible = false;
    }
    sparkMesh.count = 0;
    fragmentMesh.count = 0;
  }

  return { spark, burst, shatter, ring, streak, update, clear };
}
