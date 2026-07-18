import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera, PerspectiveCamera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createPendingVisualRecords,
  createTransientEffectPool,
  disposeObject3D,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { createStrandlineRail, type StrandlineEnemyKind } from '../gameplay';
import { STRANDLINE_DURATION } from '../timing';
import { createStrandlineEnvironment } from './environment';
import {
  createParasite,
  createStrandGlyph,
  createStrandProjectile,
  createStrandReticle,
  type StrandlinePalette,
} from './models';

export const PALETTE: StrandlinePalette = {
  deep: new Color(0.006, 0.065, 0.12),
  water: new Color(0.02, 0.33, 0.43),
  jade: new Color(0.16, 0.82, 0.5),
  gold: new Color(0.82, 1, 0.38),
  sun: new Color(0.72, 1, 0.82),
  parasite: new Color(0.34, 0.055, 0.46),
  sour: new Color(0.82, 0.16, 1),
  shadow: new Color(0.055, 0.018, 0.09),
};

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number;
  locked: boolean;
};
type VisualContext = { scene: Scene; camera: Camera };
type Pulse = { mesh: Mesh; color: Color; scale: number; inward: boolean; age: number; life: number };
type Fragment = { mesh: Mesh; velocity: Vector3; spin: Vector3; scale: number; age: number; life: number };

const enemies = createPendingVisualRecords<Group, EnemyRecord, [string]>({
  createRecord: (mesh, kind) => ({ mesh, kind, bornAt: elapsedNow, locked: false }),
  disposeRecord: (record) => disposeObject3D(record.mesh),
});
const projectiles = createPendingVisualRecords<Group, Group>({
  createRecord: (mesh) => mesh,
  disposeRecord: disposeObject3D,
});
const PULSE_GEOMETRY = new RingGeometry(0.92, 1, 36);
const pulses = createTransientEffectPool<Pulse, VisualContext>({
  update(effect, progress, _dt, context) {
    effect.mesh.quaternion.copy(context.camera.quaternion);
    const curve = effect.inward ? 1.6 - progress * 1.42 : 0.16 + progress * 1.65;
    effect.mesh.scale.setScalar(effect.scale * curve);
    const material = effect.mesh.material as MeshBasicMaterial;
    material.color.copy(effect.color).multiplyScalar(1.6 * (1 - progress) ** 1.35);
    material.opacity = (1 - progress) ** 1.2;
  },
  dispose(effect) {
    effect.mesh.removeFromParent();
    (effect.mesh.material as MeshBasicMaterial).dispose();
  },
});
const FRAGMENT_GEOMETRY = new OctahedronGeometry(0.13, 0);
const fragments = createTransientEffectPool<Fragment, VisualContext>({
  update(fragment, progress, dt) {
    fragment.mesh.position.addScaledVector(fragment.velocity, dt);
    fragment.velocity.multiplyScalar(Math.exp(-dt * 1.7));
    fragment.mesh.rotation.x += fragment.spin.x * dt;
    fragment.mesh.rotation.y += fragment.spin.y * dt;
    fragment.mesh.rotation.z += fragment.spin.z * dt;
    fragment.mesh.scale.setScalar(Math.max(0.01, fragment.scale * (1 - progress) * (0.55 + progress)));
    const material = fragment.mesh.material as MeshBasicMaterial;
    material.opacity = (1 - progress) ** 1.4;
  },
  dispose(fragment) {
    fragment.mesh.removeFromParent();
    (fragment.mesh.material as MeshBasicMaterial).dispose();
  },
});

let environment: ReturnType<typeof createStrandlineEnvironment> | null = null;
let elapsedNow = 0;
let runTimeNow = 0;
let beatEnergy = 0;
let broodsRemaining = 3;
let parentReleased = false;
let reticleRef: Group | null = null;
let releaseOrigin: Vector3 | null = null;
let releaseStartedAt = -1;

export function createEnvironment(scene: Scene) {
  environment?.dispose();
  environment = createStrandlineEnvironment(scene, { rail: createStrandlineRail(), palette: PALETTE });
  return environment.root;
}

export function disposeVisuals(scene: Scene, camera: Camera) {
  pulses.clear({ scene, camera });
  fragments.clear({ scene, camera });
  enemies.clear({ dispose: true, pending: true });
  projectiles.clear({ dispose: true, pending: true });
  environment?.dispose();
  environment = null;
  if (reticleRef) disposeObject3D(reticleRef);
  reticleRef = null;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' || letter
    ? createStrandGlyph(letter ?? 'A', PALETTE)
    : createParasite(kind as StrandlineEnemyKind, PALETTE);
  mesh.scale.setScalar(0.001);
  enemies.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  mesh.userData.locked = locked;
  const record = [...enemies.values()].find((candidate) => candidate.mesh === mesh);
  if (record) record.locked = locked;
  const color = colorForLockCount(lockCount, [PALETTE.jade, PALETTE.gold, PALETTE.sun]);
  tintMaterials(mesh, locked ? color : undefined, locked ? 1.8 : 1);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.55;
  tintMaterials(mesh, PALETTE.sour, 2.25);
}

export function createProjectileMesh() {
  return projectiles.enqueue(createStrandProjectile(PALETTE));
}

export function createReticle() {
  reticleRef = createStrandReticle(PALETTE);
  return reticleRef;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.08 : 0));
  const materials = reticle.userData.materials as MeshBasicMaterial[] | undefined;
  const color = lockCount > 0 ? colorForLockCount(lockCount, [PALETTE.jade, PALETTE.gold, PALETTE.sun]) : PALETTE.jade;
  materials?.forEach((material) => material.color.copy(color).multiplyScalar(active ? 1.65 : 1.2));
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, camera: Camera, feel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    enemies.claim(enemyId, kind);
    const color = kind === 'parent' || kind === 'brood' ? PALETTE.sour : PALETTE.parasite;
    const scale = kind === 'parent' ? 5.5 : kind === 'brood' ? 3 : 1.7;
    pulse(scene, worldPosition, color, scale, kind === 'parent' ? 0.64 : 0.34, kind === 'parent');
    if (kind === 'parent') {
      pulse(scene, worldPosition, PALETTE.sour, 8, 0.9, true);
      feel.shake(0.62, { decay: 1.4, maxTrauma: 0.8 });
    }
    if (kind === 'venom') {
      pulse(scene, worldPosition, PALETTE.sour, 2.3, 0.26, true);
      feel.shake(0.08, { decay: 6 });
    }
  });

  bus.on('lock', ({ worldPosition, lockCount }) => {
    pulse(scene, worldPosition, colorForLockCount(lockCount, [PALETTE.jade, PALETTE.gold, PALETTE.sun]), 1.3, 0.22, true);
  });

  bus.on('unlock', ({ worldPosition }) => {
    pulse(scene, worldPosition, PALETTE.water, 1.15, 0.2, false);
  });

  bus.on('fire', ({ projectileId, worldPosition, volleySize }) => {
    projectiles.claim(projectileId);
    const full = volleySize === 6;
    pulse(scene, worldPosition, full ? PALETTE.sun : PALETTE.gold, 0.9 + volleySize * 0.1, full ? 0.36 : 0.2);
    feel.shake(full ? 0.52 : 0.08 + volleySize * 0.025, { decay: full ? 2.6 : 5.5 });
    if (full) {
      feel.kickFov(2.3, { decay: 4.2 });
      environment?.flash(0.24);
    }
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectiles.delete(projectileId, { dispose: true });
    const record = enemies.get(enemyId);
    if (record && !lethal) record.mesh.userData.flashUntil = elapsedNow + 0.22;
    pulse(scene, worldPosition, lethal ? PALETTE.gold : PALETTE.sour, lethal ? 3.2 : 1.8, lethal ? 0.42 : 0.24);
    burst(scene, worldPosition, lethal ? PALETTE.gold : PALETTE.sour, lethal ? 5 : 3, lethal ? 3.8 : 2.2, enemyId * 3.17);
    environment?.flash(lethal ? 0.11 : 0.045);
  });

  bus.on('stage', ({ enemyId, worldPosition, stageIndex, hitStageCount }) => {
    const record = enemies.get(enemyId);
    if (record) record.mesh.userData.stage = stageIndex;
    if (record?.kind === 'nurse') record.mesh.userData.shellBroken = true;
    pulse(scene, worldPosition, PALETTE.sun, record?.kind === 'parent' ? 5.8 : 3.5, 0.48);
    pulse(scene, worldPosition, PALETTE.sour, 2.6, 0.32, true);
    feel.shake(record?.kind === 'parent' ? 0.9 : 0.52, { decay: 2.8 });
    feel.kickFov(0.9 + stageIndex / Math.max(1, hitStageCount), { decay: 4 });
    burst(scene, worldPosition, record?.kind === 'parent' ? PALETTE.sun : PALETTE.sour, record?.kind === 'parent' ? 12 : 7, record?.kind === 'parent' ? 6.2 : 4.2, enemyId * 7.31 + stageIndex);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    const kind = record?.kind;
    enemies.delete(enemyId, { dispose: true });
    const major = kind === 'brood' || kind === 'parent';
    pulse(scene, worldPosition, major ? PALETTE.sun : PALETTE.gold, kind === 'parent' ? 9 : major ? 5.2 : 3.2, kind === 'parent' ? 1.05 : major ? 0.65 : 0.4);
    pulse(scene, worldPosition, kind === 'parent' ? PALETTE.jade : PALETTE.sour, kind === 'parent' ? 6.5 : major ? 3.4 : 2, kind === 'parent' ? 0.82 : 0.38, true);
    burst(scene, worldPosition, kind === 'parent' ? PALETTE.sun : kind === 'brood' ? PALETTE.sour : PALETTE.gold, kind === 'parent' ? 22 : kind === 'brood' ? 13 : 8, kind === 'parent' ? 8.5 : major ? 6 : 4.5, enemyId * 11.73);
    if (kind === 'brood') {
      broodsRemaining = Math.max(0, broodsRemaining - 1);
      const slot = Number(record?.mesh.userData.broodSlot ?? -1);
      if (slot >= 0) environment?.clearWebSector(slot);
      else environment?.setBroodSectors(broodsRemaining);
      environment?.restore(0.09);
      environment?.flash(0.38);
      feel.shake(0.86, { decay: 2.2 });
    }
    if (kind === 'parent') {
      parentReleased = true;
      releaseOrigin = null;
      releaseStartedAt = runTimeNow;
      environment?.setParentReleased(true);
      environment?.flash(1);
      feel.shake(1.35, { decay: 1.15, maxTrauma: 1.5, rollDegrees: 1.7 });
      feel.kickFov(5, { decay: 0.65 });
    }
    if (kind && kind !== 'brood' && kind !== 'parent' && kind !== 'venom') {
      environment?.restore(kind === 'nurse' ? 0.032 : 0.02);
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    enemies.delete(enemyId, { dispose: true });
    pulse(scene, worldPosition, PALETTE.sour, 1.7, 0.24, true);
  });

  bus.on('reject', ({ enemyIds, missingEnemyIds }) => {
    const ids = new Set([...enemyIds, ...(missingEnemyIds ?? [])]);
    ids.forEach((enemyId) => {
      const record = enemies.get(enemyId);
      if (!record) return;
      record.mesh.userData.deniedUntil = elapsedNow + 0.58;
      pulse(scene, record.mesh.position, PALETTE.sour, 2.5, 0.3);
      pulse(scene, record.mesh.position, PALETTE.shadow, 1.4, 0.22, true);
    });
    feel.shake(0.18);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size === 6 && kills === 6) {
      beatEnergy = 1.45;
      environment?.flash(0.32);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.42);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase !== 'exposed') return;
    const parent = [...enemies.values()].find((record) => record.kind === 'parent');
    if (!parent) return;
    pulse(scene, parent.mesh.position, PALETTE.sun, 9.5, 0.95);
    pulse(scene, parent.mesh.position, PALETTE.jade, 6.4, 0.72, true);
    environment?.flash(0.82);
    feel.shake(1.05, { decay: 1.45, maxTrauma: 1.25, rollDegrees: 1.4 });
    feel.kickFov(3.8, { decay: 1.3 });
  });

  bus.on('runstart', () => {
    enemies.clear({ dispose: true });
    projectiles.clear({ dispose: true });
    fragments.clear({ scene, camera });
    broodsRemaining = 3;
    parentReleased = false;
    releaseOrigin = null;
    releaseStartedAt = -1;
    runTimeNow = 0;
    environment?.reset();
    feel.restore();
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.7;
    environment?.flash(0.42);
    const impact = new Vector3();
    camera.getWorldDirection(impact);
    impact.multiplyScalar(1.15).add(camera.position);
    pulse(scene, impact, PALETTE.sour, 4.8, 0.46, true);
    burst(scene, impact, PALETTE.sour, 14, 5.8, elapsedNow * 17.3 + runTimeNow);
    feel.shake(1.18, { decay: 2.1, maxTrauma: 1.4, pitchDegrees: 0.75, yawDegrees: 0.65, rollDegrees: 1.5 });
  });
}

function pulse(scene: Scene, position: Vector3, color: Color, scale: number, life: number, inward = false) {
  const mesh = new Mesh(PULSE_GEOMETRY, new MeshBasicMaterial({
    color: color.clone().multiplyScalar(1.6),
    side: DoubleSide,
    transparent: true,
    opacity: 1,
    blending: AdditiveBlending,
    depthWrite: false,
  }));
  mesh.position.copy(position);
  scene.add(mesh);
  pulses.add({ mesh, color: color.clone(), scale, inward, age: 0, life });
}

function burst(scene: Scene, position: Vector3, color: Color, count: number, energy: number, seed: number) {
  for (let index = 0; index < count; index += 1) {
    const azimuth = hash01(seed + index * 4.17) * Math.PI * 2;
    const z = hash01(seed * 1.9 + index * 7.31) * 2 - 1;
    const radial = Math.sqrt(Math.max(0, 1 - z * z));
    const speed = energy * (0.45 + hash01(seed * 0.7 + index * 2.11) * 0.75);
    const velocity = new Vector3(Math.cos(azimuth) * radial, Math.sin(azimuth) * radial, z).multiplyScalar(speed);
    const material = new MeshBasicMaterial({
      color: color.clone().multiplyScalar(1.25 + hash01(seed + index) * 0.8),
      transparent: true,
      opacity: 0.95,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new Mesh(FRAGMENT_GEOMETRY, material);
    mesh.position.copy(position);
    const scalar = 0.65 + hash01(seed + index * 9.2) * 1.4;
    mesh.scale.setScalar(scalar);
    scene.add(mesh);
    fragments.add({
      mesh,
      velocity,
      spin: new Vector3(
        (hash01(seed + index * 1.3) - 0.5) * 12,
        (hash01(seed + index * 2.7) - 0.5) * 12,
        (hash01(seed + index * 5.1) - 0.5) * 12,
      ),
      scale: scalar,
      age: 0,
      life: 0.45 + hash01(seed + index * 8.3) * 0.48,
    });
  }
}

function hash01(n: number) {
  const value = Math.sin(n * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function tintMaterials(mesh: Object3D, color?: Color, intensity = 1) {
  const materials = mesh.userData.materials as Array<MeshBasicMaterial> | undefined;
  materials?.forEach((material) => {
    const base = material.userData.baseColor as Color | undefined;
    material.color.copy(color ? color.clone().multiplyScalar(intensity) : base ?? PALETTE.parasite);
  });
}

export function updateVisuals(
  dt: number,
  context: { scene: Scene; camera: Camera; feel: CameraFeelRig; elapsed: number; runTime: number; running: boolean },
) {
  elapsedNow = context.elapsed;
  runTimeNow = context.runTime;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.8);
  environment?.update(dt, runTimeNow, context.running, beatEnergy, context.camera);
  context.feel.setFovOffset(context.running ? beatEnergy * 0.8 + Math.min(2, runTimeNow / 30) : beatEnergy * 0.35);

  for (const record of enemies.values()) {
    const age = elapsedNow - record.bornAt;
    const intro = Math.min(1, age / (record.kind === 'parent' ? 0.75 : record.kind === 'brood' ? 0.45 : 0.24));
    const smooth = intro * intro * (3 - 2 * intro);
    const denied = Number(record.mesh.userData.deniedUntil ?? -1) > elapsedNow;
    const flashing = Number(record.mesh.userData.flashUntil ?? -1) > elapsedNow;
    const pump = Number(record.mesh.userData.pump ?? 0);
    const brake = Number(record.mesh.userData.brake ?? 0);
    const baseScale = record.kind === 'parent' ? 1.65 : record.kind === 'brood' ? 1.35 : record.kind === 'nurse' ? 1.08 : record.kind === 'venom' ? 1.18 + brake * 0.35 : 1;
    const breathe = 1 + pump * 0.06 + (record.locked ? Math.sin(elapsedNow * 14) * 0.055 : 0);
    const denyScale = denied ? 1 + Math.sin(elapsedNow * 43) * 0.12 : 1;
    record.mesh.scale.setScalar(smooth * baseScale * breathe * denyScale);

    if (denied) tintMaterials(record.mesh, PALETTE.sour, 2.2);
    else if (flashing) tintMaterials(record.mesh, PALETTE.sun, 2.25);
    else if (!record.locked) tintMaterials(record.mesh);

    const anchorPart = record.mesh.userData.anchorPart as Object3D | undefined;
    if (anchorPart) {
      const detach = Number(record.mesh.userData.detach ?? 0);
      anchorPart.visible = detach < 0.98;
      anchorPart.scale.y = Math.max(0.02, 1 - detach);
    }

    const rotors = record.mesh.userData.rotors as Object3D[] | undefined;
    rotors?.forEach((rotor, index) => {
      rotor.rotation.z += dt * (index % 2 ? -1.15 : 1.45) * (record.locked ? 2 : 1);
      if (record.kind === 'nurse' && record.mesh.userData.shellBroken) {
        const target = index === 0 ? 0.34 : 0.62;
        rotor.scale.lerp(new Vector3(target, target, target), Math.min(1, dt * 6));
      }
      if (record.kind === 'parent') {
        const stage = Number(record.mesh.userData.stage ?? 0);
        const target = 1 + stage * 0.28 + pump * 0.06;
        rotor.scale.lerp(new Vector3(target, target, target), Math.min(1, dt * 4.5));
      }
    });
    const animated = record.mesh.userData.animatedParts as Object3D[] | undefined;
    animated?.forEach((part, index) => {
      part.rotation.y = Math.sin(elapsedNow * (2.2 + index * 0.15) + index) * (record.kind === 'parent' ? 0.24 : 0.12);
      if (record.kind === 'parent') {
        const stage = Number(record.mesh.userData.stage ?? 0);
        const broken = index < stage * 2;
        const target = broken ? 0.08 : 1;
        part.scale.lerp(new Vector3(target, target, target), Math.min(1, dt * 5));
      }
    });
    if (record.kind === 'parent') {
      const webSectors = record.mesh.userData.webSectors as Group[] | undefined;
      const remaining = Number(record.mesh.userData.webs ?? broodsRemaining);
      const mask = record.mesh.userData.webMask as boolean[] | undefined;
      webSectors?.forEach((sector, index) => {
        sector.visible = mask?.[index] ?? index < remaining;
        sector.rotation.z = Math.sin(elapsedNow * 0.8 + index * 2) * 0.05;
      });
    }
  }

  for (const projectile of projectiles.values()) {
    projectile.rotateZ(dt * 10);
    const rotors = projectile.userData.rotors as Object3D[] | undefined;
    rotors?.forEach((rotor, index) => { rotor.rotation.z += dt * (index ? -7 : 8); });
  }
  if (reticleRef) {
    const rotors = reticleRef.userData.rotors as Object3D[] | undefined;
    rotors?.forEach((rotor, index) => { rotor.rotation.z += dt * (index % 2 ? -0.48 : 0.72) * (reticleRef?.userData.active ? 2.1 : 1); });
  }
  pulses.update(dt, context);
  fragments.update(dt, context);
}

export function updateReleaseCamera(camera: PerspectiveCamera, runTime: number) {
  if (!parentReleased || releaseStartedAt < 0 || runTime < releaseStartedAt) return;
  releaseOrigin ??= camera.position.clone();
  const travelSeconds = Math.max(0.15, STRANDLINE_DURATION - releaseStartedAt);
  const raw = Math.min(1, Math.max(0, (runTime - releaseStartedAt) / travelSeconds));
  const p = raw * raw * (3 - 2 * raw);
  // Pull wide enough to reveal the bell and the entire clean curtain for the
  // first time. The target stays on the crown while the body drifts upward.
  const targetPosition = new Vector3(135, 92, 76);
  camera.position.copy(releaseOrigin).lerp(targetPosition, p);
  camera.lookAt(new Vector3(0, 4 + p * 10, -232));
  camera.rotateZ(-p * 0.035);
  camera.fov = 58 + p * 16;
  camera.updateProjectionMatrix();
}
