import {
  BoxGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { uniform } from 'three/tsl';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createBroadsideRail, progressAt } from '../gameplay';
import { sampleRailFrame } from '../../../engine/rail';
import {
  createAdditiveBasicMaterial,
  createPendingVisualRecords,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { burstDebris, burstSparks, createEffects, dropTrail, paletteOf, resetEffects, spawnGlint, spawnRing, updateEffects } from './effects';
import { createLetterMesh, setLetterLocked } from './letters';
import {
  createBatteryMesh,
  createBoltMesh,
  createConduitMesh,
  createDartMesh,
  createGeneratorMesh,
  createGunshipMesh,
  createPdTurretMesh,
  createPlayerProjectileMesh,
  createWeaverMesh,
} from './models';
import { CRIMSON, EMBER, GOLD, hdr, ICE, MAGENTA } from './palette';
import { createBroadsideEnvironment, type BroadsideEnvironment } from './ships';

// Screen-space finale flash, written from the visual loop and composited in
// the level's post hook: gold-white bloom as the flagship breaks apart.
export const finaleFlash = uniform(0);

type EnemyRecord = { mesh: Group; born: number | null; lockRing: Group | null };

let environment: BroadsideEnvironment | null = null;
let feelRig: CameraFeelRig | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let lastRunProgress = 0;
let shieldDropUntil = -1;
let destroyedAt = -1;
let burningShips = false;

// One rail instance shared by the set-piece math (muzzle anchors, crossfire,
// explosion chain) — the same curve the runner flies.
const RAIL = createBroadsideRail();

const records = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, born: null, lockRing: null }),
  // Every enemy mesh owns its geometries and materials (the shared lock
  // bracket lives on record.lockRing, detached before deletion), so a full
  // traversal dispose is safe.
  disposeRecord(record) {
    record.mesh.traverse((child) => {
      const mesh = child as Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material?.dispose();
    });
  },
});
const projectileRecords = createPendingVisualRecords<Object3D, Object3D>({ createRecord: (mesh) => mesh });

// --- transient pools ----------------------------------------------------------

type PooledEffect = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  age: number;
  life: number;
  velocity: Vector3 | null;
  baseScale: number;
};

const flashPool: PooledEffect[] = [];
const shellPool: PooledEffect[] = [];
const beamPool: PooledEffect[] = [];

function buildPools(scene: Scene) {
  const flashGeometry = new PlaneGeometry(3.4, 3.4);
  for (let i = 0; i < 8; i += 1) {
    const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
    const mesh = new Mesh(flashGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    flashPool.push({ mesh, material, age: 1, life: -1, velocity: null, baseScale: 1 });
  }
  const shellGeometry = new OctahedronGeometry(0.28, 0);
  for (let i = 0; i < 10; i += 1) {
    const material = createAdditiveBasicMaterial({ color: 0x000000 });
    const mesh = new Mesh(shellGeometry, material);
    mesh.scale.set(0.7, 0.7, 4);
    mesh.visible = false;
    scene.add(mesh);
    shellPool.push({ mesh, material, age: 1, life: -1, velocity: null, baseScale: 1 });
  }
  const beamGeometry = new BoxGeometry(0.16, 0.16, 1);
  for (let i = 0; i < 12; i += 1) {
    const material = createAdditiveBasicMaterial({ color: 0x000000 });
    const mesh = new Mesh(beamGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    beamPool.push({ mesh, material, age: 1, life: -1, velocity: null, baseScale: 1 });
  }
}

function takeFromPool(pool: PooledEffect[]): PooledEffect | null {
  return pool.find((effect) => effect.age >= effect.life) ?? null;
}

// --- creation ------------------------------------------------------------------

export function createEnvironment(scene: Scene) {
  environment = createBroadsideEnvironment(scene);
  createEffects(scene);
  buildPools(scene);
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? '?');
    case 'dart':
      return createDartMesh();
    case 'gunship':
      return createGunshipMesh();
    case 'weaver':
      return createWeaverMesh();
    case 'battery':
      return createBatteryMesh();
    case 'pdturret':
      return createPdTurretMesh();
    case 'generator':
      return createGeneratorMesh();
    case 'conduit':
      return createConduitMesh();
    case 'bolt':
      return createBoltMesh();
    default:
      return createDartMesh();
  }
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  records.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  mesh.traverse((child) => {
    if (child instanceof Mesh && child.material instanceof MeshBasicMaterial) {
      child.material.wireframe = locked;
    }
  });
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  spawnRing(mesh.position, hdr(CRIMSON, 1.2), 2.8, 0.32);
}

export function createProjectileMesh() {
  const mesh = createPlayerProjectileMesh();
  projectileRecords.enqueue(mesh);
  return mesh;
}

export function createReticle() {
  const group = new Group();
  const parts: MeshBasicMaterial[] = [];
  const add = (geometry: RingGeometry | PlaneGeometry | CircleGeometry, color: Color) => {
    const material = createAdditiveBasicMaterial({ color, opacity: 0.9, side: DoubleSide });
    parts.push(material);
    const mesh = new Mesh(geometry, material);
    group.add(mesh);
    return mesh;
  };
  add(new RingGeometry(0.55, 0.6, 32), hdr(ICE, 1.2));
  for (let i = 0; i < 4; i += 1) {
    const tick = add(new PlaneGeometry(0.24, 0.04), hdr(GOLD, 1.2));
    const angle = (i / 4) * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0);
    tick.rotation.z = angle;
  }
  add(new CircleGeometry(0.035, 10), hdr(ICE, 1.9));
  group.userData.parts = parts;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.065 + (active ? 0.06 : 0));
  const colors = [ICE, ICE, GOLD, GOLD, MAGENTA, MAGENTA];
  const color = lockCount ? colorForLockCount(lockCount, colors) : ICE;
  for (const material of reticle.userData.parts as MeshBasicMaterial[]) {
    material.color.copy(hdr(color, active ? 1.5 : 1));
  }
}

// --- events ---------------------------------------------------------------------

let pendingExplosions: Array<{ at: number; position: Vector3 }> = [];

const BRACKET_GEOMETRY = new RingGeometry(1.3, 1.38, 4, 1, 0, Math.PI / 2);
const bracketMaterials = new Map<number, MeshBasicMaterial>();
function lockBracketMaterial(color: Color): MeshBasicMaterial {
  let material = bracketMaterials.get(color.getHex());
  if (!material) {
    material = createAdditiveBasicMaterial({ color: hdr(color, 1.3), side: DoubleSide });
    bracketMaterials.set(color.getHex(), material);
  }
  return material;
}

export function installVisualEventHandlers(bus: EventBus, _scene: Scene) {
  bus.on('spawn', ({ enemyId, worldPosition }) => {
    const record = records.claim(enemyId);
    if (!record || record.mesh.userData.kind === 'bolt' || record.mesh.userData.kind === 'letter') return;
    spawnRing(worldPosition, hdr(CRIMSON, 0.8), 2.6, 0.4);
  });

  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const record = records.get(enemyId);
    if (record && !record.lockRing) {
      const ring = new Group();
      const color = colorForLockCount(lockCount, [ICE, GOLD, MAGENTA]);
      const material = lockBracketMaterial(color);
      for (let i = 0; i < 4; i += 1) {
        const corner = new Mesh(BRACKET_GEOMETRY, material);
        corner.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
        ring.add(corner);
      }
      ring.scale.setScalar(record.mesh.userData.lockRingScale ?? 1);
      record.lockRing = ring;
    }
    burstSparks(worldPosition, hdr(ICE, 1), 3, 2.4);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = records.get(enemyId);
    if (record?.lockRing) {
      record.lockRing.removeFromParent();
      record.lockRing = null;
    }
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    burstSparks(worldPosition, hdr(ICE, 1.1), 4, 4);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = records.get(enemyId);
    if (!lethal) {
      burstSparks(worldPosition, hdr(ICE, 1), 6, 5);
      return;
    }
    const accent = (record?.mesh.userData.accent as Color | undefined) ?? EMBER;
    burstDebris(worldPosition, record?.mesh.userData.shardSpecs, paletteOf(accent));
    burstSparks(worldPosition, hdr(accent, 0.5), 8, 7);
    const big = record?.mesh.userData.kind === 'generator'
      || record?.mesh.userData.kind === 'conduit'
      || record?.mesh.userData.kind === 'battery';
    spawnRing(worldPosition, hdr(accent, 1), big ? 6.5 : 4.4, big ? 0.55 : 0.42);
    spawnGlint(worldPosition, hdr(ICE, 1.4), big ? 1.8 : 1, big ? 0.26 : 0.16);
  });

  bus.on('stage', ({ worldPosition }) => {
    spawnRing(worldPosition, hdr(GOLD, 1.4), 5.5, 0.5);
  });

  bus.on('kill', ({ enemyId }) => {
    const record = records.get(enemyId);
    if (record?.lockRing) {
      record.lockRing.removeFromParent();
      record.lockRing = null;
    }
    records.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    records.delete(enemyId, { dispose: true });
    burstSparks(worldPosition, hdr(CRIMSON, 0.5), 4, 2.6);
  });

  // Releasing a conduit behind the shield flashes every live generator.
  bus.on('shielded', ({ shields }) => {
    for (const shield of shields) {
      const record = records.get(shield.enemyId);
      if (record) record.mesh.userData.shieldFlashUntil = elapsedNow + 0.7;
      spawnRing(shield.worldPosition, hdr(MAGENTA, 1.4), 4.6, 0.45);
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = isDownbeat ? 1 : 0.45;
    maybeCannonSalvo(isDownbeat);
    maybeCrossfire();
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.5;
    feelRig?.shake(0.5);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') {
      // Shield drop: the trench conductors flare gold for a breath.
      shieldDropUntil = elapsedNow + 2.2;
      if (environment) {
        for (const material of environment.trenchConductors) {
          material.color.copy(hdr(GOLD, 2.2));
        }
      }
    }
    if (phase === 'destroyed') {
      destroyedAt = elapsedNow;
      burningShips = true;
      pendingExplosions = [];
      for (let i = 0; i < 12; i += 1) {
        pendingExplosions.push({
          at: destroyedAt + 0.12 + i * 0.17,
          position: pointAlongFlagship(44 + Math.random() * 14),
        });
      }
      feelRig?.shake(1);
      finaleFlash.value = 1.4;
    }
  });

  bus.on('runstart', () => {
    resetEffects();
    records.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    destroyedAt = -1;
    burningShips = false;
    pendingExplosions = [];
    finaleFlash.value = 0;
    shieldDropUntil = -1;
    for (const pool of [flashPool, shellPool, beamPool]) {
      for (const effect of pool) {
        effect.age = 1;
        effect.life = -1;
        effect.mesh.visible = false;
      }
    }
    if (environment) {
      for (const material of environment.trenchConductors) {
        material.color.copy(hdr(GOLD, 0.7));
      }
    }
  });
}

/** World-space point along the flagship's keel for the break-apart chain. */
function pointAlongFlagship(seconds: number): Vector3 {
  // Mirrors the flagship placement in ships.ts: right +10, up +22.
  const frame = sampleRailFrame(RAIL, Math.min(0.9999, progressAt(seconds)));
  return frame.position.clone()
    .addScaledVector(frame.right, 10 + (Math.random() - 0.5) * 34)
    .addScaledVector(frame.up, 22 + (Math.random() - 0.5) * 12);
}

// --- set pieces -------------------------------------------------------------------

function maybeCannonSalvo(isDownbeat: boolean) {
  if (!isDownbeat || !environment) return;
  if (lastRunProgress < progressAt(22.4) || lastRunProgress > progressAt(30.1)) return;
  const anchors = environment.muzzleAnchors;
  const index = Math.floor(Math.random() * anchors.length);
  const frame = sampleRailFrame(RAIL, lastRunProgress);
  for (let i = 0; i < 2; i += 1) {
    const anchor = anchors[(index + i * 3) % anchors.length];
    const flash = takeFromPool(flashPool);
    if (flash) {
      flash.mesh.position.copy(anchor);
      flash.baseScale = 2.4;
      flash.material.color.copy(hdr(GOLD, 1.6));
      flash.age = 0;
      flash.life = 0.24;
      flash.velocity = null;
      flash.mesh.visible = true;
    }
    // Shell streaks race across the view toward the distant enemy line.
    const shell = takeFromPool(shellPool);
    if (shell) {
      shell.mesh.position.copy(anchor).addScaledVector(frame.right, -1.5);
      shell.material.color.copy(hdr(GOLD, 1.3));
      shell.age = 0;
      shell.life = 0.85;
      shell.velocity = frame.right.clone().multiplyScalar(-(34 + Math.random() * 14))
        .addScaledVector(frame.up, 6 + Math.random() * 8)
        .addScaledVector(frame.tangent, 6);
      shell.mesh.visible = true;
    }
    if (i === 0) {
      spawnGlint(
        anchor.clone()
          .addScaledVector(frame.right, -(48 + Math.random() * 20))
          .addScaledVector(frame.up, Math.random() * 14),
        hdr(EMBER, 1.2),
        2.2,
        0.3,
      );
    }
  }
  feelRig?.shake(0.22);
}

function maybeCrossfire() {
  if (!environment) return;
  const p = lastRunProgress;
  const inWindow = (a: number, b: number) => p >= progressAt(a) && p <= progressAt(b);
  if (!(inWindow(6.6, 22.4) || inWindow(32.8, 58.9))) return;
  if (Math.random() > 0.75) return;
  const frame = sampleRailFrame(RAIL, p);
  const side = Math.random() < 0.5 ? -1 : 1;
  const start = frame.position.clone()
    .addScaledVector(frame.right, side * (18 + Math.random() * 26))
    .addScaledVector(frame.up, (Math.random() - 0.4) * 26)
    .addScaledVector(frame.tangent, 26 + Math.random() * 46);
  const end = start.clone()
    .addScaledVector(frame.right, (Math.random() - 0.5) * 26)
    .addScaledVector(frame.up, (Math.random() - 0.5) * 18);
  const beam = takeFromPool(beamPool);
  if (!beam) return;
  beam.mesh.position.copy(start);
  beam.mesh.lookAt(end);
  beam.mesh.scale.set(1, 1, start.distanceTo(end));
  beam.material.color.copy(hdr(Math.random() < 0.6 ? CRIMSON : GOLD, 0.9));
  beam.age = 0;
  beam.life = 0.22;
  beam.velocity = null;
  beam.mesh.visible = true;
}

// --- update -----------------------------------------------------------------------

export function updateVisuals(dt: number, ctx: {
  scene: Scene;
  camera: PerspectiveCamera;
  feel: CameraFeelRig;
  elapsed: number;
  runProgress: number;
}) {
  elapsedNow = ctx.elapsed;
  feelRig = ctx.feel;
  beatEnergy = Math.max(0, beatEnergy - dt * 4);
  ctx.feel.setFovOffset(beatEnergy * 1.3);
  lastRunProgress = ctx.runProgress;
  finaleFlash.value = Math.max(0, finaleFlash.value - dt * 0.9);

  environment?.debris.update(ctx.runProgress, dt);
  updateShipLights();
  updateTrenchPulse();

  // Break-apart chain along the flagship's keel.
  while (pendingExplosions.length > 0 && pendingExplosions[0].at <= elapsedNow) {
    const explosion = pendingExplosions.shift();
    if (!explosion) break;
    spawnRing(explosion.position, hdr(EMBER, 1.4), 14, 0.7);
    spawnRing(explosion.position, hdr(GOLD, 0.8), 8, 0.5);
    burstDebris(explosion.position, undefined, 'ember');
    burstSparks(explosion.position, hdr(GOLD, 1), 10, 9);
    spawnGlint(explosion.position, hdr(ICE, 1.6), 3, 0.3);
    feelRig?.shake(0.18);
  }

  for (const [enemyId, record] of records.entries()) {
    if (!record.mesh.parent) {
      records.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.born === null) record.born = elapsedNow;
    const age = elapsedNow - record.born;
    const intro = Math.min(1, age / 0.35);
    const denied = (record.mesh.userData.deniedUntil ?? -Infinity) > elapsedNow;
    record.mesh.scale.setScalar(easeOutBack(intro) * (denied ? 0.8 + Math.sin(elapsedNow * 34) * 0.1 : 1));

    const spin = record.mesh.userData.spin as number | undefined;
    if (spin !== undefined) {
      const rings = record.mesh.userData.rings as Mesh[] | undefined;
      if (rings) {
        rings[0].rotation.z = spin * 1.6;
        rings[1].rotation.z = -spin * 1.1;
        rings[0].rotation.x = Math.sin(spin * 0.7) * 0.5;
      }
      const gyro = record.mesh.userData.gyro as Mesh | undefined;
      if (gyro) gyro.rotation.z = spin * 3.4;
    }

    const pulse = record.mesh.userData.pulse as number | undefined;
    if (pulse !== undefined) {
      const plasma = record.mesh.userData.plasma as Mesh | undefined;
      if (plasma) plasma.scale.setScalar(0.85 + Math.sin(pulse * 7) * 0.18);
      const channel = record.mesh.userData.channel as Mesh | undefined;
      if (channel) {
        (channel.material as MeshBasicMaterial).color.copy(hdr(GOLD, 1.7 + Math.sin(pulse * 9) * 0.5));
      }
    }

    const shielded = record.mesh.userData.shielded === true;
    const shieldFlash = (record.mesh.userData.shieldFlashUntil ?? -Infinity) > elapsedNow;
    if (shielded || shieldFlash) {
      const orb = record.mesh.children[0] as Mesh | undefined;
      if (orb && orb.material instanceof MeshBasicMaterial) {
        orb.material.color.copy(hdr(shieldFlash ? GOLD : MAGENTA, shieldFlash ? 2.4 : 1.5));
      }
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 2.4;
      const ringPulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      record.lockRing.scale.setScalar((record.mesh.userData.lockRingScale ?? 1) * ringPulse);
    }
  }

  for (const [projectileId, projectile] of projectileRecords.entries()) {
    if (!projectile.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    dropTrail(projectile.position, ICE);
  }

  for (const pool of [flashPool, shellPool, beamPool]) {
    for (const effect of pool) {
      if (effect.age >= effect.life) {
        effect.mesh.visible = false;
        continue;
      }
      effect.age += dt;
      const progress = Math.max(0, effect.age / effect.life);
      const envelope = Math.sin(Math.min(1, progress * 1.2) * Math.PI);
      if (effect.velocity) effect.mesh.position.addScaledVector(effect.velocity, dt);
      if (pool === flashPool) {
        effect.mesh.quaternion.copy(ctx.camera.quaternion);
        effect.mesh.scale.setScalar(effect.baseScale * (0.55 + 0.75 * envelope));
      }
      effect.material.opacity = envelope;
    }
  }

  updateEffects(dt, ctx.camera);

  // Reticle slow-spin; speeds up while actively locking.
  for (const child of ctx.scene.children) {
    if (child.userData.active !== undefined && child.userData.parts) {
      child.rotation.z += dt * (child.userData.active ? 1.8 : 0.5);
      break;
    }
  }
}

function updateShipLights() {
  if (!environment) return;
  environment.ships.forEach((ship, shipIndex) => {
    const base = ship.faction === 'friend' ? ICE : CRIMSON;
    ship.lights.forEach((material, index) => {
      const phase = elapsedNow * (ship.faction === 'friend' ? 2.4 : 5) + index * 1.3 + shipIndex;
      const blink = ship.faction === 'friend'
        ? 0.4 + Math.max(0, Math.sin(phase)) * 0.8
        : Math.sin(phase) > 0.55 ? 1.3 : 0.12;
      material.color.copy(hdr(base, blink));
    });
    // Ignited enemy hulls burn molten after the flagship falls.
    if (burningShips && ship.faction === 'foe' && ship.burnable) {
      const flicker = 0.75 + Math.sin(elapsedNow * 13 + shipIndex) * 0.25;
      ship.burnable.color.setRGB(1.6 * flicker, 0.7 * flicker, 0.25 * flicker);
    }
  });
}

function updateTrenchPulse() {
  if (!environment) return;
  if (elapsedNow < shieldDropUntil) return; // still flaring from the shield drop
  const inTrench = lastRunProgress >= progressAt(50);
  environment.trenchConductors.forEach((material, i) => {
    material.color.copy(hdr(GOLD, inTrench ? 0.6 + Math.sin(elapsedNow * 5 + i) * 0.25 : 0.7));
  });
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
