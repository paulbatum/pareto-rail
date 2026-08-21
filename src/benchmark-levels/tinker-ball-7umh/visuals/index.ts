import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import type { EventBus } from '../../../events';
import {
  createPendingVisualRecords,
  disposeObject3D,
} from '../../../engine/visual-kit';
import {
  createBeetleMesh,
  createGrandSpillHeartMesh,
  createHazardBeadMesh,
  createMortarMesh,
  createSkittererMesh,
  createSnapperMesh,
  createSpillCoreMesh,
  createWalkerMesh,
  type EnemyMeshUserData,
} from './enemies';
import {
  createEffectsSystem,
  createTinkerProjectileMesh,
  createTinkerReticleMesh,
  type EffectsSystem,
} from './effects';
import { createLetterMesh, setLetterLocked } from './letters';
import {
  DENIED_COLOR,
  hdr,
  LOCK_COLOR,
} from './palette';
import { createTinkerBall, type TinkerBall } from './player-ball';
import { decayPostFx, kickWarmFlash } from './post-fx';
import { createTableEnvironment, type TableEnvironment } from './table-environment';
import type { CatmullRomCurve3 } from 'three';

export type VisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  feel: CameraFeelRig;
  elapsed: number;
  dt: number;
  runProgress: number;
  speed: number;
  running: boolean;
};

type EnemyRecord = {
  mesh: Object3D;
  userData: EnemyMeshUserData;
  bornAt: number;
  locked: boolean;
};

let environment: TableEnvironment | null = null;
let effects: EffectsSystem | null = null;
let playerBall: TinkerBall | null = null;

const enemyRecords = createPendingVisualRecords<Object3D, EnemyRecord>({
  createRecord: (mesh) => ({
    mesh,
    userData: (mesh.userData ?? {}) as EnemyMeshUserData,
    bornAt: 0,
    locked: false,
  }),
  disposeRecord: (record) => {
    disposeObject3D(record.mesh);
  },
});

export function createEnvironment(scene: Scene, curve: CatmullRomCurve3): Group {
  if (environment) environment.dispose();
  if (effects) effects.dispose();
  if (playerBall) playerBall.dispose();

  environment = createTableEnvironment(scene, curve);
  effects = createEffectsSystem(scene);
  playerBall = createTinkerBall(scene);

  return environment.root;
}

export function disposeEnvironment() {
  if (environment) {
    environment.dispose();
    environment = null;
  }
  if (effects) {
    effects.dispose();
    effects = null;
  }
  if (playerBall) {
    playerBall.dispose();
    playerBall = null;
  }
  enemyRecords.clear({ dispose: true, pending: true });
}

export function createEnemyMesh(kind: string, letter?: string): Object3D {
  if (kind === 'letter' || letter !== undefined) {
    const mesh = createLetterMesh(letter ?? 'A');
    enemyRecords.enqueue(mesh);
    return mesh;
  }

  let mesh: Group;
  switch (kind) {
    case 'beetle':
      mesh = createBeetleMesh();
      break;
    case 'skitterer':
      mesh = createSkittererMesh();
      break;
    case 'walker':
      mesh = createWalkerMesh();
      break;
    case 'snapper':
      mesh = createSnapperMesh();
      break;
    case 'mortar':
      mesh = createMortarMesh();
      break;
    case 'hazard':
      mesh = createHazardBeadMesh();
      break;
    case 'spill-core-1':
    case 'spill-core-2':
    case 'spill-core-3':
    case 'spill-core-4':
      mesh = createSpillCoreMesh(kind.slice(-1));
      break;
    case 'spill-heart':
    case 'spill-boss':
      mesh = createGrandSpillHeartMesh();
      break;
    default:
      mesh = createBeetleMesh();
      break;
  }

  enemyRecords.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }

  const uData = mesh.userData as EnemyMeshUserData;
  if (uData.coreMaterial) {
    if (locked) {
      uData.coreMaterial.color.copy(hdr(LOCK_COLOR, 2.0));
    } else {
      uData.coreMaterial.color.copy(new Color(0x120a16));
    }
  }
}

export function setEnemyDenied(mesh: Object3D) {
  const uData = mesh.userData as EnemyMeshUserData;
  if (uData.coreMaterial) {
    uData.coreMaterial.color.copy(hdr(DENIED_COLOR, 2.5));
    setTimeout(() => {
      if (uData.coreMaterial) uData.coreMaterial.color.copy(new Color(0x120a16));
    }, 180);
  }
}

export function createProjectileMesh(): Object3D {
  return createTinkerProjectileMesh();
}

export function createReticle(): Object3D {
  return createTinkerReticleMesh();
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  const ring = reticle.userData.ring as Mesh | undefined;
  const ringMat = reticle.userData.ringMat as MeshBasicMaterial | undefined;
  if (!ring || !ringMat) return;

  if (active) {
    ring.scale.setScalar(1.0 + lockCount * 0.05);
    ringMat.color.copy(hdr(lockCount >= 6 ? LOCK_COLOR : new Color(0xffab40), 1.8 + lockCount * 0.2));
  } else {
    ring.scale.setScalar(1.0);
    ringMat.color.copy(hdr(new Color(0xffab40), 1.4));
  }
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId }) => {
    const record = enemyRecords.claim(enemyId);
    if (record) {
      record.bornAt = performance.now() / 1000;
    }
  });

  bus.on('lock', ({ lockCount }) => {
    feel.kickFov(0.3 + lockCount * 0.15);
  });

  bus.on('fire', ({ volleySize }) => {
    feel.kickFov(-0.5 - volleySize * 0.2);
    feel.shake(0.08 + volleySize * 0.03);
    kickWarmFlash(0.12 + volleySize * 0.04);
  });

  bus.on('hit', ({ worldPosition, enemyId, lethal }) => {
    if (worldPosition && effects) {
      const p = new Vector3(worldPosition.x, worldPosition.y, worldPosition.z);
      const record = enemyRecords.get(enemyId);
      const color = record?.userData.accentColor ?? new Color(0xffc107);
      effects.spawnHitBurst(p, color);
      feel.shake(lethal ? 0.18 : 0.08);
      kickWarmFlash(0.15);
    }
  });

  bus.on('kill', ({ worldPosition, enemyId }) => {
    if (worldPosition && effects) {
      const p = new Vector3(worldPosition.x, worldPosition.y, worldPosition.z);
      effects.spawnCleanKillBurst(p);

      const record = enemyRecords.get(enemyId);
      const kind = record?.userData.kind ?? 'beetle';

      // Add supply debris to the rolling ball collection field!
      if (playerBall) {
        const act = kind.includes('spill') ? 2 : kind === 'walker' || kind === 'mortar' ? 1 : 0;
        const count = kind.includes('spill') ? 14 : kind === 'walker' ? 6 : 3;
        playerBall.addDebrisScatter(p, count, act);
      }

      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('playerhit', () => {
    feel.shake(0.45);
    kickWarmFlash(0.5);
  });

  bus.on('reject', () => {
    feel.shake(0.12);
  });
}

export function updateVisuals(dt: number, context: VisualContext) {
  if (environment) {
    environment.update(context.runProgress, dt);
  }
  if (effects) {
    effects.update(dt);
  }
  if (playerBall && context.running) {
    playerBall.update(dt, context.speed, context.runProgress, context.camera.position, context.camera.quaternion);
  }
  decayPostFx(dt);
}
