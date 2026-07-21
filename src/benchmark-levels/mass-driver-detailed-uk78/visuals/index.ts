import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { EventBus } from '../../../events';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { createAdditiveBasicMaterial, createPendingVisualRecords, disposeObject3D } from '../../../engine/visual-kit';
import type { MassDriverEnemyKind, MassDriverMetrics } from '../gameplay';
import { massDriverSpeedAt } from '../gameplay';
import { INTERLOCK_TIME, MASS_DRIVER_TIME, SHOT_TIME } from '../timing';
import { createMassDriverEnvironment, type MassDriverEnvironment } from './environment';
import { createHostileModel, createLetterModel, createPlayerProjectile, materialsIn } from './models';
import { ARC_BLUE, GUNMETAL, HAZARD_RED, ION_WHITE, VOLT_VIOLET, colorForLockCount, heatColor, hot, mulberry32 } from './palette';
import { chargeUniform, detonationUniform, flashUniform } from './post-fx';

type MaterialState = { material: MeshBasicMaterial; color: Color; opacity: number };
type EnemyRecord = {
  mesh: Group;
  kind: string;
  materials: MaterialState[];
  bornAt: number;
  deniedUntil: number;
};
type ProjectileRecord = { mesh: Group; lastTrailAt: number };
type Effect = {
  object: Object3D;
  age: number;
  life: number;
  velocity: Vector3;
  spin: Vector3;
  grow?: number;
  baseScale?: number;
  fade?: MeshBasicMaterial | LineBasicMaterial;
};

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord, [string]>({
  createRecord(mesh, kind) {
    const states: MaterialState[] = [];
    for (const material of materialsIn(mesh)) {
      if (!(material instanceof MeshBasicMaterial)) continue;
      states.push({ material, color: material.color.clone(), opacity: material.opacity });
    }
    return { mesh, kind, materials: states, bornAt: elapsedNow, deniedUntil: -1 };
  },
});
const projectileRecords = createPendingVisualRecords<Group, ProjectileRecord>({
  createRecord(mesh) { return { mesh, lastTrailAt: -Infinity }; },
});

let environment: MassDriverEnvironment | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let pendingBeatPulse = 0;
let pendingDownbeat = false;
let pendingShot = false;
let pendingDetonation = false;
let pendingShake = 0;
let interlockKills = 0;
let lastRunTime = 0;
let chargePulse = 0;
const effects: Effect[] = [];
const rng = mulberry32(780078);
const EFFECT_RING_GEOMETRY = new RingGeometry(0.92, 1, 48);
const EFFECT_GLINT_H_GEOMETRY = new PlaneGeometry(2.7, 0.045);
const EFFECT_GLINT_V_GEOMETRY = new PlaneGeometry(0.045, 2.7);
const EFFECT_SPARK_GEOMETRY = new BoxGeometry(0.035, 0.035, 1);
const EFFECT_TRAIL_GEOMETRY = new BoxGeometry(0.06, 0.06, 1.4);
const EFFECT_LIGHTNING_GEOMETRY = (() => {
  const points: number[] = [];
  for (let index = 0; index < 8; index += 1) {
    const t = index / 7;
    points.push(t, Math.sin(index * 4.71) * 0.11, Math.cos(index * 3.19) * 0.08);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  return geometry;
})();
const EFFECT_FORWARD = new Vector3(1, 0, 0);

export type VisualUpdateContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  feel: CameraFeelRig;
  metrics: MassDriverMetrics;
};

export function createEnvironment(scene: Scene) {
  environment = createMassDriverEnvironment(scene);
  return environment;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' || letter
    ? createLetterModel(letter ?? 'A')
    : createHostileModel(kind as MassDriverEnemyKind);
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function restoreMaterials(mesh: Group) {
  const record = [...enemyRecords.values()].find((candidate) => candidate.mesh === mesh);
  if (!record) return;
  for (const state of record.materials) {
    state.material.color.copy(state.color);
    state.material.opacity = state.opacity;
  }
}

function lockRingFor(mesh: Object3D) {
  let ring = mesh.userData.lockRing as Group | undefined;
  if (ring) return ring;
  ring = new Group();
  const outer = new Mesh(new RingGeometry(1.08, 1.15, 6), createAdditiveBasicMaterial({ color: hot(ARC_BLUE, 1.4), opacity: 0.9, side: DoubleSide }));
  const inner = new Mesh(new RingGeometry(0.83, 0.89, 6), createAdditiveBasicMaterial({ color: hot(ION_WHITE, 1.15), opacity: 0.8, side: DoubleSide }));
  inner.rotation.z = Math.PI / 6;
  ring.add(outer, inner);
  ring.position.z = 1.1;
  ring.scale.setScalar((mesh.userData.lockRingScale as number | undefined) ?? 1);
  mesh.add(ring);
  mesh.userData.lockRing = ring;
  return ring;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean, lockCount = 1) {
  mesh.userData.locked = locked;
  const ring = lockRingFor(mesh);
  ring.visible = locked;
  const record = [...enemyRecords.values()].find((candidate) => candidate.mesh === mesh);
  if (!record) return;
  if (!locked) {
    restoreMaterials(record.mesh);
    return;
  }
  const tint = colorForLockCount(lockCount);
  for (const state of record.materials) {
    state.material.color.copy(state.color).lerp(tint, state.color.getHex() === GUNMETAL.getHex() ? 0.58 : 0.82).multiplyScalar(1.18);
  }
}

export function setEnemyDenied(mesh: Object3D) {
  const group = mesh as Group;
  group.userData.deniedUntil = elapsedNow + 0.28;
  const record = [...enemyRecords.values()].find((candidate) => candidate.mesh === group);
  if (record) {
    record.deniedUntil = elapsedNow + 0.28;
    for (const state of record.materials) state.material.color.copy(hot(HAZARD_RED, 1.45));
  }
  detonationUniform.value = Math.max(detonationUniform.value, 0.13);
  pendingShake += 0.12;
}

export function createProjectileMesh() {
  const mesh = createPlayerProjectile();
  projectileRecords.enqueue(mesh);
  return mesh;
}

export function createReticle() {
  const root = new Group();
  const spinner = new Group();
  const outer = new Mesh(new RingGeometry(0.58, 0.615, 64), createAdditiveBasicMaterial({ color: hot(ARC_BLUE, 1.1), opacity: 0.9, side: DoubleSide }));
  const dot = new Mesh(new CircleGeometry(0.045, 16), createAdditiveBasicMaterial({ color: hot(ION_WHITE, 2.2), opacity: 1, side: DoubleSide }));
  const segments: MeshBasicMaterial[] = [];
  for (let index = 0; index < 6; index += 1) {
    const material = createAdditiveBasicMaterial({ color: hot(ARC_BLUE, 0.38), opacity: 0.42, side: DoubleSide });
    const start = index / 6 * Math.PI * 2 + 0.045;
    const segment = new Mesh(new RingGeometry(0.72, 0.79, 48, 1, start, Math.PI / 3 - 0.09), material);
    spinner.add(segment);
    segments.push(material);
  }
  root.add(outer, spinner, dot);
  root.userData.spinner = spinner;
  root.userData.segments = segments;
  root.userData.active = false;
  return root;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.055 + (active ? 0.04 : 0));
  const segments = reticle.userData.segments as MeshBasicMaterial[];
  for (let index = 0; index < segments.length; index += 1) {
    if (index < lockCount) {
      segments[index].color.copy(hot(colorForLockCount(index + 1), index === 5 ? 2.3 : 1.45));
      segments[index].opacity = 0.95;
    } else {
      segments[index].color.copy(hot(ARC_BLUE, active ? 0.55 : 0.35));
      segments[index].opacity = active ? 0.56 : 0.36;
    }
  }
}

function spawnRing(position: Vector3, camera: PerspectiveCamera, color: Color, size: number, life = 0.55) {
  const material = createAdditiveBasicMaterial({ color, opacity: 0.9, side: DoubleSide });
  const mesh = new Mesh(EFFECT_RING_GEOMETRY, material);
  mesh.position.copy(position);
  mesh.quaternion.copy(camera.quaternion);
  mesh.scale.setScalar(size);
  mesh.userData.raildIgnoreOcclusion = true;
  camera.parent?.add(mesh);
  if (!mesh.parent) return;
  effects.push({ object: mesh, age: 0, life, velocity: new Vector3(), spin: new Vector3(0, 0, 1.8), grow: 3.2, baseScale: size, fade: material });
}

function spawnGlint(scene: Scene, position: Vector3, color: Color, size = 1.5, life = 0.2) {
  const material = createAdditiveBasicMaterial({ color, opacity: 1, side: DoubleSide });
  const root = new Group();
  const horizontal = new Mesh(EFFECT_GLINT_H_GEOMETRY, material);
  const vertical = new Mesh(EFFECT_GLINT_V_GEOMETRY, material);
  root.add(horizontal, vertical);
  root.position.copy(position);
  root.scale.setScalar(size);
  root.userData.raildIgnoreOcclusion = true;
  scene.add(root);
  effects.push({ object: root, age: 0, life, velocity: new Vector3(), spin: new Vector3(0, 0, 0.7), grow: 0.7, baseScale: size, fade: material });
}

function burstSparks(scene: Scene, position: Vector3, color: Color, count: number, speed = 12) {
  for (let index = 0; index < count; index += 1) {
    const material = createAdditiveBasicMaterial({ color, opacity: 0.95 });
    const spark = new Mesh(EFFECT_SPARK_GEOMETRY, material);
    spark.scale.z = 0.65 + rng() * 0.9;
    spark.position.copy(position);
    const velocity = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize().multiplyScalar(speed * (0.35 + rng() * 0.65));
    spark.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), velocity.clone().normalize());
    spark.userData.raildIgnoreOcclusion = true;
    scene.add(spark);
    effects.push({ object: spark, age: 0, life: 0.2 + rng() * 0.35, velocity, spin: new Vector3(), fade: material });
  }
}

function spawnLightning(scene: Scene, from: Vector3, color: Color, scale = 3.2, life = 0.22) {
  const direction = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
  const material = new LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
  const line = new Line(EFFECT_LIGHTNING_GEOMETRY, material);
  line.position.copy(from);
  line.quaternion.setFromUnitVectors(EFFECT_FORWARD, direction);
  line.scale.setScalar(scale);
  line.userData.raildIgnoreOcclusion = true;
  scene.add(line);
  effects.push({ object: line, age: 0, life, velocity: new Vector3(), spin: new Vector3(), baseScale: scale, fade: material });
}

function trail(scene: Scene, position: Vector3, color: Color) {
  const material = createAdditiveBasicMaterial({ color, opacity: 0.55 });
  const mesh = new Mesh(EFFECT_TRAIL_GEOMETRY, material);
  mesh.position.copy(position);
  mesh.userData.raildIgnoreOcclusion = true;
  scene.add(mesh);
  effects.push({ object: mesh, age: 0, life: 0.18, velocity: new Vector3(0, 0, 0.4), spin: new Vector3(), fade: material, grow: 0.25 });
}

function exposeStage(record: EnemyRecord) {
  if (record.kind === 'capacitor') {
    record.mesh.traverse((child) => { if (child.name === 'capacitor-stave') child.visible = false; });
    const core = record.mesh.getObjectByName('capacitor-core');
    if (core) core.scale.setScalar(1.25);
  }
  if (record.kind === 'interlock') {
    const cowl = record.mesh.getObjectByName('interlock-cowl');
    const core = record.mesh.getObjectByName('interlock-core');
    if (cowl) cowl.visible = false;
    if (core) core.visible = true;
  }
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId, kind);
    if (!record) return;
    record.mesh.position.copy(worldPosition);
    if (kind === 'interlock') {
      flashUniform.value = Math.max(flashUniform.value, 0.16);
      detonationUniform.value = Math.max(detonationUniform.value, 0.16);
      pendingShake += 0.3;
    }
  });
  bus.on('fire', ({ projectileId, worldPosition }) => {
    const record = projectileRecords.claim(projectileId);
    if (record) record.mesh.position.copy(worldPosition);
    flashUniform.value = Math.max(flashUniform.value, 0.035);
  });
  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const ring = record?.mesh.userData.lockRing as Group | undefined;
    if (ring) ring.rotation.z += 0.23;
    chargePulse = Math.max(chargePulse, lockCount / 6);
    spawnGlint(scene, worldPosition, hot(colorForLockCount(lockCount), 1.4), 0.7, 0.12);
    if (lockCount === 6) {
      flashUniform.value = Math.max(flashUniform.value, 0.2);
      pendingShake += 0.18;
    }
  });
  bus.on('unlock', ({ worldPosition }) => spawnGlint(scene, worldPosition, hot(ARC_BLUE, 0.7), 0.35, 0.1));
  bus.on('hit', ({ enemyId, worldPosition, stageCompleted }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      for (const state of record.materials) state.material.color.copy(hot(ION_WHITE, 2.15));
      if (stageCompleted) exposeStage(record);
    }
    burstSparks(scene, worldPosition, hot(ARC_BLUE, 1.4), stageCompleted ? 16 : 7, stageCompleted ? 18 : 10);
    spawnLightning(scene, worldPosition, hot(VOLT_VIOLET, 1.45), stageCompleted ? 5.5 : 2.8);
    spawnGlint(scene, worldPosition, hot(ION_WHITE, 2.0), stageCompleted ? 1.8 : 0.8);
    pendingShake += stageCompleted ? 0.22 : 0.07;
  });
  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const isInterlock = record?.kind === 'interlock';
    const isArc = record?.kind === 'arc';
    burstSparks(scene, worldPosition, hot(isInterlock ? ION_WHITE : ARC_BLUE, isInterlock ? 2 : 1.4), isInterlock ? 34 : 14, isInterlock ? 24 : 15);
    spawnLightning(scene, worldPosition, hot(isInterlock ? ION_WHITE : VOLT_VIOLET, 1.7), isInterlock ? 9 : 4.8, isInterlock ? 0.38 : 0.24);
    if (isInterlock) spawnLightning(scene, worldPosition, hot(VOLT_VIOLET, 1.5), 7.5, 0.34);
    spawnGlint(scene, worldPosition, hot(ION_WHITE, 2.4), isInterlock ? 3.8 : 1.6, isInterlock ? 0.38 : 0.22);
    if (record) {
      enemyRecords.delete(enemyId);
      disposeObject3D(record.mesh);
    }
    pendingShake += isInterlock ? 0.52 : isArc ? 0.16 : 0.23;
    if (isInterlock) {
      interlockKills += 1;
      flashUniform.value = Math.max(flashUniform.value, 0.13 + interlockKills * 0.035);
      if (interlockKills === 6) {
        flashUniform.value = 0.82;
        chargePulse = 1.4;
        pendingShake += 0.7;
      }
    }
  });
  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      enemyRecords.delete(enemyId);
      disposeObject3D(record.mesh);
    }
    burstSparks(scene, worldPosition, GUNMETAL.clone().multiplyScalar(0.7), 3, 4);
  });
  bus.on('reject', () => {
    detonationUniform.value = Math.max(detonationUniform.value, 0.18);
    pendingShake += 0.2;
  });
  bus.on('volley', ({ size, kills }) => {
    if (size >= 5 && kills === size) {
      flashUniform.value = Math.max(flashUniform.value, size === 6 ? 0.24 : 0.12);
      pendingShake += size === 6 ? 0.3 : 0.12;
    }
  });
  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.48);
    pendingBeatPulse += 1;
    pendingDownbeat ||= isDownbeat;
  });
  bus.on('playerhit', () => {
    detonationUniform.value = Math.max(detonationUniform.value, 0.4);
    pendingShake += 0.55;
  });
  bus.on('runend', ({ died }) => {
    if (died) {
      pendingDetonation = true;
      detonationUniform.value = 1;
      flashUniform.value = Math.max(flashUniform.value, 0.55);
      feel.kickFov(18, { decay: 2.7 });
    }
  });
  bus.on('runstart', () => {
    enemyRecords.clear({ pending: true });
    projectileRecords.clear({ pending: true });
    for (const effect of effects.splice(0)) {
      effect.object.removeFromParent();
      disposeEffect(effect.object);
    }
    interlockKills = 0;
    lastRunTime = 0;
    pendingShot = false;
    pendingDetonation = false;
    flashUniform.value = 0;
    chargeUniform.value = 0;
    detonationUniform.value = 0;
  });
}

export function updateVisuals(dt: number, context: VisualUpdateContext) {
  elapsedNow = context.elapsed;
  const { camera, scene, running, runTime, feel, metrics } = context;
  beatEnergy *= Math.exp(-dt * 7.5);
  chargePulse *= Math.exp(-dt * 4.2);
  flashUniform.value *= Math.exp(-dt * (pendingDetonation ? 1.8 : 6.7));
  detonationUniform.value *= Math.exp(-dt * (pendingDetonation ? 0.65 : 5.2));
  const chargeProgress = running ? Math.min(1, Math.max(0, (runTime - INTERLOCK_TIME) / (SHOT_TIME - INTERLOCK_TIME))) : 0;
  chargeUniform.value += ((running && runTime < SHOT_TIME ? chargeProgress * 0.72 : 0) - chargeUniform.value) * Math.min(1, dt * 3.4);

  for (const record of enemyRecords.values()) {
    const age = elapsedNow - record.bornAt;
    const pop = Math.min(1, age / 0.32);
    const overshoot = 1 + Math.sin(pop * Math.PI) * 0.18;
    const base = (record.mesh.userData.baseScale as number | undefined) ?? 1;
    record.mesh.scale.setScalar(Math.max(0.001, pop * overshoot * base));
    const ring = record.mesh.userData.lockRing as Group | undefined;
    if (ring?.visible) {
      ring.rotation.z += dt * (record.kind === 'interlock' ? 0.9 : 1.7);
      const pulse = 1 + Math.sin(elapsedNow * 8) * 0.045;
      const fit = (record.mesh.userData.lockRingScale as number | undefined) ?? 1;
      ring.scale.setScalar(fit * pulse);
    }
    if (record.deniedUntil > 0 && elapsedNow >= record.deniedUntil) {
      record.deniedUntil = -1;
      restoreMaterials(record.mesh);
    }
  }

  for (const [id, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(id);
      disposeObject3D(record.mesh);
      continue;
    }
    if (elapsedNow - record.lastTrailAt > 0.035) {
      record.lastTrailAt = elapsedNow;
      trail(scene, record.mesh.position, hot(ARC_BLUE, 1.1));
    }
  }

  const reticle = scene.children.find((child) => child.userData.raildRole === 'reticle');
  const spinner = reticle?.userData.spinner as Group | undefined;
  if (spinner) spinner.rotation.z += dt * (reticle?.userData.active ? 4.5 + chargePulse * 2 : 0.75);

  if (pendingBeatPulse > 0 && running) {
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const position = camera.position.clone().addScaledVector(forward, 7.5);
    spawnRing(position, camera, hot(heatColor(Math.min(1, runTime / SHOT_TIME)), pendingDownbeat ? 1.9 : 1.2), pendingDownbeat ? 1.75 : 1.25, pendingDownbeat ? 0.42 : 0.3);
    feel.kickFov(pendingDownbeat ? 1.05 : 0.32, { decay: 12 });
    pendingBeatPulse = 0;
    pendingDownbeat = false;
  }

  if (running && lastRunTime < SHOT_TIME && runTime >= SHOT_TIME && !metrics.detonated) {
    pendingShot = true;
    metrics.fired = metrics.interlocksCleared === 6;
    flashUniform.value = 1.65;
    chargeUniform.value = 0;
    feel.kickFov(19, { decay: 2.4 });
    pendingShake += 1.5;
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const position = camera.position.clone().addScaledVector(forward, 10);
    spawnRing(position, camera, hot(ION_WHITE, 3), 2.8, 0.85);
  }
  lastRunTime = running ? runTime : 0;

  if (pendingShake > 0) {
    feel.shake(Math.min(1.8, pendingShake), {
      maxTrauma: pendingDetonation ? 2.2 : 1.8,
      decay: pendingDetonation ? 1.1 : 3.0,
      pitchDegrees: pendingDetonation ? 2.2 : 0.75,
      yawDegrees: pendingDetonation ? 1.5 : 0.55,
      rollDegrees: pendingDetonation ? 5.2 : 2.1,
      frequency: pendingDetonation ? 18 : 14,
      smoothing: 30,
    });
    pendingShake = 0;
  }

  const speed = running ? massDriverSpeedAt(runTime) : 0.3;
  const postShot = running && runTime >= SHOT_TIME;
  feel.setFovOffset((speed - 0.4) * (postShot ? 1.35 : 1.05), { response: 6 });
  if (running && !postShot) {
    const taper = 1 - Math.min(1, runTime / SHOT_TIME) ** 5;
    camera.rotateZ(Math.sin(runTime * 0.88) * 0.00085 * taper);
  }
  feel.update(dt, {
    shake: {
      pitchDegrees: pendingDetonation ? 2.2 : 0.75,
      yawDegrees: pendingDetonation ? 1.5 : 0.55,
      rollDegrees: pendingDetonation ? 5.2 : 2.1,
      frequency: pendingDetonation ? 18 : 14,
      smoothing: 30,
    },
  });

  environment?.update(dt, {
    camera,
    elapsed: context.elapsed,
    runTime,
    running,
    beatEnergy,
    charge: Math.max(chargePulse, chargeProgress),
  });

  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const effect = effects[index];
    effect.age += dt;
    const progress = effect.age / effect.life;
    if (progress >= 1) {
      effect.object.removeFromParent();
      disposeEffect(effect.object);
      effects.splice(index, 1);
      continue;
    }
    effect.object.position.addScaledVector(effect.velocity, dt);
    effect.object.rotation.x += effect.spin.x * dt;
    effect.object.rotation.y += effect.spin.y * dt;
    effect.object.rotation.z += effect.spin.z * dt;
    if (effect.grow) effect.object.scale.setScalar((effect.baseScale ?? 1) * (1 + progress * effect.grow));
    if (effect.fade) effect.fade.opacity = (1 - progress) ** 1.7;
  }
}

function disposeEffect(object: Object3D) {
  object.traverse((child) => {
    if (!(child instanceof Mesh) && !(child instanceof Line)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}
