import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { float, positionWorld, sin, uniform, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { createAtmosphereRamp } from '../../../engine/environment-kit';
import { mulberry32 } from '../../../engine/rng';
import { disposeObject3D } from '../../../engine/visual-kit';
import { createVespersRail, roseAnchor, ROSE_RADIUS, WEST_WALL_Z } from '../gameplay';
import { CANDLE, COBALT, GOLD, hdr, STONE, STONE_DARK, STONE_EDGE, STONE_LINE, WINDOW_PALETTE } from './palette';

// The nave: black stone piers, tiers of arcade and gallery stacked overhead,
// a floor of candles far below, ribbed vaults closing over, and lancet
// windows in the gallery and clerestory that start dead and relight one by
// one as the player returns their stolen light. The dead rose window at the
// west end holds the Devourer, and ignites all at once when it dies.

const HALF_WIDTH = 19;       // nave walls at x = ±19
const FLOOR_Y = -16;
const VAULT_WALL_Y = 20;     // springing line of the vault
const VAULT_CROWN_Y = 24.5;
const BAY = 21.5;            // bay spacing along the nave
const BAYS = 12;
const PIER_X = 16.6;
const PIER_HEIGHT = VAULT_WALL_Y - FLOOR_Y + 2;

export type WindowState = {
  u: number;
  position: Vector3;
  fill: Mesh;
  glow: Mesh;
  pool: Mesh;
  frame: LineSegments;
  lit: boolean;
  colour: Color;
  flashUntil: number;
};

export type RoseState = {
  group: Group;
  petals: Array<{ mesh: Mesh; material: MeshBasicMaterial; colour: Color; lit: boolean }>;
  ringMaterials: MeshBasicMaterial[];
  centreGlow: Mesh;
  ignited: boolean;
  igniteAt: number;
  litCount: number;
};

export type Environment = {
  root: Group;
  windows: WindowState[];
  rose: RoseState;
  candleFlicker: { value: number };
  atmosphere: (progress: number) => void;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = new Color(0.003, 0.004, 0.012);
  scene.fog = new FogExp2(0x000006, 0.0062);
  const root = new Group();
  const curve = createVespersRail();
  const rng = mulberry32(20261104);
  const windows: WindowState[] = [];

  // ---- floor ---------------------------------------------------------------
  const floor = new Mesh(
    new PlaneGeometry(64, 320),
    new MeshBasicMaterial({ color: STONE_DARK, side: DoubleSide }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR_Y, -140);
  root.add(floor);

  // ---- piers ---------------------------------------------------------------
  // Merged black stone columns on both sides, rising from the floor into the
  // vault, with a capital and a base each.
  const pierPieces: BufferGeometry[] = [];
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < BAYS + 1; k += 1) {
      const z = -8 - BAY * k;
      const x = side * PIER_X;
      pierPieces.push(
        new CylinderGeometry(1.45, 1.75, PIER_HEIGHT, 8).translate(x, (FLOOR_Y + VAULT_WALL_Y) / 2, z),
        new CylinderGeometry(2.05, 1.45, 1.5, 8).translate(x, VAULT_WALL_Y - 0.25, z),
        new CylinderGeometry(2.2, 2.4, 1.5, 8).translate(x, FLOOR_Y + 0.75, z),
      );
    }
  }
  const piersMesh = new Mesh(mergeGeometries(pierPieces), new MeshBasicMaterial({ color: STONE }));
  piersMesh.frustumCulled = false;
  root.add(piersMesh);
  for (const geometry of pierPieces) geometry.dispose();

  // ---- walls ---------------------------------------------------------------
  // Arcade spandrel (floor to gallery sill), gallery wall, clerestory wall.
  const wallPieces: BufferGeometry[] = [];
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < BAYS; k += 1) {
      const z = -8 - BAY * k - BAY / 2;
      const x = side * HALF_WIDTH;
      wallPieces.push(
        new PlaneGeometry(BAY * 0.94, 20.5).rotateY(Math.PI / 2).translate(x, 1.25, z),
        new PlaneGeometry(BAY * 0.94, 8).rotateY(Math.PI / 2).translate(x, 6.5, z),
        new PlaneGeometry(BAY * 0.94, 8).rotateY(Math.PI / 2).translate(x, 15, z),
      );
    }
  }
  const walls = new Mesh(mergeGeometries(wallPieces), new MeshBasicMaterial({ color: STONE_DARK, side: DoubleSide }));
  walls.frustumCulled = false;
  root.add(walls);
  for (const geometry of wallPieces) geometry.dispose();

  // ---- vault ribs ----------------------------------------------------------
  // Transverse arches, diagonal ribs, and a ridge line — a ribbed vault
  // closing overhead. Merged into one line set.
  const vaultPositions: number[] = [];
  const archSegments = 18;
  for (let k = 0; k <= BAYS; k += 1) {
    const z = -8 - BAY * k;
    for (let s = 0; s < archSegments; s += 1) {
      pushArc(vaultPositions, -HALF_WIDTH, HALF_WIDTH, z, VAULT_WALL_Y, VAULT_CROWN_Y, s / archSegments, (s + 1) / archSegments);
    }
    pushLine(vaultPositions, -HALF_WIDTH, VAULT_WALL_Y, z, 0, VAULT_CROWN_Y, z + BAY * 0.5);
    pushLine(vaultPositions, HALF_WIDTH, VAULT_WALL_Y, z, 0, VAULT_CROWN_Y, z + BAY * 0.5);
    pushLine(vaultPositions, 0, VAULT_CROWN_Y, z, 0, VAULT_CROWN_Y, z + BAY);
  }
  const vaultGeometry = new BufferGeometry();
  vaultGeometry.setAttribute('position', new Float32BufferAttribute(vaultPositions, 3));
  const vault = new LineSegments(vaultGeometry, new LineBasicMaterial({ color: STONE_EDGE, transparent: true, opacity: 0.75 }));
  vault.frustumCulled = false;
  root.add(vault);

  // ---- candles -------------------------------------------------------------
  const candleCount = 520;
  const { material: candleMaterial, flicker } = buildCandleMaterial();
  const candle = new InstancedMesh(new OctahedronGeometry(0.42, 0), candleMaterial, candleCount);
  const candleMatrix = new Matrix4();
  const candlePosition = new Vector3();
  const candleQuat = new Quaternion();
  const candleScale = new Vector3();
  for (let i = 0; i < candleCount; i += 1) {
    candlePosition.set((rng() * 2 - 1) * 17, FLOOR_Y + 0.2 + rng() * 0.3, -5 - rng() * 250);
    candleScale.setScalar(0.6 + rng() * 0.9);
    candleMatrix.compose(candlePosition, candleQuat, candleScale);
    candle.setMatrixAt(i, candleMatrix);
  }
  candle.instanceMatrix.needsUpdate = true;
  candle.frustumCulled = false;
  root.add(candle);

  // ---- windows -------------------------------------------------------------
  const lancetGeometry = makeLancetGeometry();
  type WindowPlacement = { side: number; bay: number; u: number; tier: 'gallery' | 'clerestory' };
  const placements: WindowPlacement[] = [];
  for (let k = 0; k < 10; k += 1) {
    placements.push({ side: -1, bay: k, u: (k + 0.5) / 11, tier: 'gallery' });
    placements.push({ side: 1, bay: k, u: (k + 0.5) / 11, tier: 'gallery' });
  }
  for (const k of [1, 2, 3, 4, 5, 7, 8]) {
    placements.push({ side: -1, bay: k, u: (k + 0.5) / 11, tier: 'clerestory' });
    placements.push({ side: 1, bay: k, u: (k + 0.5) / 11, tier: 'clerestory' });
  }

  for (const placement of placements) {
    const z = -8 - BAY * placement.bay - BAY / 2;
    const x = placement.side * HALF_WIDTH;
    const centreY = placement.tier === 'gallery' ? 6.5 : 15;
    const scale = placement.tier === 'gallery' ? 1.9 : 1.5;
    const window = makeWindow(lancetGeometry, x, centreY, z, scale, placement.u);
    root.add(window.fill, window.glow, window.pool, window.frame);
    windows.push(window);
  }
  windows.sort((a, b) => b.position.z - a.position.z); // near first

  // Pre-lit: the first two windows (one cobalt, one gold) so the player sees
  // what a lit window looks like before the first kill.
  relightWindow(windows[0], COBALT, 0);
  relightWindow(windows[1], GOLD, 0);

  // ---- west wall + rose window --------------------------------------------
  const westWall = new Mesh(
    new PlaneGeometry(62, 44),
    new MeshBasicMaterial({ color: STONE_DARK, side: DoubleSide }),
  );
  westWall.position.set(0, 8, WEST_WALL_Z - 5);
  root.add(westWall);

  const rose = buildRose();
  markRoseAsWindow(rose);
  root.add(rose.group);

  // ---- atmosphere ----------------------------------------------------------
  const ramp = createAtmosphereRamp(scene, [
    { progress: 0, fog: 0x000006, density: 0.0072, background: 0x000408 },
    { progress: 0.55, fog: 0x000006, density: 0.0062, background: 0x000408 },
    { progress: 0.85, fog: 0x0a0612, density: 0.0052, background: 0x050308 },
    { progress: 1, fog: 0x140a18, density: 0.0046, background: 0x0a060e },
  ]);
  ramp(0);

  scene.add(root);
  return { root, windows, rose, candleFlicker: flicker, atmosphere: ramp };
}

function pushArc(
  positions: number[],
  x0: number,
  x1: number,
  z: number,
  wallY: number,
  crownY: number,
  t0: number,
  t1: number,
) {
  const a = arcPoint(x0, x1, wallY, crownY, t0, z);
  const b = arcPoint(x0, x1, wallY, crownY, t1, z);
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

function arcPoint(x0: number, x1: number, wallY: number, crownY: number, t: number, z: number) {
  const x = x0 + (x1 - x0) * t;
  const y = wallY + Math.sin(Math.PI * t) * (crownY - wallY);
  return new Vector3(x, y, z);
}

function pushLine(positions: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  positions.push(x0, y0, z0, x1, y1, z1);
}

// A lancet: a tall rectangle with a pointed apex — the classic window shape.
function makeLancetGeometry(): ShapeGeometry {
  const shape = new Shape();
  shape.moveTo(-0.5, -0.8);
  shape.lineTo(-0.5, 0.35);
  shape.lineTo(0, 1.05);
  shape.lineTo(0.5, 0.35);
  shape.lineTo(0.5, -0.8);
  shape.closePath();
  return new ShapeGeometry(shape);
}

function makeWindow(geometry: ShapeGeometry, x: number, centreY: number, z: number, scale: number, u: number): WindowState {
  const width = 1.9 * scale;
  const height = 3.4 * scale;

  const fill = new Mesh(geometry, new MeshBasicMaterial({ color: new Color(0.008, 0.01, 0.022), side: DoubleSide }));
  fill.scale.set(width, height, 1);
  fill.position.set(x, centreY, z + 0.1);
  fill.renderOrder = 2;

  const glow = new Mesh(geometry, new MeshBasicMaterial({
    color: new Color(0, 0, 0),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  }));
  glow.scale.set(width * 1.3, height * 1.3, 1);
  glow.position.set(x, centreY, z + 0.06);
  glow.renderOrder = 3;
  glow.visible = false;

  // The colour the glass throws onto the stone floor beneath.
  const pool = new Mesh(
    new PlaneGeometry(width * 2.4, width * 2.4),
    new MeshBasicMaterial({
      color: new Color(0, 0, 0),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(x, FLOOR_Y + 0.08, z + 0.4);
  pool.renderOrder = 1;
  pool.visible = false;

  const frame = makeWindowFrame(width, height);
  frame.position.set(x, centreY, z + 0.05);

  return {
    u,
    position: new Vector3(x, centreY, z),
    fill,
    glow,
    pool,
    frame,
    lit: false,
    colour: new Color(0.008, 0.01, 0.022),
    flashUntil: 0,
  };
}

function makeWindowFrame(width: number, height: number): LineSegments {
  const halfW = width / 2;
  const bottom = -height * 0.8;
  const mid = height * 0.35;
  const apex = height * 1.05;
  const positions = [
    -halfW, bottom, 0, halfW, bottom, 0,
    halfW, bottom, 0, halfW, mid, 0,
    halfW, mid, 0, 0, apex, 0,
    0, apex, 0, -halfW, mid, 0,
    -halfW, mid, 0, -halfW, bottom, 0,
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({ color: STONE_EDGE });
  return new LineSegments(geometry, material);
}

export function relightWindow(window: WindowState, colour: Color, now: number) {
  window.lit = true;
  window.colour.copy(colour);
  (window.fill.material as MeshBasicMaterial).color.copy(hdr(colour, 1.25));
  window.glow.visible = true;
  (window.glow.material as MeshBasicMaterial).color.copy(hdr(colour, 0.5));
  window.pool.visible = true;
  (window.pool.material as MeshBasicMaterial).color.copy(hdr(colour, 0.16));
  (window.frame.material as LineBasicMaterial).color.copy(hdr(GOLD, 0.55));
  window.flashUntil = now + 0.5;
}

// The next window that is still dead, in flight order (near first).
export function nextUnlitWindow(windows: WindowState[]): WindowState | undefined {
  return windows.find((window) => !window.lit);
}

function buildCandleMaterial(): { material: MeshBasicNodeMaterial; flicker: { value: number } } {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const flicker = uniform(0);
  const flickerNode = float(0.42)
    .add(sin(positionWorld.x.mul(11.3).add(positionWorld.z.mul(5.7)).add(flicker.mul(8.6))).mul(0.14))
    .add(sin(positionWorld.x.mul(4.9).add(positionWorld.z.mul(12.1)).add(flicker.mul(4.2))).mul(0.1))
    .add(sin(positionWorld.x.mul(17.3).add(positionWorld.z.mul(2.3)).add(flicker.mul(16.7))).mul(0.06));
  material.colorNode = vec3(CANDLE.r, CANDLE.g, CANDLE.b).mul(flickerNode).mul(1.7);
  return { material, flicker };
}

function buildRose(): RoseState {
  const group = new Group();
  const centre = roseAnchor();
  group.position.copy(centre);

  const petals: RoseState['petals'] = [];
  const ringMaterials: MeshBasicMaterial[] = [];

  // The stone tracery: rim, mullion rings.
  const rim = new Mesh(new RingGeometry(ROSE_RADIUS - 1.2, ROSE_RADIUS + 0.6, 40), new MeshBasicMaterial({ color: STONE, side: DoubleSide }));
  ringMaterials.push(rim.material as MeshBasicMaterial);
  group.add(rim);

  const mullionOuter = new Mesh(new RingGeometry(9.2, 9.7, 32), new MeshBasicMaterial({ color: STONE, side: DoubleSide }));
  ringMaterials.push(mullionOuter.material as MeshBasicMaterial);
  group.add(mullionOuter);

  const mullionInner = new Mesh(new RingGeometry(5.5, 5.9, 28), new MeshBasicMaterial({ color: STONE, side: DoubleSide }));
  ringMaterials.push(mullionInner.material as MeshBasicMaterial);
  group.add(mullionInner);

  // Petals: an outer band of twelve. The centre stays open — the Devourer
  // nests in the dead heart, and its thorns orbit the clear band between the
  // mullion rings and the glass.
  const petalGeometry = new PlaneGeometry(2.1, 3.9);
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const petal = new Mesh(petalGeometry, new MeshBasicMaterial({ color: STONE_DARK, side: DoubleSide }));
    petal.position.set(Math.cos(angle) * 14.2, Math.sin(angle) * 14.2, 0.05);
    petal.rotation.z = angle;
    group.add(petal);
    const colour = WINDOW_PALETTE[i % WINDOW_PALETTE.length];
    petals.push({ mesh: petal, material: petal.material as MeshBasicMaterial, colour: colour.clone(), lit: false });
  }

  // Tracery lines over the petals so the window reads as stone even dead.
  const tracery = new LineSegments(makeRoseTracery(), new LineBasicMaterial({ color: STONE_LINE }));
  group.add(tracery);

  // The light that returns to the heart when the Devourer dies.
  const centreGlow = new Mesh(
    new RingGeometry(0.2, 5.2, 40),
    new MeshBasicMaterial({
      color: new Color(0, 0, 0),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  centreGlow.visible = false;
  group.add(centreGlow);

  return { group, petals, ringMaterials, centreGlow, ignited: false, igniteAt: 0, litCount: 0 };
}

// The rose is a window: the Devourer nests inside it, so looking through the
// glass at it is intentional. The occlusion checker honours this.
export function markRoseAsWindow(rose: RoseState) {
  rose.group.userData.raildIgnoreOcclusion = true;
  rose.group.traverse((child) => {
    child.userData.raildIgnoreOcclusion = true;
  });
}

function makeRoseTracery(): BufferGeometry {
  const positions: number[] = [];
  const petals = 12;
  for (let i = 0; i < petals; i += 1) {
    const angle = (i / petals) * Math.PI * 2;
    positions.push(
      Math.cos(angle) * 5.9, Math.sin(angle) * 5.9, 0.03,
      Math.cos(angle) * (ROSE_RADIUS - 1.2), Math.sin(angle) * (ROSE_RADIUS - 1.2), 0.03,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

export function updateWindowFlash(window: WindowState, now: number) {
  if (window.flashUntil <= now) return;
  const t = (window.flashUntil - now) / 0.5;
  (window.glow.material as MeshBasicMaterial).color.copy(hdr(window.colour, 0.5 + t * 0.8));
}

export function disposeEnvironment(environment: Environment) {
  environment.root.removeFromParent();
  disposeObject3D(environment.root);
}
