import { BufferAttribute, BufferGeometry, Group, MathUtils, Mesh, Vector3 } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node, UniformNode } from 'three/webgpu';
import { attribute, cameraViewMatrix, float, mix, normalWorld, output, positionLocal, select, smoothstep, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { Color } from 'three';
import {
  DAM,
  GORGE_MOUTH_S,
  LIP_A,
  LIP_ANGLE_RADIANS,
  LIP_HEIGHT,
  SPINE,
  TAILWATER,
  WATER_LEVEL,
  archFaceA,
  chuteFloor,
  damPoint,
  floodDepth,
  rightVector,
  valleyRiverHalfWidth,
} from '../route';
import { fbm2, wallProfile, wallSkyVisibility } from '../world';
import { noise1, noise4 } from './noise';
import { LOW_POLY } from './lowpoly';
import { createDisplacementClock, displacedPosition } from '../../../engine/displaced-velocity';

// Water surfaces, all one shading model: a lit, glossy surface whose ripples
// and foam are advected by a per-vertex flow with the two-phase flow-map trick,
// so the pattern streams downstream without stretching. Ribbons carry their
// own surface frame (`surf` coordinates in world units, `across` direction);
// the lake computes its flow in the shader so the breach can pull it.

type FloatNode = Node<'float'>;
type Vec2Node = Node<'vec2'>;

export type WaterColors = { deep: Color; shallow: Color; foam: Color };

export type WaterSurfaceInputs = {
  surf: Vec2Node;
  /** Flow velocity in surf units per second. */
  flow: Vec2Node;
  foam: FloatNode;
  /** 0 calm to 1 whitewater: ripple strength. */
  rough: FloatNode;
  /** Sky visibility for the image-based reflection. */
  sky: FloatNode;
  edge: FloatNode;
  across: Node<'vec3'>;
  /** Fragments with this above zero are cut away (flood fronts). */
  cut?: FloatNode;
};

const rgb = (color: Color) => vec3(color.r, color.g, color.b);
const FLOW_PERIOD = 1.7;

export function createWaterMaterial(colors: WaterColors, inputs: WaterSurfaceInputs) {
  const material = new MeshStandardNodeMaterial({ metalness: 0 });
  const phase = time.div(FLOW_PERIOD);
  const phase0 = phase.fract();
  const phase1 = phase.add(0.5).fract();
  const weight1 = phase0.sub(0.5).abs().mul(2);
  const uv0 = inputs.surf.sub(inputs.flow.mul(phase0.mul(FLOW_PERIOD)));
  const uv1 = inputs.surf.sub(inputs.flow.mul(phase1.mul(FLOW_PERIOD))).add(vec2(13.7, 7.1));

  // Each flow phase takes five fetches from the baked noise volume; their channels
  // feed the slopes, the froth, the lace, the bubbles and the foam lines. The foam
  // patterns are stretched along the current (surf y) so they read as flowing.
  const layers = (uv: Vec2Node) => {
    const broad = noise4(vec3(uv.mul(0.16), time.mul(0.12)));
    const fine = noise4(vec3(uv.x.mul(1.0), uv.y.mul(0.22), time.mul(0.45)));
    const tiny = noise4(vec3(uv.x.mul(3.2), uv.y.mul(1.1), time.mul(1.1)));
    const bubbles = noise4(vec3(uv.x.mul(9), uv.y.mul(5), time.mul(1.7)));
    // Foam lines drawn out along the current: what makes the surface read as flowing downstream.
    const lines = noise1(vec3(uv.x.mul(0.55), uv.y.mul(0.035), time.mul(0.08)));
    return {
      slope: broad.xy.add(fine.xy.mul(0.5)),
      ripple: tiny.xy,
      froth: fine.z.add(broad.z.mul(0.6)),
      lace: tiny.z.add(tiny.w.mul(0.5)),
      bubbles: bubbles.x.add(bubbles.y.mul(0.5)),
      bubbleSlope: bubbles.zw,
      shade: broad.w,
      lines,
    };
  };
  const l0 = layers(uv0);
  const l1 = layers(uv1);
  const blend = <T extends Node>(a: T, b: T) => mix(a as never, b as never, weight1) as unknown as T;
  // Capillary ripples at a finer scale than the mesh give detail close to the camera, even on calm water.
  const gradient = blend(l0.slope, l1.slope).mul(mix(float(0.12), float(0.75), inputs.rough)).add(blend(l0.ripple, l1.ripple).mul(0.1));
  const bubbles = blend(l0.bubbles, l1.bubbles);
  const lineFoam = smoothstep(0.42, 0.85, blend(l0.lines, l1.lines)).mul(inputs.rough.mul(0.8));

  // Foam in two layers. Thin foam is a translucent, pale green veil of fine bubbles;
  // thick foam is white, with its brightness broken up by the bubbles and a broad
  // shade, and the lace always opens gaps in it.
  const cover = inputs.foam.add(blend(l0.froth, l1.froth).mul(0.34)).add(blend(l0.lace, l1.lace).mul(0.26));
  const thin = smoothstep(0.38, 0.6, cover).max(lineFoam.mul(0.7));
  const thick = smoothstep(0.62, 0.8, cover.add(bubbles.mul(0.12)));
  const foam = thin.mul(0.45).add(thick.mul(0.55));

  const n = normalWorld;
  const along = n.cross(inputs.across).normalize();
  // Foam keeps its ripples and gains bubble relief, so up close it is a textured surface, not a flat sheet.
  const detail = gradient.add(blend(l0.bubbleSlope, l1.bubbleSlope).mul(thin.mul(0.18)));
  const worldNormal = n.sub(inputs.across.mul(detail.x)).sub(along.mul(detail.y)).normalize();
  material.normalNode = cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz.normalize();

  const body = mix(rgb(colors.deep), rgb(colors.shallow), inputs.edge);
  const foamColor = rgb(colors.foam).mul(bubbles.mul(0.08).add(blend(l0.shade, l1.shade).mul(0.07)).add(0.9));
  const veil = mix(body.mul(1.8), rgb(colors.foam), 0.45);
  // Clear water reflects and scatters rather than diffusing: a low albedo, and the colour comes from the emissive scatter below.
  material.colorNode = mix(mix(body.mul(0.45), veil, thin.mul(0.8)), foamColor, thick);
  material.roughnessNode = mix(float(0.09), float(0.55), foam);
  material.aoNode = mix(inputs.sky.mul(0.35).add(0.2), float(1), foam.mul(0.8));
  // Light scattered back up out of the water column, strongest where the surface
  // sees open sky: it keeps the river cold green instead of a dark mirror.
  // Foam scatters too, so whitewater in the shade of the gorge still reads white.
  const scatter = body.mul(mix(float(0.25), float(0.5), inputs.sky));
  material.emissiveNode = mix(mix(scatter, veil.mul(0.3), thin.mul(0.7)), foamColor.mul(0.38), thick);
  // A sun glint at grazing angles overflows the half-float scene target; keep it finite.
  material.outputNode = vec4(output.rgb.min(vec3(60)), output.a);
  if (inputs.cut) {
    material.opacityNode = select(inputs.cut.greaterThan(0), float(0), float(1));
    material.alphaTest = 0.5;
  }
  return material;
}

// Ribbon vertex data, packed to stay under the eight vertex buffers a pipeline may bind:
// `surf` is (across, along, edge) and `water` is (speed, foam, rough, sky).
function ribbonInputs(extra: Partial<WaterSurfaceInputs> = {}): WaterSurfaceInputs {
  const surf = attribute<'vec3'>('surf', 'vec3');
  const water = attribute<'vec4'>('water', 'vec4');
  return {
    surf: surf.xy,
    flow: vec2(0, water.x),
    foam: water.y,
    rough: water.z,
    sky: water.w,
    edge: surf.z,
    across: attribute<'vec3'>('across', 'vec3'),
    ...extra,
  };
}

// ---- ribbon construction ------------------------------------------------------------

type RibbonRow = {
  centre: Vector3;
  across: Vector3;
  halfWidth: number;
  along: number;
  speed: number;
  rough: number;
  sky: number;
  /** Height offset and foam for a point `l` across this row. */
  surface(l: number): { lift: number; foam: number };
};

function buildRibbon(rows: RibbonRow[], columns: number) {
  const count = rows.length * columns;
  const position = new Float32Array(count * 3);
  const surf = new Float32Array(count * 3);
  const across = new Float32Array(count * 3);
  const water = new Float32Array(count * 4);
  let v = 0;
  for (const row of rows) {
    for (let c = 0; c < columns; c += 1) {
      const t = (c / (columns - 1)) * 2 - 1;
      const l = t * row.halfWidth;
      const { lift, foam } = row.surface(l);
      position.set([row.centre.x + row.across.x * l, row.centre.y + row.across.y * l + lift, row.centre.z + row.across.z * l], v * 3);
      surf.set([l, row.along, Math.abs(t) ** 2], v * 3);
      across.set([row.across.x, row.across.y, row.across.z], v * 3);
      water.set([row.speed, foam, row.rough, row.sky], v * 4);
      v += 1;
    }
  }
  const indices: number[] = [];
  for (let r = 0; r < rows.length - 1; r += 1) {
    for (let c = 0; c < columns - 1; c += 1) {
      const a = r * columns + c;
      const b = a + columns;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('surf', new BufferAttribute(surf, 3));
  geometry.setAttribute('across', new BufferAttribute(across, 3));
  geometry.setAttribute('water', new BufferAttribute(water, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function chunked(rows: RibbonRow[], columns: number, rowsPerChunk: number, material: MeshStandardNodeMaterial, name: string) {
  if (LOW_POLY) {
    rows = rows.filter((_, index) => index % 3 === 0 || index === rows.length - 1);
    columns = Math.max(3, Math.round(columns / 3));
    rowsPerChunk = Math.max(1, Math.round(rowsPerChunk / 3));
  }
  const group = new Group();
  group.name = name;
  for (let start = 0; start < rows.length - 1; start += rowsPerChunk) {
    const mesh = new Mesh(buildRibbon(rows.slice(start, start + rowsPerChunk + 1), columns), material);
    mesh.receiveShadow = true;
    mesh.userData.raildIgnoreOcclusion = true;
    group.add(mesh);
  }
  return group;
}

// ---- the river ----------------------------------------------------------------------

export type Obstacle = { position: Vector3; radius: number };

/**
 * The material shared by the gorge river and the valley river (one shader to compile
 * instead of two). `surge` adds flow and foam once the flood reaches the valley; the
 * gorge is out of sight by then.
 */
export function createRiverMaterial(colors: WaterColors) {
  const surge = uniform(0);
  const inputs = ribbonInputs();
  inputs.flow = inputs.flow.mul(surge.mul(3).add(1));
  inputs.foam = inputs.foam.add(surge.mul(inputs.rough).mul(0.6));
  const material = createWaterMaterial(colors, inputs);
  material.name = 'water-river';
  return { material, surge };
}

export type RiverOptions = {
  material: MeshStandardNodeMaterial;
  /** Boulders standing in the stream: each throws a foam wake downstream. */
  obstacles: Obstacle[];
  /** Spine range of cascades, foamed over their whole drop. */
  cascades: Array<[fromS: number, toS: number]>;
};

/** Standing waves in the rapids: fixed in space, a hump every ~9 units, broken up across the stream. */
function standingWave(s: number, l: number, halfWidth: number, rapids: number) {
  const across = Math.max(0, 1 - (l / (halfWidth + 2)) ** 2);
  const phase = s * 0.7 + fbm2(l * 0.09, s * 0.02, 2) * 3;
  const wave = Math.sin(phase) * (0.6 + 0.4 * fbm2(s * 0.03, l * 0.07, 2));
  // Peaked crests over broad troughs, breaking white at the top.
  const crest = Math.max(0, wave) ** 1.5;
  return { lift: (crest * 1.5 - 0.3) * rapids * across * (0.3 + 0.55 * rapids), crest: crest * rapids * across };
}

export function createRiver(options: RiverOptions) {
  const { material } = options;
  const rows: RibbonRow[] = [];
  const endS = GORGE_MOUTH_S + 40;
  const right = new Vector3();
  const obstacles = options.obstacles.map((o) => ({ ...o, local: new Vector3() }));
  for (const sample of SPINE) {
    if (sample.kind === 'chute' || sample.kind === 'valley' || sample.s > endS) continue;
    rightVector(sample.heading, right);
    const halfWidth = sample.halfWidth + 5;
    const cascade = options.cascades.some(([from, to]) => sample.s >= from && sample.s <= to + 30);
    // White down the face; the plunge pool below it churns but lets green through.
    const cascadeFoam = options.cascades.some(([from, to]) => sample.s >= from && sample.s <= to) ? 1 : 0.84;
    const walls = Math.min(wallProfile(sample, 1).wall, wallProfile(sample, -1).wall);
    const sink = -0.6 * Math.min(1, Math.max(0, (sample.s - (GORGE_MOUTH_S + 5)) / 30));
    const nearby = obstacles.filter((o) => Math.abs(o.position.x - sample.x) < 40 && Math.abs(o.position.z - sample.z) < 40);
    rows.push({
      centre: new Vector3(sample.x, sample.y + sink, sample.z),
      across: right.clone(),
      halfWidth,
      along: sample.s,
      speed: 2.2 + sample.rapids * 10 + (cascade ? 9 : 0),
      rough: Math.min(1, sample.rapids * 1.1 + (cascade ? 0.4 : 0)),
      sky: Math.max(0.2, wallSkyVisibility(sample, 0, walls)),
      surface(l) {
        const wave = standingWave(sample.s, l, sample.halfWidth, sample.rapids);
        let foam = sample.rapids * 0.36 + wave.crest * 0.8;
        let lift = wave.lift;
        foam += smoothRange(sample.halfWidth - 3, sample.halfWidth + 1.5, Math.abs(l)) * (0.25 + sample.rapids * 0.45);
        if (cascade) foam = Math.max(foam, cascadeFoam);
        for (const o of nearby) {
          const dx = sample.x + right.x * l - o.position.x;
          const dz = sample.z + right.z * l - o.position.z;
          const downstream = dx * Math.sin(sample.heading) - dz * Math.cos(sample.heading);
          const side = dx * right.x + dz * right.z;
          const reach = downstream < 0 ? o.radius * 1.3 : o.radius * (1.2 + downstream * 0.05);
          const across = Math.exp(-(side * side) / (reach * reach));
          const wake = across * Math.exp(-Math.max(0, -downstream) / o.radius - Math.max(0, downstream) / (o.radius * 6));
          foam += wake * 1.1;
          // Pour-over: a pillow of water heaped against the rock, a hole just behind it.
          lift += across * o.radius * (downstream < 0 ? 0.25 * Math.exp(downstream / o.radius) : -0.45 * Math.exp(-downstream / (o.radius * 1.8)) * smoothRange(0, o.radius, downstream));
        }
        // Capped below solid white so the lace noise always opens green gaps, even in the roughest water.
        return { lift, foam: Math.min(cascade ? cascadeFoam : 0.78, foam) };
      },
    });
  }
  return chunked(rows, 34, 120, material, 'river');
}

const smoothRange = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// ---- the lake -----------------------------------------------------------------------

export type LakeOptions = { colors: WaterColors; from: number; halfWidth: number };

/**
 * The reservoir: a grid in the dam's frame whose downstream edge follows the
 * arch. `breach` (0..1) sets the lake sliding toward the centre gate and draws
 * the surface down in front of it.
 */
/** How far the breach draws the lake down around the centre gate; the flood tucks under it. */
const DRAWDOWN = { depth: 5, range: 55, bay: 2, bayReach: 12 };
const BAY_PITCH = DAM.gateWidth + DAM.pierWidth;
const bayWave = (l: number) => 0.5 + 0.5 * Math.cos((2 * Math.PI * l) / BAY_PITCH);
const drawdownAt = (a: number, l: number) => {
  const bay = bayWave(l) ** 2 * smoothRange(DAM.spillwayHalfWidth, DAM.spillwayHalfWidth - 8, Math.abs(l)) * Math.exp(Math.min(0, a) / DRAWDOWN.bayReach);
  return DRAWDOWN.depth * Math.exp(-Math.hypot(Math.min(0, a), l) / DRAWDOWN.range) + DRAWDOWN.bay * bay;
};

/** 0..1 dip in front of each gate bay (x across, y along the dam axis). */
function bayDip(l: FloatNode, a: FloatNode) {
  const wave = l.mul((2 * Math.PI) / BAY_PITCH).cos().mul(0.5).add(0.5);
  const inside = smoothstep(float(DAM.spillwayHalfWidth), float(DAM.spillwayHalfWidth - 8), l.abs());
  return wave.mul(wave).mul(inside).mul(a.min(0).div(DRAWDOWN.bayReach).exp());
}

/** Foam where the lake piles against the pier noses. */
function pierPile(l: FloatNode, a: FloatNode) {
  const pier = l.mul((2 * Math.PI) / BAY_PITCH).cos().mul(-0.5).add(0.5).pow(6);
  const inside = smoothstep(float(DAM.spillwayHalfWidth + 4), float(DAM.spillwayHalfWidth - 4), l.abs());
  return pier.mul(inside).mul(a.min(0).div(7).exp()).mul(0.8);
}

export function createLake(options: LakeOptions) {
  const breachClock = createDisplacementClock(0);
  const breach = breachClock.current;
  const across = DAM.right;
  // Columns are fine across the spillway, where the breach pulls the water into each bay.
  const inner = DAM.spillwayHalfWidth + 12;
  const ls: number[] = [];
  for (let i = 0; i < 26; i += 1) ls.push(-options.halfWidth + (i / 26) * (options.halfWidth - inner));
  for (let l = -inner; l < inner; l += 2) ls.push(l);
  for (let i = 0; i <= 26; i += 1) ls.push(inner + (i / 26) * (options.halfWidth - inner));
  const columns = ls.length;
  const rowsCount = 90;
  const count = columns * rowsCount;
  const position = new Float32Array(count * 3);
  const surf = new Float32Array(count * 2);
  const point = new Vector3();
  let v = 0;
  for (let r = 0; r < rowsCount; r += 1) {
    const t = r / (rowsCount - 1);
    for (let c = 0; c < columns; c += 1) {
      const l = ls[c];
      const face = Math.abs(l) < DAM.halfSpan + 10 ? archFaceA(l) - 0.5 : 60;
      const shore = Math.min(face, 60);
      // Rows bunch toward the dam, where the breach pulls the surface down.
      const a = options.from + (shore - options.from) * (1 - (1 - t) ** 1.6);
      damPoint(a, l, 0, point);
      position[v * 3] = point.x;
      position[v * 3 + 1] = point.y;
      position[v * 3 + 2] = point.z;
      surf[v * 2] = l;
      surf[v * 2 + 1] = a;
      v += 1;
    }
  }
  const indices: number[] = [];
  for (let r = 0; r < rowsCount - 1; r += 1) {
    for (let c = 0; c < columns - 1; c += 1) {
      const a = r * columns + c;
      const b = a + columns;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('surf', new BufferAttribute(surf, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const local = attribute<'vec2'>('surf', 'vec2');
  const bay = bayDip(local.x, local.y);
  const distance = local.length();
  const toGate = local.negate().div(distance.max(1));
  const pull = breach.mul(float(16).mul(distance.div(-190).exp()).add(1.5));
  const flow = vec2(0, 0.25).add(toGate.mul(pull));
  const material = createWaterMaterial(options.colors, {
    surf: local,
    flow,
    // Glassy where it pours into the bays, torn white where it piles against the piers.
    foam: breach.mul(ramp(float(130), float(15), distance).mul(float(0.6).sub(bay.mul(0.35))).add(pierPile(local.x, local.y))),
    rough: breach.mul(ramp(float(200), float(20), distance)).mul(0.9),
    sky: float(1),
    edge: float(0),
    across: vec3(across.x, across.y, across.z),
  });
  material.name = 'water-lake';
  const drawdown = distance.div(-DRAWDOWN.range).exp().mul(DRAWDOWN.depth).add(bay.mul(DRAWDOWN.bay));
  material.positionNode = displacedPosition((position, amount) => position.sub(vec3(0, amount.mul(drawdown), 0)), breachClock);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'lake';
  mesh.receiveShadow = true;
  mesh.userData.raildIgnoreOcclusion = true;
  return { mesh, breach: breachClock };
}

const ramp = (a: FloatNode, b: FloatNode, x: FloatNode) => {
  const t = x.sub(a).div(b.sub(a)).clamp(0, 1);
  return t.mul(t).mul(t.mul(-2).add(3));
};

// ---- the flood, the jet and the valley river --------------------------------------------

export type SpillwayWater = {
  group: Group;
  /** Arc length down the chute the flood has reached; below the sill it is hidden. */
  floodFront: UniformNode<'float', number>;
  /** Extra flow and foam on the valley river once the flood lands. */
  surge: UniformNode<'float', number>;
  /** Arc length of the chute from the gates to the lip. */
  chuteLength: number;
};

const JET_SPEED = 27;
/** Flood-front distance past the lip over which the jet draws out. */
export const JET_REVEAL = 30;
const JET_GRAVITY = 15;

/** Height (relative to the lake) and axial position of the jet `t` seconds after leaving the lip. */
export function jetPoint(t: number) {
  const vx = JET_SPEED * Math.cos(LIP_ANGLE_RADIANS);
  const vy = JET_SPEED * Math.sin(LIP_ANGLE_RADIANS);
  return { a: LIP_A + vx * t, y: LIP_HEIGHT + 1.5 + vy * t - 0.5 * JET_GRAVITY * t * t };
}

export function createSpillwayWater(colors: WaterColors, river: { material: MeshStandardNodeMaterial; surge: UniformNode<'float', number> }) {
  const floodFront = uniform(-100);
  const { surge } = river;
  const group = new Group();
  group.name = 'spillway-water';

  // Flood down the chute: from between the piers to the lip.
  const rows: RibbonRow[] = [];
  const point = new Vector3();
  const previous = new Vector3();
  // It starts well out on the lake, under the surface, and rises through it before the gates, so the two meet without a step.
  let along = -24;
  for (let a = -30; a <= LIP_A + 0.01; a += 1.5) {
    damPoint(a, 0, chuteFloor(a) + floodDepth(a), point);
    if (rows.length > 0) along += point.distanceTo(previous);
    previous.copy(point);
    const halfWidth = MathClamp(DAM.spillwayHalfWidth - 1 - (a / 40) * (DAM.spillwayHalfWidth - DAM.chuteHalfWidth), DAM.chuteHalfWidth - 0.6, DAM.spillwayHalfWidth - 1);
    const rowAlong = along;
    const rowY = point.y - WATER_LEVEL;
    const rowA = a;
    rows.push({
      centre: point.clone(),
      across: DAM.right.clone(),
      halfWidth,
      along: rowAlong,
      speed: 20 + Math.min(30, Math.max(0, rowAlong) * 0.25),
      rough: 0.35 + 0.65 * smoothRange(10, 50, rowAlong),
      sky: 1,
      // A smooth, glassy tongue over the sill (no bulge in front of the camera), tearing
      // into white streaks as it gathers speed down the chute.
      // Near the gates it follows the drawn-down lake, just above it except at its upstream and side edges.
      surface: (l) => {
        const above = smoothRange(-30, -18, rowA) * smoothRange(halfWidth, halfWidth - 8, Math.abs(l));
        const lake = -drawdownAt(rowA, l) - rowY + MathUtils.lerp(-0.5, 0.2, above);
        const lift = (0.15 + 0.6 * smoothRange(10, 50, rowAlong)) * fbm2(l * 0.15, rowAlong * 0.08, 2);
        return {
          lift: rowA < 30 ? Math.min(lake, lift) : lift,
          foam: Math.min(0.74, 0.34 + Math.min(0.38, Math.max(0, rowAlong) / 160) + 0.3 * (Math.abs(l) / halfWidth) ** 2),
        };
      },
    });
  }
  const chuteLength = along;
  // Deep lake green where it leaves the gates, paling as it thins and speeds down the chute.
  const floodAlong = attribute<'vec3'>('surf', 'vec3').y;
  // One material for the flood and the jet (double-sided for the jet): one shader to compile.
  const floodMaterial = createWaterMaterial(colors, ribbonInputs({ cut: floodAlong.sub(floodFront), edge: smoothstep(6, 45, floodAlong) }));
  floodMaterial.name = 'water-flood';
  floodMaterial.side = 2;
  group.add(chunked(rows, 26, 200, floodMaterial, 'flood'));

  // The jet off the ski-jump lip, spreading as it falls into the plunge pool.
  const jetRows: RibbonRow[] = [];
  const landing = timeToTailwater();
  for (let i = 0; i <= 60; i += 1) {
    const t = (i / 60) * landing;
    const { a, y } = jetPoint(t);
    jetRows.push({
      centre: damPoint(a, 0, y),
      across: DAM.right.clone(),
      halfWidth: DAM.chuteHalfWidth + t * 3,
      // Along the flood's arc length, compressed: the jet draws out over the flood front's last 30 units.
      along: chuteLength + (i / 60) * JET_REVEAL,
      speed: 0.5 * JET_REVEAL,
      rough: 1,
      sky: 1,
      surface: (l) => ({ lift: 1.2 * fbm2(l * 0.1, i * 0.2, 2), foam: 0.78 }),
    });
  }
  group.add(chunked(jetRows, 20, 60, floodMaterial, 'jet'));

  // The valley river, from under the lip out across the valley.
  const valleyRows: RibbonRow[] = [];
  for (let a = LIP_A - 12; a <= 1300; a += 3) {
    const halfWidth = valleyRiverHalfWidth(a) + 7;
    const plunge = Math.max(0, 1 - Math.abs(a - (LIP_A + 80)) / 90);
    const aValue = a;
    valleyRows.push({
      centre: damPoint(a, 0, TAILWATER - WATER_LEVEL),
      across: DAM.right.clone(),
      halfWidth,
      along: a,
      speed: 2.5 + plunge * 4,
      rough: 0.25 + plunge * 0.6,
      sky: 1,
      surface: (l) => ({ lift: 0, foam: plunge * 0.5 + 0.3 * smoothRange(halfWidth - 9, halfWidth - 4, Math.abs(l)) + 0.1 * fbm2(aValue * 0.02, l * 0.05, 2) }),
    });
  }
  group.add(chunked(valleyRows, 20, 120, river.material, 'valley-river'));

  return { group, floodFront, surge, chuteLength } satisfies SpillwayWater;
}

function timeToTailwater() {
  const target = TAILWATER - WATER_LEVEL;
  let t = 0;
  while (jetPoint(t).y > target && t < 10) t += 0.02;
  return t;
}

function MathClamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Water height of the river mesh at a spine sample, for things that float or wade. */
export function riverSurfaceLift(s: number, l: number, halfWidth: number, rapids: number) {
  return standingWave(s, l, halfWidth, rapids).lift;
}
