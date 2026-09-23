import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';

// Leaf: pooled transient effects. Callers choose every colour, size, speed,
// and lifetime; these pools only own buffers and per-frame integration.

const additive = { transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false } as const;

// ---- spark streaks ----------------------------------------------------------------

type Spark = {
  alive: boolean;
  position: Vector3;
  velocity: Vector3;
  color: Color;
  age: number;
  life: number;
  drag: number;
  length: number;
};

export type SparkField = ReturnType<typeof createSparkField>;

/** `unit` converts the caller's speeds (barrel units per second) into world units. */
export function createSparkField(scene: Scene, unit = 1, capacity = 900) {
  const positions = new Float32Array(capacity * 6);
  const colors = new Float32Array(capacity * 6);
  const geometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage);
  const colorAttribute = new BufferAttribute(colors, 3).setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('color', colorAttribute);
  const lines = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, ...additive }));
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  scene.add(lines);

  const sparks: Spark[] = Array.from({ length: capacity }, () => ({
    alive: false,
    position: new Vector3(),
    velocity: new Vector3(),
    color: new Color(),
    age: 0,
    life: 1,
    drag: 2,
    length: 0.06,
  }));
  let cursor = 0;
  const direction = new Vector3();

  function emit(origin: Vector3, color: Color, count: number, speed: number, life: number, options: { drag?: number; length?: number; bias?: Vector3; spread?: number } = {}) {
    for (let i = 0; i < count; i += 1) {
      const spark = sparks[cursor];
      cursor = (cursor + 1) % capacity;
      direction.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (direction.lengthSq() < 0.0001) direction.set(0, 1, 0);
      direction.normalize().multiplyScalar(options.spread ?? 1);
      if (options.bias) direction.add(options.bias);
      spark.alive = true;
      spark.position.copy(origin);
      spark.velocity.copy(direction).multiplyScalar(speed * unit * (0.45 + Math.random() * 0.75));
      spark.color.copy(color);
      spark.age = 0;
      spark.life = life * (0.6 + Math.random() * 0.6);
      spark.drag = options.drag ?? 2.2;
      spark.length = options.length ?? 0.05;
    }
  }

  function update(dt: number) {
    for (let i = 0; i < capacity; i += 1) {
      const spark = sparks[i];
      const offset = i * 6;
      if (!spark.alive) {
        colors.fill(0, offset, offset + 6);
        continue;
      }
      spark.age += dt;
      if (spark.age >= spark.life) {
        spark.alive = false;
        colors.fill(0, offset, offset + 6);
        continue;
      }
      spark.velocity.multiplyScalar(Math.exp(-spark.drag * dt));
      spark.position.addScaledVector(spark.velocity, dt);
      const fade = 1 - spark.age / spark.life;
      const tail = spark.length;
      positions[offset] = spark.position.x;
      positions[offset + 1] = spark.position.y;
      positions[offset + 2] = spark.position.z;
      positions[offset + 3] = spark.position.x - spark.velocity.x * tail;
      positions[offset + 4] = spark.position.y - spark.velocity.y * tail;
      positions[offset + 5] = spark.position.z - spark.velocity.z * tail;
      colors[offset] = spark.color.r * fade;
      colors[offset + 1] = spark.color.g * fade;
      colors[offset + 2] = spark.color.b * fade;
      colors[offset + 3] = spark.color.r * fade * 0.15;
      colors[offset + 4] = spark.color.g * fade * 0.15;
      colors[offset + 5] = spark.color.b * fade * 0.15;
    }
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  }

  function clear() {
    for (const spark of sparks) spark.alive = false;
    colors.fill(0);
    colorAttribute.needsUpdate = true;
  }

  return { emit, update, clear };
}

// ---- shock rings ---------------------------------------------------------------------

type Shock = { mesh: Mesh; material: MeshBasicMaterial; age: number; life: number; radius: number; color: Color; faceCamera: boolean; alive: boolean };

export type ShockRings = ReturnType<typeof createShockRings>;

export function createShockRings(scene: Scene, unit = 1, capacity = 28) {
  const geometry = new RingGeometry(0.9, 1, 64);
  const shocks: Shock[] = Array.from({ length: capacity }, () => {
    const material = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide, ...additive });
    const mesh = new Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = 6;
    scene.add(mesh);
    return { mesh, material, age: 0, life: 1, radius: 1, color: new Color(), faceCamera: true, alive: false };
  });
  let cursor = 0;

  function spawn(position: Vector3, color: Color, radius: number, life: number, orientation?: Quaternion) {
    const shock = shocks[cursor];
    cursor = (cursor + 1) % capacity;
    shock.alive = true;
    shock.age = 0;
    shock.life = life;
    shock.radius = radius * unit;
    shock.color.copy(color);
    shock.faceCamera = !orientation;
    shock.mesh.position.copy(position);
    if (orientation) shock.mesh.quaternion.copy(orientation);
    shock.mesh.visible = true;
  }

  function update(dt: number, camera: Camera) {
    for (const shock of shocks) {
      if (!shock.alive) continue;
      shock.age += dt;
      if (shock.age >= shock.life) {
        shock.alive = false;
        shock.mesh.visible = false;
        continue;
      }
      const t = shock.age / shock.life;
      const eased = 1 - (1 - t) ** 3;
      shock.mesh.scale.setScalar(Math.max(0.01, shock.radius * (0.15 + eased * 0.85)));
      if (shock.faceCamera) shock.mesh.quaternion.copy(camera.quaternion);
      shock.material.color.copy(shock.color).multiplyScalar((1 - t) ** 1.6);
    }
  }

  function clear() {
    for (const shock of shocks) {
      shock.alive = false;
      shock.mesh.visible = false;
    }
  }

  return { spawn, update, clear };
}

// ---- glints --------------------------------------------------------------------------

type Glint = { mesh: Mesh; material: MeshBasicMaterial; age: number; life: number; size: number; color: Color; alive: boolean };

export type Glints = ReturnType<typeof createGlints>;

export function createGlints(scene: Scene, unit = 1, capacity = 40) {
  const geometry = new OctahedronGeometry(1, 0);
  geometry.scale(1, 1, 0.2);
  const glints: Glint[] = Array.from({ length: capacity }, () => {
    const material = new MeshBasicMaterial({ color: 0xffffff, ...additive });
    const mesh = new Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = 7;
    scene.add(mesh);
    return { mesh, material, age: 0, life: 1, size: 1, color: new Color(), alive: false };
  });
  let cursor = 0;

  function spawn(position: Vector3, color: Color, size: number, life: number) {
    const glint = glints[cursor];
    cursor = (cursor + 1) % capacity;
    glint.alive = true;
    glint.age = 0;
    glint.life = life;
    glint.size = size * unit;
    glint.color.copy(color);
    glint.mesh.position.copy(position);
    glint.mesh.visible = true;
  }

  function update(dt: number, camera: Camera) {
    for (const glint of glints) {
      if (!glint.alive) continue;
      glint.age += dt;
      if (glint.age >= glint.life) {
        glint.alive = false;
        glint.mesh.visible = false;
        continue;
      }
      const t = glint.age / glint.life;
      glint.mesh.quaternion.copy(camera.quaternion);
      glint.mesh.rotateZ(t * 1.2);
      glint.mesh.scale.set(glint.size * (1 - t * 0.5), glint.size * (0.25 + (1 - t) * 0.75), 1);
      glint.material.color.copy(glint.color).multiplyScalar((1 - t) ** 2);
    }
  }

  function clear() {
    for (const glint of glints) {
      glint.alive = false;
      glint.mesh.visible = false;
    }
  }

  return { spawn, update, clear };
}

// ---- lightning arcs ------------------------------------------------------------------

const ARC_SEGMENTS = 14;

type Arc = {
  lines: LineSegments;
  positions: Float32Array;
  colors: Float32Array;
  offsets: Float32Array;
  from: Vector3;
  to: Vector3;
  color: Color;
  jag: number;
  age: number;
  life: number;
  reshapeIn: number;
  alive: boolean;
  held: boolean;
};

export type ArcBank = ReturnType<typeof createArcBank>;

/**
 * Jagged electric arcs. `spawn` fires a transient bolt; `hold` keeps a slot
 * alive for one frame at a time (tethers, drains) — call it every frame.
 */
export function createArcBank(scene: Scene, unit = 1, capacity = 48) {
  const group = new Group();
  scene.add(group);
  const arcs: Arc[] = Array.from({ length: capacity }, () => {
    const positions = new Float32Array(ARC_SEGMENTS * 6);
    const colors = new Float32Array(ARC_SEGMENTS * 6);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('color', new BufferAttribute(colors, 3).setUsage(DynamicDrawUsage));
    const lines = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, ...additive }));
    lines.frustumCulled = false;
    lines.visible = false;
    lines.renderOrder = 6;
    group.add(lines);
    return { lines, positions, colors, offsets: new Float32Array(ARC_SEGMENTS * 3), from: new Vector3(), to: new Vector3(), color: new Color(), jag: 1, age: 0, life: 1, reshapeIn: 0, alive: false, held: false };
  });
  const heldSlots = new Map<string, Arc>();
  let cursor = 0;
  const axis = new Vector3();
  const side = new Vector3();
  const lift = new Vector3();
  const point = new Vector3();
  const previous = new Vector3();

  function nextFree() {
    for (let i = 0; i < capacity; i += 1) {
      const arc = arcs[(cursor + i) % capacity];
      if (!arc.alive) {
        cursor = (cursor + i + 1) % capacity;
        return arc;
      }
    }
    const arc = arcs[cursor];
    cursor = (cursor + 1) % capacity;
    for (const [key, held] of heldSlots) if (held === arc) heldSlots.delete(key);
    return arc;
  }

  /** New random kinks and flicker; the arc keeps them until the next reshape. */
  function randomize(arc: Arc) {
    for (let i = 0; i < ARC_SEGMENTS; i += 1) {
      arc.offsets[i * 3] = Math.random() * 2 - 1;
      arc.offsets[i * 3 + 1] = Math.random() * 2 - 1;
      arc.offsets[i * 3 + 2] = 0.7 + Math.random() * 0.5;
    }
  }

  function layout(arc: Arc, brightness: number) {
    axis.copy(arc.to).sub(arc.from);
    const length = axis.length();
    if (length < 0.001) return;
    axis.divideScalar(length);
    side.set(axis.y, -axis.x, 0.3).cross(axis).normalize();
    lift.crossVectors(axis, side).normalize();
    previous.copy(arc.from);
    for (let i = 0; i < ARC_SEGMENTS; i += 1) {
      const t = (i + 1) / ARC_SEGMENTS;
      const envelope = Math.sin(t * Math.PI);
      point.copy(arc.from).lerp(arc.to, t);
      if (i < ARC_SEGMENTS - 1) {
        point.addScaledVector(side, arc.offsets[i * 3] * arc.jag * envelope);
        point.addScaledVector(lift, arc.offsets[i * 3 + 1] * arc.jag * envelope);
      }
      const o = i * 6;
      arc.positions[o] = previous.x;
      arc.positions[o + 1] = previous.y;
      arc.positions[o + 2] = previous.z;
      arc.positions[o + 3] = point.x;
      arc.positions[o + 4] = point.y;
      arc.positions[o + 5] = point.z;
      const flicker = brightness * arc.offsets[i * 3 + 2];
      for (const k of [0, 3]) {
        arc.colors[o + k] = arc.color.r * flicker;
        arc.colors[o + k + 1] = arc.color.g * flicker;
        arc.colors[o + k + 2] = arc.color.b * flicker;
      }
      previous.copy(point);
    }
    const geometry = arc.lines.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  function spawn(from: Vector3, to: Vector3, color: Color, life: number, jag: number) {
    const arc = nextFree();
    arc.alive = true;
    arc.held = false;
    arc.from.copy(from);
    arc.to.copy(to);
    arc.color.copy(color);
    arc.jag = jag * unit;
    arc.age = 0;
    arc.life = life;
    arc.reshapeIn = 0;
    arc.lines.visible = true;
  }

  /** Keep a persistent arc under `key` alive this frame. */
  function hold(key: string, from: Vector3, to: Vector3, color: Color, jag: number) {
    let arc = heldSlots.get(key);
    if (!arc || !arc.alive || !arc.held) {
      arc = nextFree();
      heldSlots.set(key, arc);
      arc.reshapeIn = 0;
    }
    arc.alive = true;
    arc.held = true;
    arc.age = 0;
    arc.life = 0.1;
    arc.from.copy(from);
    arc.to.copy(to);
    arc.color.copy(color);
    arc.jag = jag * unit;
    arc.lines.visible = true;
  }

  function update(dt: number) {
    for (const arc of arcs) {
      if (!arc.alive) continue;
      arc.age += dt;
      if (arc.age >= arc.life) {
        arc.alive = false;
        arc.held = false;
        arc.lines.visible = false;
        continue;
      }
      arc.reshapeIn -= dt;
      if (arc.reshapeIn <= 0) {
        randomize(arc);
        arc.reshapeIn = 0.04 + Math.random() * 0.035;
      }
      layout(arc, arc.held ? 1 : (1 - arc.age / arc.life) ** 1.4);
    }
  }

  function clear() {
    heldSlots.clear();
    for (const arc of arcs) {
      arc.alive = false;
      arc.held = false;
      arc.lines.visible = false;
    }
  }

  return { spawn, hold, update, clear };
}
