import { AgXToneMapping, Box3, BoxGeometry, Color, Group, HemisphereLight, Matrix4, Mesh, Object3D, PlaneGeometry, PointLight, Scene, Vector3 } from 'three';
import { bakeEnvironment, createGradientSky } from '../../../engine/environment-light';
import type { Node, WebGPURenderer } from 'three/webgpu';
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
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { fractalNoise, voronoiEdgeDistance, type FloatNode, type Vec3Node } from '../../../engine/tsl-surface';
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

/** Applies the strike wave to a local-space position: to world, displace, back to local. */
export function strikeDisplaceLocal(local: Vec3Node): Vec3Node {
  const world = modelWorldMatrix.mul(vec4(local, 1)).xyz;
  const displaced = world.add(strikeOffsetWorld(world));
  return modelWorldMatrixInverse.mul(vec4(displaced, 1)).xyz;
}

/**
 * The position node every still environment material uses. `shape` runs first
 * on the local position; the strike wave then displaces the result.
 */
export function environmentPositionNode(shape?: (local: Vec3Node) => Vec3Node): Vec3Node {
  return Fn(() => strikeDisplaceLocal(shape ? shape(positionLocal) : positionLocal))();
}

// ---- brushed metal ------------------------------------------------------------
//
// Two detail frequencies give the metal its scale: plate seams hundreds of
// units apart with rivet rows along them, and brushing scratches a few units
// across. Under the PMREM environment the metal reflects the warm sky above
// and the steel-blue sides; the point lights add the local highlight.

export type MetalOptions = {
  /** Plate size divisor for the seam mask: 1 / plate size in world units. Omit for no seams. */
  seamScale?: number;
  /** Plate stretch along the second in-plane axis; 2.5 makes plates 2.5 times longer than wide. */
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
  /** Runs on the local position before the strike displacement. */
  shape?: (local: Vec3Node) => Vec3Node;
  /** Replaces the whole positionNode; spinning parts use this to feed the velocity pass. */
  positionNode?: Vec3Node;
  /** PMREM environment lighting plugs in here (`material.envNode`). */
  environmentNode?: Node;
};

const DEFAULT_BRUSH_AXIS = new Vector3(0, 1, 0);
/** Brushing scratch frequency: features about a unit across. */
const BRUSH_SCALE = 0.9;
/** Streak length is 1 / (BRUSH_SCALE * squash): about 55 units, so a groove crosses a whole plate. */
const BRUSH_ALONG_SQUASH = 0.02;
/** Tarnish blotch frequency: patches ten to twenty units across. */
const TARNISH_SCALE = 0.035;
const DEFAULT_SEAM_ANISO = 2.5;
/** Seam groove width in cell units. */
const SEAM_WIDTH = 0.012;
/** Rivet row distance from the seam and rivet spacing, both in cell units. */
const RIVET_ROW = 0.035;
const RIVET_ROW_WIDTH = 0.012;
const RIVETS_PER_CELL = 22;
const RIVET_RADIUS = 0.3;

function colorNode(color: Color): Vec3Node {
  return vec3(color.r, color.g, color.b);
}

type SurfaceFrame = { along: Vec3Node; across: Vec3Node; streak: FloatNode };

/** Tangent frame for brushing and the scratch noise, 0.5-centred. */
function surfaceFrame(pattern: Vec3Node, brushAxis: Vector3): SurfaceFrame {
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
  return { along, across, streak };
}

/** Cells along the surface normal are stretched this much, so a flat surface never crosses a lattice plane. */
const SEAM_NORMAL_STRETCH = 1000;

type PlateDetail = {
  /** 1 on plate faces, 0 in the seam groove. */
  face: FloatNode;
  /** 1 on a rivet head. */
  rivet: FloatNode;
  /** Offset from the rivet centre in rivet-lattice units, for the dome bump. */
  rivetOffset: Node<'vec2'>;
};

/**
 * Plate seams and rivet rows sampled in the surface's own plane. The 3D lattice
 * is swizzled so the dominant normal axis becomes z and held at mid-cell along
 * it, which stops a flat surface that lies on a lattice plane from reading as a
 * checkerboard. Plates are a straight grid, so the rivet rows run parallel to
 * the seams.
 */
function plateDetail(pattern: Vec3Node, normal: Vec3Node, scale: number, aniso: number): PlateDetail {
  const magnitude = abs(normal);
  const xDominant = magnitude.x.greaterThan(magnitude.y).and(magnitude.x.greaterThan(magnitude.z));
  const yDominant = magnitude.y.greaterThan(magnitude.z);
  const swizzled = select(xDominant, pattern.yzx, select(yDominant, pattern.zxy, pattern.xyz));
  const midCell = (0.5 * SEAM_NORMAL_STRETCH) / scale;
  const projected = vec3(swizzled.x, swizzled.y.div(aniso), midCell);
  const edge = voronoiEdgeDistance(projected, scale, { aniso: SEAM_NORMAL_STRETCH, randomness: 0 });
  const face = smoothstep(float(0), float(SEAM_WIDTH), edge);
  const row = smoothstep(float(RIVET_ROW_WIDTH), float(0), abs(edge.sub(RIVET_ROW)));
  const lattice = vec2(swizzled.x, swizzled.y.div(aniso)).mul(scale * RIVETS_PER_CELL);
  const rivetOffset = lattice.fract().sub(0.5);
  const dome = smoothstep(float(RIVET_RADIUS), float(RIVET_RADIUS * 0.6), length(rivetOffset));
  return { face, rivet: dome.mul(row), rivetOffset };
}

function tarnishMask(pattern: Vec3Node, coverage: number): FloatNode {
  if (coverage <= 0) return float(0);
  const noise = fractalNoise(pattern, { scale: TARNISH_SCALE, octaves: 4, roughness: 0.55 });
  const threshold = 0.72 - coverage * 0.3;
  return smoothstep(float(threshold), float(threshold + 0.07), noise);
}

function verdigrisMask(pattern: Vec3Node, coverage: number): FloatNode {
  if (coverage <= 0) return float(0);
  const noise = fractalNoise(pattern.add(vec3(31, 7, 13)), { scale: TARNISH_SCALE * 1.6, octaves: 4, roughness: 0.6 });
  const threshold = 0.66 - coverage * 0.3;
  return smoothstep(float(threshold), float(threshold + 0.08), noise);
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
  const roughness = options.roughness ?? defaults.roughness;
  const material = new MeshStandardNodeMaterial({
    roughness,
    metalness: options.metalness ?? defaults.metalness,
  });
  const pattern = options.patternPosition ?? positionWorld;
  const frame = surfaceFrame(pattern, options.brushAxis ?? DEFAULT_BRUSH_AXIS);
  const brushStrength = options.brushStrength ?? 0.3;

  let color = colorNode(base);
  let rough: FloatNode = float(roughness);
  let normal: Vec3Node = normalWorld;

  // Fine layer: scratches darken and roughen thin lines along the brushing.
  const scratch = smoothstep(float(0.14), float(0.24), frame.streak);
  color = color.mul(scratch.mul(-0.18).add(1));
  rough = rough.add(scratch.mul(0.12));
  normal = normal.add(frame.across.mul(frame.streak.mul(brushStrength * 2)));

  // Coarse layer: plate seams and rivet rows.
  if (options.seamScale !== undefined) {
    const detail = plateDetail(pattern, options.patternNormal ?? normalWorld, options.seamScale, options.seamAniso ?? DEFAULT_SEAM_ANISO);
    color = mix(color.mul(0.35), color, detail.face);
    rough = mix(float(Math.min(1, roughness + 0.3)), rough, detail.face);
    color = mix(color, color.mul(1.12), detail.rivet);
    normal = normal.add(frame.along.mul(detail.rivetOffset.x).add(frame.across.mul(detail.rivetOffset.y)).mul(detail.rivet.mul(1.6)));
  }

  const tarnish = tarnishMask(pattern, options.tarnish ?? 0.35);
  color = mix(color, colorNode(dark), tarnish.mul(0.8));
  rough = mix(rough, float(Math.min(1, roughness + 0.35)), tarnish);

  const verdigris = verdigrisMask(pattern, options.verdigris ?? 0);
  color = mix(color, colorNode(VERDIGRIS), verdigris);
  rough = mix(rough, float(0.9), verdigris);

  material.colorNode = color;
  material.roughnessNode = rough.clamp(0.05, 1);
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(normalize(normal), 0)).xyz);
  material.positionNode = options.positionNode ?? environmentPositionNode(options.shape);
  const environmentNode = options.environmentNode ?? sharedEnvironmentNode;
  if (environmentNode) material.envNode = environmentNode;
  metals.push(material);
  return material;
}

/** Lamp-lit brass: metallic, brushed, tarnished in patches, plate seams when `seamScale` is given. */
export function createBrassMaterial(options: MetalOptions = {}) {
  return createMetal(BRASS, BRASS_DARK, options, { roughness: 0.3, metalness: 0.9 });
}

/** Steel blue: pylons, rods, arbors and the ratchet-coloured fittings. */
export function createSteelMaterial(options: MetalOptions = {}) {
  return createMetal(STEEL_BLUE, STEEL_DARK, options, { roughness: 0.4, metalness: 0.85 });
}

/** Black oxide: hands, hammer heads, the dial face. */
export function createOxideMaterial(options: MetalOptions = {}) {
  return createMetal(BLACK_OXIDE, VOID, { tarnish: 0, ...options }, { roughness: 0.58, metalness: 0.6 });
}

/** The lamp body: the only warm-white surface in the environment. Clamped at 1; the flare and bloom stages add the glow. */
export function createLampMaterial(intensity = 1) {
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
  /**
   * Candela. Falloff is physical (decay 2), so a surface `d` units away receives
   * `intensity / d²`; pick the value so a mid-distance surface gets about 0.35
   * on top of the sky, and let bloom carry the hot spot near the lamp.
   */
  intensity: number;
  /** Falloff exponent; 2 is physical and the default. */
  decay?: number;
};

/** A warm point light. `escapement-lamp` is the one the god-rays stage looks up by name. */
export function createLamp(options: LampOptions) {
  const light = new PointLight(LAMP_WARM, options.intensity, 0, options.decay ?? 2);
  light.name = options.name;
  light.position.copy(options.position);
  return light;
}

/** Low steel-blue fill from the sides, black from below, for a scene without the sky bake. */
export function createFill(intensity = 1.2) {
  return new HemisphereLight(STEEL_BLUE.clone().multiplyScalar(0.8), VOID, intensity);
}

export type PreviewContext = { renderer: WebGPURenderer; scene: Scene };

/** The procedural sky the level's PMREM bake uses: warm lamp above, steel-blue sides, black below. */
export function createEscapementSky() {
  return createGradientSky({
    zenith: LAMP_WARM.clone().multiplyScalar(0.9),
    horizon: STEEL_BLUE.clone().multiplyScalar(0.55),
    ground: VOID,
    horizonWidth: 0.35,
    sunDirection: new Vector3(0.2, 1, 0.35),
    sunColor: LAMP_WARM,
    sunIntensity: 30,
    sunAngularRadius: 0.08,
    haloAngularRadius: 0.6,
    haloIntensity: 0.15,
  });
}

/**
 * Wraps a snapshot factory so the harness bakes the level's sky into the scene
 * before building the set. The harness calls the returned function with its
 * renderer once the renderer is initialised.
 */
export function withPreviewEnvironment(build: () => Object3D) {
  return ({ renderer, scene }: PreviewContext) => {
    const sky = createEscapementSky();
    bakeEnvironment(renderer, () => sky.scene, { size: 128 }).attach(scene);
    // The level renders through AgX; the harness applies whatever the renderer carries.
    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = 1;
    return build();
  };
}

/**
 * Lights for a single-set snapshot under the sky bake: one lamp above the set's
 * centre. `reach` is the lamp's height above the centre; the intensity gives the
 * centre about 0.35 of lamp light.
 */
export function createPreviewLights(center: Vector3, reach: number) {
  const group = new Group();
  group.add(createLamp({
    name: 'preview-lamp',
    position: center.clone().add(new Vector3(reach * 0.35, reach, reach * 0.5)),
    intensity: reach * reach * 0.55,
  }));
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
    { seamScale: 1 / 300, tarnish: 0, brushStrength: 0 },
    { tarnish: 0.4, brushStrength: 0 },
    { tarnish: 0, brushStrength: 0.3 },
    { seamScale: 1 / 300, tarnish: 0.4, brushStrength: 0.3 },
  ];
  options.forEach((option, index) => {
    const plate = new Mesh(new PlaneGeometry(400, 400), createBrassMaterial(option));
    plate.position.set((index - 1.5) * 410, 0, 0);
    plate.rotation.x = -0.35;
    group.add(plate);
  });
  group.add(createLamp({ name: 'preview-lamp', position: new Vector3(120, 260, 420), intensity: 70000 }));
  return group;
}

/** Snapshot factory: the swatches under the level's PMREM sky. */
export function previewMaterialSwatchesLit() {
  return withPreviewEnvironment(previewMaterialSwatches);
}
