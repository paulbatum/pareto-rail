import { Box3, BoxGeometry, Color, Group, HemisphereLight, Matrix4, Mesh, Object3D, PlaneGeometry, PointLight, Vector3 } from 'three';
import type { Node } from 'three/webgpu';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn,
  abs,
  cameraViewMatrix,
  cross,
  dot,
  exp,
  float,
  length,
  max,
  mix,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  normalView,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  select,
  sin,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { createDisplacementClock, displacedPosition } from '../../../engine/displaced-velocity';
import { fractalNoise, seams, type FloatNode, type Vec3Node } from '../../../engine/tsl-surface';
import { BLACK_OXIDE, BRASS, BRASS_DARK, LAMP_WARM, STEEL_BLUE, STEEL_DARK, VERDIGRIS, VOID } from './palette';

// Every environment surface is lit and never emissive. The palette rule for
// the environment is brass, steel blue, black oxide, void and the lamp's warm
// white on the lamp body only. The `verdigris` option below exists for
// lockable targets that reuse these materials; the environment passes 0.

// ---- shared uniforms ----------------------------------------------------------

/** Seconds since the bell was last struck. A large value means no wave is travelling. */
export const strikeAge = uniform(1e4);
/** World position the strike wave expands from. */
export const strikeOrigin = uniform(new Vector3());
/** Peak displacement of the strike wave in world units. 0 disables the wave. */
export const strikeStrength = uniform(0);

/**
 * Displacement clock for the gear spin. The environment sets it from the
 * integrated gear time once per frame, so the velocity pass sees only the
 * rotation between frames and per-object motion blur follows the gears.
 */
export const gearDisplacementClock = createDisplacementClock(0);

/** Wave-front speed in world units per second. */
export const STRIKE_SPEED = 700;
/** Half width of the Gaussian window around the wave front, in world units. */
const STRIKE_WIDTH = 55;
/** Sine cycles inside the window; with the window this makes a band-pass front. */
const STRIKE_CYCLES = 2.5;
/** Amplitude decays by 1/e every 1/STRIKE_DECAY seconds. */
const STRIKE_DECAY = 0.9;

/**
 * Radial band-pass displacement for one world position: a windowed sine that
 * expands from `strikeOrigin` at STRIKE_SPEED and decays with `strikeAge`.
 */
function strikeOffsetWorld(world: Vec3Node): Vec3Node {
  const toPoint = world.sub(strikeOrigin);
  const distance = length(toPoint);
  const front = strikeAge.mul(STRIKE_SPEED);
  const x = distance.sub(front).div(STRIKE_WIDTH);
  const window = exp(x.mul(x).negate());
  const carrier = sin(x.mul(Math.PI * STRIKE_CYCLES));
  const decay = exp(strikeAge.mul(-STRIKE_DECAY));
  const amount = window.mul(carrier).mul(decay).mul(strikeStrength);
  return toPoint.div(max(distance, float(1))).mul(amount);
}

/**
 * The position node every environment material uses. `shape` runs first on the
 * local position (the gear spin lives there); the strike wave then displaces the
 * result in world space and maps it back to local space.
 */
export function environmentPositionNode(shape?: (local: Vec3Node, clock: FloatNode) => Vec3Node): Vec3Node {
  return displacedPosition((position, clock) => {
    const local = shape ? shape(position, clock) : position;
    const world = modelWorldMatrix.mul(vec4(local, 1)).xyz;
    const displaced = world.add(strikeOffsetWorld(world));
    return modelWorldMatrixInverse.mul(vec4(displaced, 1)).xyz;
  }, gearDisplacementClock);
}

// ---- brushed metal ------------------------------------------------------------

export type MetalOptions = {
  /** World-space plate size divisor for the seam mask: 1 / plate size. Omit for no seams. */
  seamScale?: number;
  /** Seam stretch along z (see `seams`). */
  seamAniso?: number;
  /** Direction the brushing grooves run along; the highlight stretches along it. */
  brushAxis?: Vector3;
  /** Normal tilt across the grooves, 0..1. */
  brushStrength?: number;
  roughness?: number;
  metalness?: number;
  /** How much of the surface the dark tarnish mask covers, 0..1. */
  tarnish?: number;
  /** Verdigris coverage, 0..1. Environment surfaces pass 0. */
  verdigris?: number;
  /** World position the noise and seams sample; gears pass their pre-spin local position. */
  patternPosition?: Vec3Node;
  /** Normal in the same space as `patternPosition`; defaults to the world normal. */
  patternNormal?: Vec3Node;
  /** Runs on the local position before the strike displacement. `clock` is the gear displacement clock. */
  shape?: (local: Vec3Node, clock: FloatNode) => Vec3Node;
  /** PMREM environment lighting plugs in here (`material.envNode`). */
  environmentNode?: Node;
};

const DEFAULT_BRUSH_AXIS = new Vector3(0, 1, 0);
const BRUSH_SCALE = 0.9;
const BRUSH_ALONG_SQUASH = 0.08;
const NOISE_SCALE = 0.11;

function colorNode(color: Color): Vec3Node {
  return vec3(color.r, color.g, color.b);
}

/**
 * View-space normal tilted across a brushing direction by streaky noise, so a
 * point light draws one stretched highlight instead of a round one.
 */
function brushedNormal(pattern: Vec3Node, brushAxis: Vector3, strength: number): Vec3Node {
  const axis = vec3(brushAxis.x, brushAxis.y, brushAxis.z);
  const n = normalWorld;
  // Grooves run along `along`; fall back to a second axis where the normal is parallel to the brush axis.
  const primary = cross(n, axis);
  const fallback = cross(n, vec3(1, 0, 0));
  const along = normalize(select(length(primary).lessThan(0.05), fallback, primary));
  const across = cross(n, along);
  // Compress the sample coordinate along the grooves so the noise is long along them and fine across.
  const projected = pattern.sub(along.mul(dot(pattern, along).mul(1 - BRUSH_ALONG_SQUASH)));
  const streak = fractalNoise(projected, { scale: BRUSH_SCALE, octaves: 3, roughness: 0.6 }).sub(0.5);
  const tilted = normalize(n.add(across.mul(streak.mul(strength * 2))));
  return normalize(cameraViewMatrix.mul(vec4(tilted, 0)).xyz);
}

/** Cells along the surface normal are stretched this much, so a flat surface never crosses a lattice plane. */
const SEAM_NORMAL_STRETCH = 1000;

/**
 * Plate seams sampled in the surface's own plane. The 3D lattice is swizzled
 * so the dominant normal axis becomes z and stretched along it, which stops a
 * flat surface that lies on a lattice plane from reading as a checkerboard.
 */
function surfaceSeams(pattern: Vec3Node, normal: Vec3Node, scale: number, aniso: number): FloatNode {
  const magnitude = abs(normal);
  const xDominant = magnitude.x.greaterThan(magnitude.y).and(magnitude.x.greaterThan(magnitude.z));
  const yDominant = magnitude.y.greaterThan(magnitude.z);
  const swizzled = select(xDominant, pattern.yzx, select(yDominant, pattern.zxy, pattern.xyz));
  // Hold the collapsed axis at the middle of a cell so the surface never sits on a lattice border.
  const midCell = (0.5 * SEAM_NORMAL_STRETCH * aniso) / scale;
  const projected = vec3(swizzled.x, swizzled.y, midCell);
  return seams(projected, scale, SEAM_NORMAL_STRETCH * aniso);
}

function tarnishMask(pattern: Vec3Node, coverage: number): FloatNode {
  if (coverage <= 0) return float(0);
  const noise = fractalNoise(pattern, { scale: NOISE_SCALE, octaves: 4, roughness: 0.55 });
  return smoothstep(float(1 - coverage * 0.75), float(1.05 - coverage * 0.75), noise);
}

function verdigrisMask(pattern: Vec3Node, coverage: number): FloatNode {
  if (coverage <= 0) return float(0);
  const noise = fractalNoise(pattern.add(vec3(31, 7, 13)), { scale: NOISE_SCALE * 1.6, octaves: 4, roughness: 0.6 });
  return smoothstep(float(1 - coverage * 0.7), float(1.08 - coverage * 0.7), noise);
}

/** Every metal material made so far, so a PMREM environment can be applied after the fact. */
const metals: MeshStandardNodeMaterial[] = [];
let sharedEnvironmentNode: Node | null = null;

/** Assigns `envNode` on every metal material, present and future. The PMREM bake plugs in here. */
export function applyEnvironmentNode(node: Node | null) {
  sharedEnvironmentNode = node;
  for (const material of metals) {
    material.envNode = node;
    material.needsUpdate = true;
  }
}

function createMetal(base: Color, dark: Color, options: MetalOptions, defaults: { roughness: number; metalness: number }) {
  const material = new MeshStandardNodeMaterial({
    roughness: options.roughness ?? defaults.roughness,
    metalness: options.metalness ?? defaults.metalness,
  });
  const pattern = options.patternPosition ?? positionWorld;
  const roughness = options.roughness ?? defaults.roughness;

  let color = colorNode(base);
  let rough: FloatNode = float(roughness);

  if (options.seamScale !== undefined) {
    const plate = surfaceSeams(pattern, options.patternNormal ?? normalWorld, options.seamScale, options.seamAniso ?? 1);
    color = mix(color.mul(0.42), color, plate);
    rough = mix(float(Math.min(1, roughness + 0.35)), rough, plate);
  }

  const tarnish = tarnishMask(pattern, options.tarnish ?? 0.35);
  color = mix(color, colorNode(dark), tarnish.mul(0.85));
  rough = mix(rough, float(Math.min(1, roughness + 0.3)), tarnish);

  const verdigris = verdigrisMask(pattern, options.verdigris ?? 0);
  color = mix(color, colorNode(VERDIGRIS), verdigris);
  rough = mix(rough, float(0.9), verdigris);

  material.colorNode = color;
  material.roughnessNode = rough;
  material.normalNode = brushedNormal(pattern, options.brushAxis ?? DEFAULT_BRUSH_AXIS, options.brushStrength ?? 0.22);
  material.positionNode = environmentPositionNode(options.shape);
  const environmentNode = options.environmentNode ?? sharedEnvironmentNode;
  if (environmentNode) material.envNode = environmentNode;
  metals.push(material);
  return material;
}

/** Lamp-lit brass: metallic, brushed, tarnished in patches, plate seams when `seamScale` is given. */
export function createBrassMaterial(options: MetalOptions = {}) {
  return createMetal(BRASS, BRASS_DARK, options, { roughness: 0.42, metalness: 0.72 });
}

/** Steel blue: pylons, rods, arbors and the ratchet-coloured fittings. */
export function createSteelMaterial(options: MetalOptions = {}) {
  return createMetal(STEEL_BLUE, STEEL_DARK, options, { roughness: 0.5, metalness: 0.6 });
}

/** Black oxide: hands, hammer heads, the dial face. */
export function createOxideMaterial(options: MetalOptions = {}) {
  return createMetal(BLACK_OXIDE, VOID, { tarnish: 0, ...options }, { roughness: 0.62, metalness: 0.4 });
}

/** The lamp body: the only warm-white surface in the environment. Intensity above 1 feeds bloom. */
export function createLampMaterial(intensity = 3) {
  const material = new MeshBasicNodeMaterial();
  const view = normalize(vec3(0, 0, 1));
  const rim = float(1).sub(normalView.dot(view).abs()).pow(2);
  material.colorNode = colorNode(LAMP_WARM).mul(float(intensity).sub(rim.mul(intensity * 0.5)));
  material.positionNode = environmentPositionNode();
  return material;
}

// ---- lights -----------------------------------------------------------------------

export type LampOptions = {
  name: string;
  position: Vector3;
  intensity: number;
  /** 1 gives linear falloff, which reaches across a set at this scale; 2 is physical. */
  decay?: number;
};

/** A warm point light. `escapement-lamp` is the one the god-rays stage looks up by name. */
export function createLamp(options: LampOptions) {
  const light = new PointLight(LAMP_WARM, options.intensity, 0, options.decay ?? 1);
  light.name = options.name;
  light.position.copy(options.position);
  return light;
}

/** Low steel-blue fill from the sides, black from below. */
export function createFill(intensity = 1.2) {
  return new HemisphereLight(STEEL_BLUE.clone().multiplyScalar(0.8), VOID, intensity);
}

/**
 * Lights for a single-set snapshot: a lamp above the set's bounds centre and the
 * fill. `reach` is the lamp's height above the centre.
 */
export function createPreviewLights(center: Vector3, reach: number) {
  const group = new Group();
  group.add(createLamp({
    name: 'preview-lamp',
    position: center.clone().add(new Vector3(reach * 0.35, reach, reach * 0.5)),
    intensity: reach * 0.9,
  }));
  group.add(createFill());
  return group;
}

// ---- snapshot framing -----------------------------------------------------------------

/** Bounding-sphere radius handed to the snapshot tool; it sets the orbit distance and the far plane. */
const PIN_RADIUS = 30;
const SNAPSHOT_FOV_HALF = (45 * Math.PI) / 360;
const SNAPSHOT_FILL = 0.7;
/** The tool's fixed orbit pitch: the camera sits below the target and looks up by this angle. */
const SNAPSHOT_PITCH = (12 * Math.PI) / 180;

/**
 * Makes the snapshot tool's yaw-0 camera sit at `cameraPosition` looking along
 * `direction`. The set is moved so that point is the origin and the direction
 * faces the tool's camera; every real mesh gets an empty bounding box and one
 * invisible mesh carries a small box where the tool should aim, so the orbit
 * frames that box instead of the whole set. Frustum culling is switched off on
 * the real meshes because their bounds are now empty.
 */
export function pinSnapshotView(root: Object3D, cameraPosition: Vector3, direction: Vector3) {
  const orbit = PIN_RADIUS / (Math.sin(SNAPSHOT_FOV_HALF) * SNAPSHOT_FILL);
  const flat = direction.clone().setY(0);
  const elevation = Math.atan2(direction.y, flat.length());
  flat.normalize();
  const yaw = Math.atan2(flat.x, -flat.z);
  const tilt = SNAPSHOT_PITCH - elevation;
  const transform = new Matrix4()
    .makeRotationX(tilt)
    .multiply(new Matrix4().makeRotationY(yaw))
    .multiply(new Matrix4().makeTranslation(-cameraPosition.x, -cameraPosition.y, -cameraPosition.z));

  root.traverse((object) => {
    const mesh = object as Mesh & { boundingBox?: Box3 | null };
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    mesh.geometry.boundingBox = new Box3();
    if ('boundingBox' in mesh) mesh.boundingBox = new Box3();
  });

  const pivot = new Group();
  pivot.add(root);
  transform.decompose(pivot.position, pivot.quaternion, pivot.scale);

  const target = new Vector3(0, Math.sin(SNAPSHOT_PITCH) * orbit, -Math.cos(SNAPSHOT_PITCH) * orbit);
  const half = PIN_RADIUS / Math.sqrt(3);
  const anchor = new Mesh(new BoxGeometry(0.01, 0.01, 0.01));
  anchor.visible = false;
  anchor.geometry.boundingBox = new Box3(target.clone().subScalar(half), target.clone().addScalar(half));

  const outer = new Group();
  outer.add(pivot, anchor);
  return outer;
}

/** Snapshot factory: brass swatches isolating seams, tarnish and brushing, under one lamp. */
export function previewMaterialSwatches() {
  const group = new Group();
  const options: MetalOptions[] = [
    { seamScale: 1 / 60, tarnish: 0, brushStrength: 0 },
    { tarnish: 0.4, brushStrength: 0 },
    { tarnish: 0, brushStrength: 0.22 },
    { seamScale: 1 / 60, tarnish: 0.4, brushStrength: 0.22 },
  ];
  options.forEach((option, index) => {
    const plate = new Mesh(new PlaneGeometry(200, 200), createBrassMaterial(option));
    plate.position.set((index - 1.5) * 210, 0, 0);
    group.add(plate);
  });
  group.add(createLamp({ name: 'preview-lamp', position: new Vector3(0, 120, 260), intensity: 260 }));
  group.add(createFill());
  return group;
}
