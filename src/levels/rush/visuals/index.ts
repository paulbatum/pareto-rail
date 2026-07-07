import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
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
let ribField: ScatterField | null = null;
let streakField: SpeedStreakField | null = null;
let beatEnergy = 0;
let elapsedNow = 0;

export function createEnvironment(scene: Scene) {
  disposeEnvironment();
  scene.background = BLACK;
  scene.fog = new Fog(RUSH_TUNING.fog.color, RUSH_TUNING.fog.nearUnits, RUSH_TUNING.fog.farUnits);

  const root = new Group();
  const ribCount = Math.ceil(RUSH_TUNING.rail.lengthUnits / RUSH_TUNING.ribs.spacingUnits);
  const railLength = rail.getLength();

  ribField = scatterAlongRail(rail, {
    count: ribCount,
    seed: 914170,
    window: {
      behind: RUSH_TUNING.ribs.spacingUnits * RUSH_TUNING.ribs.behindCount,
      ahead: RUSH_TUNING.ribs.spacingUnits * RUSH_TUNING.ribs.aheadCount,
    },
    place(index) {
      return { u: (index * RUSH_TUNING.ribs.spacingUnits) / railLength, offset: new Vector3() };
    },
    make(index) {
      return createRib(index);
    },
    onUpdate(item) {
      const hot = (item.index % RUSH_TUNING.ribs.strobeEvery === 0 ? beatEnergy : 0) * 1.8;
      item.object.scale.setScalar(1 + hot * 0.035);
      tintObject(item.object, item.index % RUSH_TUNING.ribs.strobeEvery === 0 ? hdr(AMBER, 0.4 + hot) : hdr(CYAN, 0.36));
    },
  });
  root.add(ribField.group);

  root.add(createDashRails());
  streakField = createSpeedStreaks();
  root.add(streakField.object);

  scene.add(root);
  environmentRoot = root;
  return root;
}

export function disposeEnvironment() {
  ribField?.dispose();
  ribField = null;
  streakField?.dispose();
  streakField = null;
  if (environmentRoot) {
    environmentRoot.removeFromParent();
    disposeObject3D(environmentRoot);
  }
  environmentRoot = null;
  setRushRadialBlur(0);
}

function createRib(index: number) {
  const group = new Group();
  const radius = RUSH_TUNING.ribs.nearMissRadiusUnits;
  const height = RUSH_TUNING.ribs.heightUnits;
  const z = 0;
  const points = [
    -radius, -height * 0.5, z, radius, -height * 0.5, z,
    radius, -height * 0.5, z, radius, height * 0.5, z,
    radius, height * 0.5, z, -radius, height * 0.5, z,
    -radius, height * 0.5, z, -radius, -height * 0.5, z,
    -radius, -height * 0.5, z, radius, height * 0.5, z,
    -radius, height * 0.5, z, radius, -height * 0.5, z,
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  const material = new LineBasicMaterial({ color: index % RUSH_TUNING.ribs.strobeEvery === 0 ? hdr(AMBER, 0.85) : hdr(CYAN, 0.34), transparent: true, blending: AdditiveBlending, depthWrite: false });
  group.add(new LineSegments(geometry, material));

  if (index % RUSH_TUNING.ribs.strobeEvery === 0) {
    const ring = new Mesh(
      new TorusGeometry(radius * 0.72, 0.025, 6, 40),
      createAdditiveBasicMaterial({ color: hdr(AMBER, 0.9), side: DoubleSide }),
    );
    ring.scale.y = height / (radius * 2);
    group.add(ring);
  }
  return group;
}

function createDashRails() {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const colors: number[] = [];
  const railLength = rail.getLength();
  const count = Math.floor(railLength / RUSH_TUNING.dashRails.spacingUnits);
  for (let i = 0; i < count; i += 1) {
    const u0 = (i * RUSH_TUNING.dashRails.spacingUnits) / railLength;
    const u1 = Math.min(1, (i * RUSH_TUNING.dashRails.spacingUnits + RUSH_TUNING.dashRails.lengthUnits) / railLength);
    for (const side of [-1, 1]) {
      const start = railDashPoint(u0, side);
      const end = railDashPoint(u1, side);
      positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
      const color = side < 0 ? CYAN : AMBER;
      const intensity = i % RUSH_TUNING.ribs.strobeEvery === 0 ? 0.85 : 0.26;
      colors.push(color.r * intensity, color.g * intensity, color.b * intensity, color.r * intensity, color.g * intensity, color.b * intensity);
    }
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const lines = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  lines.frustumCulled = false;
  return lines;
}

function railDashPoint(u: number, side: number) {
  const frame = sampleRailFrame(rail, u);
  return frame.position.clone()
    .addScaledVector(frame.right, side * RUSH_TUNING.dashRails.sideOffsetUnits)
    .addScaledVector(frame.up, RUSH_TUNING.dashRails.verticalOffsetUnits);
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
  const hot = createAdditiveBasicMaterial({ color: hdr(accent, 1.8), side: DoubleSide });
  const core = new MeshBasicMaterial({ color: hdr(WHITE, 0.95), side: DoubleSide });

  if (kind === 'dart') {
    const nose = new Mesh(new ConeGeometry(0.42, 1.55, 3), core);
    nose.rotation.x = Math.PI / 2;
    const wing = new Mesh(new PlaneGeometry(1.35, 0.18), hot);
    const tail = new Mesh(new PlaneGeometry(0.22, 1.7), createAdditiveBasicMaterial({ color: hdr(CYAN, 1.1), side: DoubleSide }));
    tail.position.y = -0.72;
    group.add(nose, wing, tail);
  } else if (kind === 'heavy') {
    const hull = new Mesh(new IcosahedronGeometry(0.72, 1), core);
    hull.scale.set(1.15, 0.82, 1.15);
    group.add(hull);
    for (let i = 0; i < 3; i += 1) {
      const ring = new Mesh(new TorusGeometry(0.95 + i * 0.18, 0.028, 6, 36), hot.clone());
      ring.rotation.z = (i / 3) * Math.PI;
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    }
  } else {
    const frame = new Mesh(new TorusGeometry(0.78, 0.04, 6, 6), hot);
    const coreBox = new Mesh(new BoxGeometry(0.7, 0.7, 0.24), core);
    const slit = new Mesh(new PlaneGeometry(1.2, 0.075), createAdditiveBasicMaterial({ color: hdr(AMBER, 1.6), side: DoubleSide }));
    group.add(frame, coreBox, slit);
  }

  group.userData.kind = kind;
  group.userData.accent = accent;
  group.userData.materials = collectMaterials(group);
  return group;
}

function createLetterMesh(character: string) {
  const group = new Group();
  const fill = new MeshBasicMaterial({ color: hdr(WHITE, 0.9), side: DoubleSide });
  const hot = createAdditiveBasicMaterial({ color: hdr(CYAN, 1.7), side: DoubleSide });
  const cellGeometry = new BoxGeometry(0.19, 0.19, 0.075);
  const coreGeometry = new BoxGeometry(0.105, 0.105, 0.09);
  for (const cell of glyphOnCells(character)) {
    const block = new Mesh(cellGeometry, fill);
    block.position.set((cell.x - 2) * 0.27, (3 - cell.y) * 0.27, 0);
    const core = new Mesh(coreGeometry, hot);
    core.position.copy(block.position);
    core.position.z = 0.07;
    group.add(block, core);
  }
  const bracket = new Mesh(new RingGeometry(0.88, 0.92, 4), createAdditiveBasicMaterial({ color: hdr(AMBER, 1.2), side: DoubleSide }));
  bracket.rotation.z = Math.PI / 4;
  group.add(bracket);
  group.userData.kind = 'letter';
  group.userData.accent = CYAN;
  group.userData.materials = collectMaterials(group);
  return group;
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
  for (const material of materials ?? []) {
    if (!material.color) continue;
    material.color.copy(color ?? hdr(accent, material instanceof MeshBasicMaterial && material.blending !== AdditiveBlending ? 0.85 : 1.45));
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
  beatEnergy = Math.max(0, beatEnergy - dt / RUSH_TUNING.ribs.strobeHoldSeconds);
  ribField?.update(context.runProgress ?? 0, dt);
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
