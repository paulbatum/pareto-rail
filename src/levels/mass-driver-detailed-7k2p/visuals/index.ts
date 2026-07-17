import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { disposeObject3D } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import {
  MASS_DRIVER_MARKERS,
} from '../timing';
import type { MassDriverRunState } from '../gameplay';
import { createEnvironment as createEnvironmentInternal, type MassDriverEnvironment } from './environment';
import {
  createChargeReticle,
  createHostile,
  createLetter,
  createProjectile,
  denyObject,
  exposeArmor,
  material,
  PALETTE,
  tintObject,
  type TintPart,
} from './models';
import { chargeUniform, detonationUniform, flashUniform } from './post-fx';

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number;
  deniedUntil: number;
  locked: boolean;
  lockRing?: Group;
};

type Transient = {
  object: Object3D;
  age: number;
  life: number;
  grow: number;
  spin: number;
  material?: MeshBasicMaterial | LineBasicMaterial;
  velocity?: Vector3;
  billboard?: boolean;
  sharedGeometry?: boolean;
};

const LOCK_GRADIENT = [PALETTE.arc, new Color(0x38aaff), new Color(0x526dff), PALETTE.violet, new Color(0xb88cff), PALETTE.white];
const Z_AXIS = new Vector3(0, 0, 1);
const pulseGeometries = new Map<number, RingGeometry>();
const sparkGeometry = new OctahedronGeometry(0.1, 0);
const lockOuterGeometry = new RingGeometry(0.88, 1, 6);
const lockInnerGeometry = new RingGeometry(0.64, 0.7, 6);
const lightningGeometries = Array.from({ length: 8 }, (_, seed) => {
  const points: number[] = [];
  for (let index = 0; index <= 8; index += 1) {
    const p = index / 8;
    const envelope = Math.sin(p * Math.PI);
    points.push(
      Math.sin(seed * 7.7 + index * 4.1) * 0.08 * envelope,
      Math.cos(seed * 5.3 + index * 3.7) * 0.08 * envelope,
      p,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  return geometry;
});
const pendingEnemies: Group[] = [];
const enemies = new Map<number, EnemyRecord>();
const disposers: Array<() => void> = [];
let environment: MassDriverEnvironment | null = null;
let effectsRoot: Group | null = null;
let transients: Transient[] = [];
let elapsedNow = 0;
let state: MassDriverRunState = { destroyedInterlocks: 0, interceptedArcs: 0, hullRemaining: 3, gunFired: false, detonated: false };

export function setRunState(next: Readonly<MassDriverRunState>) {
  const wasDetonated = state.detonated;
  state = { ...next };
  if (!wasDetonated && state.detonated) {
    detonationUniform.value = 1.25;
    environment?.flash(1.3);
  }
}

export function triggerShotFlash() {
  flashUniform.value = 1.45;
  environment?.flash(1.15);
}

export function triggerInterlockStrobe() {
  flashUniform.value = Math.max(flashUniform.value, 0.72);
  environment?.strobe();
}

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  effectsRoot = new Group();
  effectsRoot.name = 'mass-driver-electrical-effects';
  effectsRoot.userData.raildIgnoreOcclusion = true;
  scene.add(effectsRoot);
  return environment;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' || letter ? createLetter(letter ?? 'A') : createHostile(kind as Parameters<typeof createHostile>[0]);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  pendingEnemies.push(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  tintObject(mesh, locked);
  for (const record of enemies.values()) {
    if (record.mesh === mesh) record.locked = locked;
  }
}

export function setEnemyDenied(mesh: Object3D) {
  denyObject(mesh);
  for (const record of enemies.values()) {
    if (record.mesh === mesh) record.deniedUntil = elapsedNow + 0.4;
  }
  detonationUniform.value = Math.max(detonationUniform.value, 0.18);
}

export function createProjectileMesh() {
  return createProjectile();
}

export function createReticle() {
  return createChargeReticle();
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.rotation.z += active ? 0.017 + lockCount * 0.004 : 0.004;
  reticle.scale.setScalar(1 + lockCount * 0.045 + (active ? 0.045 : 0));
  const ring = reticle.userData.ring as Mesh | undefined;
  if (ring) (ring.material as MeshBasicMaterial).color.copy(active ? PALETTE.white : PALETTE.arc).multiplyScalar(active ? 1.7 : 1.15);
  const segments = reticle.userData.segments as Array<{ mesh: Mesh; material: MeshBasicMaterial }> | undefined;
  segments?.forEach(({ material: segmentMaterial }, index) => {
    if (index < lockCount) segmentMaterial.color.copy(LOCK_GRADIENT[index]).multiplyScalar(index === 5 ? 2.5 : 1.65);
    else segmentMaterial.color.copy(PALETTE.steelEdge).multiplyScalar(0.58);
  });
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, camera: Camera, feel: CameraFeelRig) {
  const pulse = (position: Vector3, color: Color, radius: number, life: number, grow = 6, sides = 32) => {
    if (!effectsRoot) return;
    const pulseMaterial = material(color, 1.5, true, 0.92);
    let geometry = pulseGeometries.get(sides);
    if (!geometry) {
      geometry = new RingGeometry(0.76, 1, sides);
      pulseGeometries.set(sides, geometry);
    }
    const mesh = new Mesh(geometry, pulseMaterial);
    mesh.position.copy(position);
    mesh.quaternion.copy(camera.quaternion);
    mesh.scale.setScalar(radius);
    effectsRoot.add(mesh);
    transients.push({ object: mesh, age: 0, life, grow, spin: sides === 6 ? 1.8 : 0.3, material: pulseMaterial, billboard: true, sharedGeometry: true });
  };
  const lightning = (from: Vector3, to: Vector3, color: Color, life = 0.24, seed = 0) => {
    if (!effectsRoot) return;
    const lineMaterial = new LineBasicMaterial({ color: color.clone().multiplyScalar(1.8), transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false });
    const line = new Line(lightningGeometries[Math.abs(seed) % lightningGeometries.length], lineMaterial);
    const delta = to.clone().sub(from);
    const distance = Math.max(0.001, delta.length());
    line.position.copy(from);
    line.quaternion.setFromUnitVectors(Z_AXIS, delta.normalize());
    line.scale.set(distance, distance, distance);
    effectsRoot.add(line);
    transients.push({ object: line, age: 0, life, grow: 0, spin: 0, material: lineMaterial, sharedGeometry: true });
  };
  const burst = (position: Vector3, color: Color, count: number, force: number, doubled = false) => {
    if (!effectsRoot) return;
    for (let index = 0; index < count; index += 1) {
      const angle = index / count * Math.PI * 2 + (index % 3) * 0.2;
      const up = ((index * 7) % count) / count * 2 - 1;
      const shardMaterial = material(index % 4 === 0 ? PALETTE.white : color, 1.4, true, 0.9);
      const shard = new Mesh(sparkGeometry, shardMaterial);
      shard.scale.set(doubled ? 0.56 : 0.35, doubled ? 0.56 : 0.35, doubled ? 3.8 : 2.4);
      shard.position.copy(position);
      shard.rotation.z = angle;
      effectsRoot.add(shard);
      transients.push({
        object: shard,
        age: 0,
        life: doubled ? 0.72 : 0.48,
        grow: 0,
        spin: (index % 2 ? 1 : -1) * 8,
        material: shardMaterial,
        velocity: new Vector3(Math.cos(angle) * force, Math.sin(angle) * force, up * force * 0.7),
        sharedGeometry: true,
      });
    }
  };

  disposers.push(bus.on('runstart', () => {
    state = { destroyedInterlocks: 0, interceptedArcs: 0, hullRemaining: 3, gunFired: false, detonated: false };
    flashUniform.value = 0;
    chargeUniform.value = 0;
    detonationUniform.value = 0;
    clearTransients();
  }));
  disposers.push(bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const mesh = pendingEnemies.shift();
    if (mesh) enemies.set(enemyId, { mesh, kind, bornAt: elapsedNow, deniedUntil: -1, locked: false });
    if (kind === 'interlock') {
      pulse(worldPosition, PALETTE.amber, 1.0, 0.6, 8, 32);
      pulse(worldPosition, PALETTE.red, 1.5, 0.82, 11, 32);
      feel.shake(0.18, { maxTrauma: 0.8, decay: 2.8, rollDegrees: 1.2, pitchDegrees: 0.28, frequency: 12 });
    } else if (kind !== 'arc') {
      pulse(worldPosition, PALETTE.arc, 0.28, 0.3, 3, 24);
    }
  }));
  disposers.push(bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemies.get(enemyId);
    if (record && !record.lockRing && effectsRoot) {
      const clamp = new Group();
      const size = record.kind === 'interlock' ? 2.9 : record.kind === 'capacitor' ? 1.9 : 1.25;
      const outer = new Mesh(lockOuterGeometry, material(color, 1.5, true, 0.85));
      const inner = new Mesh(lockInnerGeometry, material(PALETTE.white, 1.2, true, 0.62));
      clamp.add(outer, inner);
      clamp.scale.setScalar(size);
      effectsRoot.add(clamp);
      record.lockRing = clamp;
    }
    pulse(worldPosition, color, 0.42, 0.28, 5, 6);
    if (lockCount === 6) {
      flashUniform.value = Math.max(flashUniform.value, 0.32);
      feel.shake(0.1, { maxTrauma: 0.55, decay: 4, rollDegrees: 0.7, frequency: 14 });
    }
  }));
  disposers.push(bus.on('unlock', ({ enemyId, worldPosition }) => {
    detachLock(enemies.get(enemyId));
    pulse(worldPosition, PALETTE.steelEdge, 0.48, 0.24, -1.3, 6);
  }));
  disposers.push(bus.on('fire', ({ worldPosition, targetPosition, volleySize, indexInVolley }) => {
    if ((indexInVolley ?? 0) === 0) {
      pulse(worldPosition, volleySize === 6 ? PALETTE.white : PALETTE.arc, 0.25, 0.3, 8, 24);
      flashUniform.value = Math.max(flashUniform.value, volleySize === 6 ? 0.24 : 0.06);
      feel.kickFov(volleySize === 6 ? 2.6 : 0.9, { decay: 6 });
    }
    lightning(worldPosition, targetPosition, PALETTE.arc, 0.11, volleySize + (indexInVolley ?? 0));
  }));
  disposers.push(bus.on('hit', ({ enemyId, worldPosition, lethal, projectileId }) => {
    pulse(worldPosition, lethal ? PALETTE.white : PALETTE.violet, lethal ? 0.48 : 0.3, 0.35, lethal ? 9 : 5, 24);
    lightning(worldPosition.clone().add(new Vector3(-0.8, 0.5, 0)), worldPosition.clone().add(new Vector3(0.7, -0.4, 0.3)), PALETTE.white, 0.15, projectileId);
    burst(worldPosition, lethal ? PALETTE.arc : PALETTE.violet, lethal ? 9 : 4, lethal ? 7 : 4);
    const record = enemies.get(enemyId);
    if (record && !lethal) {
      for (const part of (record.mesh.userData.tintParts as TintPart[] | undefined) ?? []) part.material.color.copy(PALETTE.white).multiplyScalar(2.2);
    }
    feel.shake(lethal ? 0.09 : 0.045, { maxTrauma: 0.62, decay: 3.5, rollDegrees: 0.8, frequency: 13 });
  }));
  disposers.push(bus.on('stage', ({ enemyId, worldPosition, stageIndex }) => {
    const record = enemies.get(enemyId);
    if (record) exposeArmor(record.mesh);
    pulse(worldPosition, record?.kind === 'interlock' ? PALETTE.amber : PALETTE.violet, 0.85, 0.56, 9, 32);
    burst(worldPosition, PALETTE.violet, 12, 8, true);
    lightning(worldPosition.clone().add(new Vector3(-1.4, 0, 0)), worldPosition.clone().add(new Vector3(1.4, 0, 0)), PALETTE.white, 0.28, stageIndex);
    feel.shake(record?.kind === 'interlock' ? 0.2 : 0.12, { maxTrauma: 0.88, decay: 2.7, rollDegrees: 1.2, frequency: 12 });
  }));
  disposers.push(bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    const boss = record?.kind === 'interlock';
    detachLock(record);
    burst(worldPosition, boss ? PALETTE.amber : PALETTE.arc, boss ? 28 : 15, boss ? 13 : 9, boss);
    pulse(worldPosition, PALETTE.white, boss ? 1.4 : 0.65, boss ? 0.85 : 0.55, boss ? 14 : 10, 32);
    lightning(worldPosition.clone().add(new Vector3(-2.2, 1.3, 0)), worldPosition.clone().add(new Vector3(2.0, -1.2, 0.5)), boss ? PALETTE.amber : PALETTE.violet, boss ? 0.42 : 0.25, enemyId);
    if (boss) flashUniform.value = Math.max(flashUniform.value, 0.2 + state.destroyedInterlocks * 0.035);
    enemies.delete(enemyId);
  }));
  disposers.push(bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    detachLock(record);
    if (record?.kind !== 'arc') pulse(worldPosition, PALETTE.steelEdge, 0.35, 0.35, 2.5, 16);
    enemies.delete(enemyId);
  }));
  disposers.push(bus.on('reject', () => {
    detonationUniform.value = Math.max(detonationUniform.value, 0.2);
    const forward = new Vector3(0, 0, -4).applyQuaternion(camera.quaternion).add(camera.position);
    pulse(forward, PALETTE.red, 1.2, 0.34, 5, 6);
  }));
  disposers.push(bus.on('playerhit', () => {
    detonationUniform.value = Math.max(detonationUniform.value, 0.5);
    environment?.flash(0.38);
    feel.shake(0.55, { maxTrauma: 1.4, decay: 1.0, rollDegrees: 2.5, pitchDegrees: 0.65, yawDegrees: 0.55, frequency: 15 });
  }));
  disposers.push(bus.on('beat', ({ isDownbeat }) => {
    if (!effectsRoot) return;
    const forward = new Vector3(0, 0, -3.2).applyQuaternion(camera.quaternion).add(camera.position);
    pulse(forward, isDownbeat ? PALETTE.white : PALETTE.arc, isDownbeat ? 0.36 : 0.22, 0.22, isDownbeat ? 6 : 4, 32);
    if (isDownbeat) feel.shake(0.035, { maxTrauma: 0.4, decay: 5, rollDegrees: 0.52, pitchDegrees: 0.12, frequency: 14 });
  }));

  return () => {
    for (const dispose of disposers.splice(0)) dispose();
  };
}

function detachLock(record: EnemyRecord | undefined) {
  if (!record?.lockRing) return;
  record.lockRing.removeFromParent();
  disposeMaterials(record.lockRing);
  record.lockRing = undefined;
}

function clearTransients() {
  for (const transient of transients) {
    disposeTransient(transient);
  }
  transients = [];
}

function disposeMaterials(root: Object3D) {
  root.traverse((child) => {
    if (!(child instanceof Mesh || child instanceof Line)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const childMaterial of materials) childMaterial.dispose();
  });
}

function disposeTransient(transient: Transient) {
  transient.object.removeFromParent();
  if (transient.sharedGeometry) disposeMaterials(transient.object);
  else disposeObject3D(transient.object);
}

export function updateVisuals(dt: number, context: { elapsed: number; runTime: number; running: boolean; camera: Camera; feel: CameraFeelRig }) {
  elapsedNow = context.elapsed;
  const charge = context.running
    ? Math.max(0, Math.min(1, (context.runTime - MASS_DRIVER_MARKERS.interlock) / (MASS_DRIVER_MARKERS.shot - MASS_DRIVER_MARKERS.interlock)))
    : 0;
  chargeUniform.value = charge * 0.72;
  flashUniform.value = Math.max(0, flashUniform.value - dt * (state.gunFired ? 0.62 : 2.8));
  detonationUniform.value = Math.max(0, detonationUniform.value - dt * (state.detonated ? 0.18 : 2.5));
  environment?.update(dt, context.elapsed, context.runTime, context.running, context.camera, state.gunFired, state.detonated);

  for (const record of enemies.values()) {
    const age = context.elapsed - record.bornAt;
    if (age < 0.32) {
      const p = Math.min(1, age / 0.32);
      const overshoot = 1 + Math.sin(p * Math.PI) * 0.16;
      record.mesh.scale.setScalar(p * overshoot);
    } else if (record.deniedUntil > 0 && context.elapsed >= record.deniedUntil) {
      record.deniedUntil = -1;
      tintObject(record.mesh, record.locked);
    }
    const tail = record.mesh.userData.tail as Mesh | undefined;
    if (tail) {
      const tailMaterial = tail.material as MeshBasicMaterial;
      tailMaterial.opacity = 0.2 + Math.abs(Math.sin(context.elapsed * 13 + record.mesh.id)) * 0.22;
      tail.scale.z = 0.85 + Math.sin(context.elapsed * 17 + record.mesh.id) * 0.2;
    }
    const shells = record.mesh.userData.shells as Mesh[] | undefined;
    shells?.forEach((shell, index) => {
      shell.rotation.set(context.elapsed * (9 + index * 5), context.elapsed * (13 + index * 7), context.elapsed * (17 - index * 3));
      shell.scale.setScalar(0.84 + Math.abs(Math.sin(context.elapsed * (31 + index * 8))) * 0.3);
    });
    if (record.mesh.userData.exposed) {
      const core = record.mesh.userData.core as Mesh | undefined;
      if (core) core.scale.setScalar(1 + Math.sin(context.elapsed * 39) * 0.16);
    }
    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(context.camera.quaternion);
      record.lockRing.rotation.z += dt * 0.7;
    }
  }

  for (let index = transients.length - 1; index >= 0; index -= 1) {
    const transient = transients[index];
    transient.age += dt;
    transient.object.rotation.z += dt * transient.spin;
    if (transient.velocity) transient.object.position.addScaledVector(transient.velocity, dt);
    if (transient.grow !== 0) transient.object.scale.addScalar(dt * transient.grow);
    if (transient.billboard) transient.object.quaternion.copy(context.camera.quaternion);
    if (transient.material) transient.material.opacity = Math.max(0, 1 - transient.age / transient.life);
    if (transient.age >= transient.life) {
      disposeTransient(transient);
      transients.splice(index, 1);
    }
  }
}

export function disposeVisuals() {
  for (const dispose of disposers.splice(0)) dispose();
  for (const record of enemies.values()) detachLock(record);
  enemies.clear();
  pendingEnemies.length = 0;
  clearTransients();
  effectsRoot?.removeFromParent();
  if (effectsRoot) disposeObject3D(effectsRoot);
  effectsRoot = null;
  environment?.dispose();
  environment = null;
}
