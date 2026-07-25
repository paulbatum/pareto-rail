import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  BoxGeometry,
  CircleGeometry,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../../engine/rng';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { createRadialFanGeometry } from './enemies';
import { BACKGROUND, CANDLE, GOLD, hdr, LEAD, PETAL_JEWELS, ROSEWHITE, WINDOW_JEWELS } from './palette';

// The building: a straight, enormous gothic nave along -z. Black stone piers
// carry an arcade, a gallery course, and ribbed vaults; the floor far below
// is a sea of candles; both walls carry two tiers of stained-glass windows —
// every one of them dark until the player wins its light back. The dead rose
// window waits at the west end.
//
// Scale + draw calls: all window panes are ONE InstancedMesh, all glows one,
// all floor pools one, all architecture lines one merged LineSegments — the
// whole cathedral is a handful of draw calls.

const NAVE_HALF = 15; // pier centres
const WALL_X = 16.6;
const FLOOR_Y = -10;
const SPRING_Y = 20;
const APEX_Y = 30;
const BAY = 16;
const FIRST_Z = 16;
const LAST_Z = -576;

export const ROSE_CENTER = new Vector3(0, 8, -570);
const ROSE_RADIUS = 10.4;

type WindowRecord = {
  index: number;
  center: Vector3;
  jewel: Color;
  lit: boolean;
  assigned: boolean;
  paneStart: number;
  paneCount: number;
  glowIndex: number;
  poolIndex: number;
};

export type VespersEnvironment = {
  root: Group;
  roseCenter: Vector3;
  /** Claim the nearest dark, unclaimed window to a spawn position. */
  assignWindowNear(position: Vector3): number;
  windowTarget(index: number): Vector3;
  windowJewel(index: number): Color;
  igniteWindow(index: number): void;
  roseSectorTarget(petalIndex: number): Vector3;
  ignitePetalSector(petalIndex: number): void;
  /** The finale: the rose ignites, then every remaining window down the nave. */
  igniteRose(elapsed: number): void;
  litFraction(): number;
  reset(): void;
  update(dt: number, elapsed: number): void;
};

export function createVespersEnvironment(scene: Scene): VespersEnvironment {
  scene.background = BACKGROUND.clone();
  scene.fog = new Fog(BACKGROUND.clone(), 26, 155);

  const root = new Group();
  const rng = mulberry32(20260725);

  // ---- stone shell: walls, vault, floor, west wall (vertex-coloured quads) --
  const shellPositions: number[] = [];
  const shellColors: number[] = [];
  const pushQuad = (corners: [Vector3, Vector3, Vector3, Vector3], colors: [Color, Color, Color, Color]) => {
    const [a, b, c, d] = corners;
    const [ca, cb, cc, cd] = colors;
    for (const [v, col] of [[a, ca], [b, cb], [c, cc], [a, ca], [c, cc], [d, cd]] as const) {
      shellPositions.push(v.x, v.y, v.z);
      shellColors.push(col.r, col.g, col.b);
    }
  };
  const wallLow = new Color(0x16131c);
  const wallHigh = new Color(0x0a0a10);
  const vaultTone = new Color(0x08080e);
  const floorTone = new Color(0x0e0c11);
  const endTone = new Color(0x0b0b12);
  for (const side of [-1, 1]) {
    const x = side * WALL_X;
    pushQuad(
      [new Vector3(x, FLOOR_Y, FIRST_Z), new Vector3(x, FLOOR_Y, LAST_Z), new Vector3(x, SPRING_Y, LAST_Z), new Vector3(x, SPRING_Y, FIRST_Z)],
      [wallLow, wallLow, wallHigh, wallHigh],
    );
    pushQuad(
      [new Vector3(x, SPRING_Y, FIRST_Z), new Vector3(x, SPRING_Y, LAST_Z), new Vector3(0, APEX_Y, LAST_Z), new Vector3(0, APEX_Y, FIRST_Z)],
      [wallHigh, wallHigh, vaultTone, vaultTone],
    );
  }
  pushQuad(
    [new Vector3(-WALL_X, FLOOR_Y, FIRST_Z), new Vector3(WALL_X, FLOOR_Y, FIRST_Z), new Vector3(WALL_X, FLOOR_Y, LAST_Z), new Vector3(-WALL_X, FLOOR_Y, LAST_Z)],
    [floorTone, floorTone, floorTone, floorTone],
  );
  pushQuad(
    [new Vector3(-WALL_X - 2, FLOOR_Y, LAST_Z - 2), new Vector3(WALL_X + 2, FLOOR_Y, LAST_Z - 2), new Vector3(WALL_X + 2, APEX_Y + 3, LAST_Z - 2), new Vector3(-WALL_X - 2, APEX_Y + 3, LAST_Z - 2)],
    [endTone, endTone, endTone, endTone],
  );
  const shellGeometry = new BufferGeometry();
  shellGeometry.setAttribute('position', new Float32BufferAttribute(shellPositions, 3));
  shellGeometry.setAttribute('color', new Float32BufferAttribute(shellColors, 3));
  const shell = new Mesh(shellGeometry, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
  shell.frustumCulled = false;
  root.add(shell);

  // ---- piers ----------------------------------------------------------------
  const bayZs: number[] = [];
  for (let z = FIRST_Z; z >= LAST_Z; z -= BAY) bayZs.push(z);
  const pierGeometry = new BoxGeometry(1.9, SPRING_Y - FLOOR_Y, 1.9);
  const piers = new InstancedMesh(pierGeometry, new MeshBasicMaterial({ color: 0x0a0a0f }), bayZs.length * 2);
  const pierMatrix = new Matrix4();
  const pierLinePositions: number[] = [];
  let pierCount = 0;
  for (const z of bayZs) {
    for (const side of [-1, 1]) {
      const x = side * NAVE_HALF;
      pierMatrix.makeTranslation(x, (FLOOR_Y + SPRING_Y) / 2, z);
      piers.setMatrixAt(pierCount, pierMatrix);
      pierCount += 1;
      // Vertical corner lines only: they sell the height without clutter.
      for (const [dx, dz] of [[-0.95, -0.95], [-0.95, 0.95], [0.95, -0.95], [0.95, 0.95]]) {
        pierLinePositions.push(x + dx, FLOOR_Y, z + dz, x + dx, SPRING_Y, z + dz);
      }
    }
  }
  piers.count = pierCount;
  piers.frustumCulled = false;
  root.add(piers);

  // ---- architecture lines: arcade arches, courses, ribs, rose tracery -------
  const linePositions: number[] = pierLinePositions;
  const pushLine = (a: Vector3, b: Vector3) => linePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const pushArc = (points: Vector3[]) => {
    for (let i = 1; i < points.length; i += 1) pushLine(points[i - 1], points[i]);
  };
  const pointedArch = (x: number, z0: number, z1: number, springY: number, apexY: number, plane: 'z') => {
    void plane;
    const mid = (z0 + z1) / 2;
    const points: Vector3[] = [];
    for (let i = 0; i <= 10; i += 1) {
      const t = i / 10;
      const z = z0 + (z1 - z0) * t;
      const y = springY + (apexY - springY) * Math.sin(t * Math.PI) ** 0.8;
      points.push(new Vector3(x, y, z));
    }
    void mid;
    return points;
  };
  for (let i = 0; i < bayZs.length - 1; i += 1) {
    const z0 = bayZs[i];
    const z1 = bayZs[i + 1];
    for (const side of [-1, 1]) {
      const x = side * NAVE_HALF;
      // Arcade arch and a shallower gallery arch above it.
      pushArc(pointedArch(x, z0 - 0.9, z1 + 0.9, 6.5, 12.5, 'z'));
      pushArc(pointedArch(x, z0 - 0.9, z1 + 0.9, 13.5, 17.5, 'z'));
    }
    // Transverse rib: a pointed arch across the nave at each pier line.
    for (const side of [-1, 1]) {
      const ribPoints: Vector3[] = [];
      for (let s = 0; s <= 8; s += 1) {
        const t = s / 8;
        const x = side * WALL_X * (1 - t);
        const y = SPRING_Y + (APEX_Y - 0.4 - SPRING_Y) * Math.sin((t * Math.PI) / 2);
        ribPoints.push(new Vector3(x, y, z0));
      }
      pushArc(ribPoints);
      // Diagonal rib crossing the bay.
      const diagonal: Vector3[] = [];
      for (let s = 0; s <= 8; s += 1) {
        const t = s / 8;
        const x = side * WALL_X * (1 - t);
        const y = SPRING_Y + (APEX_Y - 0.4 - SPRING_Y) * Math.sin((t * Math.PI) / 2);
        diagonal.push(new Vector3(x, y, z0 + (z1 - z0) * t));
      }
      pushArc(diagonal);
    }
  }
  // Long spring courses down both walls.
  for (const side of [-1, 1]) {
    pushLine(new Vector3(side * WALL_X, SPRING_Y, FIRST_Z), new Vector3(side * WALL_X, SPRING_Y, LAST_Z));
    pushLine(new Vector3(side * NAVE_HALF, 6.5, FIRST_Z), new Vector3(side * NAVE_HALF, 6.5, LAST_Z));
  }

  // ---- windows --------------------------------------------------------------
  const windows: WindowRecord[] = [];
  const paneTransforms: Array<{ position: Vector3; quaternion: Quaternion; scale: Vector3 }> = [];
  const paneDark: number[] = [];
  const paneLit: number[] = [];
  const glowTransforms: Array<{ position: Vector3; quaternion: Quaternion; scale: Vector3 }> = [];
  const poolTransforms: Array<{ position: Vector3; quaternion: Quaternion; scale: Vector3 }> = [];

  const inward = (side: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), side > 0 ? -Math.PI / 2 : Math.PI / 2);
  const diamond = (side: number) => {
    const q = inward(side);
    return q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4));
  };

  function buildWindow(side: number, z: number, tier: 'aisle' | 'clerestory') {
    const jewel = WINDOW_JEWELS[Math.floor(rng() * WINDOW_JEWELS.length)];
    const x = side * (WALL_X - 0.18);
    const paneStart = paneTransforms.length;
    const cols = tier === 'aisle' ? 3 : 2;
    const rows = tier === 'aisle' ? 5 : 3;
    const paneW = tier === 'aisle' ? 0.95 : 0.92;
    const paneH = tier === 'aisle' ? 2.0 : 1.5;
    const colPitch = tier === 'aisle' ? 1.06 : 1.05;
    const rowPitch = tier === 'aisle' ? 2.16 : 1.64;
    const baseY = tier === 'aisle' ? -3.4 : 13.4;
    for (let c = 0; c < cols; c += 1) {
      for (let r = 0; r < rows; r += 1) {
        const zOffset = (c - (cols - 1) / 2) * colPitch;
        const y = baseY + paneH / 2 + r * rowPitch;
        paneTransforms.push({
          position: new Vector3(x, y, z + zOffset),
          quaternion: inward(side),
          scale: new Vector3(paneW, paneH, 1),
        });
        const dark = jewel.clone().multiplyScalar(0.05 + rng() * 0.035);
        paneDark.push(dark.r, dark.g, dark.b);
        const sparkle = rng() < 0.14 ? jewel.clone().lerp(new Color(1, 1, 1), 0.5).multiplyScalar(1.9) : jewel.clone().multiplyScalar(0.9 + rng() * 0.9);
        paneLit.push(sparkle.r, sparkle.g, sparkle.b);
      }
    }
    // The apex light: a diamond pane above the grid.
    const apexY = baseY + rows * rowPitch + (tier === 'aisle' ? 0.85 : 0.7);
    paneTransforms.push({
      position: new Vector3(x, apexY, z),
      quaternion: diamond(side),
      scale: new Vector3(tier === 'aisle' ? 1.15 : 0.95, tier === 'aisle' ? 1.15 : 0.95, 1),
    });
    const apexDark = jewel.clone().multiplyScalar(0.06);
    paneDark.push(apexDark.r, apexDark.g, apexDark.b);
    const apexLit = jewel.clone().lerp(new Color(1, 1, 1), 0.35).multiplyScalar(1.7);
    paneLit.push(apexLit.r, apexLit.g, apexLit.b);

    const centerY = baseY + (rows * rowPitch) / 2;
    const glowIndex = glowTransforms.length;
    glowTransforms.push({
      position: new Vector3(side * (WALL_X - 0.55), centerY + 0.4, z),
      quaternion: inward(side),
      scale: tier === 'aisle' ? new Vector3(3.6, 7.6, 1) : new Vector3(2.8, 4.4, 1),
    });

    let poolIndex = -1;
    if (tier === 'aisle') {
      poolIndex = poolTransforms.length;
      poolTransforms.push({
        position: new Vector3(side * (NAVE_HALF - 3.2), FLOOR_Y + 0.07, z),
        quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2),
        scale: new Vector3(6.2, 4.6, 1),
      });
    }

    windows.push({
      index: windows.length,
      center: new Vector3(x, centerY, z),
      jewel: jewel.clone(),
      lit: false,
      assigned: false,
      paneStart,
      paneCount: paneTransforms.length - paneStart,
      glowIndex,
      poolIndex,
    });
  }

  for (let i = 0; i < bayZs.length - 1; i += 1) {
    const z = (bayZs[i] + bayZs[i + 1]) / 2;
    for (const side of [-1, 1]) {
      buildWindow(side, z, 'aisle');
      buildWindow(side, z, 'clerestory');
    }
    // Lead tracery around both windows of the bay.
    for (const side of [-1, 1]) {
      const x = side * (WALL_X - 0.12);
      pushLine(new Vector3(x, -3.4, z - 1.7), new Vector3(x, 7.6, z - 1.7));
      pushLine(new Vector3(x, -3.4, z + 1.7), new Vector3(x, 7.6, z + 1.7));
      pushLine(new Vector3(x, -3.4, z - 1.7), new Vector3(x, -3.4, z + 1.7));
      pushArc(pointedArch(x, z - 1.7, z + 1.7, 7.6, 9.6, 'z'));
      pushLine(new Vector3(x, 13.4, z - 1.2), new Vector3(x, 18.4, z - 1.2));
      pushLine(new Vector3(x, 13.4, z + 1.2), new Vector3(x, 18.4, z + 1.2));
      pushLine(new Vector3(x, 13.4, z - 1.2), new Vector3(x, 13.4, z + 1.2));
      pushArc(pointedArch(x, z - 1.2, z + 1.2, 18.4, 19.9, 'z'));
    }
  }

  const paneGeometry = new PlaneGeometry(1, 1);
  const panes = new InstancedMesh(paneGeometry, new MeshBasicMaterial({ side: DoubleSide }), paneTransforms.length);
  const matrix = new Matrix4();
  const scratchColor = new Color();
  paneTransforms.forEach((t, i) => {
    matrix.compose(t.position, t.quaternion, t.scale);
    panes.setMatrixAt(i, matrix);
    panes.setColorAt(i, scratchColor.setRGB(paneDark[i * 3], paneDark[i * 3 + 1], paneDark[i * 3 + 2]));
  });
  panes.frustumCulled = false;
  root.add(panes);

  const fanGeometry = createRadialFanGeometry(22);
  const glows = new InstancedMesh(
    fanGeometry,
    new MeshBasicMaterial(additiveMaterialParameters({ vertexColors: true, side: DoubleSide })),
    glowTransforms.length,
  );
  glowTransforms.forEach((t, i) => {
    matrix.compose(t.position, t.quaternion, t.scale);
    glows.setMatrixAt(i, matrix);
    glows.setColorAt(i, scratchColor.setRGB(0, 0, 0));
  });
  glows.frustumCulled = false;
  root.add(glows);

  const pools = new InstancedMesh(
    fanGeometry,
    new MeshBasicMaterial(additiveMaterialParameters({ vertexColors: true, side: DoubleSide })),
    poolTransforms.length,
  );
  poolTransforms.forEach((t, i) => {
    matrix.compose(t.position, t.quaternion, t.scale);
    pools.setMatrixAt(i, matrix);
    pools.setColorAt(i, scratchColor.setRGB(0, 0, 0));
  });
  pools.frustumCulled = false;
  root.add(pools);

  // ---- the rose window ------------------------------------------------------
  const SECTOR_COUNT = 12;
  const sectorMaterials: MeshBasicMaterial[] = [];
  const sectorJewels: Color[] = [];
  const roseGroup = new Group();
  roseGroup.position.copy(ROSE_CENTER);
  const bands: Array<[number, number]> = [[2.9, 5.1], [5.4, 7.5], [7.8, 10.1]];
  for (let s = 0; s < SECTOR_COUNT; s += 1) {
    const jewel = PETAL_JEWELS[s % PETAL_JEWELS.length];
    sectorJewels.push(jewel.clone());
    const material = new MeshBasicMaterial({ color: jewel.clone().multiplyScalar(0.05), side: DoubleSide });
    sectorMaterials.push(material);
    const positions: number[] = [];
    const a0 = (s / SECTOR_COUNT) * Math.PI * 2 + 0.035;
    const a1 = ((s + 1) / SECTOR_COUNT) * Math.PI * 2 - 0.035;
    for (const [r0, r1] of bands) {
      const steps = 3;
      for (let i = 0; i < steps; i += 1) {
        const b0 = a0 + ((a1 - a0) * i) / steps;
        const b1 = a0 + ((a1 - a0) * (i + 1)) / steps;
        const p00 = [Math.cos(b0) * r0, Math.sin(b0) * r0, 0];
        const p10 = [Math.cos(b1) * r0, Math.sin(b1) * r0, 0];
        const p11 = [Math.cos(b1) * r1, Math.sin(b1) * r1, 0];
        const p01 = [Math.cos(b0) * r1, Math.sin(b0) * r1, 0];
        positions.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    roseGroup.add(new Mesh(geometry, material));
  }
  const oculusMaterial = new MeshBasicMaterial({ color: new Color(0x0a0a10), side: DoubleSide });
  roseGroup.add(new Mesh(new CircleGeometry(2.55, 26), oculusMaterial));

  // Rose tracery into the shared line pool (world coordinates).
  for (const radius of [2.7, 5.25, 7.65, 10.25, ROSE_RADIUS + 0.5]) {
    const segments = 40;
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      const b = ((i + 1) / segments) * Math.PI * 2;
      pushLine(
        new Vector3(ROSE_CENTER.x + Math.cos(a) * radius, ROSE_CENTER.y + Math.sin(a) * radius, ROSE_CENTER.z),
        new Vector3(ROSE_CENTER.x + Math.cos(b) * radius, ROSE_CENTER.y + Math.sin(b) * radius, ROSE_CENTER.z),
      );
    }
  }
  for (let s = 0; s < SECTOR_COUNT; s += 1) {
    const a = (s / SECTOR_COUNT) * Math.PI * 2;
    pushLine(
      new Vector3(ROSE_CENTER.x + Math.cos(a) * 2.7, ROSE_CENTER.y + Math.sin(a) * 2.7, ROSE_CENTER.z),
      new Vector3(ROSE_CENTER.x + Math.cos(a) * (ROSE_RADIUS + 0.5), ROSE_CENTER.y + Math.sin(a) * (ROSE_RADIUS + 0.5), ROSE_CENTER.z),
    );
  }

  // Light beams for the ignition — invisible while their colour is black.
  // All twelve rays merge into one mesh; the whole fan rotates as one.
  const beamMaterial = new MeshBasicMaterial(additiveMaterialParameters({ color: 0x000000, side: DoubleSide }));
  const beamGeometry = new PlaneGeometry(0.9, 30);
  const beamGeometries: BufferGeometry[] = [];
  const beamMatrix = new Matrix4();
  for (let i = 0; i < SECTOR_COUNT; i += 1) {
    const angle = (i / SECTOR_COUNT) * Math.PI * 2;
    beamMatrix.compose(
      new Vector3(Math.cos(angle) * 15, Math.sin(angle) * 15, 0.4),
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle - Math.PI / 2),
      new Vector3(1, 1, 1),
    );
    beamGeometries.push(beamGeometry.clone().applyMatrix4(beamMatrix));
  }
  const beams = new Mesh(mergeGeometries(beamGeometries), beamMaterial);
  for (const geometry of beamGeometries) geometry.dispose();
  beamGeometry.dispose();
  roseGroup.add(beams);
  root.add(roseGroup);

  const lineGeometry = new BufferGeometry();
  lineGeometry.setAttribute('position', new Float32BufferAttribute(linePositions, 3));
  const lines = new LineSegments(lineGeometry, new LineBasicMaterial(additiveMaterialParameters({ color: LEAD.clone().multiplyScalar(1.4) })));
  lines.frustumCulled = false;
  root.add(lines);

  // ---- candles --------------------------------------------------------------
  const candleClouds: Points[] = [];
  const candleMaterials: PointsMaterial[] = [];
  for (const phase of [0, 1]) {
    const count = 1100;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const x = (rng() * 2 - 1) * (NAVE_HALF - 0.8);
      const z = FIRST_Z - rng() * (FIRST_Z - LAST_Z);
      positions[i * 3] = x;
      positions[i * 3 + 1] = FLOOR_Y + 0.35 + rng() * 0.25;
      positions[i * 3 + 2] = z;
      const intensity = rng() < 0.05 ? 1.7 : 0.3 + rng() * 0.5;
      const warm = CANDLE.clone().multiplyScalar(intensity);
      colors[i * 3] = warm.r;
      colors[i * 3 + 1] = warm.g;
      colors[i * 3 + 2] = warm.b;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const material = new PointsMaterial(additiveMaterialParameters({
      size: 0.34,
      vertexColors: true,
      sizeAttenuation: true,
    }));
    const cloud = new Points(geometry, material);
    cloud.frustumCulled = false;
    cloud.userData.phase = phase;
    candleClouds.push(cloud);
    candleMaterials.push(material);
    root.add(cloud);
  }

  scene.add(root);

  // ---- runtime state --------------------------------------------------------
  let litCount = 0;
  const cascade: Array<{ index: number; at: number }> = [];
  let beamsOn = false;
  let beamIntensity = 0;

  function writePaneColors(record: WindowRecord, source: number[]) {
    for (let i = 0; i < record.paneCount; i += 1) {
      const paneIndex = record.paneStart + i;
      panes.setColorAt(paneIndex, scratchColor.setRGB(source[paneIndex * 3], source[paneIndex * 3 + 1], source[paneIndex * 3 + 2]));
    }
    if (panes.instanceColor) panes.instanceColor.needsUpdate = true;
  }

  function igniteWindow(index: number) {
    const record = windows[index];
    if (!record || record.lit) return;
    record.lit = true;
    litCount += 1;
    writePaneColors(record, paneLit);
    glows.setColorAt(record.glowIndex, scratchColor.copy(record.jewel).multiplyScalar(0.5));
    if (glows.instanceColor) glows.instanceColor.needsUpdate = true;
    if (record.poolIndex >= 0) {
      pools.setColorAt(record.poolIndex, scratchColor.copy(record.jewel).multiplyScalar(0.28));
      if (pools.instanceColor) pools.instanceColor.needsUpdate = true;
    }
  }

  function reset() {
    litCount = 0;
    cascade.length = 0;
    beamsOn = false;
    beamIntensity = 0;
    beamMaterial.color.setRGB(0, 0, 0);
    for (const record of windows) {
      record.lit = false;
      record.assigned = false;
      writePaneColors(record, paneDark);
      glows.setColorAt(record.glowIndex, scratchColor.setRGB(0, 0, 0));
      if (record.poolIndex >= 0) pools.setColorAt(record.poolIndex, scratchColor.setRGB(0, 0, 0));
    }
    if (glows.instanceColor) glows.instanceColor.needsUpdate = true;
    if (pools.instanceColor) pools.instanceColor.needsUpdate = true;
    sectorMaterials.forEach((material, s) => material.color.copy(sectorJewels[s]).multiplyScalar(0.05));
    oculusMaterial.color.set(0x0a0a10);
  }

  return {
    root,
    roseCenter: ROSE_CENTER.clone(),
    assignWindowNear(position) {
      let best = -1;
      let bestDistance = Infinity;
      for (const record of windows) {
        if (record.lit || record.assigned) continue;
        const distance = record.center.distanceToSquared(position);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = record.index;
        }
      }
      if (best >= 0) windows[best].assigned = true;
      return best;
    },
    windowTarget(index) {
      return windows[index]?.center.clone() ?? ROSE_CENTER.clone();
    },
    windowJewel(index) {
      return windows[index]?.jewel.clone() ?? GOLD.clone();
    },
    igniteWindow,
    roseSectorTarget(petalIndex) {
      const angle = ((petalIndex * 2 + 1) / SECTOR_COUNT) * Math.PI * 2;
      return ROSE_CENTER.clone().add(new Vector3(Math.cos(angle) * 6.4, Math.sin(angle) * 6.4, 0.4));
    },
    ignitePetalSector(petalIndex) {
      for (const s of [petalIndex * 2, petalIndex * 2 + 1]) {
        const material = sectorMaterials[s % SECTOR_COUNT];
        material.color.copy(sectorJewels[s % SECTOR_COUNT]).multiplyScalar(1.5);
      }
    },
    igniteRose(elapsed) {
      sectorMaterials.forEach((material, s) => material.color.copy(sectorJewels[s]).multiplyScalar(1.9));
      oculusMaterial.color.copy(hdr(ROSEWHITE, 2.3));
      beamsOn = true;
      // The light sweeps back down the nave, relighting every window the
      // player could not save — the rose gives it all back.
      for (const record of windows) {
        if (record.lit) continue;
        const distance = Math.abs(record.center.z - ROSE_CENTER.z);
        cascade.push({ index: record.index, at: elapsed + 0.25 + distance * 0.0055 });
      }
      cascade.sort((a, b) => a.at - b.at);
    },
    litFraction() {
      return windows.length === 0 ? 0 : litCount / windows.length;
    },
    reset,
    update(dt, elapsed) {
      while (cascade.length > 0 && cascade[0].at <= elapsed) {
        const next = cascade.shift();
        if (next) igniteWindow(next.index);
      }
      if (beamsOn && beamIntensity < 1) beamIntensity = Math.min(1, beamIntensity + dt * 0.8);
      if (beamsOn) {
        beams.rotation.z += dt * 0.12;
        beamMaterial.color.copy(GOLD).multiplyScalar(0.4 * beamIntensity * (0.85 + Math.sin(elapsed * 2.2) * 0.15));
      }
      candleMaterials.forEach((material, index) => {
        material.opacity = 0.72 + 0.24 * Math.sin(elapsed * (3.4 + index * 0.9) + index * 2.1);
      });
    },
  };
}
