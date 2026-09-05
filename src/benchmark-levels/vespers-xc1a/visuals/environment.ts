import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
} from 'three';
import { LineBasicNodeMaterial, PointsNodeMaterial } from 'three/webgpu';
import { attribute, float, time, uniform } from 'three/tsl';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import {
  createVespersRail,
  NAVE_FLOOR_Y,
  NAVE_HALF_WIDTH,
  RAIL_END_Z,
  ROSE_CENTER,
  ROSE_RADIUS,
  WEST_WALL_Z,
} from '../gameplay';
import { BLOOD, BOTTLE, CANDLE, COBALT, GOLD, PANE_ORDER, PANE_COLORS, STONE, VIOLET, VOID, WHITE_HOT } from './palette';

// The nave. Black stone piers, arcade and gallery tiers stacked overhead,
// ribbed vaults closing over the rail, a floor of candles far below, and a
// window in every bay. Windows are the level's memory: each one is a record
// that an enemy can claim, that a kill relights, and that stays lit for the
// rest of the run. Their light is thrown onto the stone around them through
// vertex colours, so the building itself brightens as it is won back.

export const beatUniform = uniform(0);
export const candleUniform = uniform(0); // extra candle brightness (ignition, beats)

const BAY = 14;
const FIRST_BAY_Z = 28;
const PIER_TOP_Y = 22;
const RIDGE_Y = 34;
const CLERESTORY_BOTTOM = 9.5;
const CLERESTORY_TOP = 21;
const GALLERY_BOTTOM = 4;
const GALLERY_TOP = 8.6;
const ARCADE_SPRING_Y = -3;
const SPILL_REACH = 26;
const DARK_GLASS = 0.045;
const DARK_ROSE = 0.03;

type Fan = { start: number; count: number; strength: number };

export type WindowRecord = {
  index: number;
  center: Vector3;
  normal: Vector3;
  color: Color;
  lit: number;
  target: number;
  flash: number;
  dying: number;
  claimedBy: number;
  igniteAt: number;
  isRose: boolean;
  fill: { start: number; count: number; base: Float32Array };
  fans: Fan[];
};

type Contribution = { window: number; weight: number };

export type Environment = {
  root: Group;
  windows: WindowRecord[];
  rose: WindowRecord;
  update(dt: number, elapsed: number, beat: number): void;
  claimWindow(enemyId: number, position: Vector3, reach: { behind: number; ahead: number }, preferred?: Color): WindowRecord | undefined;
  releaseWindow(enemyId: number): WindowRecord | undefined;
  windowFor(enemyId: number): WindowRecord | undefined;
  igniteWindow(record: WindowRecord, flash: number): void;
  darkenWindow(record: WindowRecord): void;
  igniteRose(elapsed: number): void;
  resetForRun(): void;
  resetForAttract(): void;
  attractTick(dt: number, rng: () => number): void;
  litFraction(): number;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = VOID.clone();
  scene.fog = new FogExp2(VOID.clone(), 0.0085);
  const root = new Group();
  const rng = mulberry32(20260904);
  const curve = createVespersRail();

  // ---- geometry accumulators -----------------------------------------------------------
  const stoneFill = { positions: [] as number[], colors: [] as number[] };
  const stoneLine = { positions: [] as number[], colors: [] as number[] };
  const glass = { positions: [] as number[], colors: [] as number[] };
  const spill = { positions: [] as number[], colors: [] as number[] };
  const windows: WindowRecord[] = [];

  const pushTriangle = (target: { positions: number[]; colors: number[] }, a: Vector3, b: Vector3, c: Vector3, color: Color) => {
    target.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i += 1) target.colors.push(color.r, color.g, color.b);
  };

  const pushLine = (a: Vector3, b: Vector3, intensity: number) => {
    stoneLine.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    for (let i = 0; i < 2; i += 1) stoneLine.colors.push(0.16 * intensity, 0.15 * intensity, 0.17 * intensity);
  };

  // A box of black stone with baked shading: the face toward the nave is
  // the brightest, the top and outside faces fall off.
  const addStoneBox = (center: Vector3, size: Vector3, naveDirection: Vector3, base = STONE) => {
    const half = size.clone().multiplyScalar(0.5);
    const faces: Array<[Vector3, Vector3, Vector3]> = [
      [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)],
      [new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, -1)],
      [new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0)],
      [new Vector3(0, -1, 0), new Vector3(0, 0, -1), new Vector3(1, 0, 0)],
      [new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(-1, 0, 0)],
      [new Vector3(0, 0, -1), new Vector3(0, 1, 0), new Vector3(1, 0, 0)],
    ];
    for (const [normal, up, right] of faces) {
      const toward = Math.max(0, normal.dot(naveDirection));
      const factor = 0.42 + 0.58 * toward + 0.12 * Math.max(0, normal.y) - 0.2 * Math.max(0, -normal.y);
      const color = base.clone().multiplyScalar(factor);
      const origin = center.clone().add(normal.clone().multiply(half));
      const u = right.clone().multiply(half);
      const v = up.clone().multiply(half);
      const p0 = origin.clone().sub(u).sub(v);
      const p1 = origin.clone().add(u).sub(v);
      const p2 = origin.clone().add(u).add(v);
      const p3 = origin.clone().sub(u).add(v);
      pushTriangle(stoneFill, p0, p1, p2, color);
      pushTriangle(stoneFill, p0, p2, p3, color);
    }
  };

  // Pointed arch polyline between two springing points, apex up.
  const pointedArch = (left: Vector3, right: Vector3, up: Vector3, segments = 7): Vector3[] => {
    const width = left.distanceTo(right);
    const along = right.clone().sub(left).normalize();
    const points: Vector3[] = [];
    // Left arc: centred on the right spring, radius = width, from 180° to 120°.
    for (let i = 0; i <= segments; i += 1) {
      const angle = Math.PI - (i / segments) * (Math.PI / 3);
      points.push(right.clone().addScaledVector(along, Math.cos(angle) * width).addScaledVector(up, Math.sin(angle) * width));
    }
    for (let i = segments - 1; i >= 0; i -= 1) {
      const angle = (i / segments) * (Math.PI / 3);
      points.push(left.clone().addScaledVector(along, Math.cos(angle) * width).addScaledVector(up, Math.sin(angle) * width));
    }
    return points;
  };

  const addArchLines = (left: Vector3, right: Vector3, up: Vector3, intensity: number, segments = 7) => {
    const points = pointedArch(left, right, up, segments);
    for (let i = 1; i < points.length; i += 1) pushLine(points[i - 1], points[i], intensity);
  };

  // A soft radial fan of additive light: centre vertex hot, inner ring at
  // 45%, rim black. Its colours are rewritten as the window's litness moves.
  const addFan = (center: Vector3, u: Vector3, v: Vector3, radiusU: number, radiusV: number, strength: number): Fan => {
    const start = spill.positions.length / 3;
    const RIM = 14;
    const rim = (ring: number, i: number) => {
      const angle = (i / RIM) * Math.PI * 2;
      return center.clone().addScaledVector(u, Math.cos(angle) * radiusU * ring).addScaledVector(v, Math.sin(angle) * radiusV * ring);
    };
    for (let i = 0; i < RIM; i += 1) {
      pushTriangle(spill, center, rim(0.42, i), rim(0.42, i + 1), new Color(0, 0, 0));
      pushTriangle(spill, rim(0.42, i), rim(1, i), rim(1, i + 1), new Color(0, 0, 0));
      pushTriangle(spill, rim(0.42, i), rim(1, i + 1), rim(0.42, i + 1), new Color(0, 0, 0));
    }
    return { start, count: spill.positions.length / 3 - start, strength };
  };

  // ---- windows -----------------------------------------------------------------------

  type LancetOptions = {
    center: Vector3;
    u: Vector3;
    v: Vector3;
    normal: Vector3;
    width: number;
    height: number;
    color: Color;
    companion: Color;
    wallFanRadius: number;
    pool?: { center: Vector3; u: Vector3; v: Vector3; radiusU: number; radiusV: number; strength: number };
  };

  const addLancet = (options: LancetOptions): WindowRecord => {
    const { center, u, v, normal, width, height, color, companion } = options;
    const local = (x: number, y: number, lift = 0) => center.clone().addScaledVector(u, x).addScaledVector(v, y).addScaledVector(normal, lift);
    const archHeight = width * 0.866;
    const rectHeight = height - archHeight;
    const rows = Math.max(2, Math.round(rectHeight / (width * 0.62)));
    const rowHeight = rectHeight / rows;
    const bottom = -height / 2;
    const spring = bottom + rectHeight;
    const start = glass.positions.length / 3;
    const cellColor = () => {
      const mix = rng() < 0.22 ? companion : color;
      return mix.clone().multiplyScalar(0.72 + rng() * 0.42);
    };
    const cell = (x0: number, y0: number, x1: number, y1: number) => {
      const c = cellColor();
      pushTriangle(glass, local(x0, y0), local(x1, y0), local(x1, y1), c);
      pushTriangle(glass, local(x0, y0), local(x1, y1), local(x0, y1), c);
    };
    for (let row = 0; row < rows; row += 1) {
      const y0 = bottom + row * rowHeight;
      const y1 = y0 + rowHeight;
      cell(-width / 2, y0, 0, y1);
      cell(0, y0, width / 2, y1);
    }
    // Arch head: two halves fanned from a point just above the spring.
    const arch = pointedArch(local(-width / 2, spring), local(width / 2, spring), v, 6);
    const apexIndex = Math.floor(arch.length / 2);
    const leftHead = cellColor();
    const rightHead = cellColor();
    const hub = local(0, spring + archHeight * 0.25);
    for (let i = 0; i < apexIndex; i += 1) pushTriangle(glass, hub, arch[i], arch[i + 1], leftHead);
    pushTriangle(glass, hub, local(-width / 2, spring), arch[0], leftHead);
    for (let i = apexIndex; i < arch.length - 1; i += 1) pushTriangle(glass, hub, arch[i], arch[i + 1], rightHead);
    pushTriangle(glass, hub, arch[arch.length - 1], local(width / 2, spring), rightHead);
    pushTriangle(glass, local(-width / 2, spring), hub, local(0, spring), leftHead);
    pushTriangle(glass, local(0, spring), hub, local(width / 2, spring), rightHead);
    const count = glass.positions.length / 3 - start;
    const base = new Float32Array(glass.colors.slice(start * 3, (start + count) * 3));

    // Lead: a black mullion and transoms sitting just proud of the glass.
    const black = new Color(0, 0, 0);
    const lead = (x0: number, y0: number, x1: number, y1: number) => {
      pushTriangle(glass, local(x0, y0, 0.06), local(x1, y0, 0.06), local(x1, y1, 0.06), black);
      pushTriangle(glass, local(x0, y0, 0.06), local(x1, y1, 0.06), local(x0, y1, 0.06), black);
    };
    lead(-width * 0.025, bottom, width * 0.025, spring + archHeight * 0.3);
    for (let row = 1; row < rows; row += 1) lead(-width / 2, bottom + row * rowHeight - width * 0.02, width / 2, bottom + row * rowHeight + width * 0.02);
    lead(-width / 2, spring - width * 0.02, width / 2, spring + width * 0.02);

    const fans: Fan[] = [addFan(center.clone().addScaledVector(normal, 0.12), u, v, options.wallFanRadius, options.wallFanRadius * 1.25, 0.26)];
    if (options.pool) fans.push(addFan(options.pool.center, options.pool.u, options.pool.v, options.pool.radiusU, options.pool.radiusV, options.pool.strength));

    const record: WindowRecord = {
      index: windows.length,
      center: center.clone(),
      normal: normal.clone(),
      color: color.clone(),
      lit: 0,
      target: 0,
      flash: 0,
      dying: 0,
      claimedBy: -1,
      igniteAt: -1,
      isRose: false,
      fill: { start, count, base },
      fans,
    };
    windows.push(record);
    return record;
  };

  const paneCycle = (bay: number, side: number) => {
    const index = (bay * 2 + (side > 0 ? 1 : 0)) % PANE_ORDER.length;
    return PANE_COLORS[PANE_ORDER[index]];
  };
  const companionFor = (color: Color) => (color === GOLD ? BLOOD : color === BLOOD ? GOLD : color === COBALT ? GOLD : color === BOTTLE ? GOLD : GOLD);

  // ---- the bays -------------------------------------------------------------------------
  const bayCount = Math.floor((FIRST_BAY_Z - WEST_WALL_Z) / BAY);
  const floorUp = new Vector3(0, 0, -1);
  const floorRight = new Vector3(1, 0, 0);

  for (let bay = 0; bay < bayCount; bay += 1) {
    const z = FIRST_BAY_Z - bay * BAY;
    const zMid = z - BAY / 2;
    const lastBays = z - BAY < WEST_WALL_Z + BAY * 2.5;
    for (const side of [-1, 1] as const) {
      const x = side * NAVE_HALF_WIDTH;
      const inward = new Vector3(-side, 0, 0);

      // Pier: a clustered shaft from the floor to the vault spring.
      addStoneBox(new Vector3(x, (NAVE_FLOOR_Y + PIER_TOP_Y) / 2, z), new Vector3(2.4, PIER_TOP_Y - NAVE_FLOOR_Y, 2.4), inward);
      addStoneBox(new Vector3(x - side * 1.5, (NAVE_FLOOR_Y + GALLERY_BOTTOM) / 2, z), new Vector3(0.9, GALLERY_BOTTOM - NAVE_FLOOR_Y, 0.9), inward, STONE.clone().multiplyScalar(1.15));
      // Vertical edge lines so the pier reads as a mass in the dark.
      for (const dz of [-1.2, 1.2]) {
        pushLine(new Vector3(x - side * 1.2, NAVE_FLOOR_Y, z + dz), new Vector3(x - side * 1.2, PIER_TOP_Y, z + dz), 0.32);
      }
      // Capital and base bands.
      pushLine(new Vector3(x - side * 1.4, PIER_TOP_Y - 1.2, z - 1.4), new Vector3(x - side * 1.4, PIER_TOP_Y - 1.2, z + 1.4), 0.4);

      // Wall bands: gallery and clerestory, set back behind the pier face.
      addStoneBox(new Vector3(x + side * 0.9, (GALLERY_BOTTOM + GALLERY_TOP) / 2, zMid), new Vector3(1.2, GALLERY_TOP - GALLERY_BOTTOM, BAY), inward, STONE.clone().multiplyScalar(0.9));
      addStoneBox(new Vector3(x + side * 1.1, (CLERESTORY_BOTTOM - 0.5 + CLERESTORY_TOP + 1.2) / 2, zMid), new Vector3(1.4, CLERESTORY_TOP + 1.7 - CLERESTORY_BOTTOM, BAY), inward, STONE.clone().multiplyScalar(0.8));

      // Arcade arch at ground level, gallery arcade above it.
      addArchLines(new Vector3(x - side * 1.2, ARCADE_SPRING_Y, z - 1.2), new Vector3(x - side * 1.2, ARCADE_SPRING_Y, z - BAY + 1.2), new Vector3(0, 1, 0), 0.3, 8);
      pushLine(new Vector3(x - side * 1.2, ARCADE_SPRING_Y, z - 1.2), new Vector3(x - side * 1.2, NAVE_FLOOR_Y, z - 1.2), 0.22);
      for (let arch = 0; arch < 3; arch += 1) {
        const a = z - 1.4 - (arch * (BAY - 2.8)) / 3;
        const b = a - (BAY - 2.8) / 3 + 0.35;
        addArchLines(new Vector3(x - side * 0.3, GALLERY_BOTTOM + 1.2, a), new Vector3(x - side * 0.3, GALLERY_BOTTOM + 1.2, b), new Vector3(0, 1, 0), 0.24, 5);
        pushLine(new Vector3(x - side * 0.3, GALLERY_BOTTOM + 1.2, a), new Vector3(x - side * 0.3, GALLERY_BOTTOM, a), 0.2);
      }
      // String courses.
      pushLine(new Vector3(x - side * 0.3, GALLERY_BOTTOM, z), new Vector3(x - side * 0.3, GALLERY_BOTTOM, z - BAY), 0.26);
      pushLine(new Vector3(x - side * 0.4, CLERESTORY_BOTTOM - 0.4, z), new Vector3(x - side * 0.4, CLERESTORY_BOTTOM - 0.4, z - BAY), 0.3);
      pushLine(new Vector3(x - side * 0.4, PIER_TOP_Y, z), new Vector3(x - side * 0.4, PIER_TOP_Y, z - BAY), 0.24);

      // Vault: transverse rib across the nave, diagonal ribs to the next bay.
      addArchLines(new Vector3(x - side * 1.2, PIER_TOP_Y, z), new Vector3(-x + side * 1.2, PIER_TOP_Y, z), new Vector3(0, (RIDGE_Y - PIER_TOP_Y) / (NAVE_HALF_WIDTH * 0.866 * 2), 0).normalize(), 0.3, 8);
      if (side > 0 && bay < bayCount - 1) {
        addArchLines(new Vector3(x - 1.2, PIER_TOP_Y, z), new Vector3(-x + 1.2, PIER_TOP_Y, z - BAY), new Vector3(0, 1, 0).multiplyScalar(0.42), 0.2, 8);
        addArchLines(new Vector3(-x + 1.2, PIER_TOP_Y, z), new Vector3(x - 1.2, PIER_TOP_Y, z - BAY), new Vector3(0, 1, 0).multiplyScalar(0.42), 0.2, 8);
        pushLine(new Vector3(0, RIDGE_Y, z), new Vector3(0, RIDGE_Y, z - BAY), 0.2);
      }

      // The window in this bay. The last bays carry tall transept lights
      // instead of clerestory lancets.
      const color = paneCycle(bay, side);
      const u = new Vector3(0, 0, -side);
      const v = new Vector3(0, 1, 0);
      if (lastBays) {
        addLancet({
          center: new Vector3(x + side * 0.35, 7, zMid),
          u,
          v,
          normal: inward,
          width: 6.4,
          height: 24,
          color,
          companion: companionFor(color),
          wallFanRadius: 12,
          pool: { center: new Vector3(x - side * 8, NAVE_FLOOR_Y + 0.25, zMid), u: floorRight, v: floorUp, radiusU: 9, radiusV: 12, strength: 0.13 },
        });
      } else {
        addLancet({
          center: new Vector3(x + side * 0.35, (CLERESTORY_BOTTOM + CLERESTORY_TOP) / 2, zMid),
          u,
          v,
          normal: inward,
          width: 3.8,
          height: CLERESTORY_TOP - CLERESTORY_BOTTOM,
          color,
          companion: companionFor(color),
          wallFanRadius: 8.5,
          pool: { center: new Vector3(x - side * 7.5, NAVE_FLOOR_Y + 0.25, zMid), u: floorRight, v: floorUp, radiusU: 6.5, radiusV: 10, strength: 0.11 },
        });
      }
    }
  }

  // ---- the west wall ------------------------------------------------------------------------
  const westNormal = new Vector3(0, 0, 1);
  addStoneBox(new Vector3(0, 12, WEST_WALL_Z - 1.2), new Vector3(NAVE_HALF_WIDTH * 2 + 6, 56, 2.4), westNormal, STONE.clone().multiplyScalar(0.9));
  // Portal arch under the rose, and the rose's own rim in stone.
  addArchLines(new Vector3(-3.6, NAVE_FLOOR_Y + 8, WEST_WALL_Z + 0.2), new Vector3(3.6, NAVE_FLOOR_Y + 8, WEST_WALL_Z + 0.2), new Vector3(0, 1, 0), 0.34, 8);
  pushLine(new Vector3(-3.6, NAVE_FLOOR_Y + 8, WEST_WALL_Z + 0.2), new Vector3(-3.6, NAVE_FLOOR_Y, WEST_WALL_Z + 0.2), 0.3);
  pushLine(new Vector3(3.6, NAVE_FLOOR_Y + 8, WEST_WALL_Z + 0.2), new Vector3(3.6, NAVE_FLOOR_Y, WEST_WALL_Z + 0.2), 0.3);
  for (let i = 0; i < 48; i += 1) {
    const a = (i / 48) * Math.PI * 2;
    const b = ((i + 1) / 48) * Math.PI * 2;
    pushLine(
      new Vector3(ROSE_CENTER.x + Math.cos(a) * (ROSE_RADIUS + 0.8), ROSE_CENTER.y + Math.sin(a) * (ROSE_RADIUS + 0.8), WEST_WALL_Z + 0.2),
      new Vector3(ROSE_CENTER.x + Math.cos(b) * (ROSE_RADIUS + 0.8), ROSE_CENTER.y + Math.sin(b) * (ROSE_RADIUS + 0.8), WEST_WALL_Z + 0.2),
      0.36,
    );
  }
  // Four lancets flanking the portal: the petals' windows.
  for (const x of [-11, -6.2, 6.2, 11]) {
    const color = x < 0 ? (x < -8 ? COBALT : BLOOD) : x > 8 ? GOLD : BOTTLE;
    addLancet({
      center: new Vector3(x, NAVE_FLOOR_Y + 7.2, WEST_WALL_Z + 0.25),
      u: new Vector3(1, 0, 0),
      v: new Vector3(0, 1, 0),
      normal: westNormal,
      width: 3.2,
      height: 12.5,
      color,
      companion: companionFor(color),
      wallFanRadius: 7.5,
      pool: { center: new Vector3(x, NAVE_FLOOR_Y + 0.25, WEST_WALL_Z + 7), u: floorRight, v: floorUp, radiusU: 5.5, radiusV: 8, strength: 0.12 },
    });
  }

  // ---- the rose window ----------------------------------------------------------------------
  const rose = addRose();

  function addRose(): WindowRecord {
    const center = ROSE_CENTER.clone();
    const u = new Vector3(1, 0, 0);
    const v = new Vector3(0, 1, 0);
    const local = (r: number, angle: number, lift = 0) => center.clone().addScaledVector(u, Math.cos(angle) * r).addScaledVector(v, Math.sin(angle) * r).addScaledVector(westNormal, lift);
    const start = glass.positions.length / 3;
    const palette = [COBALT, BLOOD, GOLD, BOTTLE, VIOLET, GOLD];
    const wedge = (r0: number, r1: number, a0: number, a1: number, color: Color, steps = 3) => {
      for (let i = 0; i < steps; i += 1) {
        const b0 = a0 + ((a1 - a0) * i) / steps;
        const b1 = a0 + ((a1 - a0) * (i + 1)) / steps;
        pushTriangle(glass, local(r0, b0), local(r1, b0), local(r1, b1), color);
        pushTriangle(glass, local(r0, b0), local(r1, b1), local(r0, b1), color);
      }
    };
    // Centre rosette: white-gold.
    for (let i = 0; i < 6; i += 1) {
      const a0 = (i / 6) * Math.PI * 2;
      const a1 = ((i + 1) / 6) * Math.PI * 2;
      const c = WHITE_HOT.clone().lerp(GOLD, 0.45).multiplyScalar(0.8 + rng() * 0.3);
      pushTriangle(glass, center.clone(), local(2.4, a0), local(2.4, a1), c);
    }
    // Inner petals (12) and outer lights (24), alternating the stolen colours.
    for (let i = 0; i < 12; i += 1) {
      const a0 = (i / 12) * Math.PI * 2;
      const a1 = ((i + 1) / 12) * Math.PI * 2;
      wedge(2.7, 6.3, a0 + 0.02, a1 - 0.02, palette[i % palette.length].clone().multiplyScalar(0.8 + rng() * 0.35));
    }
    for (let i = 0; i < 24; i += 1) {
      const a0 = (i / 24) * Math.PI * 2;
      const a1 = ((i + 1) / 24) * Math.PI * 2;
      wedge(6.7, ROSE_RADIUS - 0.5, a0 + 0.015, a1 - 0.015, palette[(i + 2) % palette.length].clone().multiplyScalar(0.75 + rng() * 0.4), 2);
    }
    const count = glass.positions.length / 3 - start;
    const base = new Float32Array(glass.colors.slice(start * 3, (start + count) * 3));
    // Lead: rings and spokes proud of the glass.
    const black = new Color(0, 0, 0);
    const ring = (r: number, w: number) => {
      for (let i = 0; i < 48; i += 1) {
        const a0 = (i / 48) * Math.PI * 2;
        const a1 = ((i + 1) / 48) * Math.PI * 2;
        pushTriangle(glass, local(r - w, a0, 0.06), local(r + w, a0, 0.06), local(r + w, a1, 0.06), black);
        pushTriangle(glass, local(r - w, a0, 0.06), local(r + w, a1, 0.06), local(r - w, a1, 0.06), black);
      }
    };
    ring(2.55, 0.14);
    ring(6.5, 0.16);
    ring(ROSE_RADIUS - 0.4, 0.2);
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      const inner = i % 2 === 0 ? 2.5 : 6.5;
      const w = 0.1;
      const p0 = local(inner, a, 0.06).addScaledVector(u, -Math.sin(a) * w).addScaledVector(v, Math.cos(a) * w);
      const p1 = local(inner, a, 0.06).addScaledVector(u, Math.sin(a) * w).addScaledVector(v, -Math.cos(a) * w);
      const p2 = local(ROSE_RADIUS - 0.3, a, 0.06).addScaledVector(u, Math.sin(a) * w).addScaledVector(v, -Math.cos(a) * w);
      const p3 = local(ROSE_RADIUS - 0.3, a, 0.06).addScaledVector(u, -Math.sin(a) * w).addScaledVector(v, Math.cos(a) * w);
      pushTriangle(glass, p0, p1, p2, black);
      pushTriangle(glass, p0, p2, p3, black);
    }
    const fans: Fan[] = [
      addFan(center.clone().addScaledVector(westNormal, 0.15), u, v, 22, 22, 0.15),
      addFan(new Vector3(0, NAVE_FLOOR_Y + 0.25, WEST_WALL_Z + 14), floorRight, floorUp, 22, 18, 0.12),
    ];
    const record: WindowRecord = {
      index: -1,
      center: center.clone(),
      normal: westNormal.clone(),
      color: GOLD.clone(),
      lit: 0,
      target: 0,
      flash: 0,
      dying: 0,
      claimedBy: -1,
      igniteAt: -1,
      isRose: true,
      fill: { start, count, base },
      fans,
    };
    return record;
  }

  // ---- build the meshes -------------------------------------------------------------------------
  const stoneGeometry = new BufferGeometry();
  stoneGeometry.setAttribute('position', new Float32BufferAttribute(stoneFill.positions, 3));
  const stoneColorAttribute = new Float32BufferAttribute(stoneFill.colors, 3);
  stoneGeometry.setAttribute('color', stoneColorAttribute);
  const stone = new Mesh(stoneGeometry, new MeshBasicMaterial({ vertexColors: true }));
  stone.frustumCulled = false;
  root.add(stone);

  const lineGeometry = new BufferGeometry();
  lineGeometry.setAttribute('position', new Float32BufferAttribute(stoneLine.positions, 3));
  const lineColorAttribute = new Float32BufferAttribute(stoneLine.colors, 3);
  lineGeometry.setAttribute('color', lineColorAttribute);
  const lineMaterial = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  lineMaterial.colorNode = attribute<'vec3'>('color', 'vec3').mul(beatUniform.mul(0.18).add(1));
  const lines = new LineSegments(lineGeometry, lineMaterial);
  lines.frustumCulled = false;
  root.add(lines);

  const glassGeometry = new BufferGeometry();
  glassGeometry.setAttribute('position', new Float32BufferAttribute(glass.positions, 3));
  const glassColorAttribute = new Float32BufferAttribute(glass.colors, 3);
  glassGeometry.setAttribute('color', glassColorAttribute);
  const glassMesh = new Mesh(glassGeometry, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
  glassMesh.frustumCulled = false;
  root.add(glassMesh);

  const spillGeometry = new BufferGeometry();
  spillGeometry.setAttribute('position', new Float32BufferAttribute(spill.positions, 3));
  const spillColorAttribute = new Float32BufferAttribute(spill.colors, 3);
  spillGeometry.setAttribute('color', spillColorAttribute);
  const spillMesh = new Mesh(spillGeometry, new MeshBasicMaterial(additiveMaterialParameters({ vertexColors: true, side: DoubleSide })));
  spillMesh.frustumCulled = false;
  root.add(spillMesh);

  root.add(createCandleFloor(rng));
  root.add(createDust(rng, curve));
  scene.add(root);

  // ---- stone spill bookkeeping ------------------------------------------------------------------
  // Each stone vertex remembers which windows can colour it and by how much.
  const allWindows = [...windows, rose];
  const stoneBase = new Float32Array(stoneFill.colors);
  const lineBase = new Float32Array(stoneLine.colors);
  const stoneContributions: Contribution[][] = [];
  const lineContributions: Contribution[][] = [];
  const affected: number[][] = allWindows.map(() => []);
  const affectedLines: number[][] = allWindows.map(() => []);
  const probe = new Vector3();
  const buildContributions = (positions: number[], target: Contribution[][], affectedTarget: number[][], gain: number) => {
    for (let i = 0; i < positions.length / 3; i += 1) {
      probe.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      const list: Contribution[] = [];
      for (let w = 0; w < allWindows.length; w += 1) {
        const reach = allWindows[w].isRose ? SPILL_REACH * 2.2 : SPILL_REACH;
        const distance = probe.distanceTo(allWindows[w].center);
        if (distance > reach) continue;
        const falloff = (1 - distance / reach) ** 2;
        list.push({ window: w, weight: falloff * gain * (allWindows[w].isRose ? 0.15 : 1) });
        affectedTarget[w].push(i);
      }
      target.push(list);
    }
  };
  buildContributions(stoneFill.positions, stoneContributions, affected, 0.24);
  buildContributions(stoneLine.positions, lineContributions, affectedLines, 0.5);

  let ambient = 0.55;
  const recolorStoneVertex = (i: number) => {
    let r = stoneBase[i * 3] * ambient;
    let g = stoneBase[i * 3 + 1] * ambient;
    let b = stoneBase[i * 3 + 2] * ambient;
    for (const { window: w, weight } of stoneContributions[i]) {
      const record = allWindows[w];
      const amount = weight * Math.min(1.4, record.lit + record.flash * 0.5);
      r += record.color.r * amount;
      g += record.color.g * amount;
      b += record.color.b * amount;
    }
    stoneColorAttribute.setXYZ(i, r, g, b);
  };
  const recolorLineVertex = (i: number) => {
    let r = lineBase[i * 3] * (0.6 + ambient * 0.35);
    let g = lineBase[i * 3 + 1] * (0.6 + ambient * 0.35);
    let b = lineBase[i * 3 + 2] * (0.6 + ambient * 0.35);
    for (const { window: w, weight } of lineContributions[i]) {
      const record = allWindows[w];
      const amount = weight * Math.min(1.4, record.lit + record.flash * 0.5);
      r += record.color.r * amount;
      g += record.color.g * amount;
      b += record.color.b * amount;
    }
    lineColorAttribute.setXYZ(i, r, g, b);
  };
  const recolorAllStone = () => {
    for (let i = 0; i < stoneContributions.length; i += 1) recolorStoneVertex(i);
    for (let i = 0; i < lineContributions.length; i += 1) recolorLineVertex(i);
    stoneColorAttribute.needsUpdate = true;
    lineColorAttribute.needsUpdate = true;
  };
  const recolorAround = (record: WindowRecord) => {
    const w = record.isRose ? allWindows.length - 1 : record.index;
    for (const i of affected[w]) recolorStoneVertex(i);
    for (const i of affectedLines[w]) recolorLineVertex(i);
    stoneColorAttribute.needsUpdate = true;
    lineColorAttribute.needsUpdate = true;
  };

  const writeWindow = (record: WindowRecord, beat: number) => {
    const shown = (record.isRose ? DARK_ROSE : DARK_GLASS) + record.lit * (0.95 + beat * 0.07) + record.flash;
    const { start, count, base } = record.fill;
    for (let i = 0; i < count; i += 1) {
      glassColorAttribute.setXYZ(start + i, base[i * 3] * shown, base[i * 3 + 1] * shown, base[i * 3 + 2] * shown);
    }
    const glow = Math.min(1.6, record.lit + record.flash * 0.6);
    for (const fan of record.fans) {
      const hot = fan.strength * glow;
      const c = record.color;
      // Vertex layout per rim step: [centre, inner, inner], [inner, outer, outer], [inner, outer, inner].
      for (let i = 0; i < fan.count; i += 9) {
        const k = fan.start + i;
        glassAt(spillColorAttribute, k, c, hot);
        glassAt(spillColorAttribute, k + 1, c, hot * 0.32);
        glassAt(spillColorAttribute, k + 2, c, hot * 0.32);
        glassAt(spillColorAttribute, k + 3, c, hot * 0.32);
        glassAt(spillColorAttribute, k + 4, c, 0);
        glassAt(spillColorAttribute, k + 5, c, 0);
        glassAt(spillColorAttribute, k + 6, c, hot * 0.32);
        glassAt(spillColorAttribute, k + 7, c, 0);
        glassAt(spillColorAttribute, k + 8, c, hot * 0.32);
      }
    }
  };

  for (const record of allWindows) writeWindow(record, 0);
  glassColorAttribute.needsUpdate = true;
  spillColorAttribute.needsUpdate = true;
  recolorAllStone();

  const claims = new Map<number, WindowRecord>();
  let litCount = 0;

  function countLit() {
    let count = 0;
    for (const record of windows) if (record.target >= 0.99) count += 1;
    return count;
  }

  function setAmbient() {
    const next = countLit();
    if (next === litCount) return;
    litCount = next;
    ambient = 0.55 + 0.75 * (litCount / windows.length) + (rose.target >= 0.99 ? 0.3 : 0);
    recolorAllStone();
  }

  const environment: Environment = {
    root,
    windows,
    rose,
    update(dt, elapsed, beat) {
      let anyChanged = false;
      for (const record of allWindows) {
        let changed = false;
        if (record.igniteAt >= 0 && elapsed >= record.igniteAt) {
          record.igniteAt = -1;
          record.target = 1;
          record.dying = 0;
          record.flash = Math.max(record.flash, record.isRose ? 2.4 : 1.0);
          changed = true;
        }
        if (record.dying > 0) {
          record.dying = Math.max(0, record.dying - dt / 0.75);
          record.lit = record.dying * (0.5 + 0.5 * Math.sin(elapsed * 52 + record.index));
          if (record.dying === 0) record.lit = 0;
          changed = true;
        } else if (Math.abs(record.lit - record.target) > 0.002) {
          record.lit += (record.target - record.lit) * Math.min(1, dt * 7);
          if (Math.abs(record.lit - record.target) <= 0.002) record.lit = record.target;
          changed = true;
        }
        if (record.flash > 0.002) {
          record.flash *= Math.exp(-3.6 * dt);
          if (record.flash <= 0.002) record.flash = 0;
          changed = true;
        }
        if (changed || (record.lit > 0 && beat > 0.02)) {
          writeWindow(record, beat);
          anyChanged = true;
        }
        if (changed) recolorAround(record);
      }
      if (anyChanged) {
        glassColorAttribute.needsUpdate = true;
        spillColorAttribute.needsUpdate = true;
      }
      setAmbient();
    },
    claimWindow(enemyId, position, reach, preferred) {
      const candidates = windows.filter((record) => record.claimedBy < 0 && record.center.z <= position.z + reach.ahead && record.center.z >= position.z - reach.behind);
      const pool = candidates.length > 0 ? candidates : windows.filter((record) => record.claimedBy < 0);
      if (pool.length === 0) return undefined;
      const sideOf = (x: number) => (Math.abs(x) < 12 ? 0 : Math.sign(x));
      let best: WindowRecord | undefined;
      let bestScore = Infinity;
      for (const record of pool) {
        const zScore = Math.abs(record.center.z - (position.z - 12));
        const sidePenalty = sideOf(record.center.x) !== 0 && sideOf(record.center.x) !== Math.sign(position.x || 1) ? 10 : 0;
        const colourPenalty = preferred && !record.color.equals(preferred) ? 7 : 0;
        const score = zScore + sidePenalty + colourPenalty;
        if (score < bestScore) {
          bestScore = score;
          best = record;
        }
      }
      if (!best) return undefined;
      best.claimedBy = enemyId;
      claims.set(enemyId, best);
      return best;
    },
    releaseWindow(enemyId) {
      const record = claims.get(enemyId);
      if (!record) return undefined;
      claims.delete(enemyId);
      record.claimedBy = -1;
      return record;
    },
    windowFor(enemyId) {
      return claims.get(enemyId);
    },
    igniteWindow(record, flash) {
      record.dying = 0;
      record.igniteAt = -1;
      record.target = 1;
      record.flash = Math.max(record.flash, flash);
    },
    darkenWindow(record) {
      if (record.target <= 0 && record.lit <= 0) {
        record.flash = Math.max(record.flash, 0.25);
        return;
      }
      record.target = 0;
      record.dying = 1;
      record.igniteAt = -1;
    },
    // The biggest single event in the level: the rose lights all at once and
    // a wave of returned light runs back down the nave toward the player.
    igniteRose(elapsed) {
      rose.target = 1;
      rose.flash = 1.6;
      rose.igniteAt = -1;
      for (const record of windows) {
        if (record.target >= 0.99) {
          record.flash = Math.max(record.flash, 0.6);
          continue;
        }
        record.igniteAt = elapsed + 0.15 + Math.abs(record.center.z - WEST_WALL_Z) / 95;
      }
    },
    resetForRun() {
      claims.clear();
      for (const record of allWindows) {
        record.claimedBy = -1;
        record.igniteAt = -1;
        record.dying = 0;
        record.flash = 0;
        // The first bays still burn when the run begins; the first shades
        // take that light.
        const stillLit = !record.isRose && record.center.z > -30;
        record.target = stillLit ? 1 : 0;
        record.lit = record.target;
        writeWindow(record, 0);
      }
      glassColorAttribute.needsUpdate = true;
      spillColorAttribute.needsUpdate = true;
      litCount = -1;
      setAmbient();
    },
    resetForAttract() {
      claims.clear();
      for (const record of allWindows) {
        record.claimedBy = -1;
        record.igniteAt = -1;
        record.dying = 0;
        record.flash = 0;
        record.target = !record.isRose && record.center.z > -150 ? 1 : 0;
        record.lit = record.target;
        writeWindow(record, 0);
      }
      glassColorAttribute.needsUpdate = true;
      spillColorAttribute.needsUpdate = true;
      litCount = -1;
      setAmbient();
    },
    // Attract screen: the light is being eaten. One window at a time
    // flickers out somewhere down the nave.
    attractTick(dt, tickRng) {
      attractClock += dt;
      if (attractClock < 1.4) return;
      attractClock = 0;
      const lit = windows.filter((record) => record.target >= 0.99 && record.dying === 0 && record.center.z > -150);
      if (lit.length <= 3) {
        for (const record of windows) if (record.center.z > -150 && record.target < 0.5) record.igniteAt = 0;
        return;
      }
      const victim = lit[Math.floor(tickRng() * lit.length)];
      environment.darkenWindow(victim);
    },
    litFraction() {
      return windows.length === 0 ? 0 : countLit() / windows.length;
    },
  };
  let attractClock = 0;

  return environment;
}

function glassAt(attributeTarget: Float32BufferAttribute, index: number, color: Color, amount: number) {
  attributeTarget.setXYZ(index, color.r * amount, color.g * amount, color.b * amount);
}

// ---- the candle floor ---------------------------------------------------------------------------

// Thousands of flames far below the rail. Each point flickers on its own
// phase; the beat and the ignition lift them all together.
function createCandleFloor(rng: () => number) {
  const count = 4400;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const cluster = rng();
    const x = cluster < 0.5 ? (rng() - 0.5) * 24 : (rng() < 0.5 ? -1 : 1) * (16 + rng() * 22);
    const z = FIRST_BAY_Z + 10 - rng() * (FIRST_BAY_Z + 12 - WEST_WALL_Z);
    positions[i * 3] = x;
    positions[i * 3 + 1] = NAVE_FLOOR_Y + 0.25 + rng() * 0.9;
    positions[i * 3 + 2] = z;
    const warm = CANDLE.clone().lerp(GOLD, rng() * 0.5);
    const intensity = rng() < 0.1 ? 1.9 : 0.5 + rng() * 0.7;
    colors[i * 3] = warm.r * intensity;
    colors[i * 3 + 1] = warm.g * intensity;
    colors[i * 3 + 2] = warm.b * intensity;
    phases[i] = rng() * Math.PI * 2;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('phase', new Float32BufferAttribute(phases, 1));
  const material = new PointsNodeMaterial(additiveMaterialParameters({}));
  material.size = 0.62;
  material.sizeAttenuation = true;
  const flicker = time.mul(3.9).add(attribute<'float'>('phase', 'float')).sin().mul(0.22).add(float(0.78));
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(flicker).mul(candleUniform.add(1)).mul(beatUniform.mul(0.12).add(1));
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

// Dust in the nave near the rail: small, dim, warm; it sells the camera's speed.
function createDust(rng: () => number, curve: ReturnType<typeof createVespersRail>) {
  const count = 700;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const frame = sampleRailFrame(curve, rng());
    const angle = rng() * Math.PI * 2;
    const radius = 2 + rng() * 8;
    const point = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 20);
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
    const intensity = 0.08 + rng() * 0.16;
    colors[i * 3] = GOLD.r * intensity;
    colors[i * 3 + 1] = GOLD.g * intensity * 0.9;
    colors[i * 3 + 2] = GOLD.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial(additiveMaterialParameters({ size: 0.13, vertexColors: true, sizeAttenuation: true }));
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

export const NAVE_LENGTH = FIRST_BAY_Z - RAIL_END_Z;
