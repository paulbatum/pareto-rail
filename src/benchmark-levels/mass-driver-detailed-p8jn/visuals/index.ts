import {
  CircleGeometry, Color, DoubleSide, Group, Line, MathUtils, Mesh, MeshBasicMaterial,
  Object3D, PerspectiveCamera, RingGeometry, Scene, Vector3,
} from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createAdditiveBasicMaterial, createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { massDriverSpeed } from '../gameplay';
import { MASS_DRIVER_BARS, MASS_DRIVER_SHOT_TIME, MASS_DRIVER_TIME } from '../timing';
import { arc, burst, createEffects, crossGlint, pulse, resetEffects, updateEffects } from './effects';
import { createEnvironmentInternal, disposeEnvironment, updateEnvironment, type MassDriverEnvironment } from './environment';
import {
  createArcMesh, createCapacitorMesh, createCoilMesh, createInterlockMesh, createLetterMesh,
  createPlayerProjectile, createThreaderMesh, exposeArmor, type TintPart,
} from './models';
import { ARC_BLUE, GUNMETAL, HAZARD_AMBER, HAZARD_RED, HOT_VIOLET, ION_BLUE, ION_WHITE, LOCK_GRADIENT, VIOLET, hdr, heatColor } from './palette';
import { chargeUniform, detonationUniform, flashUniform } from './post-fx';

type EnemyRecord = { mesh: Group; born: number; lockRing: Group | null; targetScale: number; lastCrackle: number };
type ProjectileRecord = { mesh: Object3D; lastPosition: Vector3 };

let environment: MassDriverEnvironment | null = null;
let sceneNow: Scene | null = null;
let elapsedNow = 0;
let beatPulse = 0;
let fullVolleyPulse = 0;
let shotPulse = 0;
let ringPulsePending = 0;
let clearSweepProgress = -1;
let detonationEnergy = 0;
let shotSuccess: boolean | null = null;
let cameraFeel: CameraFeelRig | null = null;

const SHAKE: CameraFeelShakeOptions = { decay: 2.8, maxTrauma: 2.2, pitchDegrees: 0.42, yawDegrees: 0.32, rollDegrees: 1.35, frequency: 13, smoothing: 24 };

function disposeObject(root: Object3D) {
  root.traverse((child) => {
    if (!(child instanceof Mesh) && !(child instanceof Line)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}

const enemies = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, born: elapsedNow, lockRing: null, targetScale: mesh.userData.kindScale ?? 1, lastCrackle: -1 }),
  disposeRecord(record) { if (record.lockRing) { record.lockRing.removeFromParent(); disposeObject(record.lockRing); } disposeObject(record.mesh); },
});
const projectiles = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({ createRecord: (record) => record, disposeRecord(record) { disposeObject(record.mesh); } });

export function createEnvironment(scene: Scene) {
  sceneNow = scene; environment = createEnvironmentInternal(scene); createEffects(scene); return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  let mesh: Group;
  switch (kind) {
    case 'letter': mesh = createLetterMesh(letter ?? 'A'); break;
    case 'threader': mesh = createThreaderMesh(); break;
    case 'capacitor': mesh = createCapacitorMesh(); break;
    case 'arc': mesh = createArcMesh(); break;
    case 'interlock': mesh = createInterlockMesh(); break;
    default: mesh = createCoilMesh();
  }
  mesh.userData.kind = kind; mesh.scale.setScalar(0.001); enemies.enqueue(mesh); return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  mesh.userData.locked = locked; mesh.userData.lockCount = lockCount;
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.48;
  pulse(mesh.position, HAZARD_RED, 3.2, 0.34, 6); burst(mesh.position, HAZARD_RED, 7, 5, 0.3);
  detonationUniform.value = Math.max(detonationUniform.value, 0.16);
}

export function createProjectileMesh() {
  const mesh = createPlayerProjectile(); projectiles.enqueue({ mesh, lastPosition: new Vector3() }); return mesh;
}

export function createReticle() {
  const root = new Group(); const segments: Array<{ mesh: Mesh; material: MeshBasicMaterial }> = [];
  const outer = new Mesh(new RingGeometry(0.58, 0.615, 48), createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.15), opacity: 0.88, side: DoubleSide })); root.add(outer);
  const spinner = new Group();
  for (let i = 0; i < 6; i += 1) {
    const material = createAdditiveBasicMaterial({ color: hdr(GUNMETAL, 0.8), opacity: 0.62, side: DoubleSide });
    const mesh = new Mesh(new RingGeometry(0.72, 0.79, 10, 1, i * Math.PI / 3 + 0.04, Math.PI / 3 - 0.08), material);
    spinner.add(mesh); segments.push({ mesh, material });
  }
  const inner = new Mesh(new RingGeometry(0.25, 0.28, 6), createAdditiveBasicMaterial({ color: hdr(ION_BLUE, 1.25), opacity: 0.85 })); spinner.add(inner); root.add(spinner);
  const dot = new Mesh(new CircleGeometry(0.042, 12), new MeshBasicMaterial({ color: hdr(ION_WHITE, 2.1) })); root.add(dot);
  root.userData.segments = segments; root.userData.spinner = spinner; root.userData.active = false; return root;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active; reticle.userData.lockCount = lockCount; reticle.scale.setScalar(1 + lockCount * 0.045 + (active ? 0.04 : 0));
  const segments = reticle.userData.segments as Array<{ mesh: Mesh; material: MeshBasicMaterial }>;
  segments.forEach(({ material }, index) => {
    const lit = index < lockCount;
    material.color.copy(lit ? hdr(LOCK_GRADIENT[index], index === 5 ? 2.3 : 1.45) : hdr(ARC_BLUE, active ? 0.36 : 0.22));
    material.opacity = lit ? 0.98 : 0.38;
  });
}

function createLockClamp(color: Color, boss: boolean) {
  const root = new Group(); const radius = boss ? 2.5 : 1.42;
  for (let layer = 0; layer < 2; layer += 1) {
    const material = createAdditiveBasicMaterial({ color: hdr(color, layer ? 1.05 : 1.5), opacity: layer ? 0.58 : 0.9 });
    const ring = new Mesh(new RingGeometry(radius + layer * 0.2, radius + 0.08 + layer * 0.2, 6), material); ring.rotation.z = Math.PI / 6 + layer * Math.PI / 12; root.add(ring);
  }
  return root;
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  cameraFeel = feel;
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemies.claim(enemyId); if (!record) return; record.born = elapsedNow;
    if (kind === 'interlock') {
      pulse(worldPosition, HAZARD_AMBER, 8, 0.65, 6); pulse(worldPosition, HAZARD_AMBER, 5, 0.45, 6);
      burst(worldPosition, HAZARD_AMBER, 16, 8, 0.55); feel.shake(0.42, SHAKE);
    } else if (kind === 'arc') {
      pulse(worldPosition, ION_WHITE, 2.2, 0.24, 10);
    } else pulse(worldPosition, kind === 'capacitor' ? VIOLET : ARC_BLUE, 2.4, 0.3, 6);
  });
  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const record = enemies.get(enemyId); const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    if (record && !record.lockRing) { record.lockRing = createLockClamp(color, Boolean(record.mesh.userData.isInterlock)); scene.add(record.lockRing); }
    pulse(worldPosition, color, 1.9, 0.22, 6); if (lockCount === 6) { flashUniform.value = Math.max(flashUniform.value, 0.26); feel.shake(0.18, SHAKE); }
  });
  bus.on('unlock', ({ enemyId }) => { const record = enemies.get(enemyId); if (record?.lockRing) { record.lockRing.removeFromParent(); disposeObject(record.lockRing); record.lockRing = null; } });
  bus.on('fire', ({ projectileId, worldPosition }) => { projectiles.claim(projectileId); crossGlint(worldPosition, 0.65); burst(worldPosition, ARC_BLUE, 4, 7, 0.18); });
  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectiles.delete(projectileId, { dispose: true }); const record = enemies.get(enemyId); if (record) record.mesh.userData.flashUntil = elapsedNow + 0.15;
    crossGlint(worldPosition, lethal ? 1.15 : 0.72); burst(worldPosition, lethal ? ION_WHITE : ARC_BLUE, lethal ? 15 : 7, lethal ? 12 : 7, lethal ? 0.62 : 0.3);
    if (!lethal) { const offset = new Vector3(1.6, 0.8, -0.5); arc(worldPosition.clone().sub(offset), worldPosition.clone().add(offset), HOT_VIOLET, 0.24, enemyId); }
  });
  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId); if (record) exposeArmor(record.mesh);
    pulse(worldPosition, record?.mesh.userData.isInterlock ? HAZARD_AMBER : VIOLET, 5.5, 0.48, 6); burst(worldPosition, ION_WHITE, 22, 14, 0.7);
    arc(worldPosition.clone().add(new Vector3(-2.5, 1, 0)), worldPosition.clone().add(new Vector3(2.5, -1, 0)), ION_WHITE, 0.34, enemyId);
    feel.shake(record?.mesh.userData.isInterlock ? 0.52 : 0.28, SHAKE);
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId); const boss = Boolean(record?.mesh.userData.isInterlock);
    pulse(worldPosition, boss ? HAZARD_AMBER : VIOLET, boss ? 10 : 5, boss ? 0.72 : 0.45, 6);
    burst(worldPosition, boss ? ION_WHITE : ION_BLUE, boss ? 38 : 20, boss ? 21 : 14, boss ? 0.9 : 0.62);
    arc(worldPosition.clone().add(new Vector3(-3, 2, 0)), worldPosition.clone().add(new Vector3(3, -2, 0)), boss ? HAZARD_AMBER : VIOLET, boss ? 0.46 : 0.3, enemyId * 3);
    if (boss) { arc(worldPosition.clone().add(new Vector3(-2, -2.5, 0)), worldPosition.clone().add(new Vector3(2, 2.5, 0)), ION_WHITE, 0.4, enemyId * 7); feel.shake(0.62, SHAKE); }
    enemies.delete(enemyId, { dispose: true });
  });
  bus.on('miss', ({ enemyId, worldPosition }) => { burst(worldPosition, ARC_BLUE, 3, 2.5, 0.2); enemies.delete(enemyId, { dispose: true }); });
  bus.on('volley', ({ size, kills }) => { if (size === 6 && kills === 6) { fullVolleyPulse = 1; flashUniform.value = Math.max(flashUniform.value, 0.22); feel.shake(0.42, SHAKE); } });
  bus.on('reject', () => { detonationUniform.value = Math.max(detonationUniform.value, 0.24); feel.shake(0.28, SHAKE); });
  bus.on('beat', ({ isDownbeat }) => {
    beatPulse = isDownbeat ? 1 : 0.48; ringPulsePending = isDownbeat ? 2 : 1;
    feel.shake(isDownbeat ? 0.075 : 0.025, SHAKE);
    if (isDownbeat) feel.kickFov(0.32, { decay: 9 });
  });
  bus.on('playerhit', ({ healthRemaining }) => {
    detonationUniform.value = Math.max(detonationUniform.value, healthRemaining <= 0 ? 1.65 : 0.58); flashUniform.value = Math.max(flashUniform.value, healthRemaining <= 0 ? 0.8 : 0.15);
    if (healthRemaining <= 0) detonationEnergy = 1;
    feel.shake(healthRemaining <= 0 ? 2.1 : 0.9, SHAKE);
  });
  bus.on('bossphase', ({ phase }) => { if (phase === 'destroyed') { clearSweepProgress = 0; flashUniform.value = Math.max(flashUniform.value, 0.82); chargeUniform.value *= 0.35; feel.shake(1.0, SHAKE); } });
  bus.on('runstart', () => {
    resetEffects(); enemies.clear({ dispose: true, pending: true }); projectiles.clear({ pending: true });
    beatPulse = 0; fullVolleyPulse = 0; shotPulse = 0; ringPulsePending = 0; clearSweepProgress = -1; detonationEnergy = 0; shotSuccess = null; flashUniform.value = 0; chargeUniform.value = 0; detonationUniform.value = 0;
  });
}

export function triggerShot(success: boolean) {
  shotPulse = 1;
  shotSuccess = success;
  if (success) { flashUniform.value = 1.65; chargeUniform.value = 0; cameraFeel?.kickFov(17, { decay: 2.4 }); cameraFeel?.shake(2.1, SHAKE); }
  else { detonationEnergy = 1; detonationUniform.value = 1.8; flashUniform.value = 0.75; cameraFeel?.kickFov(8, { decay: 1.8 }); cameraFeel?.shake(2.2, SHAKE); }
}

export function updateCameraEffects(dt: number, context: { camera: PerspectiveCamera; runTime: number; running: boolean; feel: CameraFeelRig }) {
  const speed = context.running ? massDriverSpeed.speedAt(context.runTime) : 0.3;
  context.feel.setFovOffset(Math.min(8.5, speed * 0.75), { response: 6 });
  if (context.running && context.runTime < MASS_DRIVER_SHOT_TIME) {
    const taper = 1 - MathUtils.smoothstep(context.runTime, MASS_DRIVER_TIME.bar(25), MASS_DRIVER_SHOT_TIME);
    context.camera.rotateZ(Math.sin(context.runTime * 0.72) * 0.012 * taper);
  }
  context.feel.update(dt, { shake: SHAKE });
}

export function updateVisuals(dt: number, context: { camera: PerspectiveCamera; elapsed: number; runTime: number; running: boolean }) {
  elapsedNow = context.elapsed;
  beatPulse *= Math.exp(-dt * 7.5); fullVolleyPulse *= Math.exp(-dt * 5); shotPulse *= Math.exp(-dt * 2.2);
  if (clearSweepProgress >= 0) { clearSweepProgress += dt * 1.15; if (clearSweepProgress > 1.15) clearSweepProgress = -1; }
  detonationEnergy *= Math.exp(-dt * 1.35);
  flashUniform.value *= Math.exp(-dt * (shotPulse > 0.1 ? 2.2 : 8));
  detonationUniform.value *= Math.exp(-dt * 3.6);
  const interlockStart = MASS_DRIVER_TIME.bar(MASS_DRIVER_BARS.interlock);
  const charge = context.running ? MathUtils.clamp((context.runTime - interlockStart) / (MASS_DRIVER_SHOT_TIME - interlockStart), 0, 1) : 0;
  chargeUniform.value = context.runTime >= MASS_DRIVER_SHOT_TIME ? chargeUniform.value * Math.exp(-dt * 12) : Math.max(chargeUniform.value * Math.exp(-dt * 4), Math.pow(charge, 1.8) * 0.24);
  if (environment) updateEnvironment(environment, dt, { ...context, clearSweep: clearSweepProgress, detonation: detonationEnergy, shotSuccess, beatPulse });
  if (ringPulsePending && context.running && context.runTime < MASS_DRIVER_SHOT_TIME) {
    const forward = new Vector3(); context.camera.getWorldDirection(forward);
    const point = context.camera.position.clone().addScaledVector(forward, 2.8);
    const downbeat = ringPulsePending === 2;
    pulse(point, heatColor(context.runTime / MASS_DRIVER_SHOT_TIME), downbeat ? 6.8 : 4.2, downbeat ? 0.42 : 0.3, 48);
    ringPulsePending = 0;
  }

  for (const record of enemies.values()) {
    const introT = MathUtils.clamp((elapsedNow - record.born) * 5.8, 0.001, 1);
    const overshoot = introT < 0.72 ? MathUtils.lerp(0.001, 1.14, MathUtils.smoothstep(introT, 0, 0.72)) : MathUtils.lerp(1.14, 1, MathUtils.smoothstep(introT, 0.72, 1));
    const denied = record.mesh.userData.deniedUntil > elapsedNow;
    const enemyAge = Number(record.mesh.userData.enemyAge ?? (elapsedNow - record.born));
    const tell = Number(record.mesh.userData.fireTell ?? 0);
    const recoilRemaining = Number(record.mesh.userData.recoilUntil ?? -1) - enemyAge;
    const recoil = recoilRemaining > 0 ? Math.sin((recoilRemaining / 0.34) * Math.PI) : 0;
    record.mesh.scale.setScalar(record.targetScale * overshoot * (denied ? 0.82 + Math.sin(elapsedNow * 42) * 0.08 : 1) * (1 - tell * 0.09 + recoil * 0.16));
    const flash = record.mesh.userData.flashUntil > elapsedNow;
    const locked = Boolean(record.mesh.userData.locked); const lockCount = Number(record.mesh.userData.lockCount ?? 1);
    const tint = locked ? LOCK_GRADIENT[Math.min(5, lockCount - 1)] : null;
    const nearBoost = MathUtils.clamp(34 / Math.max(20, context.camera.position.distanceTo(record.mesh.position)) - 0.45, 0, 0.55);
    for (const part of (record.mesh.userData.tintParts ?? []) as TintPart[]) {
      if (denied) part.material.color.copy(part.role === 'fill' ? hdr(HAZARD_RED, 0.28) : hdr(HAZARD_RED, 1.5));
      else if (flash) part.material.color.copy(hdr(ION_WHITE, 2.5));
      else if (tint) part.material.color.copy(part.role === 'fill' ? hdr(tint, 0.28) : hdr(tint, part.role === 'core' ? 2 : 1.3));
      else part.material.color.copy(part.base).multiplyScalar(part.role === 'core' ? 1.5 + beatPulse * 0.3 + nearBoost + tell * 1.8 : 1 + nearBoost * 0.22 + tell * 0.08);
    }
    if (record.mesh.userData.kind === 'arc') {
      const frame = Number(record.mesh.userData.arcFrame ?? 0) + 1;
      record.mesh.userData.arcFrame = frame;
      record.mesh.traverse((child) => {
        if (child.name !== 'arc-shell') return;
        const seed = frame * 17.17 + child.id * 9.73;
        child.rotation.set(Math.sin(seed * 1.31) * Math.PI, Math.cos(seed * 0.79) * Math.PI, Math.sin(seed * 1.93) * Math.PI);
        child.scale.setScalar(0.76 + Math.abs(Math.sin(seed * 2.17)) * 0.48);
      });
    }
    if (record.mesh.userData.kind === 'threader') { const tail = record.mesh.userData.ionTail as Mesh | undefined; if (tail) tail.scale.x = 0.8 + Math.sin(elapsedNow * 17) * 0.18; }
    if (record.mesh.userData.exposed) {
      const core = record.mesh.getObjectByName(record.mesh.userData.kind === 'capacitor' ? 'exposed-core' : 'actuator-core');
      if (core) core.scale.setScalar(1 + Math.sin(elapsedNow * 46 + record.mesh.id) * 0.09);
      if (record.mesh.userData.kind === 'capacitor' && elapsedNow - record.lastCrackle > 0.17) {
        record.lastCrackle = elapsedNow;
        const side = new Vector3(Math.sin(elapsedNow * 31) * 1.2, Math.cos(elapsedNow * 27) * 1.2, 0.3);
        arc(record.mesh.position.clone().sub(side), record.mesh.position.clone().add(side), HOT_VIOLET, 0.14, record.mesh.id + elapsedNow * 10);
      }
    }
    if (record.lockRing) { record.lockRing.position.copy(record.mesh.position); record.lockRing.quaternion.copy(context.camera.quaternion); record.lockRing.rotation.z += dt * (record.mesh.userData.isInterlock ? 0.45 : 1.1); }
  }

  for (const record of projectiles.values()) record.lastPosition.copy(record.mesh.position);
  const spinnerSpeed = 0.45 + (context.running ? charge * 4.2 : 0.2);
  // Reticles are engine-owned scene children; spin all matching groups cheaply.
  sceneNow?.traverse((object) => { if (object.userData.spinner) (object.userData.spinner as Group).rotation.z += dt * spinnerSpeed; });
  updateEffects(dt, elapsedNow, context.camera.quaternion);
}

export function disposeVisuals() {
  resetEffects(); enemies.clear({ dispose: true, pending: true }); projectiles.clear({ pending: true });
  if (environment) disposeEnvironment(environment); environment = null; sceneNow = null; cameraFeel = null;
  flashUniform.value = 0; chargeUniform.value = 0; detonationUniform.value = 0;
  shotSuccess = null;
}
