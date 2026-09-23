import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  OctahedronGeometry,
  Path,
  PlaneGeometry,
  Quaternion,
  Shape,
  TubeGeometry,
  Vector3,
  Vector4,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  Loop,
  color,
  dot,
  exp,
  float,
  fract,
  hash,
  max,
  normalWorld,
  positionWorld,
  sin,
  smoothstep,
  time,
  uniform,
  uniformArray,
  vec3,
} from 'three/tsl';
import { mulberry32 } from '../../../engine/rng';
import {
  AISLE_WALL_X,
  BAY,
  CROSSING_HALF,
  CROSSING_Z,
  EAST_END_Z,
  FLOOR_Y,
  inCrossing,
  LANTERN_RADIUS,
  NAVE_HALF_WIDTH,
  PIER_ZS,
  ROSE_CENTER,
  ROSE_RADIUS,
  SPRING_Y,
  TRANSEPT_END_X,
  VAULT_Y,
  WEST_WALL_Z,
  WINDOWS,
} from '../cathedral';

// Leaf: the stone. Every wall, pier, rib and vault is merged into a few
// meshes sharing one node material. The material is unlit by design and
// computes its own light: warm candle bounce rising from the floor, and the
// coloured spill of whichever windows the spine feeds into the light slots.

export const STONE_LIGHT_SLOTS = 16;

const floatUniform = (value: number) => uniform(value);

export type StoneLighting = {
  /** xyz = light position, w = intensity. */
  positions: Vector4[];
  /** xyz = linear RGB. */
  colors: Vector4[];
  candle: ReturnType<typeof floatUniform>;
  ambient: ReturnType<typeof floatUniform>;
};

export function createStoneLighting(): StoneLighting {
  return {
    positions: Array.from({ length: STONE_LIGHT_SLOTS }, () => new Vector4(0, -1000, 0, 0)),
    colors: Array.from({ length: STONE_LIGHT_SLOTS }, () => new Vector4(0, 0, 0, 0)),
    candle: floatUniform(1),
    ambient: floatUniform(1),
  };
}

export function createStoneMaterial(lighting: StoneLighting, base: Color, candleColor: Color, albedo: number) {
  const lightPositions = uniformArray<'vec4'>(lighting.positions, 'vec4');
  const lightColors = uniformArray<'vec4'>(lighting.colors, 'vec4');
  const { candle, ambient } = lighting;
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });

  material.colorNode = Fn(() => {
    const p = positionWorld;
    const n = normalWorld;
    // Coursed ashlar: big blocks, faint joints, uneven stone.
    const course = p.y.div(2.1);
    const row = course.floor();
    const along = p.x.add(p.z).div(3.7).add(row.mul(0.5));
    const joints = smoothstep(0.0, 0.05, fract(course))
      .mul(smoothstep(1.0, 0.95, fract(course)))
      .mul(smoothstep(0.0, 0.025, fract(along)))
      .mul(smoothstep(1.0, 0.975, fract(along)));
    const block = hash(row.mul(57.13).add(along.floor().mul(13.7)));
    const surface = joints.mul(0.22).add(0.78).mul(block.mul(0.35).add(0.75));

    // Candle bounce: the floor burns, and the undersides of everything above it
    // catch the warmth, fading with height.
    const height = max(p.y.sub(FLOOR_Y), 0);
    const flicker = sin(time.mul(7.3).add(p.x.mul(0.21)).add(p.z.mul(0.13))).mul(0.06).add(1);
    const facing = n.y.mul(-0.35).add(0.65);
    const warm = color(candleColor).mul(exp(height.mul(-0.085))).mul(facing).mul(candle).mul(flicker).mul(0.34);

    // Window spill: each slot is a coloured light hanging just inside a window.
    const spill = vec3(0, 0, 0).toVar();
    Loop(STONE_LIGHT_SLOTS, ({ i }) => {
      const light = lightPositions.element(i);
      const toLight = light.xyz.sub(p);
      const stretched = toLight.mul(vec3(1, 0.5, 1));
      const distance2 = dot(stretched, stretched);
      // Inverse-square-ish near the glass, windowed to nothing by ~18 units so
      // many distant windows never sum into a grey wash: pools stay pools.
      const reach = max(float(1).sub(distance2.div(324)), 0);
      const falloff = light.w.mul(reach.mul(reach)).div(distance2.mul(0.06).add(1));
      const lambert = max(dot(n, toLight.normalize()), 0).mul(0.7).add(0.3);
      spill.addAssign(lightColors.element(i).xyz.mul(falloff).mul(lambert));
    });

    const lit = warm.add(spill).mul(albedo).add(color(base).mul(ambient));
    return lit.mul(surface);
  })();
  return material;
}

// ---- shapes ---------------------------------------------------------------------

/** A pointed (equilateral-ish) arch opening as a closed path. */
function lancetPath(path: Path, cx: number, bottom: number, width: number, height: number) {
  const half = width / 2;
  const headHeight = Math.min(height * 0.6, width * 0.866);
  const spring = bottom + height - headHeight;
  const segments = 8;
  path.moveTo(cx - half, bottom);
  path.lineTo(cx + half, bottom);
  path.lineTo(cx + half, spring);
  for (let i = 1; i <= segments; i += 1) {
    const angle = (i / segments) * (Math.PI / 3);
    path.lineTo(cx - half + Math.cos(angle) * width, spring + (Math.sin(angle) / 0.866) * headHeight);
  }
  for (let i = segments - 1; i >= 0; i -= 1) {
    const angle = (i / segments) * (Math.PI / 3);
    path.lineTo(cx + half - Math.cos(angle) * width, spring + (Math.sin(angle) / 0.866) * headHeight);
  }
  path.lineTo(cx - half, bottom);
  return path;
}

function circlePath(path: Path, cx: number, cy: number, radius: number) {
  path.absarc(cx, cy, radius, 0, Math.PI * 2, false);
  return path;
}

function extrude(shape: Shape, depth: number) {
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 }).toNonIndexed();
}

/** Places a shape built in (u = along the wall, v = up) onto a wall plane. */
function placeOnWall(geometry: BufferGeometry, origin: Vector3, alongWall: Vector3, outward: Vector3) {
  const up = new Vector3(0, 1, 0);
  const matrix = new Matrix4().makeBasis(alongWall, up, outward).setPosition(origin);
  return geometry.applyMatrix4(matrix);
}

// Nave elevation per bay, u ∈ [-BAY/2, BAY/2]: the arcade arch is cut from
// the outline; triforium arches, lancets and the oculus are holes.
function naveBayWall() {
  const half = BAY / 2;
  const top = SPRING_Y + 0.5;
  const shape = new Shape();
  const arcadeHalf = 6.2;
  const arcadeSpring = -15;
  const arcadeApex = -4.6;
  shape.moveTo(-half, FLOOR_Y);
  shape.lineTo(-arcadeHalf, FLOOR_Y);
  shape.lineTo(-arcadeHalf, arcadeSpring);
  const segments = 12;
  const width = arcadeHalf * 2;
  const headHeight = arcadeApex - arcadeSpring;
  for (let i = 1; i <= segments; i += 1) {
    const angle = (i / segments) * (Math.PI / 3);
    shape.lineTo(arcadeHalf - Math.cos(angle) * width, arcadeSpring + (Math.sin(angle) / 0.866) * headHeight);
  }
  for (let i = segments - 1; i >= 0; i -= 1) {
    const angle = (i / segments) * (Math.PI / 3);
    shape.lineTo(-arcadeHalf + Math.cos(angle) * width, arcadeSpring + (Math.sin(angle) / 0.866) * headHeight);
  }
  shape.lineTo(arcadeHalf, FLOOR_Y);
  shape.lineTo(half, FLOOR_Y);
  shape.lineTo(half, top);
  shape.lineTo(-half, top);
  shape.lineTo(-half, FLOOR_Y);
  // Triforium: four small pointed openings onto the dark passage.
  for (const u of [-5.4, -1.8, 1.8, 5.4]) shape.holes.push(lancetPath(new Path(), u, -1.8, 2.3, 7));
  // Clerestory: two lancets and an oculus.
  for (const u of [-3.3, 3.3]) shape.holes.push(lancetPath(new Path(), u, 19 - 6.25, 3.4, 12.5));
  shape.holes.push(circlePath(new Path(), 0, 28.2, 2.35));
  return extrude(shape, 1.6);
}

function aisleBayWall() {
  const half = BAY / 2;
  const shape = new Shape();
  shape.moveTo(-half, FLOOR_Y);
  shape.lineTo(half, FLOOR_Y);
  shape.lineTo(half, -2);
  shape.lineTo(-half, -2);
  shape.lineTo(-half, FLOOR_Y);
  for (const u of [-3.1, 3.1]) shape.holes.push(lancetPath(new Path(), u, -23, 3.2, 12));
  return extrude(shape, 1.4);
}

function pier(height: number, bottom: number, shaftTop: number) {
  const parts: BufferGeometry[] = [];
  const core = new BoxGeometry(3.4, height, 3.4).toNonIndexed();
  core.translate(0, bottom + height / 2, 0);
  parts.push(core);
  for (const [dx, dz] of [[1.75, 0], [-1.75, 0], [0, 1.75], [0, -1.75]]) {
    const top = dx > 0 ? shaftTop : bottom + height;
    const shaft = new CylinderGeometry(0.62, 0.62, top - bottom, 10).toNonIndexed();
    shaft.translate(dx, bottom + (top - bottom) / 2, dz);
    parts.push(shaft);
  }
  const plinth = new BoxGeometry(4.6, 2.4, 4.6).toNonIndexed();
  plinth.translate(0, bottom + 1.2, 0);
  parts.push(plinth);
  const capital = new BoxGeometry(4.5, 0.9, 4.5).toNonIndexed();
  capital.translate(0, -15.2, 0);
  parts.push(capital);
  return mergeGeometries(parts)!;
}

/** Pointed barrel profile: y rises from the springing to the crown. */
function vaultHeight(t: number, spring: number, rise: number) {
  return spring + rise * Math.pow(Math.max(0, 1 - Math.abs(t)), 0.55);
}

function vaultBay(z0: number, z1: number, halfSpan: number, spring: number, rise: number) {
  const positions: number[] = [];
  const across = 24;
  const along = 3;
  const point = (i: number, j: number) => {
    const t = (i / across) * 2 - 1;
    // Slightly domical: the webbing sags toward the transverse ribs.
    const w = j / along;
    const dome = Math.sin(w * Math.PI) * 1.2 * (1 - Math.abs(t) * 0.6);
    return [t * halfSpan, vaultHeight(t, spring, rise) + dome, z0 + (z1 - z0) * w];
  };
  for (let i = 0; i < across; i += 1) {
    for (let j = 0; j < along; j += 1) {
      const a = point(i, j);
      const b = point(i + 1, j);
      const c = point(i + 1, j + 1);
      const d = point(i, j + 1);
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
  geometry.computeVertexNormals();
  return geometry;
}

function rib(points: Vector3[], radius: number) {
  return new TubeGeometry(new CatmullRomCurve3(points), 26, radius, 5, false).toNonIndexed();
}

function ribProfile(from: Vector3, to: Vector3, spring: number, rise: number) {
  const points: Vector3[] = [];
  for (let i = 0; i <= 12; i += 1) {
    const t = (i / 12) * 2 - 1;
    const point = from.clone().lerp(to, i / 12);
    point.y = vaultHeight(t, spring, rise);
    points.push(point);
  }
  return points;
}

// ---- the building ---------------------------------------------------------------

export type Architecture = {
  stone: Mesh;
  ribs: Mesh;
  candles: InstancedMesh;
};

export function createArchitecture(parent: Object3D, lighting: StoneLighting, colors: { stone: Color; rib: Color; candle: Color; flame: Color }, candleDensity: (z: number) => number): Architecture {
  const stoneParts: BufferGeometry[] = [];
  const ribParts: BufferGeometry[] = [];
  const rise = VAULT_Y - SPRING_Y;
  const stationZs = PIER_ZS;

  // Bays of the nave and aisles.
  for (let i = 0; i < stationZs.length - 1; i += 1) {
    const zMid = (stationZs[i] + stationZs[i + 1]) / 2;
    if (inCrossing(zMid)) continue;
    for (const side of [-1, 1]) {
      const along = new Vector3(0, 0, -side);
      const outward = new Vector3(side, 0, 0);
      stoneParts.push(placeOnWall(naveBayWall(), new Vector3(side * NAVE_HALF_WIDTH, 0, zMid), along, outward));
      stoneParts.push(placeOnWall(aisleBayWall(), new Vector3(side * AISLE_WALL_X, 0, zMid), along, outward));
      // Triforium passage back wall and the aisle roof beneath it.
      const back = new BoxGeometry(0.8, 11, BAY).toNonIndexed();
      back.translate(side * (NAVE_HALF_WIDTH + 4.2), 2.2, zMid);
      stoneParts.push(back);
      const roof = new BoxGeometry(AISLE_WALL_X - NAVE_HALF_WIDTH, 1.2, BAY).toNonIndexed();
      roof.translate(side * (NAVE_HALF_WIDTH + AISLE_WALL_X) / 2, -2.6, zMid);
      stoneParts.push(roof);
    }
    stoneParts.push(vaultBay(stationZs[i], stationZs[i + 1], NAVE_HALF_WIDTH, SPRING_Y, rise));
    // Diagonal ribs crossing at the boss.
    for (const flip of [-1, 1]) {
      ribParts.push(rib(ribProfile(
        new Vector3(-NAVE_HALF_WIDTH + 1, 0, stationZs[i] * (flip > 0 ? 1 : 0) + stationZs[i + 1] * (flip > 0 ? 0 : 1)),
        new Vector3(NAVE_HALF_WIDTH - 1, 0, stationZs[i + 1] * (flip > 0 ? 1 : 0) + stationZs[i] * (flip > 0 ? 0 : 1)),
        SPRING_Y,
        rise + 1.2,
      ), 0.32));
    }
  }

  // Piers and transverse ribs.
  for (const z of stationZs) {
    const crossingCorner = Math.abs(Math.abs(z - CROSSING_Z) - CROSSING_HALF) < 0.5;
    if (inCrossing(z)) continue;
    for (const side of [-1, 1]) {
      // The four crossing piers carry the lantern: they rise to its floor.
      const top = crossingCorner ? VAULT_Y + 1.5 : SPRING_Y;
      const geometry = pier(top - FLOOR_Y, FLOOR_Y, top + 0.5);
      if (crossingCorner) geometry.scale(1.8, 1, 1.8);
      if (side > 0) geometry.rotateY(Math.PI);
      geometry.translate(side * (NAVE_HALF_WIDTH - 0.6), 0, z);
      stoneParts.push(geometry);
    }
    ribParts.push(rib(ribProfile(new Vector3(-NAVE_HALF_WIDTH + 1, 0, z), new Vector3(NAVE_HALF_WIDTH - 1, 0, z), SPRING_Y, rise), crossingCorner ? 0.9 : 0.46));
  }
  // The ridge rib runs the whole length of the vault.
  ribParts.push(rib([new Vector3(0, VAULT_Y + 0.4, EAST_END_Z), new Vector3(0, VAULT_Y + 0.4, (EAST_END_Z + WEST_WALL_Z) / 2), new Vector3(0, VAULT_Y + 0.4, WEST_WALL_Z)], 0.28));

  // The crossing: a lantern ring on a floor-less ceiling, and the transepts.
  const lanternTop = VAULT_Y + 36;
  const ceiling = new Shape();
  ceiling.moveTo(-NAVE_HALF_WIDTH, -CROSSING_HALF);
  ceiling.lineTo(NAVE_HALF_WIDTH, -CROSSING_HALF);
  ceiling.lineTo(NAVE_HALF_WIDTH, CROSSING_HALF);
  ceiling.lineTo(-NAVE_HALF_WIDTH, CROSSING_HALF);
  ceiling.lineTo(-NAVE_HALF_WIDTH, -CROSSING_HALF);
  const octagon = new Path();
  for (let k = 0; k <= 8; k += 1) {
    const angle = (k / 8) * Math.PI * 2;
    const radius = LANTERN_RADIUS / Math.cos(Math.PI / 8);
    if (k === 0) octagon.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    else octagon.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  ceiling.holes.push(octagon);
  const ceilingGeometry = extrude(ceiling, 1.5);
  ceilingGeometry.rotateX(Math.PI / 2);
  ceilingGeometry.translate(0, VAULT_Y + 1.5, CROSSING_Z);
  stoneParts.push(ceilingGeometry);
  for (let k = 0; k < 8; k += 1) {
    const angle = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const panelWidth = 2 * LANTERN_RADIUS * Math.tan(Math.PI / 8) + 0.6;
    const panel = new Shape();
    panel.moveTo(-panelWidth / 2, VAULT_Y);
    panel.lineTo(panelWidth / 2, VAULT_Y);
    panel.lineTo(panelWidth / 2, lanternTop);
    panel.lineTo(-panelWidth / 2, lanternTop);
    panel.lineTo(-panelWidth / 2, VAULT_Y);
    panel.holes.push(lancetPath(new Path(), 0, VAULT_Y + 17 - 7.5, 4.5, 15));
    const outward = new Vector3(Math.sin(angle), 0, Math.cos(angle));
    const along = new Vector3().crossVectors(new Vector3(0, 1, 0), outward).normalize();
    stoneParts.push(placeOnWall(extrude(panel, 1.4), new Vector3(0, 0, CROSSING_Z).addScaledVector(outward, LANTERN_RADIUS), along, outward));
  }
  const cap = new CylinderGeometry(LANTERN_RADIUS + 2, LANTERN_RADIUS + 2, 1.2, 8).toNonIndexed();
  cap.translate(0, lanternTop, CROSSING_Z);
  stoneParts.push(cap);
  for (const side of [-1, 1]) {
    // Transept side walls.
    for (const dz of [-CROSSING_HALF, CROSSING_HALF]) {
      const wall = new BoxGeometry(TRANSEPT_END_X - NAVE_HALF_WIDTH, SPRING_Y - FLOOR_Y + 12, 1.4).toNonIndexed();
      wall.translate(side * (TRANSEPT_END_X + NAVE_HALF_WIDTH) / 2, (SPRING_Y + FLOOR_Y + 12) / 2, CROSSING_Z + dz);
      stoneParts.push(wall);
    }
    // Transept end wall pierced by its rose.
    const end = new Shape();
    end.moveTo(-CROSSING_HALF, FLOOR_Y);
    end.lineTo(CROSSING_HALF, FLOOR_Y);
    end.lineTo(CROSSING_HALF, SPRING_Y + 12);
    end.lineTo(-CROSSING_HALF, SPRING_Y + 12);
    end.lineTo(-CROSSING_HALF, FLOOR_Y);
    for (const slot of WINDOWS) {
      if (slot.tier !== 'transept' || slot.side !== side) continue;
      end.holes.push(circlePath(new Path(), -side * (slot.position.z - CROSSING_Z), slot.position.y, slot.width / 2 + 0.15));
    }
    stoneParts.push(placeOnWall(extrude(end, 1.6), new Vector3(side * TRANSEPT_END_X, 0, CROSSING_Z), new Vector3(0, 0, -side), new Vector3(side, 0, 0)));
    // Transept vault.
    const transeptVault = vaultBay(-CROSSING_HALF, CROSSING_HALF, CROSSING_HALF, SPRING_Y + 2, 12);
    transeptVault.rotateY(Math.PI / 2);
    transeptVault.translate(side * (NAVE_HALF_WIDTH + TRANSEPT_END_X) / 2, 0, CROSSING_Z);
    transeptVault.scale(1, 1, 1);
    stoneParts.push(transeptVault);
  }

  // The west wall with the great round opening for the rose.
  const west = new Shape();
  west.moveTo(-AISLE_WALL_X, FLOOR_Y);
  west.lineTo(AISLE_WALL_X, FLOOR_Y);
  west.lineTo(AISLE_WALL_X, VAULT_Y + 4);
  west.lineTo(-AISLE_WALL_X, VAULT_Y + 4);
  west.lineTo(-AISLE_WALL_X, FLOOR_Y);
  west.holes.push(circlePath(new Path(), 0, ROSE_CENTER.y, ROSE_RADIUS + 0.2));
  const westGeometry = extrude(west, 2);
  westGeometry.translate(0, 0, WEST_WALL_Z - 2);
  stoneParts.push(westGeometry);
  const east = new BoxGeometry(AISLE_WALL_X * 2, VAULT_Y - FLOOR_Y + 6, 2).toNonIndexed();
  east.translate(0, (VAULT_Y + FLOOR_Y + 6) / 2, EAST_END_Z);
  stoneParts.push(east);

  // Floor.
  const floor = new PlaneGeometry(TRANSEPT_END_X * 2 + 4, EAST_END_Z - WEST_WALL_Z + 8, 1, 1).toNonIndexed();
  floor.rotateX(-Math.PI / 2);
  floor.translate(0, FLOOR_Y, (EAST_END_Z + WEST_WALL_Z) / 2);
  stoneParts.push(floor);

  const stoneGeometry = mergeGeometries(stoneParts.map(normalizeAttributes))!;
  for (const part of stoneParts) part.dispose();
  const stone = new Mesh(stoneGeometry, createStoneMaterial(lighting, colors.stone, colors.candle, 0.2));
  stone.frustumCulled = false;
  parent.add(stone);

  const ribGeometry = mergeGeometries(ribParts.map(normalizeAttributes))!;
  for (const part of ribParts) part.dispose();
  const ribs = new Mesh(ribGeometry, createStoneMaterial(lighting, colors.rib, colors.candle, 0.34));
  ribs.frustumCulled = false;
  parent.add(ribs);

  const candles = createCandleFloor(colors.flame, candleDensity);
  parent.add(candles);

  return { stone, ribs, candles };
}

function normalizeAttributes(geometry: BufferGeometry) {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  for (const name of Object.keys(result.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') result.deleteAttribute(name);
  }
  if (!result.getAttribute('normal')) result.computeVertexNormals();
  if (!result.getAttribute('uv')) {
    result.setAttribute('uv', new Float32BufferAttribute(new Array(result.getAttribute('position').count * 2).fill(0), 2));
  }
  return result;
}

// ---- candles ----------------------------------------------------------------------

function createCandleFloor(flame: Color, density: (z: number) => number) {
  const rng = mulberry32(4242);
  const matrices: Matrix4[] = [];
  const scale = new Vector3();
  const rotation = new Quaternion();
  // Votive stands in loose rows down the nave and aisles, and pricket
  // clusters around each pier base.
  for (let z = EAST_END_Z - 6; z > WEST_WALL_Z + 6; z -= 2.2) {
    const keep = density(z);
    for (let x = -AISLE_WALL_X + 3; x < AISLE_WALL_X - 3; x += 2.4) {
      const lane = Math.abs(x);
      const inNave = lane < NAVE_HALF_WIDTH - 3 && lane > 5.5;
      const inAisle = lane > NAVE_HALF_WIDTH + 2;
      if (!inNave && !inAisle) continue;
      const chance = (inAisle ? 0.3 : 0.2) * keep;
      if (rng() > chance) continue;
      const flames = 3 + Math.floor(rng() * 5);
      for (let f = 0; f < flames; f += 1) {
        const height = 0.4 + rng() * 1.6;
        scale.setScalar(0.8 + rng() * 0.6);
        scale.y *= 1.8;
        matrices.push(new Matrix4().compose(
          new Vector3(x + (rng() - 0.5) * 2, FLOOR_Y + height, z + (rng() - 0.5) * 2),
          rotation,
          scale.clone(),
        ));
      }
    }
  }
  for (const z of PIER_ZS) {
    if (inCrossing(z)) continue;
    for (const side of [-1, 1]) {
      if (rng() > 0.55 * density(z)) continue;
      const flames = 6 + Math.floor(rng() * 8);
      for (let f = 0; f < flames; f += 1) {
        const angle = rng() * Math.PI * 2;
        const radius = 3.2 + rng() * 1.5;
        scale.setScalar(0.9 + rng() * 0.5);
        scale.y *= 1.8;
        matrices.push(new Matrix4().compose(
          new Vector3(side * (NAVE_HALF_WIDTH - 0.6) + Math.cos(angle) * radius, FLOOR_Y + 2.6 + rng() * 0.6, z + Math.sin(angle) * radius),
          rotation,
          scale.clone(),
        ));
      }
    }
  }

  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  // Each flame gutters on its own clock.
  const seed = positionWorld.x.mul(12.9).add(positionWorld.z.mul(7.3));
  const flicker = sin(time.mul(9.1).add(seed)).mul(0.14)
    .add(sin(time.mul(23.7).add(seed.mul(1.7))).mul(0.07))
    .add(0.9);
  material.colorNode = color(flame).mul(flicker).mul(float(1.15));
  const mesh = new InstancedMesh(new OctahedronGeometry(0.1, 0), material, matrices.length);
  matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  return mesh;
}

// ---- coronae --------------------------------------------------------------------

/**
 * Hanging ring chandeliers: a black iron hoop on a long chain from the vault,
 * crowned with candles. `hangs` gives each hoop's centre; the chain runs up to
 * `ceilingY`.
 */
export function createCoronae(parent: Object3D, hangs: readonly Vector3[], ceilingY: number, lighting: StoneLighting, colors: { iron: Color; candle: Color; flame: Color }) {
  const ironParts: BufferGeometry[] = [];
  const flameMatrices: Matrix4[] = [];
  const rotation = new Quaternion();
  for (const hang of hangs) {
    const hoop = new TubeGeometry(new CatmullRomCurve3(
      Array.from({ length: 24 }, (_, k) => new Vector3(Math.cos((k / 24) * Math.PI * 2) * 2.8, 0, Math.sin((k / 24) * Math.PI * 2) * 2.8)),
      true,
    ), 48, 0.12, 4, true).toNonIndexed();
    hoop.translate(hang.x, hang.y, hang.z);
    ironParts.push(hoop);
    for (let k = 0; k < 3; k += 1) {
      const angle = (k / 3) * Math.PI * 2;
      const strut = new CylinderGeometry(0.05, 0.05, 4.2, 3).toNonIndexed();
      const foot = new Vector3(Math.cos(angle) * 2.8, 0, Math.sin(angle) * 2.8);
      const middle = foot.clone().multiplyScalar(0.5).add(new Vector3(0, 1.8, 0));
      strut.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(-foot.x, 3.6, -foot.z).normalize()));
      strut.translate(hang.x + middle.x, hang.y + middle.y, hang.z + middle.z);
      ironParts.push(strut);
    }
    const chain = new CylinderGeometry(0.07, 0.07, ceilingY - hang.y - 3.6, 3).toNonIndexed();
    chain.translate(hang.x, (ceilingY + hang.y + 3.6) / 2, hang.z);
    ironParts.push(chain);
    for (let k = 0; k < 12; k += 1) {
      const angle = (k / 12) * Math.PI * 2;
      flameMatrices.push(new Matrix4().compose(
        new Vector3(hang.x + Math.cos(angle) * 2.8, hang.y + 0.45, hang.z + Math.sin(angle) * 2.8),
        rotation,
        new Vector3(1.1, 2, 1.1),
      ));
    }
  }
  const iron = new Mesh(mergeGeometries(ironParts.map(normalizeAttributes))!, createStoneMaterial(lighting, colors.iron, colors.candle, 0.25));
  iron.frustumCulled = false;
  // Thin ironwork high above the flight path: never a meaningful occluder.
  iron.userData.raildIgnoreOcclusion = true;
  parent.add(iron);

  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const seed = positionWorld.x.mul(9.7).add(positionWorld.z.mul(5.1));
  material.colorNode = color(colors.flame).mul(sin(time.mul(8.3).add(seed)).mul(0.12).add(1.2));
  const flames = new InstancedMesh(new OctahedronGeometry(0.12, 0), material, flameMatrices.length);
  flameMatrices.forEach((matrix, index) => flames.setMatrixAt(index, matrix));
  flames.instanceMatrix.needsUpdate = true;
  flames.frustumCulled = false;
  flames.userData.raildIgnoreOcclusion = true;
  parent.add(flames);
  return { iron, flames };
}
