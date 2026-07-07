import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Camera, Material } from 'three';
import type { EventBus } from '../../../events';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { glyphOnCells } from '../../../engine/glyphs';
import { sampleRailFrame } from '../../../engine/rail';
import { scatterAlongRail } from '../../../engine/environment-kit';
import type { ScatterField } from '../../../engine/environment-kit';
import {
  createAdditiveBasicMaterial,
  createPendingVisualRecords,
  createTransientEffectPool,
  disposeObject3D,
} from '../../../engine/visual-kit';
import { createRushRail } from '../gameplay';
import { RUSH_TUNING } from '../tuning';
import { setRushRadialBlur } from '../post-fx';

const BLACK = new Color(0.002, 0.004, 0.01);
const CYAN = new Color(0.08, 1.0, 1.35);
const AMBER = new Color(1.7, 0.52, 0.08);
const WHITE = new Color(0.86, 0.96, 1.0);
const RED = new Color(1.8, 0.08, 0.04);
const BLUE = new Color(0.04, 0.24, 1.25);

const hdr = (color: Color, intensity: number) => color.clone().multiplyScalar(intensity);

type ColorMaterial = Material & { color?: Color; opacity?: number };
type EnemyRecord = { mesh: Group; bornAt: number; accent: Color };
type ProjectileRecord = { mesh: Object3D };
type Pulse = { ring: Mesh; age: number; life: number; color: Color; scale: number };
type VisualContext = {
  scene: Scene;
  camera: Camera;
  elapsed: number;
  running: boolean;
  speedFactor: number;
  surgePulse: number;
  feel: CameraFeelRig;
  runProgress?: number;
};

const UNIT_BOX_GEOMETRY = new BoxGeometry(1, 1, 1);
const UNIT_PLANE_GEOMETRY = new PlaneGeometry(1, 1);
const BUILDING_WINDOW_MATERIAL = createAdditiveBasicMaterial({ color: 0xffffff, vertexColors: true, side: DoubleSide });
const SAME_TRAFFIC_LIGHT_MATERIAL = createAdditiveBasicMaterial({ color: hdr(AMBER, 2.0), side: DoubleSide });
const ONCOMING_TRAFFIC_LIGHT_MATERIAL = createAdditiveBasicMaterial({ color: hdr(CYAN, 2.4), side: DoubleSide });
const STREETLIGHT_HEAD_MATERIAL = createAdditiveBasicMaterial({ color: hdr(AMBER, 1.15) });
const GANTRY_STROBE_MATERIAL = createAdditiveBasicMaterial({ color: hdr(AMBER, 0.65), side: DoubleSide });
const GANTRY_IDLE_MATERIAL = createAdditiveBasicMaterial({ color: hdr(CYAN, 0.18), side: DoubleSide });
const matteMaterials = new Map<number, MeshLambertMaterial>();
const enemyGeometries = new Map<string, BufferGeometry>();
const letterGeometries = new Map<string, { fill: BufferGeometry; core: BufferGeometry }>();
const LETTER_BRACKET_GEOMETRY = new RingGeometry(0.88, 0.92, 4);

const rail = createRushRail();
const enemies = createPendingVisualRecords<Group, EnemyRecord, [number, string]>({
  createRecord: (mesh, bornAt, kind) => ({ mesh, bornAt, accent: accentForKind(kind) }),
});
const projectiles = createPendingVisualRecords<Object3D, ProjectileRecord>({
  createRecord: (mesh) => ({ mesh }),
});
const pulses = createTransientEffectPool<Pulse, VisualContext>({
  update(item, progress, _dt, context) {
    item.ring.quaternion.copy(context.camera.quaternion);
    item.ring.scale.setScalar(0.25 + progress * item.scale);
    const material = item.ring.material as MeshBasicMaterial;
    material.color.copy(item.color).multiplyScalar((1 - progress) ** 1.25);
    material.opacity = Math.max(0, 1 - progress);
  },
  dispose(item, context) {
    context.scene.remove(item.ring);
    item.ring.geometry.dispose();
    (item.ring.material as MeshBasicMaterial).dispose();
  },
});

let environmentRoot: Group | null = null;
let buildingField: ScatterField | null = null;
let sameTrafficField: ScatterField | null = null;
let oncomingTrafficField: ScatterField | null = null;
let streetlightField: ScatterField | null = null;
let gantryField: ScatterField | null = null;
let streakField: SpeedStreakField | null = null;
let beatEnergy = 0;
let elapsedNow = 0;

export function createEnvironment(scene: Scene) {
  disposeEnvironment();
  scene.background = BLACK;
  scene.fog = new Fog(RUSH_TUNING.fog.color, RUSH_TUNING.fog.nearUnits, RUSH_TUNING.fog.farUnits);

  const root = new Group();
  root.add(new AmbientLight(0x151923, 0.75));
  root.add(new HemisphereLight(0x35486e, 0x050307, 1.6));
  const key = new DirectionalLight(0x88aaff, 2.4);
  key.position.set(0.6, 0.75, 0.3);
  root.add(key);

  root.add(createStreetSurface());

  buildingField = createBuildingField();
  sameTrafficField = createTrafficField('same');
  oncomingTrafficField = createTrafficField('oncoming');
  streetlightField = createStreetlightField();
  gantryField = createGantryField();
  root.add(buildingField.group, sameTrafficField.group, oncomingTrafficField.group, streetlightField.group, gantryField.group);

  streakField = createSpeedStreaks();
  root.add(streakField.object);

  scene.add(root);
  environmentRoot = root;
  return root;
}

export function disposeEnvironment() {
  buildingField?.dispose();
  sameTrafficField?.dispose();
  oncomingTrafficField?.dispose();
  streetlightField?.dispose();
  gantryField?.dispose();
  buildingField = null;
  sameTrafficField = null;
  oncomingTrafficField = null;
  streetlightField = null;
  gantryField = null;
  streakField?.dispose();
  streakField = null;
  if (environmentRoot) {
    environmentRoot.removeFromParent();
    disposeObject3D(environmentRoot);
  }
  environmentRoot = null;
  setRushRadialBlur(0);
}

type BuildingSpec = {
  side: -1 | 1;
  gap: boolean;
  width: number;
  depth: number;
  height: number;
  setback: number;
};

type TrafficDirection = 'same' | 'oncoming';

const roadY = () => -RUSH_TUNING.street.cameraHeightOverRoadUnits;
const lerpRange = (range: readonly [number, number], t: number) => range[0] + (range[1] - range[0]) * t;
const sideForIndex = (index: number): -1 | 1 => (index % 2 === 0 ? -1 : 1);

function createStreetSurface() {
  const group = new Group();
  group.add(createRoadStrip(-RUSH_TUNING.street.roadWidthUnits * 0.5, RUSH_TUNING.street.roadWidthUnits * 0.5, roadY(), matte(0x07080a)));
  for (const side of [-1, 1] as const) {
    const roadEdge = side * RUSH_TUNING.street.roadWidthUnits * 0.5;
    const sidewalkOuter = side * (RUSH_TUNING.street.roadWidthUnits * 0.5 + RUSH_TUNING.street.sidewalkWidthUnits);
    group.add(createRoadStrip(roadEdge, sidewalkOuter, roadY() + RUSH_TUNING.street.curbHeightUnits, matte(0x101217)));
    group.add(createCurbLine(roadEdge, roadY() + RUSH_TUNING.street.curbHeightUnits));
  }
  group.add(createLaneDashes());
  return group;
}

function createRoadStrip(leftOffset: number, rightOffset: number, y: number, material: MeshLambertMaterial) {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];
  const railLength = rail.getLength();
  const samples = Math.ceil((railLength / RUSH_TUNING.street.laneDashSpacingUnits) * RUSH_TUNING.street.samplesPerDash);
  for (let i = 0; i <= samples; i += 1) {
    const u = i / samples;
    const left = streetPoint(u, leftOffset, y);
    const right = streetPoint(u, rightOffset, y);
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    if (i < samples) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

function createCurbLine(offset: number, y: number) {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const colors: number[] = [];
  const railLength = rail.getLength();
  const count = Math.floor(railLength / RUSH_TUNING.street.laneDashSpacingUnits);
  for (let i = 0; i < count; i += 1) {
    const u0 = (i * RUSH_TUNING.street.laneDashSpacingUnits) / railLength;
    const u1 = Math.min(1, (i * RUSH_TUNING.street.laneDashSpacingUnits + RUSH_TUNING.street.laneDashLengthUnits) / railLength);
    const a = streetPoint(u0, offset, y);
    const b = streetPoint(u1, offset, y);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    colors.push(AMBER.r * 0.25, AMBER.g * 0.25, AMBER.b * 0.25, AMBER.r * 0.25, AMBER.g * 0.25, AMBER.b * 0.25);
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const lines = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  lines.frustumCulled = false;
  return lines;
}

function createLaneDashes() {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];
  const railLength = rail.getLength();
  const count = Math.floor(railLength / RUSH_TUNING.street.laneDashSpacingUnits);
  for (let i = 0; i < count; i += 1) {
    const u0 = (i * RUSH_TUNING.street.laneDashSpacingUnits) / railLength;
    const u1 = Math.min(1, (i * RUSH_TUNING.street.laneDashSpacingUnits + RUSH_TUNING.street.laneDashLengthUnits) / railLength);
    for (const laneOffset of RUSH_TUNING.street.laneDashOffsetsUnits) {
      const base = positions.length / 3;
      const halfWidth = RUSH_TUNING.street.laneDashWidthUnits * 0.5;
      const p0 = streetPoint(u0, laneOffset - halfWidth, roadY() + RUSH_TUNING.street.curbHeightUnits * 0.08);
      const p1 = streetPoint(u0, laneOffset + halfWidth, roadY() + RUSH_TUNING.street.curbHeightUnits * 0.08);
      const p2 = streetPoint(u1, laneOffset - halfWidth, roadY() + RUSH_TUNING.street.curbHeightUnits * 0.08);
      const p3 = streetPoint(u1, laneOffset + halfWidth, roadY() + RUSH_TUNING.street.curbHeightUnits * 0.08);
      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ color: hdr(CYAN, 0.38), side: DoubleSide }));
  mesh.frustumCulled = false;
  return mesh;
}

function streetPoint(u: number, rightOffset: number, yOffset: number) {
  const frame = sampleRailFrame(rail, u);
  return frame.position.clone()
    .addScaledVector(frame.right, rightOffset)
    .addScaledVector(frame.up, yOffset);
}

function createBuildingField() {
  const railLength = rail.getLength();
  const visibleSpan = RUSH_TUNING.buildings.visibleAheadUnits + RUSH_TUNING.buildings.visibleBehindUnits;
  const slots = (Math.ceil(visibleSpan / RUSH_TUNING.buildings.blockSpacingUnits) + 2) * 2;
  return scatterAlongRail(rail, {
    count: slots,
    seed: RUSH_TUNING.buildings.seed,
    window: {
      behind: RUSH_TUNING.buildings.visibleBehindUnits,
      ahead: RUSH_TUNING.buildings.visibleAheadUnits,
    },
    place(index) {
      const spec = buildingSpec(index);
      const slot = Math.floor(index / 2);
      return {
        u: (slot * RUSH_TUNING.buildings.blockSpacingUnits) / railLength,
        offset: new Vector3(
          spec.side * (RUSH_TUNING.buildings.faceOffsetUnits + spec.setback + spec.width * 0.5),
          roadY() + spec.height * 0.5,
          0,
        ),
      };
    },
    make(index) {
      const spec = buildingSpec(index);
      return spec.gap ? new Group() : createBuilding(spec, index);
    },
  });
}

function buildingSpec(index: number): BuildingSpec {
  const slot = Math.floor(index / 2);
  const side = sideForIndex(index);
  return {
    side,
    gap: slot % RUSH_TUNING.buildings.gapEvery === RUSH_TUNING.buildings.gapEvery - 1,
    width: lerpRange(RUSH_TUNING.buildings.widthRangeUnits, pseudo(index + RUSH_TUNING.buildings.seed, 1)),
    depth: lerpRange(RUSH_TUNING.buildings.depthRangeUnits, pseudo(index + RUSH_TUNING.buildings.seed, 2)),
    height: lerpRange(RUSH_TUNING.buildings.heightRangeUnits, pseudo(index + RUSH_TUNING.buildings.seed, 3)),
    setback: pseudo(index + RUSH_TUNING.buildings.seed, 4) * RUSH_TUNING.buildings.setbackRangeUnits,
  };
}

function createBuilding(spec: BuildingSpec, index: number) {
  const group = new Group();
  const tower = new Mesh(UNIT_BOX_GEOMETRY, matte(0x1c222c));
  tower.scale.set(spec.width, spec.height, spec.depth);
  group.add(tower);

  const windows = createBuildingWindows(spec, index);
  if (windows) group.add(windows);
  return group;
}

function createBuildingWindows(spec: BuildingSpec, index: number) {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const nearFaceX = -spec.side * (spec.width * 0.5 + 0.015);
  const columns = Math.max(1, Math.floor(spec.depth / RUSH_TUNING.buildings.windowColumnSpacingUnits));
  const rows = Math.max(1, Math.floor(spec.height / RUSH_TUNING.buildings.windowRowSpacingUnits));
  const [windowWidth, windowHeight] = RUSH_TUNING.buildings.windowSizeUnits;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const lit = pseudo(index * 101 + row * 17 + col * 31 + RUSH_TUNING.buildings.seed, 5) < RUSH_TUNING.buildings.windowLightDensity;
      if (!lit) continue;
      const base = positions.length / 3;
      const centerY = -spec.height * 0.5 + row * RUSH_TUNING.buildings.windowRowSpacingUnits;
      const centerZ = -spec.depth * 0.5 + col * RUSH_TUNING.buildings.windowColumnSpacingUnits + windowWidth;
      const halfWidth = windowWidth * 0.5;
      const halfHeight = windowHeight * (1 + pseudo(index + row * col, 7) * windowHeight) * 0.5;
      positions.push(
        nearFaceX, centerY - halfHeight, centerZ - halfWidth,
        nearFaceX, centerY + halfHeight, centerZ - halfWidth,
        nearFaceX, centerY - halfHeight, centerZ + halfWidth,
        nearFaceX, centerY + halfHeight, centerZ + halfWidth,
      );
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      const color = hdr(pseudo(index + row + col, 6) > 0.82 ? AMBER : CYAN, 0.8);
      for (let vertex = 0; vertex < 4; vertex += 1) colors.push(color.r, color.g, color.b);
    }
  }
  if (positions.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return new Mesh(geometry, BUILDING_WINDOW_MATERIAL);
}

function createTrafficField(direction: TrafficDirection) {
  const railLength = rail.getLength();
  const count = direction === 'same' ? RUSH_TUNING.traffic.sameDirectionCount : RUSH_TUNING.traffic.oncomingCount;
  const lanes = direction === 'same' ? RUSH_TUNING.traffic.sameDirectionLaneOffsetsUnits : RUSH_TUNING.traffic.oncomingLaneOffsetsUnits;
  const speedRange = direction === 'same' ? RUSH_TUNING.traffic.sameDirectionSpeedRangeUnitsPerSecond : RUSH_TUNING.traffic.oncomingSpeedRangeUnitsPerSecond;
  return scatterAlongRail(rail, {
    count,
    seed: RUSH_TUNING.traffic.seed + (direction === 'same' ? 1 : 2),
    window: { behind: RUSH_TUNING.traffic.recycleBehindUnits, ahead: RUSH_TUNING.traffic.recycleAheadUnits },
    place(index) {
      const lane = lanes[index % lanes.length] ?? 0;
      return {
        u: ((index + pseudo(index + RUSH_TUNING.traffic.seed, direction === 'same' ? 8 : 9)) / count),
        offset: new Vector3(lane, roadY() + RUSH_TUNING.traffic.carHeightUnits * 0.5, 0),
      };
    },
    make(index) {
      const speed = lerpRange(speedRange, pseudo(index + RUSH_TUNING.traffic.seed, direction === 'same' ? 10 : 11));
      const car = createCar(direction);
      car.userData.speedUnitsPerSecond = speed;
      car.userData.directionSign = direction === 'same' ? 1 : -1;
      return car;
    },
    onUpdate(item, dt) {
      const speed = Number(item.object.userData.speedUnitsPerSecond ?? 0);
      const sign = Number(item.object.userData.directionSign ?? 1);
      item.u += (speed * sign * dt) / railLength;
    },
  });
}

function createCar(direction: TrafficDirection) {
  const group = new Group();
  const body = new Mesh(UNIT_BOX_GEOMETRY, matte(0x1a2028));
  body.scale.set(RUSH_TUNING.traffic.carWidthUnits, RUSH_TUNING.traffic.carHeightUnits * 0.62, RUSH_TUNING.traffic.carLengthUnits);
  body.position.y = -RUSH_TUNING.traffic.carHeightUnits * 0.12;
  const cabin = new Mesh(UNIT_BOX_GEOMETRY, matte(0x2a3140));
  cabin.scale.set(RUSH_TUNING.traffic.carWidthUnits * 0.7, RUSH_TUNING.traffic.carHeightUnits * 0.45, RUSH_TUNING.traffic.carLengthUnits * 0.45);
  cabin.position.y = RUSH_TUNING.traffic.carHeightUnits * 0.28;
  group.add(body, cabin);

  const lightMaterial = direction === 'same' ? SAME_TRAFFIC_LIGHT_MATERIAL : ONCOMING_TRAFFIC_LIGHT_MATERIAL;
  const [lightWidth, lightHeight] = RUSH_TUNING.traffic.lightSizeUnits;
  for (const side of [-1, 1] as const) {
    const light = new Mesh(UNIT_PLANE_GEOMETRY, lightMaterial);
    light.scale.set(lightWidth, lightHeight, 1);
    light.position.set(side * RUSH_TUNING.traffic.lightPairSpacingUnits * 0.5, RUSH_TUNING.traffic.lightHeightUnits - RUSH_TUNING.traffic.carHeightUnits * 0.5, -RUSH_TUNING.traffic.carLengthUnits * 0.5 - 0.02);
    group.add(light);
  }
  return group;
}

function createStreetlightField() {
  const railLength = rail.getLength();
  const visibleSpan = RUSH_TUNING.streetFurniture.visibleAheadUnits + RUSH_TUNING.streetFurniture.visibleBehindUnits;
  const count = (Math.ceil(visibleSpan / RUSH_TUNING.streetFurniture.streetlightSpacingUnits) + 2) * 2;
  return scatterAlongRail(rail, {
    count,
    seed: RUSH_TUNING.streetFurniture.seed,
    window: {
      behind: RUSH_TUNING.streetFurniture.visibleBehindUnits,
      ahead: RUSH_TUNING.streetFurniture.visibleAheadUnits,
    },
    place(index) {
      const slot = Math.floor(index / 2);
      const side = sideForIndex(index);
      return {
        u: (slot * RUSH_TUNING.streetFurniture.streetlightSpacingUnits) / railLength,
        offset: new Vector3(side * RUSH_TUNING.streetFurniture.poleOffsetUnits, 0, 0),
      };
    },
    make(index) {
      return createStreetlight(sideForIndex(index));
    },
  });
}

function createStreetlight(side: -1 | 1) {
  const group = new Group();
  const pole = new Mesh(UNIT_BOX_GEOMETRY, matte(0x14120f));
  pole.scale.set(RUSH_TUNING.streetFurniture.poleRadiusUnits, RUSH_TUNING.streetFurniture.poleHeightUnits, RUSH_TUNING.streetFurniture.poleRadiusUnits);
  pole.position.y = roadY() + RUSH_TUNING.streetFurniture.poleHeightUnits * 0.5;
  const [headWidth, headHeight, headDepth] = RUSH_TUNING.streetFurniture.lampHeadSizeUnits;
  const head = new Mesh(UNIT_BOX_GEOMETRY, STREETLIGHT_HEAD_MATERIAL);
  head.scale.set(headWidth, headHeight, headDepth);
  head.position.set(-side * headWidth * 0.45, roadY() + RUSH_TUNING.streetFurniture.poleHeightUnits, 0);
  group.add(pole, head);
  return group;
}

function createGantryField() {
  const railLength = rail.getLength();
  const visibleSpan = RUSH_TUNING.streetFurniture.visibleAheadUnits + RUSH_TUNING.streetFurniture.visibleBehindUnits;
  const count = Math.ceil(visibleSpan / RUSH_TUNING.streetFurniture.gantrySpacingUnits) + 2;
  return scatterAlongRail(rail, {
    count,
    seed: RUSH_TUNING.streetFurniture.seed + 17,
    window: {
      behind: RUSH_TUNING.streetFurniture.visibleBehindUnits,
      ahead: RUSH_TUNING.streetFurniture.visibleAheadUnits,
    },
    place(index) {
      return {
        u: (index * RUSH_TUNING.streetFurniture.gantrySpacingUnits) / railLength,
        offset: new Vector3(0, roadY() + RUSH_TUNING.streetFurniture.gantryHeightUnits, 0),
      };
    },
    make(index) {
      return createGantry(index);
    },
  });
}

function updateGantryMaterials() {
  GANTRY_STROBE_MATERIAL.color.copy(hdr(AMBER, 0.55 + beatEnergy * 1.8));
  GANTRY_IDLE_MATERIAL.color.copy(hdr(CYAN, 0.18));
}

function createGantry(index: number) {
  const group = new Group();
  const span = RUSH_TUNING.street.roadWidthUnits + RUSH_TUNING.street.sidewalkWidthUnits * 2;
  const thickness = RUSH_TUNING.streetFurniture.gantryBarThicknessUnits;
  const bar = new Mesh(UNIT_BOX_GEOMETRY, matte(0x111318));
  bar.scale.set(span, thickness, thickness);
  const material = index % RUSH_TUNING.streetFurniture.gantryStrobeEvery === 0 ? GANTRY_STROBE_MATERIAL : GANTRY_IDLE_MATERIAL;
  for (const x of [-span * 0.28, 0, span * 0.28]) {
    const signal = new Mesh(UNIT_PLANE_GEOMETRY, material);
    signal.scale.set(thickness * 3.2, thickness * 1.7, 1);
    signal.position.set(x, -thickness * 1.15, -thickness);
    group.add(signal);
  }
  group.add(bar);
  return group;
}

function matte(color: number) {
  let material = matteMaterials.get(color);
  if (!material) {
    material = new MeshLambertMaterial({ color, flatShading: true });
    matteMaterials.set(color, material);
  }
  return material;
}

class SpeedStreakField {
  readonly object: LineSegments;
  private readonly geometry: BufferGeometry;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly seeds: Float32Array;

  constructor() {
    const max = RUSH_TUNING.streaks.maxCount;
    this.positions = new Float32Array(max * 2 * 3);
    this.colors = new Float32Array(max * 2 * 3);
    this.seeds = new Float32Array(max * 4);
    for (let i = 0; i < max; i += 1) {
      const r = pseudo(i, 1) ** 0.55;
      const a = pseudo(i, 2) * Math.PI * 2;
      this.seeds.set([r, a, pseudo(i, 3), pseudo(i, 4)], i * 4);
    }
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    this.object = new LineSegments(this.geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
    this.object.frustumCulled = false;
  }

  update(context: VisualContext) {
    const speedExcess = Math.max(0, context.speedFactor - 1);
    const active = Math.min(RUSH_TUNING.streaks.maxCount, Math.round(RUSH_TUNING.streaks.baseCount + speedExcess * RUSH_TUNING.streaks.countPerSpeedFactor));
    const length = RUSH_TUNING.streaks.baseLengthUnits + speedExcess * RUSH_TUNING.streaks.lengthPerSpeedFactor;
    const velocity = RUSH_TUNING.streaks.baseVelocityUnitsPerSecond + speedExcess * RUSH_TUNING.streaks.velocityPerSpeedFactor;
    const forward = new Vector3();
    const right = new Vector3();
    const up = new Vector3();
    context.camera.getWorldDirection(forward);
    right.setFromMatrixColumn(context.camera.matrixWorld, 0).normalize();
    up.setFromMatrixColumn(context.camera.matrixWorld, 1).normalize();

    for (let i = 0; i < RUSH_TUNING.streaks.maxCount; i += 1) {
      const offset = i * 6;
      if (i >= active) {
        this.positions.fill(0, offset, offset + 6);
        this.colors.fill(0, offset, offset + 6);
        continue;
      }
      const seed = i * 4;
      const radial = this.seeds[seed] * RUSH_TUNING.streaks.spreadRadiusUnits;
      const angle = this.seeds[seed + 1] + Math.sin(context.elapsed * 0.7 + i) * 0.08;
      const range = RUSH_TUNING.streaks.depthRangeUnits;
      const phase = this.seeds[seed + 2] * range;
      const depth = 4 + ((((phase - context.elapsed * velocity) % range) + range) % range);
      const center = context.camera.position.clone()
        .addScaledVector(forward, depth)
        .addScaledVector(right, Math.cos(angle) * radial)
        .addScaledVector(up, Math.sin(angle) * radial * 0.72);
      const start = center.clone().addScaledVector(forward, length * 0.55);
      const end = center.clone().addScaledVector(forward, -length * 0.45);
      this.positions.set([start.x, start.y, start.z, end.x, end.y, end.z], offset);
      const color = this.seeds[seed + 3] > 0.82 ? AMBER : CYAN;
      const intensity = 0.24 + speedExcess * 0.16 + (radial < 5 ? 0.2 : 0);
      this.colors.set([color.r * intensity, color.g * intensity, color.b * intensity, color.r * intensity, color.g * intensity, color.b * intensity], offset);
    }
    (this.geometry.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as Float32BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    (this.object.material as LineBasicMaterial).dispose();
    this.object.removeFromParent();
  }
}

function createSpeedStreaks() {
  return new SpeedStreakField();
}

function pseudo(index: number, salt: number) {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' || letter ? createLetterMesh(letter ?? 'A') : createRushEnemy(kind);
  mesh.scale.setScalar(0.001);
  enemies.enqueue(mesh);
  return mesh;
}

function createRushEnemy(kind: string) {
  const group = new Group();
  const accent = accentForKind(kind);
  const body = new Mesh(getEnemyGeometry(kind), createAdditiveBasicMaterial({ color: 0xffffff, vertexColors: true, side: DoubleSide }));
  group.add(body);
  group.userData.kind = kind;
  group.userData.accent = accent;
  group.userData.vertexColored = true;
  group.userData.materials = collectMaterials(group);
  return group;
}

function getEnemyGeometry(kind: string) {
  const cached = enemyGeometries.get(kind);
  if (cached) return cached;
  const accent = accentForKind(kind);
  const hot = hdr(accent, 1.8);
  const geometries: BufferGeometry[] = [];

  if (kind === 'dart') {
    const nose = colorizedGeometry(new ConeGeometry(0.42, 1.55, 3), hdr(WHITE, 0.95));
    nose.rotateX(Math.PI / 2);
    geometries.push(nose);
    geometries.push(colorizedGeometry(new PlaneGeometry(1.35, 0.18), hot));
    const tail = colorizedGeometry(new PlaneGeometry(0.22, 1.7), hdr(CYAN, 1.1));
    tail.translate(0, -0.72, 0);
    geometries.push(tail);
  } else if (kind === 'heavy') {
    const hull = colorizedGeometry(new IcosahedronGeometry(0.72, 1), hdr(WHITE, 0.95));
    hull.scale(1.15, 0.82, 1.15);
    geometries.push(hull);
    for (let i = 0; i < 3; i += 1) {
      const ring = colorizedGeometry(new TorusGeometry(0.95 + i * 0.18, 0.028, 6, 36), hot);
      ring.rotateZ((i / 3) * Math.PI);
      ring.rotateX(Math.PI / 2);
      geometries.push(ring);
    }
  } else {
    geometries.push(colorizedGeometry(new TorusGeometry(0.78, 0.04, 6, 6), hot));
    geometries.push(colorizedGeometry(new BoxGeometry(0.7, 0.7, 0.24), hdr(WHITE, 0.95)));
    geometries.push(colorizedGeometry(new PlaneGeometry(1.2, 0.075), hdr(AMBER, 1.6)));
  }

  const merged = mergeGeometries(geometries, false) ?? new BufferGeometry();
  for (const geometry of geometries) geometry.dispose();
  enemyGeometries.set(kind, merged);
  return merged;
}

function colorizedGeometry(geometry: BufferGeometry, color: Color) {
  const prepared = geometry.index ? geometry.toNonIndexed() : geometry;
  if (prepared !== geometry) geometry.dispose();
  const count = prepared.getAttribute('position')?.count ?? 0;
  const colors: number[] = [];
  for (let i = 0; i < count; i += 1) colors.push(color.r, color.g, color.b);
  prepared.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return prepared;
}

function createLetterMesh(character: string) {
  const group = new Group();
  const geometries = getLetterGeometries(character);
  const fill = new Mesh(geometries.fill, new MeshBasicMaterial({ color: hdr(WHITE, 0.9), side: DoubleSide }));
  const hot = new Mesh(geometries.core, createAdditiveBasicMaterial({ color: hdr(CYAN, 1.7), side: DoubleSide }));
  const bracket = new Mesh(LETTER_BRACKET_GEOMETRY, createAdditiveBasicMaterial({ color: hdr(AMBER, 1.2), side: DoubleSide }));
  bracket.rotation.z = Math.PI / 4;
  group.add(fill, hot, bracket);
  group.userData.kind = 'letter';
  group.userData.accent = CYAN;
  group.userData.materials = collectMaterials(group);
  return group;
}

function getLetterGeometries(character: string) {
  const key = character.toUpperCase();
  const cached = letterGeometries.get(key);
  if (cached) return cached;
  const fills: BufferGeometry[] = [];
  const cores: BufferGeometry[] = [];
  for (const cell of glyphOnCells(key)) {
    const x = (cell.x - 2) * 0.27;
    const y = (3 - cell.y) * 0.27;
    const fill = new BoxGeometry(0.19, 0.19, 0.075);
    fill.translate(x, y, 0);
    fills.push(fill);
    const core = new BoxGeometry(0.105, 0.105, 0.09);
    core.translate(x, y, 0.07);
    cores.push(core);
  }
  const merged = {
    fill: fills.length > 0 ? mergeGeometries(fills, false) ?? new BufferGeometry() : new BufferGeometry(),
    core: cores.length > 0 ? mergeGeometries(cores, false) ?? new BufferGeometry() : new BufferGeometry(),
  };
  for (const geometry of [...fills, ...cores]) geometry.dispose();
  letterGeometries.set(key, merged);
  return merged;
}

function accentForKind(kind: string) {
  if (kind === 'dart') return CYAN;
  if (kind === 'heavy') return AMBER;
  if (kind === 'letter') return CYAN;
  return BLUE;
}

function collectMaterials(object: Object3D) {
  const materials: ColorMaterial[] = [];
  object.traverse((child) => {
    const maybe = child as Object3D & { material?: Material | Material[] };
    if (!maybe.material) return;
    const list = Array.isArray(maybe.material) ? maybe.material : [maybe.material];
    for (const material of list) materials.push(material as ColorMaterial);
  });
  return materials;
}

function tintObject(object: Object3D, color: Color) {
  const materials = collectMaterials(object);
  for (const material of materials) if (material.color) material.color.copy(color);
}

function tintEnemy(mesh: Object3D, color: Color | undefined) {
  const materials = mesh.userData.materials as ColorMaterial[] | undefined;
  const accent = (mesh.userData.accent as Color | undefined) ?? CYAN;
  const vertexColored = mesh.userData.vertexColored === true;
  for (const material of materials ?? []) {
    if (!material.color) continue;
    if (!color && vertexColored) material.color.setRGB(1, 1, 1);
    else material.color.copy(color ?? hdr(accent, material instanceof MeshBasicMaterial && material.blending !== AdditiveBlending ? 0.85 : 1.45));
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount?: number) {
  mesh.userData.locked = locked;
  const color = lockCount === undefined ? AMBER : colorForLockCount(lockCount, [CYAN, AMBER, RED]);
  tintEnemy(mesh, locked ? hdr(color, 1.9) : undefined);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.34;
  tintEnemy(mesh, hdr(RED, 1.45));
}

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(new OctahedronGeometry(0.2, 0), createAdditiveBasicMaterial({ color: hdr(AMBER, 2.1) }));
  core.scale.set(0.5, 0.5, 3.2);
  const ring = new Mesh(new RingGeometry(0.36, 0.4, 4), createAdditiveBasicMaterial({ color: hdr(CYAN, 1.2), side: DoubleSide }));
  group.add(core, ring);
  projectiles.enqueue(group);
  return group;
}

export function createReticle() {
  const group = new Group();
  const inner = new Mesh(new RingGeometry(0.45, 0.49, 32), new MeshBasicMaterial({ color: hdr(WHITE, 0.9), side: DoubleSide }));
  const outer = new Mesh(new RingGeometry(0.7, 0.73, 4), createAdditiveBasicMaterial({ color: hdr(CYAN, 1.2), side: DoubleSide }));
  outer.rotation.z = Math.PI / 4;
  group.add(inner, outer);
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.12 : 0));
  const tint = active ? hdr(AMBER, 1.15) : hdr(CYAN, 0.75);
  tintObject(reticle, tint);
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    enemies.claim(enemyId, elapsedNow, kind);
    pulse(scene, worldPosition, kind === 'heavy' ? AMBER : CYAN, 1.4, 0.18);
  });
  bus.on('lock', ({ worldPosition, lockCount }) => {
    pulse(scene, worldPosition, colorForLockCount(lockCount, [CYAN, AMBER, RED]), 1.9, 0.2);
  });
  bus.on('unlock', ({ worldPosition }) => {
    pulse(scene, worldPosition, BLUE, 1.1, 0.16);
  });
  bus.on('fire', ({ projectileId, worldPosition, volleySize }) => {
    projectiles.claim(projectileId);
    pulse(scene, worldPosition, AMBER, 1.2 + volleySize * 0.14, 0.17);
  });
  bus.on('hit', ({ projectileId, worldPosition, lethal }) => {
    projectiles.delete(projectileId);
    pulse(scene, worldPosition, lethal ? AMBER : WHITE, lethal ? 3.2 : 2.0, 0.24);
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    enemies.delete(enemyId);
    pulse(scene, worldPosition, AMBER, 4.4, 0.42);
    pulse(scene, worldPosition, CYAN, 2.2, 0.26);
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    enemies.delete(enemyId);
    pulse(scene, worldPosition, RED, 2.4, 0.22);
  });
  bus.on('reject', ({ enemyIds, missingEnemyIds }) => {
    const ids = new Set([...enemyIds, ...(missingEnemyIds ?? [])]);
    for (const id of ids) {
      const record = enemies.get(id);
      if (!record) continue;
      record.mesh.userData.deniedUntil = elapsedNow + 0.28;
      pulse(scene, record.mesh.position, RED, 2.2, 0.22);
    }
  });
  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.48;
  });
  bus.on('runstart', () => {
    enemies.clear();
    projectiles.clear();
    beatEnergy = 1;
    setRushRadialBlur(0);
  });
  bus.on('runend', () => {
    setRushRadialBlur(0);
  });
}

function pulse(scene: Scene, position: Vector3, color: Color, scale: number, life: number) {
  const ring = new Mesh(new RingGeometry(0.7, 0.75, 36), createAdditiveBasicMaterial({ color: hdr(color, 1.4), side: DoubleSide }));
  ring.position.copy(position);
  scene.add(ring);
  pulses.add({ ring, age: 0, life, color: hdr(color, 1.7), scale });
}

export function updateVisuals(dt: number, context: VisualContext) {
  elapsedNow = context.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt / RUSH_TUNING.streetFurniture.strobeHoldSeconds);
  updateGantryMaterials();
  const railU = context.runProgress ?? 0;
  buildingField?.update(railU, dt);
  sameTrafficField?.update(railU, dt);
  oncomingTrafficField?.update(railU, dt);
  streetlightField?.update(railU, dt);
  gantryField?.update(railU, dt);
  streakField?.update(context);

  const speedExcess = Math.max(0, context.speedFactor - 1);
  const fovOffset = Math.min(RUSH_TUNING.fov.maxOffsetDegrees, speedExcess * RUSH_TUNING.fov.offsetDegreesPerSpeedFactor);
  context.feel.setFovOffset(fovOffset, { response: RUSH_TUNING.fov.response });
  context.feel.shake(speedExcess * RUSH_TUNING.shake.traumaPerSecondPerSpeedFactor * dt, {
    maxTrauma: RUSH_TUNING.shake.maxTrauma,
    decay: RUSH_TUNING.shake.decay,
  });

  const blur = Math.min(
    RUSH_TUNING.post.radialBlurMax,
    RUSH_TUNING.post.radialBlurBase + speedExcess * RUSH_TUNING.post.radialBlurPerSpeedFactor + context.surgePulse,
  );
  setRushRadialBlur(context.running ? blur : 0);

  if (environmentRoot) environmentRoot.scale.setScalar(1 + beatEnergy * 0.006 + speedExcess * 0.008);

  for (const record of enemies.values()) {
    const age = context.elapsed - record.bornAt;
    const intro = Math.min(1, age / 0.16);
    const denied = ((record.mesh.userData.deniedUntil as number | undefined) ?? -Infinity) > context.elapsed;
    const locked = record.mesh.userData.locked === true;
    const pulseScale = (locked ? 1 + Math.sin(context.elapsed * 34) * 0.08 : 1) * (denied ? 0.82 + Math.sin(context.elapsed * 90) * 0.07 : 1);
    record.mesh.scale.setScalar((intro * intro * (3 - 2 * intro)) * pulseScale);
    if (denied) tintEnemy(record.mesh, hdr(RED, 1.65));
    else if (!locked) tintEnemy(record.mesh, undefined);
    record.mesh.children.forEach((child, index) => {
      child.rotateZ(dt * (0.9 + index * 0.18) * (locked ? 2.3 : 1));
    });
  }

  for (const { mesh } of projectiles.values()) mesh.rotateZ(dt * 15);
  pulses.update(dt, context);
}
