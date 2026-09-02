import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { EventBus } from '../../../events';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  DENIED_RED,
  hdr,
  JELLY_EMERALD,
  JELLY_GOLD,
  JELLY_MINT,
  LOCK_CYAN,
  LOCK_GOLD,
  PARASITE_CORE,
  PARASITE_TOXIC,
  PARASITE_VIOLET,
  PEARL_WHITE,
} from './palette';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  createClasperMesh,
  createParentOrganismMesh,
  createSkimmerMesh,
  createSporeBoltMesh,
  createSporeSacMesh,
  setEnemyMeshDenied,
  setEnemyMeshLocked,
} from './enemies';
import { createEnvironmentInternal, type StrandlineEnvironment } from './environment';
import { createVisualEffects, type VisualEffects } from './effects';

// Shared module-level projectile and reticle geometries
const projDartGeom = new ConeGeometry(0.18, 1.2, 5);
projDartGeom.rotateX(Math.PI / 2);
const projTrailGeom = new CylinderGeometry(0.04, 0.22, 1.8, 5);
projTrailGeom.rotateX(Math.PI / 2);

const reticleRingGeom = new TorusGeometry(0.68, 0.02, 6, 36);
const reticleTickGeom = new BoxGeometry(0.02, 0.14, 0.02);
const reticlePipGeom = new OctahedronGeometry(0.06, 0);

const projDartMat = new MeshBasicMaterial({ color: hdr(PEARL_WHITE, 2.0) });
const projTrailMat = new MeshBasicMaterial(
  additiveMaterialParameters({ color: hdr(LOCK_CYAN, 2.2), transparent: true, opacity: 0.8 }),
);

let env: StrandlineEnvironment | null = null;
let fx: VisualEffects | null = null;
let currentBeatEnergy = 0;
let isPurified = false;

export function createEnvironment(scene: Scene) {
  env = createEnvironmentInternal(scene);
  fx = createVisualEffects(scene);
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  currentBeatEnergy = 0;
  isPurified = false;

  bus.on('beat', () => {
    currentBeatEnergy = 1.0;
  });

  bus.on('hit', ({ worldPosition, lethal }) => {
    if (!fx || !worldPosition) return;
    fx.spawnBurst(worldPosition, lethal ? JELLY_GOLD : PARASITE_TOXIC, lethal ? 24 : 10);
  });

  bus.on('kill', ({ worldPosition }) => {
    if (!fx || !worldPosition) return;
    fx.spawnBurst(worldPosition, JELLY_MINT, 30);
    fx.spawnShockwave(worldPosition, new Vector3(0, 0, 1), JELLY_GOLD, 5.0);
  });

  bus.on('reject', () => {
    if (!fx) return;
    fx.spawnShockwave(new Vector3(0, 0, -5), new Vector3(0, 0, 1), DENIED_RED, 8.0);
  });

  bus.on('playerhit', () => {
    if (!fx) return;
    fx.spawnShockwave(new Vector3(0, 0, -4), new Vector3(0, 0, 1), PARASITE_TOXIC, 9.0);
  });

  bus.on('bossphase', ({ phase }) => {
    if (!env) return;
    if (phase === 'summoned') {
      env.setBossLatticeLevel(1.0);
    } else if (phase === 'exposed') {
      env.setBossLatticeLevel(0.0);
      if (fx) fx.spawnShockwave(new Vector3(0, 20, -525), new Vector3(0, 0, 1), JELLY_GOLD, 25.0);
    } else if (phase === 'destroyed') {
      isPurified = true;
      env.setPurified(true);
      if (fx) fx.spawnBurst(new Vector3(0, 20, -525), JELLY_GOLD, 36);
    }
  });
}

export function updateVisuals(
  dt: number,
  ctx: {
    scene: Scene;
    camera: PerspectiveCamera;
    elapsed: number;
    runTime: number;
    runProgress: number;
    running: boolean;
  },
) {
  currentBeatEnergy = Math.max(0, currentBeatEnergy - dt * 4.0);

  if (env) {
    env.update(dt, {
      camera: ctx.camera,
      runTime: ctx.runTime,
      running: ctx.running,
      elapsed: ctx.elapsed,
      beatEnergy: currentBeatEnergy,
      bossLatticeHealth: 1.0,
      purified: isPurified,
    });
  }

  if (fx) {
    fx.update(dt);
  }
}

export function disposeVisuals() {
  if (env) {
    env.dispose();
    env = null;
  }
  if (fx) {
    fx.dispose();
    fx = null;
  }
}

// Visual factories required by createLockOnRunner:

export function createEnemyMesh(kind: string, letter?: string): Object3D {
  if (kind === 'letter' || letter) {
    return createLetterMesh(letter ?? 'S');
  }
  switch (kind) {
    case 'clasper':
      return createClasperMesh();
    case 'skimmer':
      return createSkimmerMesh();
    case 'spore_sac':
      return createSporeSacMesh();
    case 'spore_bolt':
      return createSporeBoltMesh();
    case 'parent':
      return createParentOrganismMesh();
    default:
      return createClasperMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  const group = mesh as Group;
  if (group.userData?.kind === 'letter' || group.userData?.fillMaterial) {
    setLetterLocked(group, locked);
  } else {
    setEnemyMeshLocked(group, locked);
  }
}

export function setEnemyDenied(mesh: Object3D) {
  const group = mesh as Group;
  if (group.userData?.kind === 'letter' || group.userData?.fillMaterial) {
    setLetterDenied(group);
  } else {
    setEnemyMeshDenied(group);
  }
}

export function createProjectileMesh(): Object3D {
  const group = new Group();
  const dart = new Mesh(projDartGeom, projDartMat);
  group.add(dart);

  const trail = new Mesh(projTrailGeom, projTrailMat);
  trail.position.z = -0.9;
  group.add(trail);

  return group;
}

type ReticleUserData = {
  ring: Mesh;
  pips: Mesh[];
  ringMat: LineBasicMaterial;
  pipMat: MeshBasicMaterial;
};

export function createReticle(): Object3D {
  const group = new Group();

  const ringMat = new LineBasicMaterial(
    additiveMaterialParameters({ color: hdr(LOCK_CYAN, 1.8) }),
  );
  const ring = new Mesh(reticleRingGeom, ringMat);
  group.add(ring);

  for (let i = 0; i < 4; i++) {
    const tick = new Mesh(reticleTickGeom, ringMat);
    const ang = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(ang) * 0.52, Math.sin(ang) * 0.52, 0);
    tick.rotation.z = ang;
    group.add(tick);
  }

  const pipMat = new MeshBasicMaterial(
    additiveMaterialParameters({ color: hdr(LOCK_GOLD, 2.4) }),
  );
  const pips: Mesh[] = [];

  for (let i = 0; i < 6; i++) {
    const pip = new Mesh(reticlePipGeom, pipMat.clone());
    const ang = (i / 6) * Math.PI * 2 - Math.PI / 2;
    pip.position.set(Math.cos(ang) * 0.86, Math.sin(ang) * 0.86, 0);
    pip.visible = false;
    group.add(pip);
    pips.push(pip);
  }

  group.userData = { ring, pips, ringMat, pipMat } as ReticleUserData;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  const data = reticle.userData as ReticleUserData;
  if (!data || !data.pips) return;

  const targetScale = 1.0 + lockCount * 0.06 + (active ? 0.08 : 0);
  reticle.scale.setScalar(targetScale);

  for (let i = 0; i < data.pips.length; i++) {
    data.pips[i].visible = i < lockCount;
  }
}
