import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createAdditiveBasicMaterial, createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { dirToWorld } from '../world';
import { createCrown } from './crown';
import {
  animateEnemy,
  createBroodMesh,
  createBrooderMesh,
  createClamperMesh,
  createLeechMesh,
  createParentProxy,
  createSporeMesh,
  enemyRadius,
  setEnemyState,
} from './enemies';
import { createEffects } from './effects';
import { createEnvironment } from './environment';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  DENY,
  hdr,
  LOCK_GRADIENT,
  STRAND_GOLD,
  STRAND_GREEN,
  SUN_GOLD,
  SUN_WHITE,
  VIOLET,
  VIOLET_HOT,
  VIOLET_PALE,
  WATER_DEEP,
} from './palette';
import { flashU, hurtU, pulseU } from './uniforms';

// Event choreography. The visual grammar is cleansing: a parasite dies as a
// violet spatter, then gold sparks and green motes climb the axis toward the
// bell — light returning up the strand. The player's fire is a warm gold drop;
// locks are sun-coloured rings that warm from pale gold to coral.

type EnemyRecord = {
  id: number;
  kind: string;
  mesh: Object3D;
  bornAt: number;
  ring: Group | null;
  lockCount: number;
  flashUntil: number;
  deniedUntil: number;
  hero: number;
  broodOrder: number;
  radius: number;
};

type PendingEnemy = { mesh: Object3D; kind: string };
type ProjectileRecord = { mesh: Object3D; lastTrail: number };

export type VisualContext = {
  running: boolean;
  runTime: number;
  elapsed: number;
  vista: number;
  reveal: number;
  cleanse: number;
};

const SHAKE: CameraFeelShakeOptions = {
  decay: 2.4,
  maxTrauma: 1.6,
  pitchDegrees: 0.34,
  yawDegrees: 0.28,
  rollDegrees: 0.8,
  frequency: 8,
  smoothing: 20,
};

const POP_SECONDS = 0.34;

// Parasites are drawn a little larger than life: they must read at 40 m.
const BASE_SCALE: Record<string, number> = { clamper: 1.35, leech: 1.25, brooder: 1.2, spore: 1.3, brood: 2.3 };

export function createStrandlineVisuals(
  scene: Scene,
  bus: EventBus,
  camera: PerspectiveCamera,
  feel: CameraFeelRig,
  freedBy: () => 'kill' | 'pulse' | null,
) {
  const environment = createEnvironment(scene);
  const effects = createEffects(scene);
  const crown = createCrown(scene);
  crown.reset();

  const axisWorld = dirToWorld(new Vector3(0, 1, 0)); // toward the bell
  const scratchVector = new Vector3();

  let elapsedNow = 0;
  let runTimeNow = 0;
  let killCount = 0;
  let veilsCleared = 0;
  let latchIndex = 0;
  let broodIndex = 0;
  let freedAt = -1;
  let parentFreed = false;
  let pulseAge = 9;
  let reticleDeniedUntil = 0;
  let volleyGlow = 0;
  let gloom = 0;
  const later: Array<{ at: number; run: () => void }> = [];
  const schedule = (delay: number, run: () => void) => later.push({ at: elapsedNow + delay, run });

  // ---- record queues --------------------------------------------------------------------

  const enemies = createPendingVisualRecords<PendingEnemy, EnemyRecord, [number]>({
    createRecord: (pending, id) => ({
      id,
      kind: pending.kind,
      mesh: pending.mesh,
      bornAt: elapsedNow,
      ring: null,
      lockCount: 0,
      flashUntil: 0,
      deniedUntil: 0,
      hero: -1,
      broodOrder: -1,
      radius: enemyRadius(pending.kind) * (BASE_SCALE[pending.kind] ?? 1),
    }),
    disposeRecord: (record) => removeRing(record),
  });
  const projectiles = createPendingVisualRecords<ProjectileRecord, ProjectileRecord, []>({
    createRecord: (record) => record,
  });

  // ---- meshes handed to the runner ----------------------------------------------------------

  function createEnemyMesh(kind: string, letter?: string) {
    let mesh: Object3D;
    switch (kind) {
      case 'letter':
        mesh = createLetterMesh(letter ?? 'I');
        break;
      case 'clamper':
        mesh = createClamperMesh();
        break;
      case 'leech':
        mesh = createLeechMesh();
        break;
      case 'brooder':
        mesh = createBrooderMesh();
        break;
      case 'spore':
        mesh = createSporeMesh();
        break;
      case 'brood':
        mesh = createBroodMesh();
        break;
      case 'parent':
        mesh = createParentProxy();
        break;
      default:
        mesh = createClamperMesh();
    }
    mesh.userData.kind = kind;
    mesh.userData.seed = Math.random() * 60;
    mesh.userData.baseScale = BASE_SCALE[kind] ?? 1;
    mesh.renderOrder = 6;
    mesh.scale.setScalar(0.001);
    enemies.enqueue({ mesh, kind });
    return mesh;
  }

  function setEnemyLocked(mesh: Object3D, locked: boolean) {
    mesh.userData.locked = locked;
    if (mesh.userData.isLetter) setLetterLocked(mesh as Group, locked);
    else if (!mesh.userData.proxy) setEnemyState(mesh, locked ? 'locked' : 'rest');
  }

  function setEnemyDenied(mesh: Object3D) {
    mesh.userData.deniedUntil = elapsedNow + 0.55;
    const record = enemies.get(mesh.userData.raildEnemyId as number);
    if (record) record.deniedUntil = elapsedNow + 0.55;
    ringPulse(mesh.position, DENY.clone().multiplyScalar(2.2), 3.4, 0.4);
    effects.burst(mesh.position, hdr(DENY, 1.8), 8, 4, { life: 0.4, size: 0.3, drag: 3 });
  }

  // Player fire: a warm drop of light — the only warm thing in the water.
  const projectileCore = new SphereGeometry(0.2, 8, 6);
  const projectileHalo = new SphereGeometry(0.46, 8, 6);
  const projectileCoreMaterial = new MeshBasicMaterial({ color: hdr(SUN_WHITE, 2.6) });
  const projectileHaloMaterial = createAdditiveBasicMaterial({ color: hdr(SUN_GOLD, 1.1), opacity: 0.55 });
  function createProjectileMesh() {
    const group = new Group();
    const core = new Mesh(projectileCore, projectileCoreMaterial);
    core.scale.set(1, 1, 2.4);
    const halo = new Mesh(projectileHalo, projectileHaloMaterial);
    halo.scale.set(1, 1, 1.9);
    group.add(core, halo);
    projectiles.enqueue({ mesh: group, lastTrail: 0 });
    return group;
  }

  // Reticle: a gold sight ringed by petals that light with each lock, over a dark
  // outline so it holds against sunlit water even with bloom off.
  function createReticle() {
    const group = new Group();
    const parts: Array<{ material: MeshBasicMaterial; base: Color }> = [];
    const add = (mesh: Mesh, base: Color, order: number) => {
      const material = mesh.material as MeshBasicMaterial;
      material.color.copy(base);
      material.depthTest = false;
      material.depthWrite = false;
      material.transparent = true;
      mesh.renderOrder = 900 + order;
      parts.push({ material, base });
      group.add(mesh);
      return mesh;
    };
    const shadowMaterial = new MeshBasicMaterial({ color: WATER_DEEP.clone().multiplyScalar(0.8), side: DoubleSide, transparent: true, opacity: 0.75 });
    const shadow = new Mesh(new RingGeometry(0.55, 0.74, 40), shadowMaterial);
    shadowMaterial.depthTest = false;
    shadow.renderOrder = 898;
    group.add(shadow);
    add(new Mesh(new RingGeometry(0.6, 0.67, 48), new MeshBasicMaterial({ side: DoubleSide })), hdr(SUN_GOLD, 1.3), 1);

    const spinner = new Group();
    for (let i = 0; i < 4; i += 1) {
      const tick = new Mesh(new PlaneGeometry(0.16, 0.06), new MeshBasicMaterial({ side: DoubleSide }));
      const angle = (i / 4) * Math.PI * 2;
      tick.position.set(Math.cos(angle) * 0.86, Math.sin(angle) * 0.86, 0);
      tick.rotation.z = angle;
      add(tick, hdr(SUN_WHITE, 1.5), 2);
      spinner.add(tick);
    }
    group.add(spinner);

    const petals: Mesh[] = [];
    const petalGroup = new Group();
    for (let i = 0; i < 6; i += 1) {
      const petal = new Mesh(new CircleGeometry(0.075, 10), new MeshBasicMaterial({ side: DoubleSide }));
      const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
      petal.position.set(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, 0);
      add(petal, hdr(SUN_GOLD, 0.3), 3);
      petals.push(petal);
      petalGroup.add(petal);
    }
    group.add(petalGroup);
    add(new Mesh(new CircleGeometry(0.035, 12), new MeshBasicMaterial({ side: DoubleSide })), hdr(SUN_WHITE, 2), 4);

    group.userData.parts = parts;
    group.userData.spinner = spinner;
    group.userData.petalGroup = petalGroup;
    group.userData.petals = petals;
    return group;
  }

  function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
    reticle.scale.setScalar(1 + lockCount * 0.07 + (active ? 0.06 : 0));
    const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color }>;
    const petals = reticle.userData.petals as Mesh[];
    const denied = elapsedNow < reticleDeniedUntil;
    const charge = lockCount === 0 ? null : colorForLockCount(lockCount, LOCK_GRADIENT);
    for (const part of parts) {
      if (denied) part.material.color.copy(hdr(DENY, 2.4));
      else if (charge) part.material.color.copy(hdr(charge, active ? 1.8 : 1.4));
      else part.material.color.copy(part.base).multiplyScalar(active ? 1.3 : 1);
    }
    petals.forEach((petal, index) => {
      const lit = index < lockCount;
      const material = petal.material as MeshBasicMaterial;
      if (denied) material.color.copy(hdr(DENY, 2));
      else if (lit) material.color.copy(hdr(colorForLockCount(index + 1, LOCK_GRADIENT), 2.2));
      else material.color.copy(hdr(SUN_GOLD, 0.28));
      petal.scale.setScalar(lit ? 1.35 : 0.9);
    });
    (reticle.userData.spinner as Group).rotation.z = elapsedNow * (active ? 2.1 : 0.7);
    (reticle.userData.petalGroup as Group).rotation.z = -elapsedNow * 0.5;
  }

  // ---- lock rings -------------------------------------------------------------------------

  const ringGeometry = new RingGeometry(0.86, 1, 44);
  const discGeometry = new CircleGeometry(0.86, 32);
  const petalGeometry = new PlaneGeometry(0.2, 0.42);

  function makeLockRing(color: Color, count: number) {
    const group = new Group();
    const ring = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: hdr(color, 1.5), side: DoubleSide }));
    group.add(ring);
    // a faint filled disc so the captured target glows from within
    group.add(new Mesh(discGeometry, createAdditiveBasicMaterial({ color: hdr(color, 0.32), side: DoubleSide })));
    const spokes = new Group();
    const total = Math.max(4, count * 2);
    for (let i = 0; i < total; i += 1) {
      const petal = new Mesh(petalGeometry, createAdditiveBasicMaterial({ color: hdr(color, 1.7), side: DoubleSide }));
      const angle = (i / total) * Math.PI * 2;
      petal.position.set(Math.cos(angle) * 1.16, Math.sin(angle) * 1.16, 0);
      petal.rotation.z = angle - Math.PI / 2;
      spokes.add(petal);
    }
    group.add(spokes);
    group.renderOrder = 11;
    group.userData.spokes = spokes;
    group.userData.ring = ring;
    group.userData.raildIgnoreOcclusion = true;
    return group;
  }

  function removeRing(record: EnemyRecord) {
    if (!record.ring) return;
    record.ring.removeFromParent();
    for (const child of record.ring.children) {
      const mesh = child as Mesh;
      if (mesh.material) (mesh.material as MeshBasicMaterial).dispose();
      for (const grand of child.children) ((grand as Mesh).material as MeshBasicMaterial | undefined)?.dispose();
    }
    record.ring = null;
  }

  // ---- effect shorthands ---------------------------------------------------------------------

  function ringPulse(position: Vector3, color: Color, size: number, life: number) {
    effects.ring(position, camera.quaternion, color, size, life);
  }

  function cleansingBurst(position: Vector3, radius: number, chain: number, killed: boolean) {
    const scale = 0.8 + Math.min(1.2, chain * 0.16);
    // the parasite lets go: a violet spatter that thins to nothing
    effects.burst(position, hdr(VIOLET, 1.2), Math.round(10 * scale), 7, { life: 0.55, size: 0.55 * radius * 0.5, drag: 3.2, accel: new Vector3(0, -0.4, 0) });
    effects.burst(position, hdr(VIOLET_PALE, 1.4), Math.round(6 * scale), 9, { life: 0.4, size: 0.3, drag: 3.8 });
    // the strand's light answers: sun-gold sparks that hang in the water…
    effects.burst(position, hdr(SUN_GOLD, 1.7), Math.round(12 * scale), 10, { life: 0.9, size: 0.3, drag: 2.6, shape: 1 });
    // …and green motes that climb the axis toward the bell.
    effects.burst(position, hdr(STRAND_GREEN, 1.5), Math.round(9 * scale), 3, {
      life: 2.2,
      size: 0.42,
      drag: 0.9,
      accel: axisWorld.clone().multiplyScalar(5),
      shape: -1,
      spread: radius * 0.6,
    });
    ringPulse(position, hdr(SUN_GOLD, 1.9), radius * 2.8, 0.5);
    if (killed) ringPulse(position, hdr(SUN_WHITE, 1.2), radius * 1.6, 0.32);
    effects.glint(position, camera.quaternion, hdr(SUN_WHITE, 2), radius * 0.9, 0.22);
  }

  // ---- event wiring --------------------------------------------------------------------------

  bus.on('runstart', () => {
    enemies.clear({ dispose: true, pending: true });
    projectiles.clear({ dispose: true, pending: true });
    effects.clear();
    crown.reset();
    later.length = 0;
    killCount = 0;
    veilsCleared = 0;
    latchIndex = 0;
    broodIndex = 0;
    freedAt = -1;
    parentFreed = false;
    volleyGlow = 0;
    gloom = 0;
    flashU.value = 0;
    hurtU.value = 0;
  });

  bus.on('beat', ({ beatNumber }) => {
    // The lub of the lub-dub lands on beats 1 and 3 of every bar.
    if (beatNumber % 2 === 0) {
      pulseAge = 0;
      pulseU.value = 1;
    }
  });

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemies.claim(enemyId, enemyId);
    if (!record) return;
    if (kind === 'clamper' || kind === 'brooder') {
      record.hero = latchIndex;
      latchIndex += 1;
    } else if (kind === 'brood') {
      record.broodOrder = broodIndex;
      broodIndex += 1;
      crown.attachBrood(record.broodOrder, record.mesh);
      // the parent squeezes a larva out along the web
      const crownPosition = crown.worldPosition(scratchVector);
      effects.burst(crownPosition, hdr(VIOLET_HOT, 1.4), 12, 7, { life: 0.6, size: 0.6, drag: 2.5 });
      ringPulse(crownPosition, hdr(VIOLET_PALE, 1.5), 9, 0.5);
      feel.shake(0.16, SHAKE);
    } else if (kind === 'spore') {
      // A parasite sneezes: a violet flash where it leaves the sac.
      effects.burst(worldPosition, hdr(VIOLET_HOT, 1.6), 7, 4, { life: 0.4, size: 0.35, drag: 3 });
      ringPulse(worldPosition, hdr(VIOLET_HOT, 1.4), 2.6, 0.32);
    } else if (kind === 'leech') {
      effects.burst(worldPosition, hdr(VIOLET_PALE, 0.9), 5, 2, { life: 0.5, size: 0.3, drag: 2 });
    } else if (kind === 'letter') {
      effects.burst(worldPosition, hdr(STRAND_GREEN, 1.3), 3, 1.4, { life: 0.9, size: 0.26, drag: 1.5, shape: -1 });
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const record = enemies.get(enemyId);
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    if (record) {
      record.lockCount += 1;
      removeRing(record);
      const ring = makeLockRing(color, record.lockCount);
      scene.add(ring);
      record.ring = ring;
    }
    ringPulse(worldPosition, hdr(color, 1.6), 2.6, 0.26);
    effects.burst(worldPosition, hdr(color, 1.4), 4, 3, { life: 0.35, size: 0.22, drag: 3 });
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemies.get(enemyId);
    if (!record) return;
    record.lockCount = 0;
    removeRing(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectiles.claim(projectileId);
    effects.glint(worldPosition, camera.quaternion, hdr(SUN_GOLD, 1.7), 0.5, 0.14);
    effects.burst(worldPosition, hdr(SUN_GOLD, 1.3), 3, 2, { life: 0.3, size: 0.2, drag: 3 });
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal, indexInVolley }) => {
    projectiles.delete(projectileId);
    const record = enemies.get(enemyId);
    effects.burst(worldPosition, hdr(SUN_GOLD, 1.5), 5, 8, { life: 0.4, size: 0.24, drag: 3.4, shape: 1 });
    if (record && !lethal) {
      record.flashUntil = elapsedNow + 0.16;
      effects.glint(worldPosition, camera.quaternion, hdr(SUN_WHITE, 2), record.radius * 0.7, 0.16);
      if (record.kind === 'parent') {
        feel.shake(0.3, SHAKE);
        ringPulse(worldPosition, hdr(SUN_GOLD, 1.4), 9, 0.4);
      }
    }
    void indexInVolley;
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    if (!record) return;
    if (record.kind === 'brooder') {
      record.mesh.userData.stageIndex = 1;
      effects.burst(worldPosition, hdr(VIOLET_PALE, 1.5), 16, 10, { life: 0.7, size: 0.5, drag: 2.2 });
      effects.burst(worldPosition, hdr(SUN_GOLD, 1.5), 10, 8, { life: 0.6, size: 0.3, drag: 3, shape: 1 });
      ringPulse(worldPosition, hdr(SUN_GOLD, 1.7), 6, 0.45);
    } else if (record.kind === 'parent') {
      // The carapace tears away and the animal shudders around it.
      crown.stageBreak();
      const at = crown.worldPosition(scratchVector.clone());
      feel.shake(1, SHAKE);
      feel.kickFov(4, { decay: 3 });
      effects.wave(at, hdr(VIOLET_HOT, 1.6), 30, 0.9);
      ringPulse(at, hdr(SUN_GOLD, 1.8), 26, 0.8);
      effects.burst(at, hdr(VIOLET_PALE, 1.5), 50, 22, { life: 1.1, size: 0.8, drag: 1.8 });
      effects.burst(at, hdr(SUN_GOLD, 1.7), 30, 20, { life: 1, size: 0.4, drag: 2, shape: 1 });
      flashU.value = Math.max(flashU.value, 0.25);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition, indexInVolley }) => {
    const record = enemies.get(enemyId);
    const kind = record?.kind ?? 'clamper';
    if (kind === 'letter') {
      effects.burst(worldPosition, hdr(STRAND_GOLD, 1.6), 14, 6, { life: 0.8, size: 0.3, drag: 2.4, shape: 1 });
      effects.burst(worldPosition, hdr(STRAND_GREEN, 1.4), 8, 2, { life: 1.4, size: 0.34, drag: 1, accel: axisWorld.clone().multiplyScalar(3), shape: -1 });
      ringPulse(worldPosition, hdr(SUN_GOLD, 1.5), 3.2, 0.45);
      return;
    }
    killCount += 1;
    if (kind === 'parent') {
      parentFreedFinale(false);
      return;
    }
    const radius = record?.radius ?? 1.6;
    cleansingBurst(worldPosition, radius, indexInVolley ?? 0, true);
    if (record && record.hero >= 0) {
      const hero = record.hero;
      environment.cleanseHero(hero);
      // The cleansed strand lights up from the parasite's seat toward the bell.
      for (let step = 0; step < 8; step += 1) {
        schedule(step * 0.06, () => {
          const at = worldPosition.clone().addScaledVector(axisWorld, step * 9);
          effects.burst(at, hdr(STRAND_GOLD, 1.6), 4, 1.5, { life: 1.2, size: 0.34, drag: 1.2, accel: axisWorld.clone().multiplyScalar(5), shape: -1 });
          if (step % 2 === 0) effects.glint(at, camera.quaternion, hdr(STRAND_GOLD, 1.5), 1.1 + step * 0.05, 0.25);
        });
      }
    }
    if (record && record.kind === 'brood') {
      const veil = crown.broodDied(record.broodOrder);
      if (veil >= 0 && crown.state !== 'idle') {
        // A veil whose last brood is gone dies back: a violet shock, then gold.
        const remaining = broodIndex;
        void remaining;
      }
      // web snap
      const at = crown.worldPosition(scratchVector.clone());
      effects.burst(at, hdr(VIOLET_PALE, 1.1), 6, 6, { life: 0.4, size: 0.4, drag: 3 });
    }
    if (record && record.kind === 'spore') {
      effects.burst(worldPosition, hdr(SUN_WHITE, 1.4), 6, 6, { life: 0.35, size: 0.25, drag: 3.4 });
    }
    feel.shake(kind === 'brooder' ? 0.28 : 0.1, SHAKE);
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemies.get(enemyId);
    if (!record) return;
    if (record.kind === 'parent') {
      parentFreedFinale(freedBy() !== 'kill');
      return;
    }
    if (record.kind === 'letter') return;
    if (record.kind === 'brood') crown.broodDied(record.broodOrder);
    // an un-shot parasite is simply gone: a dull violet pop
    effects.burst(worldPosition, hdr(VIOLET, 0.8), 5, 3, { life: 0.4, size: 0.4, drag: 3 });
  });

  bus.on('reject', ({ enemyIds }) => {
    reticleDeniedUntil = elapsedNow + 0.4;
    for (const id of enemyIds) {
      const record = enemies.get(id);
      if (record) {
        ringPulse(record.mesh.position, hdr(DENY, 2), record.radius * 2.6, 0.32);
      }
    }
    hurtU.value = Math.max(hurtU.value, 0.22);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size >= 6 && kills >= 6) {
      volleyGlow = 1;
      feel.kickFov(5, { decay: 3.5 });
      feel.shake(0.4, SHAKE);
      const ahead = camera.getWorldDirection(new Vector3()).multiplyScalar(20).add(camera.position);
      ringPulse(ahead, hdr(SUN_GOLD, 1.7), 34, 0.7);
      ringPulse(ahead, hdr(SUN_WHITE, 1.2), 20, 0.5);
      flashU.value = Math.max(flashU.value, 0.16);
    } else if (size >= 4 && kills >= size) {
      flashU.value = Math.max(flashU.value, 0.05);
    }
  });

  bus.on('playerhit', () => {
    hurtU.value = 1;
    feel.shake(0.9, SHAKE);
    feel.kickFov(-3, { decay: 5 });
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'summoned') {
      crown.summon(runTimeNow);
      const at = crown.worldPosition(scratchVector.clone());
      feel.shake(0.9, SHAKE);
      effects.wave(at, hdr(VIOLET, 1.4), 48, 1.6);
      ringPulse(at, hdr(VIOLET_HOT, 1.6), 30, 1.1);
    } else if (phase === 'exposed') {
      crown.expose();
      const at = crown.worldPosition(scratchVector.clone());
      feel.shake(0.8, SHAKE);
      effects.wave(at, hdr(SUN_GOLD, 1.4), 40, 1.2);
      ringPulse(at, hdr(SUN_WHITE, 1.6), 34, 0.9);
      flashU.value = Math.max(flashU.value, 0.2);
      veilsCleared = 2;
    }
  });

  function parentFreedFinale(byPulse: boolean) {
    if (parentFreed) return;
    parentFreed = true;
    freedAt = runTimeNow;
    crown.free();
    const at = crown.worldPosition(scratchVector.clone());
    feel.shake(byPulse ? 0.8 : 1.6, SHAKE);
    flashU.value = byPulse ? 0.35 : 0.7;
    effects.wave(at, hdr(SUN_WHITE, 1.8), 70, 1.6);
    effects.wave(at, hdr(SUN_GOLD, 1.4), 46, 1.1);
    ringPulse(at, hdr(SUN_WHITE, 1.8), 60, 1.2);
    effects.burst(at, hdr(VIOLET_PALE, 1.6), 90, 30, { life: 1.3, size: 1, drag: 1.5 });
    effects.burst(at, hdr(SUN_GOLD, 2), 80, 26, { life: 1.6, size: 0.5, drag: 1.4, shape: 1 });
    // The light climbs every strand: successive bursts up the axis, pouring toward the bell.
    for (let step = 0; step < 14; step += 1) {
      schedule(step * 0.07, () => {
        const point = at.clone().addScaledVector(axisWorld, step * 6).add(new Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 30));
        effects.burst(point, hdr(STRAND_GOLD, 2), 8, 4, { life: 1.6, size: 0.6, drag: 0.8, accel: axisWorld.clone().multiplyScalar(9), shape: -1 });
      });
    }
  }

  // ---- per-frame ------------------------------------------------------------------------

  function updateEnemyRecords(dt: number) {
    for (const record of enemies.values()) {
      const mesh = record.mesh;
      const age = elapsedNow - record.bornAt;
      // Pop-in: overshoot and settle.
      const t = MathUtils.clamp(age / POP_SECONDS, 0, 1);
      const back = 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
      const base = (mesh.userData.baseScale as number | undefined) ?? 1;
      mesh.scale.setScalar(Math.max(0.001, back * base));

      if (mesh.userData.isLetter) {
        const denied = mesh.userData.deniedUntil as number | undefined;
        if (denied && elapsedNow < denied) setLetterDenied(mesh as Group, 1 - (denied - elapsedNow) / 0.55);
        else if (denied && !mesh.userData.locked) {
          setLetterDenied(mesh as Group, 1);
          mesh.userData.deniedUntil = 0;
        }
      } else if (!mesh.userData.proxy) {
        animateEnemy(mesh, record.kind, elapsedNow, dt, camera);
        if (elapsedNow < record.flashUntil) setEnemyState(mesh, 'flash');
        else if (record.flashUntil > 0) {
          setEnemyState(mesh, mesh.userData.locked ? 'locked' : 'rest');
          record.flashUntil = 0;
        }
      }

      if (record.ring) {
        const ring = record.ring;
        const radius = ((mesh.userData.lockScale as number | undefined) ?? record.radius) * (1 + Math.sin(elapsedNow * 7 + record.id) * 0.04);
        ring.position.copy(mesh.position);
        ring.quaternion.copy(camera.quaternion);
        ring.scale.setScalar(radius);
        (ring.userData.spokes as Group).rotation.z = elapsedNow * 1.6;
      }
    }
  }

  function updateProjectiles() {
    for (const record of projectiles.values()) {
      const position = record.mesh.position;
      // A comet of gold bubbles.
      effects.particle({
        position: position.clone(),
        velocity: new Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6),
        color: hdr(SUN_GOLD, 1.3),
        size: 0.34,
        life: 0.32,
        drag: 2.2,
        accel: axisWorld.clone().multiplyScalar(1.5),
        shape: 0,
      });
    }
  }

  return {
    createEnemyMesh,
    setEnemyLocked,
    setEnemyDenied,
    createProjectileMesh,
    createReticle,
    setReticleActive,
    /** Time the parent let go (run seconds), or −1. */
    get freedAt() {
      return freedAt;
    },
    update(dt: number, ctx: VisualContext) {
      elapsedNow = ctx.elapsed;
      runTimeNow = ctx.runTime;

      // Vitality: the animal's aliveness — a slow climb with the run, lifted by
      // every parasite freed, and flooding to full when the parent lets go.
      const base = MathUtils.lerp(0.1, 0.56, MathUtils.smoothstep(ctx.runTime, 0, 24)) + 0.12 * MathUtils.smoothstep(ctx.runTime, 24, 40);
      const earned = Math.min(0.24, killCount * 0.0075) + veilsCleared * 0.06;
      const vitality = ctx.running || ctx.cleanse > 0
        ? Math.min(1, base + earned + ctx.cleanse * 0.6)
        : 0.16;
      const infection = Math.max(0, 1 - killCount * 0.011 - veilsCleared * 0.12 - ctx.cleanse);

      pulseAge += dt;
      pulseU.value = pulseAge < 1.2 ? Math.exp(-pulseAge * 3.6) : 0;
      volleyGlow = Math.max(0, volleyGlow - dt * 1.4);
      flashU.value = Math.max(0, flashU.value - dt * 1.9);
      hurtU.value = Math.max(0, hurtU.value - dt * 1.8);

      for (let i = later.length - 1; i >= 0; i -= 1) {
        if (later[i].at <= elapsedNow) {
          const task = later.splice(i, 1)[0];
          task.run();
        }
      }

      // Gloom: the crown's chamber is dark and violet until the webbing dies back.
      const gloomTarget = crown.state === 'covered' ? [1, 0.72, 0.5][Math.min(2, crown.veilsDown())] : crown.state === 'exposed' ? 0.55 : 0;
      gloom += (gloomTarget - gloom) * Math.min(1, dt * 1.6);

      environment.update(dt, camera, {
        running: ctx.running,
        runTime: ctx.runTime,
        vitality,
        infection,
        cleanse: ctx.cleanse,
        gloom,
        reveal: ctx.reveal,
        vista: ctx.vista,
      });
      crown.update(dt, ctx.runTime);
      updateEnemyRecords(dt);
      updateProjectiles();
      effects.update(dt, camera);
    },
    dispose() {
      environment.dispose();
      effects.dispose();
      crown.dispose();
      enemies.clear({ dispose: true, pending: true });
    },
  };
}

