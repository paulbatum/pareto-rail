import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Scene,
} from 'three';
import type { Camera } from 'three';
import { uniform } from 'three/tsl';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import type { EventBus } from '../../../events';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  configureAdditiveMaterial,
} from '../../../engine/visual-kit';
import {
  createCenserMesh,
  createGloomMesh,
  createHeartMesh,
  createPetalMesh,
  createShadeMesh,
  createSpokeMesh,
  createWatcherMesh,
  type EnemyVisuals,
} from './enemies';
import { burstMotes, burstPanels, createEffects, dropTrail, resetEffects, spawnGlint, spawnRing, updateEffects } from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import { ASH, GOLD, MOON, hdr } from './palette';
import { createWindowField, type WindowField } from './windows';
import { resetStolenWindows, takeStolenWindow } from '../lightstate';
import { beatUniform, createNave } from './nave';

// Visual spine for Vespers: palette decisions, event choreography, and the
// per-frame enemy loop. Mesh construction lives in the leaves (enemies,
// windows, nave, letters, effects).

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  feel: CameraFeelRig;
  elapsed: number;
  runProgress?: number;
};

type EnemyRecord = {
  mesh: EnemyVisuals;
  bornAt: number | null;
  lockRing: Group | null;
};

type ProjectileRecord = {
  mesh: Object3D;
  trailColor: Color;
};

let environmentGroup: Group | null = null;
let windows: WindowField | null = null;
let beatEnergy = 0;
let elapsedNow = 0;

// Screen-space light response: relighting a window throws its colour over
// the frame; the ignition floods it. Composited over the engine frame.
export const flashColor = uniform(new Color(0, 0, 0));
export const flashStrength = uniform(0);

function pushFlash(color: Color, strength: number) {
  const current = flashStrength.value as number;
  const blended = Math.min(0.55, current + strength);
  (flashColor.value as Color).lerp(color, current > 0.01 ? 0.5 : 1);
  flashStrength.value = blended;
}

const LOCK_GRADIENT = [GOLD, MOON, new Color(1.0, 0.32, 0.4)] as const;

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

const enemyRecords = createPendingVisualRecords<EnemyVisuals, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => lockRings.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  environmentGroup = createNave(scene);
  windows = createWindowField();
  environmentGroup.add(windows.group);
  createEffects(scene);
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.scale.setScalar(0.001);
  mesh.userData.kind = kind;
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): EnemyVisuals {
  if (kind === 'letter' || letter) return createLetterMesh(letter ?? 'A') as EnemyVisuals;
  switch (kind) {
    case 'shade':
      return createShadeMesh(0);
    case 'censer':
      return createCenserMesh(0);
    case 'watcher':
      return createWatcherMesh(0);
    case 'gloom':
      return createGloomMesh();
    case 'spoke':
      return createSpokeMesh(2);
    case 'petal':
      return createPetalMesh(1);
    case 'heart':
      return createHeartMesh();
    default:
      return createShadeMesh(0);
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
  }
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  if (mesh.userData.isLetter) setLetterDenied(mesh as Group);
  spawnRing(mesh.position, hdr(ASH, 1.1), 2.8, 0.32);
}

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(
    new OctahedronGeometry(0.3, 0),
    new MeshBasicMaterial({ color: hdr(MOON, 2.6) }),
  );
  core.scale.set(0.45, 0.45, 2.0);
  const shell = new Mesh(
    new OctahedronGeometry(0.46, 0),
    createAdditiveBasicMaterial({ color: hdr(GOLD, 0.9), opacity: 0.5 }),
  );
  shell.scale.set(0.55, 0.55, 1.8);
  group.add(core, shell);
  projectileRecords.enqueue({ mesh: group, trailColor: GOLD.clone().multiplyScalar(0.9) });
  return group;
}

export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color; active: Color }> = [];

  const addPart = (mesh: Mesh, base: Color, active: Color) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base, side: DoubleSide });
    parts.push({ material, base, active });
  };

  const outer = new Mesh(new RingGeometry(0.6, 0.645, 48), new MeshBasicMaterial());
  addPart(outer, hdr(GOLD, 1.1), hdr(MOON, 1.8));

  const spinner = new Group();
  const inner = new Mesh(new RingGeometry(0.33, 0.36, 3), new MeshBasicMaterial());
  addPart(inner, hdr(GOLD, 0.85), hdr(MOON, 1.6));
  spinner.add(inner);

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new PlaneGeometry(0.18, 0.035), new MeshBasicMaterial());
    addPart(tick, hdr(GOLD, 1.3), hdr(MOON, 2));
    const angle = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0);
    tick.rotation.z = angle;
    brackets.add(tick);
  }

  const dot = new Mesh(new CircleGeometry(0.05, 20), new MeshBasicMaterial());
  addPart(dot, hdr(MOON, 2), hdr(MOON, 3));

  group.add(outer, spinner, brackets, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.06 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color; active: Color }>;
  for (const part of parts) {
    part.material.color.copy(active ? part.active : part.base);
  }
}

export function installVisualEventHandlers(bus: EventBus, _scene: Scene) {
  bus.on('spawn', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? GOLD;
    spawnRing(worldPosition, accent, 3.0, 0.45);
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, [...LOCK_GRADIENT]);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockRing(lockColor), _scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.3), 2.3, 0.28);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(MOON, 1.2), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (lethal) {
      const accent = (record?.mesh.userData.shardColor as Color | undefined) ?? GOLD;
      burstMotes(worldPosition, accent.clone().multiplyScalar(0.5), 7, 6);
    } else {
      burstMotes(worldPosition, hdr(MOON, 0.9), 5, 9);
      const hitKind = record?.mesh.userData.kind;
      if (hitKind !== 'gloom' && record) {
        record.mesh.userData.damageFlashUntil = elapsedNow + 0.42;
        spawnRing(worldPosition, hdr(MOON, 1.3), 4.0, 0.32);
        spawnGlint(worldPosition, hdr(MOON, 2.0), 1.2, 0.18);
      }
    }
  });

  bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
    const record = enemyRecords.get(enemyId);
    if (record?.mesh.userData.kind !== 'heart') return;
    record.mesh.userData.damageLevel = Math.max(record.mesh.userData.damageLevel ?? 0, stageIndex);
    spawnRing(worldPosition, hdr(GOLD, 1.5), 6.4, 0.5);
    spawnGlint(worldPosition, hdr(MOON, 2.2), 1.8, 0.22);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const accent = (record.mesh.userData.shardColor as Color | undefined) ?? GOLD;

    if (record.mesh.userData.kind === 'heart') {
      // The Devourer breaks: the rose ignites, the whole nave comes up lit.
      const rosePosition = windows?.igniteAll();
      burstPanels(worldPosition, hdr(new Color(0.85, 0.7, 1.0), 1.2), 26);
      spawnRing(worldPosition, hdr(MOON, 2.2), 16, 0.9);
      spawnGlint(worldPosition, hdr(MOON, 3.0), 4.5, 0.5);
      pushFlash(new Color(0.9, 0.85, 1.0), 0.5);
      if (rosePosition) spawnRing(rosePosition, hdr(MOON, 2.4), 22, 1.1);
      enemyRecords.delete(enemyId, { dispose: true });
      return;
    }

    // The light goes back where it belongs.
    const windowIndex = takeStolenWindow(enemyId);
    if (windowIndex !== undefined && windows) {
      const position = windows.relight(windowIndex);
      if (position) {
        spawnRing(position, hdr(accent, 1.6), 6.5, 0.55);
        spawnGlint(position, hdr(accent, 2.2), 1.6, 0.25);
        pushFlash(accent, 0.1);
      }
    }

    burstPanels(worldPosition, accent, 9);
    burstMotes(worldPosition, accent.clone().multiplyScalar(0.6), 6, 7);
    spawnRing(worldPosition, hdr(accent, 1.0), 5.2, 0.5);
    spawnRing(worldPosition, hdr(MOON, 0.5), 3.0, 0.32);
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    burstMotes(worldPosition, ASH.clone().multiplyScalar(0.5), 4, 3);
  });

  bus.on('shielded', ({ shields }) => {
    for (const shield of shields) {
      const record = enemyRecords.get(shield.enemyId);
      if (record) record.mesh.userData.shieldFlashUntil = elapsedNow + 0.65;
      spawnRing(shield.worldPosition, hdr(GLOOMISH, 1.3), 4.6, 0.42);
      spawnGlint(shield.worldPosition, hdr(MOON, 1.6), 1.4, 0.18);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.4;
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.6;
    pushFlash(new Color(0.5, 0.05, 0.08), 0.22);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    windows?.reset();
    resetStolenWindows();
    flashStrength.value = 0;
    (flashColor.value as Color).set(0, 0, 0);
  });
}

const GLOOMISH = new Color(0.45, 0.38, 0.62);

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.0);
  beatUniform.value = beatEnergy;
  flashStrength.value = Math.max(0, (flashStrength.value as number) - dt * 0.55);

  ctx.feel.setFovOffset(beatEnergy * 0.7);

  windows?.update(dt);

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.4)));

    const userData = record.mesh.userData;
    const distance = record.mesh.position.distanceTo(ctx.camera.position);
    const closeness = smootherstep(1 - clamp01((distance - 14) / (48 - 14)));
    const hotScale = 0.35 + 0.65 * closeness;

    // Ember and glow: dim with distance, flare when locked, ash out when denied.
    const emberMaterial = userData.emberMaterial as MeshBasicMaterial | undefined;
    const glowMaterial = userData.glowMaterial as MeshBasicMaterial | undefined;
    const emberBase = userData.emberBase as Color | undefined;
    const glowBase = userData.glowBase as Color | undefined;
    if (emberMaterial && emberBase) {
      const locked = userData.locked === true;
      const target = locked ? hdr(MOON, 2.3) : emberBase;
      emberMaterial.color.copy(emberBase).lerp(target, locked ? 0.85 : 0).multiplyScalar(hotScale);
      const deniedUntil = userData.deniedUntil as number | undefined;
      if (deniedUntil !== undefined && deniedUntil > elapsedNow) {
        const flash = Math.min(1, (deniedUntil - elapsedNow) / 0.45);
        emberMaterial.color.lerp(hdr(ASH, 1.4), flash * 0.8);
      }
    }
    if (glowMaterial && glowBase) {
      glowMaterial.color.copy(glowBase).multiplyScalar(hotScale * (userData.locked === true ? 2.0 : 1));
    }

    // Shade wings beat slowly, like something breathing in the dark.
    const wings = userData.wings as [Mesh, Mesh] | undefined;
    if (wings) {
      const flap = Math.sin(age * 4.6) * 0.3;
      wings[0].rotation.z = 0.22 + flap;
      wings[1].rotation.z = -0.22 - flap;
    }

    // Watcher iris charge: the flare before the spit.
    const irisMaterial = userData.irisMaterial as MeshBasicMaterial | undefined;
    const irisBase = userData.irisBase as Color | undefined;
    if (irisMaterial && irisBase) {
      const chargeUntil = userData.chargeUntil as number | undefined;
      const charge = chargeUntil !== undefined && chargeUntil > elapsedNow
        ? 1 - (chargeUntil - elapsedNow) / 0.55
        : 0;
      irisMaterial.color.copy(irisBase).lerp(hdr(MOON, 2.4), charge * 0.9);
    }

    // Heart: the stolen colours circle the void; exposed, the void opens.
    const orbs = userData.orbs as Mesh[] | undefined;
    if (orbs) {
      userData.orbAngle = ((userData.orbAngle as number) ?? 0) + dt * 1.15;
      orbs.forEach((orb, index) => {
        const angle = (userData.orbAngle as number) + (index / orbs.length) * Math.PI * 2;
        orb.position.set(Math.cos(angle) * 1.55, Math.sin(angle) * 1.55, 0.05);
      });
      const exposed = userData.exposed === true;
      const voidGlowMaterial = userData.emberMaterial as MeshBasicMaterial | undefined;
      if (voidGlowMaterial) {
        voidGlowMaterial.opacity = exposed ? 0.85 : 0.25;
        voidGlowMaterial.color.copy(exposed ? hdr(MOON, 1.6) : new Color(0.5, 0.2, 0.6));
      }
    }

    // Boss damage flash.
    const damageFlashUntil = userData.damageFlashUntil as number | undefined;
    if (damageFlashUntil !== undefined && damageFlashUntil > elapsedNow) {
      const flash = Math.min(1, (damageFlashUntil - elapsedNow) / 0.42);
      if (emberMaterial) emberMaterial.color.lerp(hdr(MOON, 2.6), flash * 0.8);
      if (glowMaterial) glowMaterial.color.lerp(hdr(MOON, 1.4), flash * 0.8);
    }

    // Linked-layer denial flash (petals/heart sealed by the Devourer).
    const shieldFlashUntil = userData.shieldFlashUntil as number | undefined;
    if (shieldFlashUntil !== undefined && shieldFlashUntil > elapsedNow) {
      const flash = Math.min(1, (shieldFlashUntil - elapsedNow) / 0.65);
      if (emberMaterial) emberMaterial.color.lerp(hdr(GLOOMISH, 1.6), flash * 0.85);
      if (glowMaterial) glowMaterial.color.lerp(hdr(GLOOMISH, 1.2), flash * 0.85);
    }

    // Letter state machine: locked gold, denied crimson, else dim gold.
    if (userData.isLetter && userData.locked !== true) {
      const deniedUntil = userData.deniedUntil as number | undefined;
      if (deniedUntil !== undefined && deniedUntil > elapsedNow) setLetterDenied(record.mesh as unknown as Group);
      else setLetterLocked(record.mesh as unknown as Group, false);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.6;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      const fit = (userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.9 * fit);
    }
  }

  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(record.mesh.position, record.trailColor);
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 5 : 1.4);
    const brackets = reticleSpinner.parent?.userData.brackets as Group | undefined;
    if (brackets) brackets.rotation.z -= dt * (active ? 3.2 : 0.8);
  }

  updateEffects(dt, ctx.camera);
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.spinner) return child.userData.spinner as Group;
  }
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  const ring = new Mesh(
    new RingGeometry(0.86, 0.92, 4),
    createAdditiveBasicMaterial({ color: hdr(color, 1.8), side: DoubleSide }),
  );
  const innerRing = new Mesh(
    new RingGeometry(0.68, 0.71, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(MOON, 0.55), 1.4), side: DoubleSide }),
  );
  group.add(ring, innerRing);
  return group;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smootherstep(t: number): number {
  return t * t * (3 - 2 * t);
}
