import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Fog,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { EventBus } from '../../../events';
import { colorForLockCount } from '../../../engine/locks';
import { glyphOnCells } from '../../../engine/glyphs';
import { sampleRailFrame } from '../../../engine/rail';
import { scatterAlongRail } from '../../../engine/environment-kit';
import type { ScatterField } from '../../../engine/environment-kit';
import {
  createAdditiveBasicMaterial,
  createPendingVisualRecords,
  disposeObject3D,
} from '../../../engine/visual-kit';
import { createTinkerBall8bf3Rail } from '../gameplay';

// Warm wood and paper carry the scene; the glue cores stay nearly black so
// every target has a clear visual center. The hot colors are reserved for
// locks, lamp filaments, and dismantling effects.
const TABLE = new Color(0.13, 0.045, 0.018);
const TABLE_EDGE = new Color(0.55, 0.19, 0.035);
const WOOD = new Color(0.64, 0.25, 0.06);
const WOOD_LIGHT = new Color(1.0, 0.54, 0.12);
const PAPER = new Color(0.86, 0.66, 0.36);
const CREAM = new Color(1.0, 0.85, 0.55);
const TEAL = new Color(0.06, 0.55, 0.42);
const TURQUOISE = new Color(0.16, 0.95, 0.75);
const CORAL = new Color(0.96, 0.22, 0.12);
const PINK = new Color(1.0, 0.3, 0.46);
const PURPLE = new Color(0.24, 0.045, 0.24);
const GLUE = new Color(0.055, 0.008, 0.045);
const INK = new Color(0.004, 0.003, 0.004);
const GOLD = new Color(1.0, 0.52, 0.08);
const WHITE = new Color(1.0, 0.9, 0.62);
const LOCK_COLORS = [TURQUOISE, PINK, GOLD] as const;

const hdr = (color: Color, intensity: number) => color.clone().multiplyScalar(intensity);

type EnemyRecord = { mesh: Group; bornAt: number; kind: string };
type ProjectileRecord = { mesh: Object3D };
type Pulse = { mesh: Mesh; age: number; life: number; color: Color; size: number };
type DebrisPiece = {
  mesh: Object3D;
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  age: number;
  life: number;
  spin: number;
  adhereAt: number;
  attached: boolean;
};

const enemies = createPendingVisualRecords<Group, EnemyRecord, [number, string]>({
  createRecord: (mesh, bornAt, kind) => ({ mesh, bornAt, kind }),
  disposeRecord: (record) => disposeObject3D(record.mesh),
});
const projectiles = createPendingVisualRecords<Object3D, ProjectileRecord>({
  createRecord: (mesh) => ({ mesh }),
  disposeRecord: (record) => disposeObject3D(record.mesh),
});

let environmentRoot: Group | null = null;
let clutterField: ScatterField | null = null;
let ballRoot: Group | null = null;
let ballBody: Mesh | null = null;
let ballBaseChildren: Object3D[] = [];
let spillPatches: Array<{ group: Group; revealAt: number }> = [];
let lampGlows: MeshBasicMaterial[] = [];
let elapsedNow = 0;
let beatEnergy = 0;
let currentRunProgress = 0;
const pulses: Pulse[] = [];
const debris: DebrisPiece[] = [];

export function createEnvironment(scene: Scene) {
  disposeEnvironment();

  const rail = createTinkerBall8bf3Rail();
  const root = new Group();
  root.userData.raildIgnoreOcclusion = true;
  scene.background = new Color(0.018, 0.006, 0.012);
  scene.fog = new Fog(new Color(0.06, 0.018, 0.012), 24, 155);

  root.add(createTableSurface(rail));
  root.add(createScratchRoad(rail));
  root.add(createDeskLamps(rail));
  clutterField = createClutterField(rail);
  root.add(clutterField.group);

  spillPatches = [
    createSpillPatch(rail, 0.73, 0),
    createSpillPatch(rail, 0.82, 1),
    createSpillPatch(rail, 0.91, 2),
  ];
  for (const patch of spillPatches) root.add(patch.group);
  root.add(createCleanPatch(rail));

  const dust = createDustField(rail);
  root.add(dust);
  scene.add(root);
  environmentRoot = root;

  ballRoot = createBall();
  ballBaseChildren = [...ballRoot.children];
  scene.add(ballRoot);
}

export function disposeEnvironment() {
  clutterField?.dispose();
  clutterField = null;
  clearTransientObjects();
  enemies.clear({ dispose: true, pending: true });
  projectiles.clear({ dispose: true, pending: true });
  ballBaseChildren = [];
  spillPatches = [];
  lampGlows = [];
  if (ballRoot) {
    ballRoot.removeFromParent();
    disposeObject3D(ballRoot);
  }
  ballRoot = null;
  ballBody = null;
  if (environmentRoot) {
    environmentRoot.removeFromParent();
    disposeObject3D(environmentRoot);
  }
  environmentRoot = null;
}

function createTableSurface(rail: ReturnType<typeof createTinkerBall8bf3Rail>) {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];
  const samples = 180;
  for (let i = 0; i <= samples; i += 1) {
    const frame = sampleRailFrame(rail, i / samples);
    const center = frame.position.clone().addScaledVector(frame.up, -3.15);
    const left = center.clone().addScaledVector(frame.right, -17.5);
    const right = center.clone().addScaledVector(frame.right, 17.5);
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    if (i === samples) continue;
    const base = i * 2;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const top = new Mesh(geometry, new MeshBasicMaterial({ color: TABLE, side: DoubleSide }));
  top.frustumCulled = false;

  const edgeGeometry = new BufferGeometry();
  const edgePositions: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const frameA = sampleRailFrame(rail, i / samples);
    const frameB = sampleRailFrame(rail, (i + 1) / samples);
    for (const side of [-17.5, 17.5]) {
      const a = frameA.position.clone().addScaledVector(frameA.up, -3.04).addScaledVector(frameA.right, side);
      const b = frameB.position.clone().addScaledVector(frameB.up, -3.04).addScaledVector(frameB.right, side);
      edgePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  edgeGeometry.setAttribute('position', new Float32BufferAttribute(edgePositions, 3));
  const edge = new LineSegments(edgeGeometry, new LineBasicMaterial({
    color: hdr(TABLE_EDGE, 1.05),
    transparent: true,
    opacity: 0.75,
    blending: AdditiveBlending,
    depthWrite: false,
  }));
  edge.frustumCulled = false;

  const group = new Group();
  group.add(top, edge);
  return group;
}

function createScratchRoad(rail: ReturnType<typeof createTinkerBall8bf3Rail>) {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const colors: number[] = [];
  const samples = 150;
  for (let i = 0; i < samples; i += 1) {
    const u0 = i / samples;
    const u1 = Math.min(1, (i + 0.58) / samples);
    const frameA = sampleRailFrame(rail, u0);
    const frameB = sampleRailFrame(rail, u1);
    const offsets = [
      Math.sin(i * 2.7) * 3.4,
      -11.8 + Math.sin(i * 0.9) * 1.3,
      11.4 + Math.cos(i * 1.1) * 1.4,
    ];
    for (const offset of offsets) {
      const a = frameA.position.clone().addScaledVector(frameA.up, -3.0).addScaledVector(frameA.right, offset);
      const b = frameB.position.clone().addScaledVector(frameB.up, -3.0).addScaledVector(frameB.right, offset + Math.sin(i * 1.3) * 0.18);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const tint = i % 7 === 0 ? WOOD_LIGHT : TABLE_EDGE;
      const intensity = i % 7 === 0 ? 0.54 : 0.2;
      colors.push(tint.r * intensity, tint.g * intensity, tint.b * intensity, tint.r * intensity, tint.g * intensity, tint.b * intensity);
    }
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const lines = new LineSegments(geometry, new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  }));
  lines.frustumCulled = false;
  return lines;
}

function createDeskLamps(rail: ReturnType<typeof createTinkerBall8bf3Rail>) {
  const group = new Group();
  const positions = [
    { u: 0.1, side: -11, hue: GOLD },
    { u: 0.46, side: 12, hue: CORAL },
    { u: 0.78, side: -12, hue: GOLD },
  ];
  lampGlows = [];
  for (const [index, spec] of positions.entries()) {
    const frame = sampleRailFrame(rail, spec.u);
    const lamp = new Group();
    lamp.position.copy(frame.position).addScaledVector(frame.right, spec.side).addScaledVector(frame.up, 6.5);
    const shade = new Mesh(new ConeGeometry(1.65 - index * 0.12, 1.55, 12, 1, true), new MeshBasicMaterial({ color: spec.hue.clone().multiplyScalar(0.55), side: DoubleSide }));
    shade.position.y = -0.72;
    const rim = new Mesh(new TorusGeometry(1.18 - index * 0.08, 0.06, 6, 28), createAdditiveBasicMaterial({ color: hdr(spec.hue, 1.3), side: DoubleSide }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -1.42;
    const filamentMaterial = createAdditiveBasicMaterial({ color: hdr(WHITE, 2.1) });
    const filament = new Mesh(new SphereGeometry(0.24, 10, 8), filamentMaterial);
    filament.position.y = -1.34;
    lampGlows.push(filamentMaterial);
    const stem = new Mesh(new CylinderGeometry(0.08, 0.08, 4.8, 6), new MeshBasicMaterial({ color: WOOD.clone().multiplyScalar(0.9) }));
    stem.position.y = 1.2;
    lamp.add(shade, rim, filament, stem);
    lamp.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(frame.right, frame.up, frame.tangent));
    group.add(lamp);

    const pool = new Mesh(new CircleGeometry(4.6, 40), new MeshBasicMaterial({
      color: spec.hue.clone().multiplyScalar(0.12),
      transparent: true,
      opacity: 0.3,
      side: DoubleSide,
      depthWrite: false,
    }));
    pool.position.copy(frame.position).addScaledVector(frame.right, spec.side * 0.45).addScaledVector(frame.up, -2.98);
    pool.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(frame.right, frame.tangent, frame.up));
    pool.scale.set(1.3, 0.68, 1);
    group.add(pool);
  }
  return group;
}

function createClutterField(rail: ReturnType<typeof createTinkerBall8bf3Rail>) {
  const count = 104;
  return scatterAlongRail(rail, {
    count,
    seed: 24081996,
    window: { behind: 36, ahead: 650 },
    place(index, rng) {
      const u = 0.015 + (index / (count - 1)) * 0.97;
      const lane = ((index * 37) % 100) / 100;
      const offsetX = (lane - 0.5) * 30 + Math.sin(index * 1.7) * 1.6;
      return {
        u,
        offset: new Vector3(offsetX, -2.76 + (rng() - 0.5) * 0.12, (rng() - 0.5) * 1.7),
      };
    },
    make(index, rng) {
      return createClutterItem(index, rng);
    },
    onUpdate(item, dt) {
      if (item.index % 9 === 0) item.object.rotation.z += dt * 0.018;
    },
  });
}

function createClutterItem(index: number, rng: () => number) {
  switch (index % 8) {
    case 0:
      return createButton(0.42 + rng() * 0.24, [TEAL, CORAL, GOLD][index % 3]);
    case 1:
      return createSafetyPin(1.6 + rng() * 0.7);
    case 2:
      return createBead(0.2 + rng() * 0.13, [PINK, TURQUOISE, CREAM][index % 3]);
    case 3:
      return createPaperclip(0.48 + rng() * 0.18);
    case 4:
      return createPencil(2.1 + rng() * 1.2, index % 2 === 0 ? GOLD : CORAL);
    case 5:
      return createSpoolProp(0.42 + rng() * 0.16, index % 2 === 0 ? WOOD : PINK);
    case 6:
      return createEraser(0.72 + rng() * 0.25);
    default:
      return createWoodBlock(0.8 + rng() * 0.35, index % 2 === 0 ? PAPER : WOOD_LIGHT);
  }
}

function createButton(radius: number, color: Color) {
  const group = new Group();
  const disc = new Mesh(new CylinderGeometry(radius, radius * 0.94, 0.18, 14), new MeshBasicMaterial({ color: color.clone().multiplyScalar(0.72) }));
  disc.rotation.x = Math.PI / 2;
  const rim = new Mesh(new TorusGeometry(radius * 0.78, 0.045, 5, 18), new MeshBasicMaterial({ color: hdr(color, 1.15) }));
  rim.rotation.x = Math.PI / 2;
  const hole = new Mesh(new TorusGeometry(radius * 0.19, 0.035, 5, 12), new MeshBasicMaterial({ color: INK }));
  hole.rotation.x = Math.PI / 2;
  group.add(disc, rim, hole);
  group.rotation.z = radius * 3.1;
  return group;
}

function createSafetyPin(length: number) {
  const group = new Group();
  const pin = new Mesh(new CylinderGeometry(0.045, 0.045, length, 6), new MeshBasicMaterial({ color: CREAM }));
  pin.rotation.z = Math.PI / 2;
  const head = new Mesh(new TorusGeometry(0.25, 0.045, 5, 14, Math.PI * 1.7), new MeshBasicMaterial({ color: CREAM }));
  head.rotation.x = Math.PI / 2;
  head.position.x = -length * 0.36;
  const point = new Mesh(new ConeGeometry(0.07, 0.35, 5), new MeshBasicMaterial({ color: CREAM }));
  point.rotation.z = -Math.PI / 2;
  point.position.x = length * 0.54;
  group.add(pin, head, point);
  group.rotation.z = 0.3;
  return group;
}

function createBead(radius: number, color: Color) {
  const bead = new Mesh(new SphereGeometry(radius, 10, 8), new MeshBasicMaterial({ color: color.clone().multiplyScalar(0.92) }));
  bead.position.z = 0.05;
  return bead;
}

function createPaperclip(radius: number) {
  const group = new Group();
  const outer = new Mesh(new TorusGeometry(radius, 0.055, 5, 24, Math.PI * 1.8), new MeshBasicMaterial({ color: GOLD }));
  outer.rotation.x = Math.PI / 2;
  const inner = new Mesh(new TorusGeometry(radius * 0.64, 0.04, 5, 22, Math.PI * 1.7), new MeshBasicMaterial({ color: CREAM }));
  inner.rotation.x = Math.PI / 2;
  inner.position.x = 0.12;
  group.add(outer, inner);
  group.rotation.z = -0.38;
  return group;
}

function createPencil(length: number, color: Color) {
  const group = new Group();
  const shaft = new Mesh(new BoxGeometry(length, 0.16, 0.16), new MeshBasicMaterial({ color: color.clone().multiplyScalar(0.8) }));
  const eraser = new Mesh(new BoxGeometry(0.25, 0.2, 0.2), new MeshBasicMaterial({ color: PINK }));
  eraser.position.x = -length / 2 - 0.07;
  const tip = new Mesh(new ConeGeometry(0.14, 0.34, 5), new MeshBasicMaterial({ color: WOOD_LIGHT }));
  tip.rotation.z = -Math.PI / 2;
  tip.position.x = length / 2 + 0.17;
  group.add(shaft, eraser, tip);
  group.rotation.z = 0.23;
  return group;
}

function createSpoolProp(radius: number, color: Color) {
  const group = new Group();
  const core = new Mesh(new CylinderGeometry(radius * 0.46, radius * 0.46, radius * 1.25, 10), new MeshBasicMaterial({ color: color.clone().multiplyScalar(0.82) }));
  core.rotation.x = Math.PI / 2;
  const top = new Mesh(new CylinderGeometry(radius, radius * 0.92, 0.14, 12), new MeshBasicMaterial({ color: hdr(color, 1.05) }));
  top.rotation.x = Math.PI / 2;
  top.position.z = radius * 0.66;
  const bottom = top.clone();
  bottom.position.z = -radius * 0.66;
  group.add(core, top, bottom);
  group.rotation.z = 0.5;
  return group;
}

function createEraser(size: number) {
  const group = new Group();
  const body = new Mesh(new BoxGeometry(size, size * 0.44, size * 0.62), new MeshBasicMaterial({ color: PINK.clone().multiplyScalar(0.86) }));
  const band = new Mesh(new BoxGeometry(size * 0.18, size * 0.47, size * 0.65), new MeshBasicMaterial({ color: CREAM }));
  band.position.x = -size * 0.16;
  group.add(body, band);
  group.rotation.z = -0.35;
  return group;
}

function createWoodBlock(size: number, color: Color) {
  const group = new Group();
  const body = new Mesh(new BoxGeometry(size, size * 0.76, size * 0.8), new MeshBasicMaterial({ color: color.clone().multiplyScalar(0.72) }));
  const edge = new LineSegments(new EdgesGeometry(body.geometry), new LineBasicMaterial({ color: hdr(WOOD_LIGHT, 0.7), transparent: true, opacity: 0.55 }));
  group.add(body, edge);
  group.rotation.z = 0.18;
  return group;
}

function createDustField(rail: ReturnType<typeof createTinkerBall8bf3Rail>) {
  const count = 420;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const u = (index * 73 % 1000) / 999;
    const frame = sampleRailFrame(rail, u);
    const radius = 18 + (index * 31 % 180) / 10;
    const angle = index * 2.399963;
    const point = frame.position.clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius * 0.35)
      .addScaledVector(frame.tangent, ((index * 17) % 18) - 9);
    positions.set([point.x, point.y, point.z], index * 3);
    const color = index % 5 === 0 ? GOLD : index % 3 === 0 ? PINK : PAPER;
    const intensity = index % 11 === 0 ? 0.5 : 0.13;
    colors.set([color.r * intensity, color.g * intensity, color.b * intensity], index * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const points = new Points(geometry, new PointsMaterial({ size: 0.3, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  points.frustumCulled = false;
  return points;
}

function createSpillPatch(rail: ReturnType<typeof createTinkerBall8bf3Rail>, u: number, index: number) {
  const frame = sampleRailFrame(rail, u);
  const group = new Group();
  group.position.copy(frame.position).addScaledVector(frame.up, -2.82);
  group.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(frame.right, frame.up, frame.tangent));
  group.userData.raildIgnoreOcclusion = true;

  const puddle = new Mesh(new SphereGeometry(1, 28, 12), new MeshBasicMaterial({ color: PURPLE.clone().multiplyScalar(0.72), transparent: true, opacity: 0.92 }));
  puddle.scale.set(10.5 - index * 0.5, 0.3, 6.2 + index * 0.6);
  const edge = new Mesh(new TorusGeometry(1, 0.06, 6, 50), createAdditiveBasicMaterial({ color: hdr(index === 1 ? PINK : GOLD, 0.95), side: DoubleSide }));
  edge.rotation.x = Math.PI / 2;
  edge.scale.set(8.3, 4.1, 1);
  const goo = new Mesh(new SphereGeometry(1, 16, 10), new MeshBasicMaterial({ color: GLUE.clone().multiplyScalar(1.6) }));
  goo.scale.set(2.8, 0.55, 2.1);
  goo.position.set(index % 2 === 0 ? -2.8 : 3.2, 0.1, 0.6);

  const scraps = new Group();
  const barA = new Mesh(new BoxGeometry(0.25, 0.25, 7.8), new MeshBasicMaterial({ color: WOOD_LIGHT.clone().multiplyScalar(0.58) }));
  barA.position.set(-3.7, 0.4, -0.4);
  barA.rotation.y = 0.36;
  const barB = new Mesh(new BoxGeometry(0.22, 0.22, 6.2), new MeshBasicMaterial({ color: PAPER.clone().multiplyScalar(0.78) }));
  barB.position.set(3.4, 0.52, 0.8);
  barB.rotation.y = -0.62;
  const cardboard = new Mesh(new BoxGeometry(5.8, 0.18, 2.8), new MeshBasicMaterial({ color: PAPER.clone().multiplyScalar(0.5) }));
  cardboard.position.set(0, 0.28, -1.1);
  cardboard.rotation.y = 0.22;
  scraps.add(barA, barB, cardboard);
  group.add(puddle, edge, goo, scraps);
  return { group, revealAt: 0.66 + index * 0.09 };
}

function createCleanPatch(rail: ReturnType<typeof createTinkerBall8bf3Rail>) {
  const frame = sampleRailFrame(rail, 0.982);
  const group = new Group();
  group.position.copy(frame.position).addScaledVector(frame.up, -2.91);
  group.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(frame.right, frame.up, frame.tangent));
  group.userData.raildIgnoreOcclusion = true;
  const patch = new Mesh(new BoxGeometry(20, 0.08, 17), new MeshBasicMaterial({ color: WOOD.clone().multiplyScalar(0.7) }));
  const shine = new Mesh(new PlaneGeometry(11, 0.04), createAdditiveBasicMaterial({ color: hdr(CREAM, 0.42), side: DoubleSide }));
  shine.rotation.x = Math.PI / 2;
  shine.position.y = 0.07;
  group.add(patch, shine);
  return group;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' ? createLetterMesh(letter ?? '?') : createEnemy(kind);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemies.enqueue(mesh);
  return mesh;
}

function createEnemy(kind: string) {
  switch (kind) {
    case 'beetle':
      return createGlueBeetle();
    case 'stilt':
      return createGlueStilt();
    case 'bird':
      return createGlueBird();
    case 'spool':
      return createGlueSpool();
    case 'core':
      return createGlueCore();
    default:
      return createGlueBeetle();
  }
}

function coreMesh(radius = 0.34) {
  const core = new Mesh(new IcosahedronGeometry(radius, 1), new MeshBasicMaterial({ color: INK }));
  core.position.z = 0.3;
  const halo = new Mesh(new TorusGeometry(radius * 1.45, 0.035, 6, 24), createAdditiveBasicMaterial({ color: hdr(GOLD, 1.5), side: DoubleSide }));
  halo.rotation.x = Math.PI / 2;
  halo.position.z = 0.28;
  return { core, halo };
}

function finishEnemy(group: Group, glowMaterials: MeshBasicMaterial[], scale: number, animation: string) {
  for (const material of glowMaterials) material.userData.baseColor = material.color.clone();
  group.userData.lockMaterials = glowMaterials;
  group.userData.visualScale = scale;
  group.userData.animation = animation;
  group.userData.accent = glowMaterials[0]?.color.clone() ?? GOLD.clone();
  return group;
}

function createGlueBeetle() {
  const group = new Group();
  const bodyMaterial = new MeshBasicMaterial({ color: TEAL.clone().multiplyScalar(0.64) });
  const legMaterial = new MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(0.82) });
  const glow = createAdditiveBasicMaterial({ color: hdr(TURQUOISE, 1.15) });
  const body = new Mesh(new CylinderGeometry(0.8, 0.9, 0.32, 14), bodyMaterial);
  body.rotation.x = Math.PI / 2;
  const rim = new Mesh(new TorusGeometry(0.78, 0.07, 6, 24), glow);
  rim.rotation.x = Math.PI / 2;
  const { core, halo } = coreMesh(0.28);
  const legs: Mesh[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      const leg = new Mesh(new BoxGeometry(0.95, 0.1, 0.12), legMaterial);
      leg.position.set(side * (0.62 + i * 0.05), (i - 1) * 0.34, 0.04);
      leg.rotation.z = side * (0.25 + i * 0.12);
      legs.push(leg);
      group.add(leg);
    }
  }
  const feelers = new Mesh(new TorusGeometry(0.32, 0.04, 5, 18, Math.PI * 0.8), new MeshBasicMaterial({ color: CORAL }));
  feelers.rotation.x = Math.PI / 2;
  feelers.position.set(0, 0.64, 0.06);
  group.add(body, rim, core, halo, feelers);
  group.userData.animatedParts = legs;
  return finishEnemy(group, [glow], 0.92, 'beetle');
}

function createGlueStilt() {
  const group = new Group();
  const rulerMaterial = new MeshBasicMaterial({ color: WOOD_LIGHT.clone().multiplyScalar(0.7) });
  const tickMaterial = new MeshBasicMaterial({ color: CORAL.clone().multiplyScalar(0.8) });
  const bodyMaterial = new MeshBasicMaterial({ color: PAPER.clone().multiplyScalar(0.75) });
  const glow = createAdditiveBasicMaterial({ color: hdr(GOLD, 1.35) });
  const body = new Mesh(new CylinderGeometry(0.65, 0.52, 0.42, 10), bodyMaterial);
  body.rotation.x = Math.PI / 2;
  const { core, halo } = coreMesh(0.25);
  halo.material = glow;
  const legs: Mesh[] = [];
  for (const x of [-0.56, 0.56]) {
    const leg = new Mesh(new BoxGeometry(0.2, 2.8, 0.18), rulerMaterial);
    leg.position.set(x, -1.0, 0.02);
    legs.push(leg);
    group.add(leg);
    for (let i = -1; i <= 2; i += 1) {
      const tick = new Mesh(new BoxGeometry(i % 2 === 0 ? 0.34 : 0.22, 0.055, 0.2), tickMaterial);
      tick.position.set(x + (i % 2 === 0 ? 0.06 : -0.04), -1.0 + i * 0.45, 0.13);
      group.add(tick);
    }
  }
  const top = new Mesh(new BoxGeometry(1.7, 0.3, 0.18), new MeshBasicMaterial({ color: CORAL.clone().multiplyScalar(0.75) }));
  top.position.y = 0.86;
  top.rotation.z = 0.12;
  group.add(body, core, halo, top);
  group.userData.animatedParts = legs;
  return finishEnemy(group, [glow], 0.98, 'stilt');
}

function createGlueBird() {
  const group = new Group();
  const bodyMaterial = new MeshBasicMaterial({ color: PAPER.clone().multiplyScalar(0.7) });
  const clothMaterial = new MeshBasicMaterial({ color: CORAL.clone().multiplyScalar(0.8) });
  const glow = createAdditiveBasicMaterial({ color: hdr(PINK, 1.25) });
  const body = new Mesh(new BoxGeometry(1.42, 0.56, 0.4), bodyMaterial);
  body.position.z = 0.05;
  const jawTop = new Mesh(new BoxGeometry(0.7, 0.18, 0.34), clothMaterial);
  jawTop.position.set(0.72, 0.24, 0.04);
  jawTop.rotation.z = -0.18;
  const jawBottom = jawTop.clone();
  jawBottom.position.y = -0.24;
  jawBottom.rotation.z = 0.18;
  const { core, halo } = coreMesh(0.24);
  halo.material = glow;
  const wings: Mesh[] = [];
  for (const side of [-1, 1]) {
    const wing = new Mesh(new TetrahedronGeometry(0.76, 0), clothMaterial.clone());
    wing.scale.set(1.0, 0.68, 0.18);
    wing.position.set(side * 0.58, 0.48, -0.02);
    wing.rotation.z = side * 0.45;
    wings.push(wing);
    group.add(wing);
  }
  const tail = new Mesh(new ConeGeometry(0.34, 0.9, 4), new MeshBasicMaterial({ color: GOLD }));
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -0.9;
  group.add(body, jawTop, jawBottom, core, halo, tail);
  group.userData.animatedParts = wings;
  group.userData.jaws = [jawTop, jawBottom];
  return finishEnemy(group, [glow], 0.96, 'bird');
}

function createGlueSpool() {
  const group = new Group();
  const woodMaterial = new MeshBasicMaterial({ color: WOOD.clone().multiplyScalar(0.72) });
  const threadMaterial = createAdditiveBasicMaterial({ color: hdr(PINK, 1.0) });
  const { core, halo } = coreMesh(0.3);
  halo.material = threadMaterial;
  const barrel = new Mesh(new CylinderGeometry(0.62, 0.62, 0.72, 12), woodMaterial);
  barrel.rotation.x = Math.PI / 2;
  const top = new Mesh(new CylinderGeometry(0.9, 0.82, 0.16, 12), new MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(0.75) }));
  top.rotation.x = Math.PI / 2;
  top.position.z = 0.44;
  const bottom = top.clone();
  bottom.position.z = -0.44;
  const thread = new Mesh(new TorusGeometry(0.72, 0.12, 7, 24), threadMaterial);
  thread.rotation.x = Math.PI / 2;
  thread.position.z = 0.16;
  group.add(barrel, top, bottom, thread, core, halo);
  group.userData.animatedParts = [thread];
  return finishEnemy(group, [threadMaterial], 1.0, 'spool');
}

function createGlueCore() {
  const group = new Group();
  const shell = new Mesh(new IcosahedronGeometry(1.12, 1), new MeshBasicMaterial({ color: PURPLE.clone().multiplyScalar(0.9) }));
  shell.scale.set(1.22, 0.92, 0.62);
  const shellEdge = new LineSegments(new EdgesGeometry(shell.geometry), new LineBasicMaterial({ color: hdr(PINK, 0.75), transparent: true, opacity: 0.78 }));
  shellEdge.scale.copy(shell.scale);
  const core = new Mesh(new OctahedronGeometry(0.5, 1), new MeshBasicMaterial({ color: INK }));
  core.position.z = 0.52;
  const glow = createAdditiveBasicMaterial({ color: hdr(GOLD, 1.55) });
  const halo = new Mesh(new TorusGeometry(0.78, 0.06, 7, 32), glow);
  halo.rotation.x = Math.PI / 2;
  halo.position.z = 0.5;
  const plate = new Mesh(new CylinderGeometry(1.26, 1.26, 0.12, 8), new MeshBasicMaterial({ color: PAPER.clone().multiplyScalar(0.58) }));
  plate.rotation.x = Math.PI / 2;
  plate.position.z = -0.18;
  const bars = new Group();
  const barMaterial = new MeshBasicMaterial({ color: WOOD_LIGHT.clone().multiplyScalar(0.64) });
  for (const rotation of [0.35, -0.8]) {
    const bar = new Mesh(new BoxGeometry(0.18, 2.9, 0.18), barMaterial);
    bar.rotation.z = rotation;
    bar.position.z = 0.18;
    bars.add(bar);
  }
  group.add(shell, shellEdge, plate, bars, core, halo);
  group.userData.shell = shell;
  group.userData.shellEdge = shellEdge;
  group.userData.animatedParts = [halo, bars];
  return finishEnemy(group, [glow], 1.12, 'core');
}

function createLetterMesh(character: string) {
  const group = new Group();
  const fillMaterial = new MeshBasicMaterial({ color: INK.clone().multiplyScalar(3.2) });
  const edgeMaterial = createAdditiveBasicMaterial({ color: hdr(GOLD, 1.65), side: DoubleSide });
  const cellGeometry = new BoxGeometry(0.34, 0.34, 0.12);
  for (const cell of glyphOnCells(character)) {
    const block = new Mesh(cellGeometry, fillMaterial);
    block.position.set((cell.x - 2) * 0.36, (3 - cell.y) * 0.36, 0);
    const edge = new LineSegments(new EdgesGeometry(cellGeometry), edgeMaterial);
    edge.position.copy(block.position);
    group.add(block, edge);
  }
  const bracket = new Mesh(new TorusGeometry(1.05, 0.035, 6, 28), edgeMaterial);
  bracket.rotation.z = Math.PI / 4;
  group.add(bracket);
  group.userData.isLetter = true;
  group.userData.letterMaterial = edgeMaterial;
  group.userData.lockMaterials = [edgeMaterial];
  group.userData.visualScale = 1.05;
  group.userData.accent = GOLD.clone();
  return group;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  mesh.userData.locked = locked;
  const materials = mesh.userData.lockMaterials as MeshBasicMaterial[] | undefined;
  const color = locked ? colorForLockCount(lockCount, LOCK_COLORS) : undefined;
  for (const material of materials ?? []) {
    const base = material.userData.baseColor as Color | undefined;
    material.color.copy(color ? hdr(color, 1.7) : (base ?? GOLD));
  }
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.48;
  const materials = mesh.userData.lockMaterials as MeshBasicMaterial[] | undefined;
  for (const material of materials ?? []) material.color.copy(hdr(CORAL, 1.8));
}

export function createProjectileMesh() {
  const group = new Group();
  const bead = new Mesh(new OctahedronGeometry(0.2, 0), createAdditiveBasicMaterial({ color: hdr(TURQUOISE, 2.5) }));
  bead.scale.set(0.72, 0.72, 2.6);
  const smear = new Mesh(new TorusGeometry(0.38, 0.035, 5, 20), createAdditiveBasicMaterial({ color: hdr(WHITE, 1.4), side: DoubleSide }));
  group.add(bead, smear);
  projectiles.enqueue(group);
  return group;
}

export function createReticle() {
  const group = new Group();
  const outer = new Mesh(new RingGeometry(0.86, 0.91, 24), createAdditiveBasicMaterial({ color: hdr(GOLD, 1.45), side: DoubleSide }));
  const inner = new Mesh(new RingGeometry(0.6, 0.64, 12), createAdditiveBasicMaterial({ color: hdr(TURQUOISE, 1.35), side: DoubleSide }));
  const tick = new Mesh(new BoxGeometry(0.08, 0.44, 0.025), createAdditiveBasicMaterial({ color: hdr(WHITE, 1.35) }));
  const tickB = tick.clone();
  tickB.rotation.z = Math.PI / 2;
  group.add(outer, inner, tick, tickB);
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.065 + (active ? 0.08 : 0));
  reticle.rotation.z += active ? 0.012 : 0.004;
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, worldPosition, kind }) => {
    enemies.claim(enemyId, elapsedNow, kind);
    pulse(scene, worldPosition, kind === 'core' ? GOLD : PAPER, kind === 'core' ? 3.2 : 1.45, 0.32);
  });
  bus.on('lock', ({ worldPosition, lockCount }) => {
    pulse(scene, worldPosition, colorForLockCount(lockCount, LOCK_COLORS), 1.35 + lockCount * 0.22, 0.22);
  });
  bus.on('unlock', ({ worldPosition }) => {
    pulse(scene, worldPosition, PAPER, 0.9, 0.16);
  });
  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectiles.claim(projectileId);
    pulse(scene, worldPosition, TURQUOISE, 1.1, 0.16);
  });
  bus.on('hit', ({ projectileId, worldPosition, lethal }) => {
    projectiles.delete(projectileId, { dispose: true });
    pulse(scene, worldPosition, lethal ? GOLD : CORAL, lethal ? 3.0 : 1.8, lethal ? 0.4 : 0.24);
  });
  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    if (record) {
      record.mesh.userData.cracked = true;
      pulse(scene, worldPosition, PINK, 2.7, 0.35);
      spawnDismantleDebris(scene, record.kind, worldPosition, 3, false);
    }
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    if (record) {
      spawnDismantleDebris(scene, record.kind, worldPosition, record.kind === 'core' ? 9 : 5, true);
      enemies.delete(enemyId, { dispose: true });
    }
    pulse(scene, worldPosition, GOLD, 4.8, 0.55);
    pulse(scene, worldPosition, TURQUOISE, 2.4, 0.32);
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    enemies.delete(enemyId, { dispose: true });
    pulse(scene, worldPosition, CORAL, 1.7, 0.26);
  });
  bus.on('reject', ({ enemyIds, missingEnemyIds }) => {
    const ids = new Set([...enemyIds, ...(missingEnemyIds ?? [])]);
    for (const enemyId of ids) {
      const record = enemies.get(enemyId);
      if (!record) continue;
      pulse(scene, record.mesh.position, CORAL, 2.2, 0.3);
      pulse(scene, record.mesh.position, PAPER, 1.0, 0.16);
    }
  });
  bus.on('volley', ({ size, kills }) => {
    if (kills >= 2) pulse(scene, ballRoot?.position ?? new Vector3(), size === 6 ? GOLD : TURQUOISE, 1.5 + size * 0.35, 0.32);
  });
  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.45;
  });
  bus.on('runstart', () => {
    enemies.clear({ dispose: true, pending: true });
    projectiles.clear({ dispose: true, pending: true });
    resetBallAttachments();
    clearTransientObjects();
  });
}

function pulse(scene: Scene, position: Vector3, color: Color, size: number, life: number) {
  const mesh = new Mesh(new RingGeometry(0.94, 1, 32), createAdditiveBasicMaterial({ color: hdr(color, 1.5), side: DoubleSide }));
  mesh.position.copy(position);
  mesh.userData.raildIgnoreOcclusion = true;
  scene.add(mesh);
  pulses.push({ mesh, age: 0, life, color: color.clone(), size });
}

function spawnDismantleDebris(scene: Scene, kind: string, position: Vector3, count: number, adhere: boolean) {
  for (let index = 0; index < count; index += 1) {
    const mesh = createDebrisMesh(kind, index);
    const angle = index * 2.399963 + elapsedNow * 0.2;
    const direction = new Vector3(Math.cos(angle), 0.45 + (index % 3) * 0.24, Math.sin(angle)).normalize();
    const start = position.clone().addScaledVector(direction, 0.2 + (index % 2) * 0.22);
    mesh.position.copy(start);
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    debris.push({
      mesh,
      position: start,
      velocity: direction.multiplyScalar(3.3 + (index % 4) * 1.4),
      axis: new Vector3(Math.sin(index + 1), 1, Math.cos(index * 0.7)).normalize(),
      age: 0,
      life: adhere && index === 0 ? 4.3 : 2.6 + (index % 3) * 0.65,
      spin: 2.5 + (index % 5) * 1.4,
      adhereAt: adhere && index < 2 ? elapsedNow + 0.42 + index * 0.1 : Infinity,
      attached: false,
    });
  }
}

function createDebrisMesh(kind: string, index: number) {
  if (kind === 'beetle') return createButton(0.2 + (index % 2) * 0.07, index % 2 ? CORAL : TEAL);
  if (kind === 'stilt') return createPencil(0.8 + (index % 3) * 0.22, index % 2 ? GOLD : WOOD_LIGHT);
  if (kind === 'bird') return createWoodBlock(0.38 + (index % 2) * 0.1, index % 2 ? CORAL : PAPER);
  if (kind === 'spool') return createSpoolProp(0.22 + (index % 2) * 0.08, index % 2 ? PINK : WOOD);
  return createWoodBlock(0.5 + (index % 2) * 0.15, index % 2 ? GOLD : PAPER);
}

function createBall() {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;
  const geometry = new IcosahedronGeometry(1, 2);
  ballBody = new Mesh(geometry, new MeshBasicMaterial({ color: CREAM.clone().multiplyScalar(0.46) }));
  const edge = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color: hdr(WOOD_LIGHT, 1.0), transparent: true, opacity: 0.8 }));
  const seam = new Mesh(new TorusGeometry(0.88, 0.035, 5, 30), createAdditiveBasicMaterial({ color: hdr(CORAL, 0.8), side: DoubleSide }));
  seam.rotation.x = Math.PI / 2;
  const marker = new Mesh(new SphereGeometry(0.12, 8, 6), createAdditiveBasicMaterial({ color: hdr(TURQUOISE, 1.6) }));
  marker.position.set(0.45, 0.34, 0.78);
  group.add(ballBody, edge, seam, marker);
  group.visible = true;
  return group;
}

export function updateVisuals(dt: number, context: { scene: Scene; camera: Camera; elapsed: number; runProgress?: number }) {
  elapsedNow = context.elapsed;
  currentRunProgress = context.runProgress ?? 0;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.2);

  if (environmentRoot) {
    environmentRoot.rotation.z = Math.sin(context.elapsed * 0.16) * 0.012;
    const lampIntensity = 1.6 + beatEnergy * 1.1;
    for (const material of lampGlows) material.color.copy(hdr(WHITE, lampIntensity));
  }
  for (const patch of spillPatches) {
    patch.group.visible = currentRunProgress >= patch.revealAt;
    if (patch.group.visible) patch.group.scale.setScalar(1 + beatEnergy * 0.018);
  }
  clutterField?.update(currentRunProgress, dt);

  updateBall(context.camera, dt);
  updateEnemyRecords(dt, context.camera);
  updatePulses(dt, context.camera);
  updateDebris(dt, context.scene, context.camera);
}

function updateBall(camera: Camera, dt: number) {
  if (!ballRoot || !ballBody) return;
  const forward = camera.getWorldDirection(new Vector3());
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  ballRoot.position.copy(camera.position)
    .addScaledVector(forward, 5.4)
    .addScaledVector(up, -2.65)
    .addScaledVector(right, -0.15);
  ballRoot.quaternion.copy(camera.quaternion);
  const size = 0.38 + currentRunProgress * 1.42;
  ballRoot.scale.setScalar(size);
  ballRoot.rotateX(-dt * (2.5 + currentRunProgress * 7.2));
  ballRoot.rotateZ(Math.sin(elapsedNow * 0.8) * dt * 0.35);
  (ballBody.material as MeshBasicMaterial).color.copy(CREAM.clone().multiplyScalar(0.44 + currentRunProgress * 0.12));
}

function updateEnemyRecords(dt: number, camera: Camera) {
  for (const record of enemies.values()) {
    const age = Math.max(0, elapsedNow - record.bornAt);
    const intro = Math.min(1, age / (record.kind === 'core' ? 0.45 : 0.25));
    const smoothIntro = intro * intro * (3 - 2 * intro);
    const denied = Number(record.mesh.userData.deniedUntil ?? -Infinity) > elapsedNow;
    const locked = record.mesh.userData.locked === true;
    const baseScale = Number(record.mesh.userData.visualScale ?? 1);
    const pulseScale = (locked ? 1 + Math.sin(elapsedNow * 13) * 0.065 : 1) * (denied ? 1 + Math.sin(elapsedNow * 45) * 0.1 : 1);
    record.mesh.scale.setScalar(Math.max(0.001, smoothIntro * baseScale * pulseScale));
    animateEnemy(record.mesh, record.kind, dt, camera);

    const materials = record.mesh.userData.lockMaterials as MeshBasicMaterial[] | undefined;
    if (denied) {
      for (const material of materials ?? []) material.color.copy(hdr(CORAL, 1.7));
    } else if (!locked) {
      for (const material of materials ?? []) {
        const base = material.userData.baseColor as Color | undefined;
        if (base) material.color.copy(base);
      }
    }
  }
}

function animateEnemy(mesh: Group, kind: string, dt: number, camera: Camera) {
  const parts = mesh.userData.animatedParts as Object3D[] | undefined;
  if (kind === 'beetle') {
    for (const [index, part] of (parts ?? []).entries()) part.rotation.z += dt * (index % 2 ? -2.3 : 2.3);
  } else if (kind === 'stilt') {
    for (const [index, part] of (parts ?? []).entries()) part.rotation.z = Math.sin(elapsedNow * 3.5 + index) * 0.16;
  } else if (kind === 'bird') {
    for (const [index, part] of (parts ?? []).entries()) part.rotation.z = (index === 0 ? 1 : -1) * (0.35 + Math.sin(elapsedNow * 12) * 0.23);
    const jaws = mesh.userData.jaws as Object3D[] | undefined;
    if (jaws) {
      jaws[0].rotation.z = -0.18 - Math.abs(Math.sin(elapsedNow * 7)) * 0.12;
      jaws[1].rotation.z = 0.18 + Math.abs(Math.sin(elapsedNow * 7)) * 0.12;
    }
  } else if (kind === 'spool') {
    for (const part of parts ?? []) part.rotation.z += dt * 8;
  } else if (kind === 'core') {
    for (const part of parts ?? []) part.rotation.z += dt * 0.9;
    if (mesh.userData.cracked === true) {
      const shell = mesh.userData.shell as Object3D | undefined;
      const edge = mesh.userData.shellEdge as Object3D | undefined;
      shell?.scale.set(1.22 + Math.sin(elapsedNow * 14) * 0.04, 0.92, 0.62);
      edge?.scale.copy(shell?.scale ?? new Vector3(1.22, 0.92, 0.62));
    }
  }
  // All target factories are camera-facing; this keeps their silhouettes
  // readable even when the authored rail banks around a lamp.
  if (kind === 'letter') mesh.quaternion.copy(camera.quaternion);
}

function updatePulses(dt: number, camera: Camera) {
  for (let index = pulses.length - 1; index >= 0; index -= 1) {
    const item = pulses[index];
    item.age += dt;
    if (item.age >= item.life) {
      item.mesh.removeFromParent();
      item.mesh.geometry.dispose();
      (item.mesh.material as MeshBasicMaterial).dispose();
      pulses.splice(index, 1);
      continue;
    }
    const progress = item.age / item.life;
    const envelope = Math.sin(Math.min(1, progress * 1.08) * Math.PI);
    item.mesh.quaternion.copy(camera.quaternion);
    item.mesh.scale.setScalar(Math.max(0.01, envelope * item.size));
    (item.mesh.material as MeshBasicMaterial).color.copy(hdr(item.color, envelope * 1.5));
  }
}

function updateDebris(dt: number, scene: Scene, camera: Camera) {
  for (let index = debris.length - 1; index >= 0; index -= 1) {
    const item = debris[index];
    item.age += dt;
    if (!item.attached && item.age >= item.adhereAt && ballRoot) {
      attachDebrisToBall(item);
      continue;
    }
    if (item.attached) {
      item.mesh.rotation.x += dt * item.spin * 0.5;
      item.mesh.rotation.z += dt * item.spin;
      if (item.age >= item.life) {
      item.mesh.removeFromParent();
      disposeObject3D(item.mesh);
      debris.splice(index, 1);
      }
      continue;
    }
    item.velocity.y -= dt * 2.8;
    item.velocity.multiplyScalar(Math.max(0, 1 - dt * 1.25));
    item.position.addScaledVector(item.velocity, dt);
    item.mesh.position.copy(item.position);
    item.mesh.rotateOnAxis(item.axis, item.spin * dt);
    if (item.age >= item.life) {
      scene.remove(item.mesh);
      disposeObject3D(item.mesh);
      debris.splice(index, 1);
    }
  }
}

function attachDebrisToBall(item: DebrisPiece) {
  if (!ballRoot) return;
  item.attached = true;
  item.mesh.removeFromParent();
  const angle = (debris.indexOf(item) + 1) * 2.17 + elapsedNow * 0.04;
  const y = Math.sin(angle * 1.7) * 0.52;
  const radius = 1.02;
  item.mesh.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  item.mesh.scale.setScalar(0.62);
  ballRoot.add(item.mesh);
}

function resetBallAttachments() {
  for (const child of [...(ballRoot?.children ?? [])]) {
    if (!ballBaseChildren.includes(child)) child.removeFromParent();
  }
  for (const item of debris) {
    if (item.attached) {
      item.mesh.removeFromParent();
      disposeObject3D(item.mesh);
      item.attached = false;
    }
  }
  debris.length = 0;
}

function clearTransientObjects() {
  for (const item of pulses) {
    item.mesh.removeFromParent();
    item.mesh.geometry.dispose();
    (item.mesh.material as MeshBasicMaterial).dispose();
  }
  pulses.length = 0;
  for (const item of debris) {
    item.mesh.removeFromParent();
    disposeObject3D(item.mesh);
  }
  debris.length = 0;
}
