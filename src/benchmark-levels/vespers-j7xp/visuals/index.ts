import {
  BoxGeometry,
  Camera,
  Color,
  ConeGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EventBus } from '../../../events';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  COBALT,
  CRIMSON,
  EMERALD,
  GOLD,
  hdr,
  LEAD_CAME,
  PURE_LIGHT,
  STONE_DARK,
  type GlassColorName,
} from './palette';
import {
  createBossCoreMesh,
  createBossShardMesh,
  createEmberMesh,
  createGargoyleMesh,
  createLancetMesh,
  createSeraphMesh,
  updateEnemyVisualDenied,
  updateEnemyVisualLock,
  type VespersEnemyVisualState,
} from './enemies';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  createCathedralEnvironment,
  getCathedralEnvironment,
} from './environment';
import {
  createVisualEffects,
  spawnGlassShards,
  triggerLightReturn,
  updateVisualEffects,
} from './effects';

const enemyRecords = new Map<number, { color: Color; colorName: GlassColorName }>();

export function createEnvironment(scene: Scene) {
  createCathedralEnvironment(scene);
  createVisualEffects(scene);
}

function parseColorFromKind(kind: string): { color: Color; colorName: GlassColorName } {
  const colorName: GlassColorName = kind.includes('crimson') ? 'crimson'
    : kind.includes('emerald') ? 'emerald'
    : kind.includes('cobalt') ? 'cobalt'
    : 'gold';
  const color = colorName === 'crimson' ? CRIMSON
    : colorName === 'emerald' ? EMERALD
    : colorName === 'cobalt' ? COBALT
    : GOLD;
  return { color, colorName };
}

export function installVisualEventHandlers(bus: EventBus, _scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = parseColorFromKind(kind);
    enemyRecords.set(enemyId, record);
    // Shadow peel arrival spark
    spawnGlassShards(worldPosition, record.color, 8, 4);
  });

  bus.on('hit', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId) ?? { color: GOLD, colorName: 'gold' };
    spawnGlassShards(worldPosition, record.color, 14, 8);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId) ?? { color: GOLD, colorName: 'gold' };

    // 1. Shards burst
    spawnGlassShards(worldPosition, record.color, 36, 14);

    // 2. Light returns to restore cathedral stained-glass window!
    triggerLightReturn(worldPosition, record.color, record.colorName);

    enemyRecords.delete(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    enemyRecords.delete(enemyId);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'destroyed') {
      const env = getCathedralEnvironment();
      if (env) {
        env.igniteRoseWindow();
      }
    }
  });
}

export function createEnemyMesh(kind: string, letter?: string): Object3D {
  if (kind === 'letter' || letter) {
    return createLetterMesh(letter ?? 'A');
  }

  // Parse color or default by kind
  if (kind.startsWith('lancet')) {
    const colorName: GlassColorName = kind.includes('crimson') ? 'crimson'
      : kind.includes('emerald') ? 'emerald'
      : kind.includes('gold') ? 'gold'
      : 'cobalt';
    return createLancetMesh(colorName);
  }

  if (kind.startsWith('gargoyle')) {
    const colorName: GlassColorName = kind.includes('cobalt') ? 'cobalt'
      : kind.includes('emerald') ? 'emerald'
      : kind.includes('gold') ? 'gold'
      : 'crimson';
    return createGargoyleMesh(colorName);
  }

  if (kind.startsWith('seraph')) {
    const colorName: GlassColorName = kind.includes('cobalt') ? 'cobalt'
      : kind.includes('crimson') ? 'crimson'
      : kind.includes('gold') ? 'gold'
      : 'emerald';
    return createSeraphMesh(colorName);
  }

  if (kind.startsWith('ember')) {
    const colorName: GlassColorName = kind.includes('cobalt') ? 'cobalt'
      : kind.includes('emerald') ? 'emerald'
      : 'crimson';
    return createEmberMesh(colorName);
  }

  if (kind.startsWith('boss-shard')) {
    const colorName: GlassColorName = kind.includes('cobalt') ? 'cobalt'
      : kind.includes('crimson') ? 'crimson'
      : kind.includes('emerald') ? 'emerald'
      : 'gold';
    return createBossShardMesh(colorName);
  }

  if (kind === 'boss-core' || kind === 'vespers-boss') {
    return createBossCoreMesh();
  }

  return createLancetMesh('cobalt');
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  updateEnemyVisualLock(mesh as Group, locked);
}

export function setEnemyDenied(mesh: Object3D) {
  if (mesh.userData.isLetter) {
    setLetterDenied(mesh as Group);
    return;
  }
  updateEnemyVisualDenied(mesh as Group);
}

export function createProjectileMesh(): Object3D {
  const group = new Group();

  // Elongated stained glass light dart
  const dartGeom = new OctahedronGeometry(0.18, 0);
  dartGeom.scale(0.8, 0.8, 3.2);
  const dartMat = createAdditiveBasicMaterial({ color: hdr(PURE_LIGHT, 2.5) });
  const dartMesh = new Mesh(dartGeom, dartMat);
  group.add(dartMesh);

  // Colored jewel core trail ring
  const ringGeom = new TorusGeometry(0.24, 0.04, 6, 16);
  const ringMat = createAdditiveBasicMaterial({ color: hdr(GOLD, 1.8) });
  const ringMesh = new Mesh(ringGeom, ringMat);
  group.add(ringMesh);

  group.userData.raildIgnoreOcclusion = true;
  return group;
}

export function createReticle(): Object3D {
  const group = new Group();

  // Gothic iron rose tracery ring
  const roseRingGeom = new TorusGeometry(0.52, 0.024, 6, 32);
  const roseRingMat = new MeshBasicMaterial({ color: LEAD_CAME });
  const roseRing = new Mesh(roseRingGeom, roseRingMat);
  group.add(roseRing);

  // 4 Cardinal Gothic Lancet crosshair pointers
  const pointerGeom = new ConeGeometry(0.045, 0.22, 3);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const pMesh = new Mesh(pointerGeom, roseRingMat);
    pMesh.rotation.z = angle - Math.PI / 2;
    pMesh.position.set(Math.cos(angle) * 0.62, Math.sin(angle) * 0.62, 0);
    group.add(pMesh);
  }

  // 6 Stained Glass Lock Pips around the perimeter (light up as locks are acquired)
  const pipGeom = new OctahedronGeometry(0.05, 0);
  const pips: Mesh[] = [];
  const pipColors = [COBALT, CRIMSON, EMERALD, GOLD, COBALT, GOLD];

  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const pipMat = createAdditiveBasicMaterial({ color: pipColors[i].clone().multiplyScalar(0.2) });
    const pipMesh = new Mesh(pipGeom, pipMat);
    pipMesh.position.set(Math.cos(angle) * 0.52, Math.sin(angle) * 0.52, 0.02);
    group.add(pipMesh);
    pips.push(pipMesh);
  }

  // Glowing inner reticle circle
  const innerGlowGeom = new RingGeometry(0.48, 0.54, 32);
  const innerGlowMat = createAdditiveBasicMaterial({ color: hdr(GOLD, 0.5), side: DoubleSide });
  const innerGlowMesh = new Mesh(innerGlowGeom, innerGlowMat);
  group.add(innerGlowMesh);

  group.userData.reticleState = {
    roseRing,
    pips,
    pipColors,
    innerGlowMat,
  };
  group.userData.raildIgnoreOcclusion = true;

  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  const state = reticle.userData.reticleState as {
    roseRing: Mesh;
    pips: Mesh[];
    pipColors: Color[];
    innerGlowMat: MeshBasicMaterial;
  } | undefined;

  if (!state) return;

  // Spin reticle gently
  state.roseRing.rotation.z += 0.015;

  // Scale smoothly with lock count
  const targetScale = 1.0 + lockCount * 0.06 + (active ? 0.12 : 0);
  reticle.scale.setScalar(targetScale);

  // Illuminate lock pips up to lockCount
  for (let i = 0; i < state.pips.length; i += 1) {
    const pip = state.pips[i];
    const pipMat = pip.material as MeshBasicMaterial;
    if (i < lockCount) {
      pipMat.color.copy(hdr(state.pipColors[i], 2.2));
      pip.scale.setScalar(1.4);
    } else {
      pipMat.color.copy(state.pipColors[i].clone().multiplyScalar(0.2));
      pip.scale.setScalar(1.0);
    }
  }

  // Inner glow reacts to lock acquisition
  state.innerGlowMat.color.copy(
    lockCount > 0 ? hdr(GOLD, 0.8 + lockCount * 0.25) : hdr(GOLD, active ? 0.5 : 0.25),
  );
}

export function updateVisuals(dt: number, elapsed: number, camera: Camera) {
  const env = getCathedralEnvironment();
  if (env) {
    env.update(dt, elapsed);
  }
  updateVisualEffects(dt, camera);
}
