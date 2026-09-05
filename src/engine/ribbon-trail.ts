import { AdditiveBlending, Box3, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Mesh, Sphere, Vector3, Vector4 } from 'three';
import type { Blending } from 'three';
import { attribute, float, uniform, uniformArray, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { Node, UniformNode } from 'three/webgpu';

/**
 * A camera-facing strip that follows a moving point.
 *
 * The trail keeps a ring buffer of committed positions plus one live head. Each
 * `pushPoint` moves the head to the new position and commits it when it lies at
 * least `minSpacing` from the last committed point, so a slow or stationary
 * emitter does not fill the buffer with duplicates. The strip has one point per
 * buffer slot and two vertices per point. The CPU uploads each point's position,
 * commit time, and across direction as uniform arrays; the vertex shader reads
 * its slot through the `segment` attribute and offsets each vertex sideways
 * along the across direction by the width the level's node returns.
 *
 * The across direction is `cross(tangent, toCamera)`, which faces the strip
 * toward the camera the level passes to `update`. Where the path points at the
 * camera that cross product swings through 180 degrees over a few points and
 * a per-vertex evaluation would twist the strip into a fan of slivers, so the
 * CPU walks the points from head to tail and carries the previous across
 * direction through the turn instead: `POLE_SIN_LOW` and `POLE_SIN_HIGH` bound
 * the blend on the sine of the angle between tangent and view direction, and
 * `MAX_TURN` caps how far the direction turns from one point to the next, so
 * two points that coincide on screen never twist the quad between them into a
 * sliver. Without a camera position the strip lies flat, perpendicular to
 * world up.
 *
 * Width, fade, and color are nodes built from `t` (0 at the head, 1 at the
 * tail), `age` (seconds since the point was committed), and `side` (-1 or 1
 * across the strip). Pass a number or Color for a constant, or a function that
 * builds a node from those inputs. The default is an additive, unlit, unfogged
 * strip that narrows and fades to nothing at the tail.
 *
 * Positions are world space. Add `mesh` to the scene root and leave its own
 * transform at identity. The mesh is never frustum culled, because its bounds
 * exclude the width; `geometry.boundingBox` still tracks the points so tools
 * that frame objects by their bounds find the trail.
 *
 * A half-width larger than the path's radius of curvature folds the inner edge
 * of the strip over itself, and additive blending brightens the fold. Keep the
 * width under the tightest bend the emitter makes.
 */

export type RibbonNodeInputs = {
  /** 0 at the head, 1 at the oldest point. */
  t: Node<'float'>;
  /** Seconds since the point was committed; 0 at the live head. */
  age: Node<'float'>;
  /** -1 on one edge of the strip, 1 on the other. */
  side: Node<'float'>;
};

export type RibbonNodeBuilder<T extends string> = (inputs: RibbonNodeInputs) => Node<T>;

export type RibbonTrailOptions = {
  /** Committed points in the ring buffer. The strip has this many segments. Default 32. */
  points?: number;
  /** World distance the head must travel before a new point is committed. Default 0.05. */
  minSpacing?: number;
  /** Half-width of the strip in world units, or a node builder. Default 0.25 narrowing to 0 at the tail. */
  width?: number | RibbonNodeBuilder<'float'>;
  /** Opacity multiplier, or a node builder. Default 1 - t. */
  fade?: number | RibbonNodeBuilder<'float'>;
  /** Linear color, or a node builder. Default white. */
  color?: Color | number | RibbonNodeBuilder<'vec3'>;
  /** Default additive. */
  blending?: Blending;
  /** Default false: a height haze would otherwise darken an additive strip. */
  fog?: boolean;
};

export type RibbonTrail = {
  mesh: Mesh;
  material: MeshBasicNodeMaterial;
  /** The same inputs the builders receive, for a level that assigns its own material nodes. */
  nodes: RibbonNodeInputs & { time: UniformNode<'float', number> };
  /** Move the head to `position` and commit it when it is far enough from the last committed point. */
  pushPoint(position: Vector3): void;
  /**
   * Advance the age clock and face the strip toward `cameraPosition`. Call once
   * per frame, after `pushPoint`, whether or not a point was pushed.
   */
  update(dt: number, cameraPosition?: Vector3): void;
  /** Empty the trail. It stays hidden until the next `pushPoint`, which restarts it collapsed at that point. */
  reset(): void;
  dispose(): void;
};

const DEFAULT_POINTS = 32;
const DEFAULT_MIN_SPACING = 0.05;
const DEFAULT_WIDTH = 0.25;
const MIN_TANGENT_LENGTH_SQ = 1e-12;
/** Below this sine of the tangent-to-view angle the across direction is carried from the previous point. */
const POLE_SIN_LOW = 0.15;
/** Above this sine the across direction is the camera-facing cross product. */
const POLE_SIN_HIGH = 0.6;
/** Largest turn of the across direction between adjacent points, in radians. */
const MAX_TURN = 0.17;
const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_SIDE = new Vector3(1, 0, 0);

export function createRibbonTrail(options: RibbonTrailOptions = {}): RibbonTrail {
  const committedCount = Math.max(2, Math.floor(options.points ?? DEFAULT_POINTS));
  const pointCount = committedCount + 1;
  const minSpacing = Math.max(0, options.minSpacing ?? DEFAULT_MIN_SPACING);

  // Ring buffer of committed points. `head` is the slot of the newest one.
  const ring = new Float32Array(committedCount * 3);
  const ringStamps = new Float32Array(committedCount);
  let head = 0;
  let started = false;
  const live = new Vector3();
  let liveStamp = 0;
  let clock = 0;
  let cameraPosition: Vector3 | null = null;

  // Upload order: index 0 is the live head, then committed points newest to oldest.
  const points: Vector4[] = [];
  const across: Vector4[] = [];
  const tangents: Vector3[] = [];
  for (let i = 0; i < pointCount; i += 1) {
    points.push(new Vector4());
    across.push(new Vector4(1, 0, 0, 0));
    tangents.push(new Vector3(0, 0, 1));
  }
  const pointsUniform = uniformArray<'vec4'>(points, 'vec4');
  const acrossUniform = uniformArray<'vec4'>(across, 'vec4');
  const timeUniform = uniform(0);

  const geometry = createStripGeometry(pointCount);
  geometry.boundingBox = new Box3();
  geometry.boundingSphere = new Sphere();
  const segment = attribute<'float'>('segment', 'float');
  const side = attribute<'float'>('side', 'float');
  const slot = segment.toInt();
  const point = pointsUniform.element(slot);
  const position = point.xyz;
  const t = segment.div(pointCount - 1);
  const age = timeUniform.sub(point.w).max(0);
  const inputs: RibbonNodeInputs = { t, age, side };

  const width = resolveNode(options.width, inputs, () => float(DEFAULT_WIDTH).mul(float(1).sub(t)));
  const fade = resolveNode(options.fade, inputs, () => float(1).sub(t));
  const color = resolveColorNode(options.color, inputs);

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: options.blending ?? AdditiveBlending,
    side: DoubleSide,
    fog: options.fog ?? false,
  });
  material.positionNode = position.add(acrossUniform.element(slot).xyz.mul(side).mul(width));
  material.colorNode = color;
  material.opacityNode = fade;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;

  const scratch = new Vector3();
  const newer = new Vector3();
  const older = new Vector3();
  const toCamera = new Vector3();
  const facing = new Vector3();
  const carried = new Vector3();

  function pushPoint(position: Vector3) {
    live.copy(position);
    liveStamp = clock;
    if (!started) {
      for (let i = 0; i < committedCount; i += 1) {
        ring[i * 3] = position.x;
        ring[i * 3 + 1] = position.y;
        ring[i * 3 + 2] = position.z;
        ringStamps[i] = clock;
      }
      head = 0;
      started = true;
      mesh.visible = true;
    } else {
      scratch.set(ring[head * 3], ring[head * 3 + 1], ring[head * 3 + 2]);
      if (scratch.distanceTo(position) >= minSpacing) {
        head = (head + 1) % committedCount;
        ring[head * 3] = position.x;
        ring[head * 3 + 1] = position.y;
        ring[head * 3 + 2] = position.z;
        ringStamps[head] = clock;
      }
    }
    upload();
  }

  function update(dt: number, camera?: Vector3) {
    clock += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    timeUniform.value = clock;
    if (camera) {
      cameraPosition = (cameraPosition ?? new Vector3()).copy(camera);
      if (started) upload();
    }
  }

  function upload() {
    points[0].set(live.x, live.y, live.z, liveStamp);
    for (let i = 1; i < pointCount; i += 1) {
      const slotIndex = (head - (i - 1) + committedCount) % committedCount;
      points[i].set(ring[slotIndex * 3], ring[slotIndex * 3 + 1], ring[slotIndex * 3 + 2], ringStamps[slotIndex]);
    }
    const bounds = geometry.boundingBox as Box3;
    bounds.makeEmpty();
    for (const entry of points) bounds.expandByPoint(scratch.set(entry.x, entry.y, entry.z));
    bounds.getBoundingSphere(geometry.boundingSphere as Sphere);
    computeTangents();
    computeAcross();
  }

  // Central differences from tail to head. Where two neighbours coincide, the
  // tangent keeps the value of the next older point so the strip never
  // collapses at a duplicate.
  function computeTangents() {
    for (let i = pointCount - 1; i >= 0; i -= 1) {
      const a = points[Math.max(0, i - 1)];
      const b = points[Math.min(pointCount - 1, i + 1)];
      newer.set(a.x, a.y, a.z);
      older.set(b.x, b.y, b.z);
      scratch.subVectors(newer, older);
      if (scratch.lengthSq() < MIN_TANGENT_LENGTH_SQ) tangents[i].copy(tangents[Math.min(pointCount - 1, i + 1)]);
      else tangents[i].copy(scratch.normalize());
    }
  }

  // Head to tail. Each point starts from the previous point's across direction
  // (the head starts from its own direction on the previous frame), re-projected
  // perpendicular to this point's tangent, and moves toward the camera-facing
  // cross product as the tangent leaves the view direction.
  function computeAcross() {
    for (let i = 0; i < pointCount; i += 1) {
      const tangent = tangents[i];
      const previous = across[i === 0 ? 0 : i - 1];
      carried.set(previous.x, previous.y, previous.z);
      perpendicularTo(carried, tangent);

      let weight = 0;
      if (cameraPosition) {
        const entry = points[i];
        toCamera.set(cameraPosition.x - entry.x, cameraPosition.y - entry.y, cameraPosition.z - entry.z);
        const distance = toCamera.length();
        facing.crossVectors(tangent, toCamera);
        const sine = distance > 0 ? facing.length() / distance : 0;
        if (sine > POLE_SIN_LOW) {
          facing.normalize();
          if (facing.dot(carried) < 0) facing.negate();
          weight = smoothstep(POLE_SIN_LOW, POLE_SIN_HIGH, sine);
        }
      }
      if (weight > 0) turnToward(carried, facing.lerp(carried, 1 - weight).normalize(), MAX_TURN);
      across[i].set(carried.x, carried.y, carried.z, 0);
    }
  }

  function reset() {
    started = false;
    mesh.visible = false;
  }

  function dispose() {
    reset();
    geometry.dispose();
    material.dispose();
  }

  return {
    mesh,
    material,
    nodes: { ...inputs, time: timeUniform },
    pushPoint,
    update,
    reset,
    dispose,
  };
}

/** Remove the component of `vector` along `tangent` and normalize; pick any perpendicular when nothing is left. */
function perpendicularTo(vector: Vector3, tangent: Vector3) {
  vector.addScaledVector(tangent, -vector.dot(tangent));
  if (vector.lengthSq() < 1e-8) {
    vector.crossVectors(tangent, WORLD_UP);
    if (vector.lengthSq() < 1e-8) vector.crossVectors(tangent, WORLD_SIDE);
  }
  vector.normalize();
}

/** Rotate unit `vector` toward unit `target` by at most `maxAngle` radians, in the plane of the two. */
function turnToward(vector: Vector3, target: Vector3, maxAngle: number) {
  const cosine = Math.min(1, Math.max(-1, vector.dot(target)));
  const angle = Math.acos(cosine);
  if (angle <= maxAngle) {
    vector.copy(target);
    return;
  }
  turnAxis.copy(target).addScaledVector(vector, -cosine);
  if (turnAxis.lengthSq() < 1e-12) return;
  turnAxis.normalize();
  vector.multiplyScalar(Math.cos(maxAngle)).addScaledVector(turnAxis, Math.sin(maxAngle));
}

const turnAxis = new Vector3();

function smoothstep(low: number, high: number, value: number) {
  const x = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return x * x * (3 - 2 * x);
}

/** Two vertices per point, joined into quads. `position` is a placeholder the shader replaces. */
function createStripGeometry(pointCount: number) {
  const segment = new Float32Array(pointCount * 2);
  const side = new Float32Array(pointCount * 2);
  const indices: number[] = [];
  for (let i = 0; i < pointCount; i += 1) {
    segment[i * 2] = i;
    segment[i * 2 + 1] = i;
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
    if (i < pointCount - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(pointCount * 2 * 3), 3));
  geometry.setAttribute('segment', new Float32BufferAttribute(segment, 1));
  geometry.setAttribute('side', new Float32BufferAttribute(side, 1));
  geometry.setIndex(indices);
  return geometry;
}

function resolveNode(
  value: number | RibbonNodeBuilder<'float'> | undefined,
  inputs: RibbonNodeInputs,
  fallback: () => Node<'float'>,
): Node<'float'> {
  if (typeof value === 'function') return value(inputs);
  if (typeof value === 'number') return float(value);
  return fallback();
}

function resolveColorNode(value: Color | number | RibbonNodeBuilder<'vec3'> | undefined, inputs: RibbonNodeInputs): Node<'vec3'> {
  if (typeof value === 'function') return value(inputs);
  const color = value === undefined ? new Color(1, 1, 1) : value instanceof Color ? value : new Color(value);
  return vec3(color.r, color.g, color.b);
}
