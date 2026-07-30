import {
  BoxGeometry,
  ConeGeometry,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import type { BufferGeometry, InstancedMesh as InstancedMeshType, Material } from 'three';
import { mulberry32 } from '../../../engine/rng';
import { createEdges, createInstancedEdges, type EdgeStyle } from '../../../engine/edge-overlay';
import { FRAME_HEIGHT, FRAME_WIDTH, frameAngle, frameLength, frameMid, framePoint, referenceCamera, solveFrameBox } from '../frame';
import {
  PYRE_APRON,
  PYRE_BASIN,
  PYRE_COLORS,
  PYRE_DEPTHS,
  PYRE_GATEWAY_LANE,
  type Beam,
  type Pyramid,
  type Slab,
} from './composition';

const DEG = MathUtils.degToRad;

export interface EnvironmentBuild {
  group: Group;
  dispose(): void;
}

/**
 * Collects every geometry and material the environment owns so the level can
 * release them, and attaches the edge shells when the spine asks for them.
 * `edgeStyleFor` being null is the single switch that turns the overlay off.
 */
export class EnvironmentSink {
  readonly group = new Group();
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials = new Set<Material>();

  constructor(private readonly edgeStyleFor: ((faceColor: number) => EdgeStyle) | null = null) {}

  add(object: Object3D) {
    this.group.add(object);
    return object;
  }

  /** Outline a mesh in a contrast step from its own face colour. */
  outline(mesh: Mesh, faceColor: number) {
    if (!this.edgeStyleFor) return;
    const lines = createEdges(mesh, this.edgeStyleFor(faceColor));
    mesh.add(lines);
    this.track(lines.geometry, lines.material as Material);
  }

  /** Outline every instance of an instanced mesh as one merged shell. */
  outlineInstances(mesh: InstancedMeshType, faceColor: number) {
    if (!this.edgeStyleFor) return;
    const lines = createInstancedEdges(mesh, this.edgeStyleFor(faceColor));
    this.add(lines);
    this.track(lines.geometry, lines.material as Material);
  }

  track(geometry: BufferGeometry, material: Material) {
    this.geometries.add(geometry);
    this.materials.add(material);
  }

  build(): EnvironmentBuild {
    const { group, geometries, materials } = this;
    return {
      group,
      dispose() {
        group.removeFromParent();
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
        geometries.clear();
        materials.clear();
      },
    };
  }
}

function flat(color: number) {
  return new MeshBasicMaterial({ color });
}

/** Atmosphere layers opt out of outlines: they are haze, not masses. */
export interface SlabOptions {
  outline?: boolean;
}

/** A box whose outline fills its authored frame rectangle. */
export function addSlab(sink: EnvironmentSink, slab: Slab, options: SlabOptions = {}) {
  const solved = solveFrameBox(slab.rect, slab.depth, slab.thickness, slab.roll ?? 0, slab.yaw ?? 0);
  const geometry = new BoxGeometry(solved.width, solved.height, slab.thickness);
  const material = flat(slab.color);
  const mesh = new Mesh(geometry, material);
  mesh.position.copy(solved.position);
  mesh.rotation.set(0, DEG(slab.yaw ?? 0), DEG(slab.roll ?? 0));
  sink.track(geometry, material);
  if (options.outline !== false) sink.outline(mesh, slab.edge ?? slab.color);
  return sink.add(mesh);
}

export function addSlabs(sink: EnvironmentSink, slabs: readonly Slab[], options: SlabOptions = {}) {
  for (const slab of slabs) addSlab(sink, slab, options);
}

/** A long box laid along a diagonal of the frame. */
export function addBeam(sink: EnvironmentSink, beam: Beam) {
  const geometry = new BoxGeometry(frameLength(beam.rect, beam.depth), beam.width, beam.thickness);
  const material = flat(beam.color);
  const mesh = new Mesh(geometry, material);
  mesh.position.copy(frameMid(beam.rect, beam.depth));
  mesh.position.z -= beam.thickness / 2;
  mesh.rotation.z = frameAngle(beam.rect, beam.depth);
  sink.track(geometry, material);
  sink.outline(mesh, beam.color);
  return sink.add(mesh);
}

export function addBeams(sink: EnvironmentSink, beams: readonly Beam[]) {
  for (const beam of beams) addBeam(sink, beam);
}

/**
 * A square pyramid landed on its authored outline. Tilt and yaw both walk the
 * apex and swing the base corners through different depths, so radius, height
 * and lateral seat are measured against the hero camera and corrected rather
 * than derived in closed form.
 */
export function addPyramid(sink: EnvironmentSink, pyramid: Pyramid) {
  const apex = framePoint(pyramid.apexX, pyramid.apexY, pyramid.depth);
  const baseCentre = framePoint((pyramid.baseLeftX + pyramid.baseRightX) / 2, pyramid.baseY, pyramid.depth);
  const baseLeft = framePoint(pyramid.baseLeftX, pyramid.baseY, pyramid.depth);
  const baseRight = framePoint(pyramid.baseRightX, pyramid.baseY, pyramid.depth);

  const tilt = DEG(pyramid.tilt);
  const yaw = DEG(pyramid.yaw);
  const targetWidth = pyramid.baseRightX - pyramid.baseLeftX;
  let radius = (baseRight.x - baseLeft.x) / 2;
  let height = apex.y - baseCentre.y;
  let seatX = apex.x;

  const pivot = new Group();
  pivot.rotation.z = tilt;
  const mesh = new Mesh(new ConeGeometry(1, 1, 4, 1), flat(pyramid.color));
  mesh.rotation.y = yaw;
  pivot.add(mesh);

  const apexLocal = new Vector3(0, 0.5, 0);
  const corner = new Vector3();
  for (let pass = 0; pass < 10; pass += 1) {
    mesh.scale.set(radius, height, radius);
    mesh.position.y = height / 2;
    pivot.position.set(seatX, baseCentre.y, -pyramid.depth);
    pivot.updateMatrixWorld(true);

    const apexNdc = corner.copy(apexLocal).applyMatrix4(mesh.matrixWorld).project(referenceCamera);
    const apexPx = ((apexNdc.x + 1) / 2) * FRAME_WIDTH;
    const apexPy = ((1 - apexNdc.y) / 2) * FRAME_HEIGHT;

    let minX = Infinity;
    let maxX = -Infinity;
    let basePy = 0;
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2;
      const ndc = corner.set(Math.cos(angle), -0.5, Math.sin(angle)).applyMatrix4(mesh.matrixWorld).project(referenceCamera);
      const px = ((ndc.x + 1) / 2) * FRAME_WIDTH;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      basePy += (((1 - ndc.y) / 2) * FRAME_HEIGHT) / 4;
    }

    const gotWidth = maxX - minX;
    if (gotWidth < 1e-3 || Math.abs(apexPy - basePy) < 1e-3) break;
    radius *= targetWidth / gotWidth;
    height *= (pyramid.baseY - pyramid.apexY) / (basePy - apexPy);
    seatX += ((pyramid.apexX - apexPx) / gotWidth) * radius * 2;
  }

  sink.track(mesh.geometry, mesh.material as Material);
  sink.outline(mesh, pyramid.color);
  return sink.add(pivot);
}

interface Plate {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
  drop: number;
  color: number;
}

/** `outline: false` for the broad terrain fill, whose box edges are not features. */
function addPlate(sink: EnvironmentSink, plate: Plate, outline = true) {
  const geometry = new BoxGeometry(plate.x1 - plate.x0, plate.drop, Math.abs(plate.z1 - plate.z0));
  const material = flat(plate.color);
  const mesh = new Mesh(geometry, material);
  mesh.position.set((plate.x0 + plate.x1) / 2, plate.top - plate.drop / 2, (plate.z0 + plate.z1) / 2);
  sink.track(geometry, material);
  if (outline) sink.outline(mesh, plate.color);
  return sink.add(mesh);
}

/** Half-width of the basin opening at a given z: a wedge that widens with distance. */
function basinHalfWidth(z: number) {
  const t = MathUtils.clamp((z - PYRE_BASIN.nearZ) / (PYRE_BASIN.farZ - PYRE_BASIN.nearZ), 0, 1);
  return MathUtils.lerp(PYRE_BASIN.nearHalfWidth, PYRE_BASIN.farHalfWidth, t ** PYRE_BASIN.flare);
}

const PLAIN_EDGE = 430;
const RIM_STEPS = 7;

/** The snow plain, the hole the block field sits in, and the shelves at its rim. */
export function addTerrain(sink: EnvironmentSink) {
  addPlate(sink, { x0: -PLAIN_EDGE, x1: PLAIN_EDGE, z0: 90, z1: PYRE_BASIN.nearZ, top: 0, drop: 40, color: PYRE_COLORS.snow }, false);
  addPlate(sink, {
    x0: -PLAIN_EDGE,
    x1: PLAIN_EDGE,
    z0: PYRE_BASIN.farZ,
    z1: -224,
    top: 0,
    drop: 40,
    color: PYRE_COLORS.snow,
  }, false);

  for (let i = 0; i < RIM_STEPS; i += 1) {
    const z0 = MathUtils.lerp(PYRE_BASIN.nearZ, PYRE_BASIN.farZ, i / RIM_STEPS);
    const z1 = MathUtils.lerp(PYRE_BASIN.nearZ, PYRE_BASIN.farZ, (i + 1) / RIM_STEPS);
    const half = basinHalfWidth(z1);
    addPlate(sink, { x0: -PLAIN_EDGE, x1: PYRE_BASIN.centreX - half, z0, z1, top: 0, drop: 40, color: PYRE_COLORS.snow }, false);
    addPlate(sink, { x0: PYRE_BASIN.centreX + half, x1: PLAIN_EDGE, z0, z1, top: 0, drop: 40, color: PYRE_COLORS.snow }, false);
  }

  addPlate(sink, {
    x0: PYRE_BASIN.centreX - PYRE_BASIN.farHalfWidth - 40,
    x1: PYRE_BASIN.centreX + PYRE_BASIN.farHalfWidth + 40,
    z0: PYRE_BASIN.nearZ + 6,
    z1: PYRE_BASIN.farZ - 6,
    top: PYRE_BASIN.floorY,
    drop: 12,
    color: PYRE_COLORS.basinFloor,
  }, false);

  // Dark slab platforms laid over the near plain: the reference foreground is
  // terraced concrete, not clean snow, and they carry the frame's bottom edge.
  addPlate(sink, { x0: -6, x1: 1, z0: -14, z1: -21, top: 0.2, drop: 6, color: PYRE_COLORS.slabDark });
  addPlate(sink, { x0: -11, x1: -5, z0: -16, z1: -22, top: 0.15, drop: 6, color: PYRE_COLORS.slab });
  addPlate(sink, { x0: 2, x1: 8, z0: -17, z1: -23, top: 0.2, drop: 6, color: PYRE_COLORS.slab });

  for (const step of PYRE_APRON.steps) {
    addPlate(sink, { ...step, drop: 12 });
    // Stand the riser proud of its step in both axes. Sharing the step's front
    // plane put two camera-facing faces at the same z; sitting only a fraction
    // above its top left a grazing-angle sliver that fought from the fly-around.
    addPlate(sink, {
      x0: step.x0 + 1.5,
      x1: step.x1 - 1.5,
      z0: step.z0 + 1.6,
      z1: step.z0 - 1.4,
      top: step.top + 1.2,
      drop: 4,
      color: PYRE_APRON.riser,
    });
  }

  // Shelves stepping down into the near rim, so the basin edge reads as
  // terraced ground rather than a clean cut.
  addPlate(sink, { x0: -26, x1: 34, z0: -33, z1: -42, top: -2.4, drop: 8, color: PYRE_COLORS.snowShaded });
  addPlate(sink, { x0: -18, x1: 28, z0: -42, z1: -54, top: -4.6, drop: 8, color: PYRE_COLORS.slab });
  addPlate(sink, { x0: -46, x1: -16, z0: -34, z1: -50, top: -2.6, drop: 8, color: PYRE_COLORS.slabDark });
  addPlate(sink, { x0: 28, x1: 60, z0: -36, z1: -54, top: -2.2, drop: 8, color: PYRE_COLORS.slab });
  addPlate(sink, { x0: -76, x1: -40, z0: -40, z1: -60, top: -4.2, drop: 8, color: PYRE_COLORS.slabDark });
  addPlate(sink, { x0: 52, x1: 104, z0: -44, z1: -68, top: -5, drop: 8, color: PYRE_COLORS.slabDark });
}

/**
 * Low ridges over the plain. Without them the snow is one unbroken sheet, which
 * reads as blank paper from any vantage other than the hero frame.
 */
export function addDunes(sink: EnvironmentSink, seed: number) {
  const rng = mulberry32(seed);
  const count = 26;
  const geometry = new BoxGeometry(1, 1, 1);
  const material = flat(PYRE_COLORS.snowShaded);
  const mesh = new InstancedMesh(geometry, material, count);
  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const axis = new Vector3(0, 1, 0);

  for (let i = 0; i < count; i += 1) {
    const z = MathUtils.lerp(10, -215, rng());
    const side = rng() < 0.5 ? -1 : 1;
    const x = PYRE_BASIN.centreX + side * (basinHalfWidth(z) + 24 + rng() * 250);
    const height = 3 + rng() * 7;
    position.set(x, height / 2 - 1, z);
    quaternion.setFromAxisAngle(axis, rng() * Math.PI);
    scale.set(40 + rng() * 110, height, 30 + rng() * 90);
    mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
  }
  mesh.instanceMatrix.needsUpdate = true;
  sink.track(geometry, material);
  return sink.add(mesh);
}

/** Loose rock scattered over the plain, dark against the snow. */
export function addRockField(sink: EnvironmentSink, seed: number) {
  const rng = mulberry32(seed);
  const count = 620;
  const geometry = new BoxGeometry(1, 1, 1);
  const material = flat(PYRE_COLORS.rock);
  const mesh = new InstancedMesh(geometry, material, count);
  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const axis = new Vector3(0, 1, 0);

  for (let i = 0; i < count; i += 1) {
    const z = MathUtils.lerp(-14, -210, rng());
    const half = z > PYRE_BASIN.nearZ ? 90 : basinHalfWidth(z) + 30 + rng() * 260;
    const side = rng() < 0.5 ? -1 : 1;
    const x = z > PYRE_BASIN.nearZ ? (rng() - 0.5) * 2 * half : PYRE_BASIN.centreX + side * half;
    // Scale with distance: a metre-wide rock a few metres from the lens would
    // otherwise read as a boulder blocking the frame.
    const size = (0.35 + rng() * 1.1) * MathUtils.clamp(-z / 45, 0.5, 2.6);
    position.set(x, size * 0.35, z);
    quaternion.setFromAxisAngle(axis, rng() * Math.PI);
    scale.set(size * (0.7 + rng()), size * (0.4 + rng() * 0.5), size * (0.7 + rng()));
    mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
  }
  mesh.instanceMatrix.needsUpdate = true;
  sink.track(geometry, material);
  return sink.add(mesh);
}

interface FieldTier {
  color: number;
  blocks: Array<{ x: number; z: number; sx: number; sz: number; top: number }>;
}

/**
 * The sunken block field: a receding wall of vertical faces whose tops sit just
 * under the far plain, so the band reads as architecture rather than a pit.
 */
export function addBlockField(sink: EnvironmentSink, seed: number) {
  const rng = mulberry32(seed);
  const tiers: Record<string, FieldTier> = {
    hot: { color: PYRE_COLORS.trenchHot, blocks: [] },
    mid: { color: PYRE_COLORS.trenchMid, blocks: [] },
    far: { color: PYRE_COLORS.trenchFar, blocks: [] },
    dark: { color: PYRE_COLORS.trenchDark, blocks: [] },
  };

  const rows = 26;
  for (let row = 0; row < rows; row += 1) {
    const z = MathUtils.lerp(PYRE_BASIN.nearZ - 2, PYRE_BASIN.farZ + 4, (row + 0.5) / rows);
    const rowDepth = 3 + (row / rows) * 6;
    const half = basinHalfWidth(z);
    const step = 4 + (row / rows) * 9;
    const columns = Math.ceil((half * 2) / step);
    for (let column = 0; column < columns; column += 1) {
      if (rng() < 0.12) continue;

      const x = PYRE_BASIN.centreX - half + (column + 0.5) * step + (rng() - 0.5) * step * 0.4;
      const { bounds } = PYRE_APRON;
      if (x > bounds.x0 - 10 && x < bounds.x1 + 10 && z < bounds.z0 && z > bounds.z1) continue;
      const lateral = Math.abs(x - PYRE_BASIN.centreX) / half;
      const depth = -z;
      const centreRise = (1 - lateral) ** 1.4 * 5;
      let top = Math.min(4.2, -5 + centreRise + rng() * 7 - (row / rows) * 1.5);
      if (Math.abs(x - PYRE_GATEWAY_LANE.centreX) < PYRE_GATEWAY_LANE.halfWidth) {
        // Blocks in front of the gateway duck under its sill; blocks behind it
        // stop at its lintel. Either way the silhouette stays whole.
        top = Math.min(top, framePoint(960, depth < PYRE_DEPTHS.gateway ? 986 : 836, depth).y);
      }
      const block = {
        x,
        z: z + (rng() - 0.5) * rowDepth,
        sx: step * (0.55 + rng() * 0.45),
        sz: rowDepth * (0.8 + rng() * 0.8),
        top,
      };
      // Dark structures are salted through the field rather than banded at its
      // edges, so the band reads as a lit city with towers in it. The ground
      // around the gateway stays hot: that contrast is the frame's focal point.
      const nearGateway = Math.abs(x - PYRE_GATEWAY_LANE.centreX) < PYRE_GATEWAY_LANE.halfWidth * 1.4;
      if (!nearGateway && rng() < 0.2) tiers.dark.blocks.push(block);
      else if (nearGateway && depth > 46) tiers.hot.blocks.push(block);
      else if (depth > 112) tiers.far.blocks.push(block);
      else if (lateral < 0.4 && depth > 46) tiers.hot.blocks.push(block);
      else tiers.mid.blocks.push(block);
    }
  }

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  for (const tier of Object.values(tiers)) {
    if (tier.blocks.length === 0) continue;
    const geometry = new BoxGeometry(1, 1, 1);
    const material = flat(tier.color);
    const mesh = new InstancedMesh(geometry, material, tier.blocks.length);
    tier.blocks.forEach((block, index) => {
      const height = block.top - PYRE_BASIN.floorY;
      position.set(block.x, block.top - height / 2, block.z);
      scale.set(block.sx, height, block.sz);
      mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    sink.track(geometry, material);
    sink.outlineInstances(mesh, tier.color);
    sink.add(mesh);
  }
}
