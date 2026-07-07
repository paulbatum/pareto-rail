import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { EventBus } from '../../events';
import { colorForLockCount } from '../../engine/locks';
import { sampleRailFrame } from '../../engine/rail';
import { scatterAlongRail } from '../../engine/environment-kit';
import type { ScatterField } from '../../engine/environment-kit';
import {
  createAdditiveBasicMaterial,
  createPendingVisualRecords,
  createTransientEffectPool,
  disposeObject3D,
} from '../../engine/visual-kit';
import { createPrismRail } from './gameplay';

const INDIGO = new Color(0.13, 0.08, 0.38);
const LIME = new Color(0.62, 1.0, 0.38);
const VIOLET = new Color(0.72, 0.32, 1.0);
const ICE = new Color(0.72, 1.0, 0.94);
const ROSE = new Color(1.0, 0.26, 0.46);

const hdr = (color: Color, intensity: number) => color.clone().multiplyScalar(intensity);

type VisualContext = { scene: Scene; camera: Camera; elapsed: number };
type EnemyRecord = { mesh: Group; bornAt: number; locked: boolean };
type Pulse = { ring: Mesh; age: number; life: number; color: Color };

const enemies = createPendingVisualRecords<Group, EnemyRecord, [number]>({
  createRecord: (mesh, bornAt) => ({ mesh, bornAt, locked: false }),
});
const projectiles = createPendingVisualRecords<Object3D, Object3D>({
  createRecord: (mesh) => mesh,
});
const pulses = createTransientEffectPool<Pulse, VisualContext>({
  update(item, progress, _dt, context) {
    item.ring.quaternion.copy(context.camera.quaternion);
    item.ring.scale.setScalar(0.2 + progress * 3.8);
    (item.ring.material as MeshBasicMaterial).color.copy(item.color).multiplyScalar((1 - progress) ** 1.6);
  },
  dispose(item, context) {
    context.scene.remove(item.ring);
    item.ring.geometry.dispose();
    (item.ring.material as MeshBasicMaterial).dispose();
  },
});
let beatEnergy = 0;
let environmentRoot: Group | null = null;
let baseFov: number | null = null;
let elapsedNow = 0;
let ribField: ScatterField | null = null;

export function disposeEnvironment() {
  const root = environmentRoot;
  ribField?.dispose();
  ribField = null;
  if (root) {
    root.removeFromParent();
    disposeObject3D(root);
  }
  environmentRoot = null;
}

export function createEnvironment(scene: Scene) {
  disposeEnvironment();
  scene.background = INDIGO;
  const root = new Group();
  const rail = createPrismRail();

  const ribPositions: number[] = [];
  const ribColors: number[] = [];
  const ribOffsets: number[] = [];

  for (let index = 0; index < 86; index += 1) {
    ribOffsets[index] = ribPositions.length;
    writePrismRib(ribPositions, ribColors, rail, index, index / 85);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(ribPositions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(ribColors, 3));
  const prismField = new LineSegments(
    geometry,
    new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }),
  );
  prismField.frustumCulled = false;
  root.add(prismField);

  const railLength = rail.getLength();
  const positionAttribute = geometry.getAttribute('position') as Float32BufferAttribute;
  ribField = scatterAlongRail(rail, {
    count: 86,
    seed: 20260707,
    window: { behind: railLength * 2, ahead: railLength * 2 },
    place(index) {
      return { u: index / 85, offset: new Vector3() };
    },
    make() {
      const marker = new Object3D();
      marker.visible = false;
      return marker;
    },
    onUpdate(item) {
      writePrismRibPositions(positionAttribute.array as Float32Array, ribOffsets[item.index], rail, item.index, item.u);
      positionAttribute.needsUpdate = true;
    },
  });

  const starGeometry = new BufferGeometry();
  const starPositions = new Float32Array(900 * 3);
  const starColors = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i += 1) {
    const u = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const frame = sampleRailFrame(rail, Math.abs(u));
    const angle = i * 2.399963;
    const radius = 24 + ((i * 37) % 120);
    const p = frame.position.clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, ((i * 19) % 50) - 25);
    starPositions.set([p.x, p.y, p.z], i * 3);
    const color = i % 7 === 0 ? LIME : i % 5 === 0 ? ROSE : ICE;
    const intensity = i % 17 === 0 ? 1.5 : 0.22;
    starColors.set([color.r * intensity, color.g * intensity, color.b * intensity], i * 3);
  }
  starGeometry.setAttribute('position', new Float32BufferAttribute(starPositions, 3));
  starGeometry.setAttribute('color', new Float32BufferAttribute(starColors, 3));
  root.add(new Points(starGeometry, new PointsMaterial({ size: 0.48, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false })));

  scene.add(root);
  environmentRoot = root;
  return root;
}

function writePrismRib(
  positions: number[],
  colors: number[],
  rail: ReturnType<typeof createPrismRail>,
  index: number,
  u: number,
) {
  const offset = positions.length;
  for (let i = 0; i < (index % 2 === 0 ? 12 : 6); i += 1) positions.push(0);
  writePrismRibPositions(positions, offset, rail, index, u);

  const color = index % 3 === 0 ? LIME : VIOLET;
  const intensity = index % 5 === 0 ? 0.9 : 0.28;
  colors.push(
    color.r * intensity, color.g * intensity, color.b * intensity,
    color.r * intensity, color.g * intensity, color.b * intensity,
  );
  if (index % 2 === 0) {
    colors.push(ICE.r * 0.18, ICE.g * 0.18, ICE.b * 0.18, ICE.r * 0.18, ICE.g * 0.18, ICE.b * 0.18);
  }
}

function writePrismRibPositions(
  positions: number[] | Float32Array,
  offset: number,
  rail: ReturnType<typeof createPrismRail>,
  index: number,
  u: number,
) {
  const frame = sampleRailFrame(rail, u);
  const skew = Math.sin(u * Math.PI * 8) * 3;
  const a = frame.position.clone().addScaledVector(frame.right, -14 - skew).addScaledVector(frame.up, -8);
  const b = frame.position.clone().addScaledVector(frame.right, 14 - skew).addScaledVector(frame.up, 8);
  positions[offset] = a.x;
  positions[offset + 1] = a.y;
  positions[offset + 2] = a.z;
  positions[offset + 3] = b.x;
  positions[offset + 4] = b.y;
  positions[offset + 5] = b.z;
  if (index % 2 !== 0) return;
  const c = frame.position.clone().addScaledVector(frame.right, -14 + skew).addScaledVector(frame.up, 8);
  const d = frame.position.clone().addScaledVector(frame.right, 14 + skew).addScaledVector(frame.up, -8);
  positions[offset + 6] = c.x;
  positions[offset + 7] = c.y;
  positions[offset + 8] = c.z;
  positions[offset + 9] = d.x;
  positions[offset + 10] = d.y;
  positions[offset + 11] = d.z;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' ? createLetter(letter ?? '?') : createPrismEnemy(kind);
  mesh.scale.setScalar(0.001);
  enemies.enqueue(mesh);
  return mesh;
}

function createPrismEnemy(kind: string) {
  const group = new Group();
  const accent = kind === 'comet' ? ROSE : kind === 'echo' ? LIME : VIOLET;
  const material = createAdditiveBasicMaterial({ color: hdr(accent, 1.4) });
  const coreMaterial = createAdditiveBasicMaterial({ color: hdr(ICE, 2.4) });

  if (kind === 'gate') {
    group.add(new Mesh(new TorusGeometry(0.8, 0.035, 6, 5), material));
    const cross = new Mesh(new PlaneGeometry(1.7, 0.045), coreMaterial);
    const cross2 = cross.clone();
    cross2.rotation.z = Math.PI / 2;
    group.add(cross, cross2);
  } else if (kind === 'comet') {
    const core = new Mesh(new OctahedronGeometry(0.52, 0), coreMaterial);
    core.scale.set(0.7, 0.7, 1.35);
    const tail = new Mesh(new PlaneGeometry(0.18, 2.6), material);
    tail.position.y = -1.2;
    group.add(core, tail);
  } else {
    group.add(new Mesh(new IcosahedronGeometry(0.52, 1), coreMaterial));
    for (let i = 0; i < 3; i += 1) {
      const ring = new Mesh(new TorusGeometry(0.85 + i * 0.24, 0.025, 6, 48), material.clone());
      ring.rotation.z = (i / 3) * Math.PI;
      group.add(ring);
    }
  }

  group.userData.materials = [material, coreMaterial];
  group.userData.accent = accent;
  return group;
}

const LETTER_GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
};

const LETTER_CELL = 0.24;
const LETTER_DOT = new PlaneGeometry(0.19, 0.19);
const LETTER_CORE = new PlaneGeometry(0.105, 0.105);

function createLetter(letter: string) {
  const group = new Group();
  const fillColor = hdr(ICE, 1.45);
  const hotColor = hdr(LIME, 2.05);
  const fillMaterial = createAdditiveBasicMaterial({ color: fillColor.clone(), side: DoubleSide });
  const hotMaterial = createAdditiveBasicMaterial({ color: hotColor.clone(), side: DoubleSide });
  fillMaterial.userData.baseColor = fillColor;
  hotMaterial.userData.baseColor = hotColor;

  const glyph = LETTER_GLYPHS[letter.toUpperCase()] ?? LETTER_GLYPHS.A;
  const width = (glyph[0].length - 1) * LETTER_CELL;
  const height = (glyph.length - 1) * LETTER_CELL;

  for (let y = 0; y < glyph.length; y += 1) {
    for (let x = 0; x < glyph[y].length; x += 1) {
      if (glyph[y][x] !== '1') continue;
      const cell = new Mesh(LETTER_DOT, fillMaterial);
      cell.position.set(x * LETTER_CELL - width / 2, height / 2 - y * LETTER_CELL, 0);
      cell.rotation.z = Math.PI / 4;
      const core = new Mesh(LETTER_CORE, hotMaterial);
      core.position.copy(cell.position);
      core.position.z = 0.01;
      core.rotation.z = Math.PI / 4;
      group.add(cell, core);
    }
  }

  group.userData.isLetter = true;
  group.userData.letter = letter.toUpperCase();
  group.userData.accent = ICE;
  group.userData.materials = [fillMaterial, hotMaterial];
  return group;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount?: number) {
  mesh.userData.locked = locked;
  const fallback = hdr(mesh.userData.accent ?? ICE, 1.5);
  const color = lockCount === undefined ? ROSE : colorForLockCount(lockCount, [LIME, VIOLET, ROSE]);
  tintEnemyMaterials(mesh, locked ? color : undefined, fallback);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  tintEnemyMaterials(mesh, ROSE, hdr(mesh.userData.accent ?? ICE, 1.5));
}

function tintEnemyMaterials(mesh: Object3D, color: Color | undefined, fallback: Color) {
  const materials = mesh.userData.materials as MeshBasicMaterial[] | undefined;
  for (const material of materials ?? []) {
    const baseColor = material.userData.baseColor as Color | undefined;
    material.color.copy(color ? hdr(color, 2.4) : (baseColor ?? fallback));
  }
}

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(new OctahedronGeometry(0.22, 0), createAdditiveBasicMaterial({ color: hdr(LIME, 2.6) }));
  core.scale.set(0.6, 0.6, 2.8);
  const halo = new Mesh(new RingGeometry(0.42, 0.46, 4), createAdditiveBasicMaterial({ color: hdr(ICE, 1.4), side: DoubleSide }));
  group.add(core, halo);
  projectiles.enqueue(group);
  return group;
}

export function createReticle() {
  const group = new Group();
  const ring = new Mesh(new RingGeometry(0.48, 0.53, 4), createAdditiveBasicMaterial({ color: hdr(LIME, 1.5), side: DoubleSide }));
  const ring2 = new Mesh(new RingGeometry(0.72, 0.74, 4), createAdditiveBasicMaterial({ color: hdr(VIOLET, 1.2), side: DoubleSide }));
  ring2.rotation.z = Math.PI / 4;
  group.add(ring, ring2);
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.08 + (active ? 0.1 : 0));
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, worldPosition }) => {
    enemies.claim(enemyId, performance.now() / 1000);
    pulse(scene, worldPosition, ICE, 2.4, 0.35);
  });
  bus.on('lock', ({ worldPosition, lockCount }) => {
    pulse(scene, worldPosition, colorForLockCount(lockCount, [LIME, VIOLET, ROSE]), 1.6, 0.22);
  });
  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectiles.claim(projectileId);
    pulse(scene, worldPosition, LIME, 1.1, 0.18);
  });
  bus.on('hit', ({ projectileId, worldPosition }) => {
    projectiles.delete(projectileId);
    pulse(scene, worldPosition, ICE, 3.2, 0.28);
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    enemies.delete(enemyId);
    pulse(scene, worldPosition, LIME, 4.8, 0.5);
    pulse(scene, worldPosition, ROSE, 2.6, 0.34);
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    enemies.delete(enemyId);
    pulse(scene, worldPosition, ROSE, 1.6, 0.24);
  });
  bus.on('reject', ({ enemyIds, missingEnemyIds }) => {
    const deniedIds = new Set([...enemyIds, ...(missingEnemyIds ?? [])]);
    for (const enemyId of deniedIds) {
      const record = enemies.get(enemyId);
      if (!record) continue;
      pulse(scene, record.mesh.position, ROSE, 2.6, 0.28);
      pulse(scene, record.mesh.position, ICE, 1.5, 0.18);
    }
  });
  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.45;
  });
  bus.on('runstart', () => {
    enemies.clear();
    projectiles.clear();
  });
}

function pulse(scene: Scene, position: Vector3, color: Color, scale: number, life: number) {
  const ring = new Mesh(new RingGeometry(0.96, 1, 36), createAdditiveBasicMaterial({ color: hdr(color, 1.5), side: DoubleSide }));
  ring.position.copy(position);
  scene.add(ring);
  pulses.add({ ring, age: 0, life, color: color.clone().multiplyScalar(1.5 * scale) });
}

export function updateVisuals(
  dt: number,
  context: { scene: Scene; camera: Camera; elapsed: number; runProgress?: number },
) {
  elapsedNow = context.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.8);
  if (environmentRoot) {
    environmentRoot.rotation.z = Math.sin(context.elapsed * 0.13) * 0.035;
    environmentRoot.scale.setScalar(1 + beatEnergy * 0.012);
  }
  if (context.camera instanceof PerspectiveCamera) {
    if (baseFov === null) baseFov = context.camera.fov;
    context.camera.fov = baseFov + beatEnergy * 1.7;
    context.camera.updateProjectionMatrix();
  }

  const runProgress = context.runProgress ?? 0;
  ribField?.update(runProgress, dt);

  for (const record of enemies.values()) {
    const age = context.elapsed - record.bornAt;
    const intro = Math.min(1, age / 0.28);
    const deniedUntil = record.mesh.userData.deniedUntil as number | undefined;
    const denied = (deniedUntil ?? -Infinity) > context.elapsed;
    const lockedPulse = record.mesh.userData.locked ? 1 + Math.sin(context.elapsed * 12) * 0.07 : 1;
    const deniedPulse = denied ? 1 + Math.sin(context.elapsed * 48) * 0.08 : 1;
    const pulseScale = lockedPulse * deniedPulse;
    record.mesh.scale.setScalar((intro * intro * (3 - 2 * intro)) * pulseScale);
    if (denied) {
      tintEnemyMaterials(record.mesh, ROSE.clone().lerp(ICE, 0.35), hdr(record.mesh.userData.accent ?? ICE, 1.5));
    } else if (record.mesh.userData.locked !== true) {
      tintEnemyMaterials(record.mesh, undefined, hdr(record.mesh.userData.accent ?? ICE, 1.5));
    }
    record.mesh.children.forEach((child, index) => {
      child.rotation.z += dt * (0.4 + index * 0.18) * (record.mesh.userData.locked ? 2 : 1);
    });
  }

  for (const projectile of projectiles.values()) projectile.rotateZ(dt * 8);

  pulses.update(dt, context);
}
