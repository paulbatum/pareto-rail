import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
} from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { cameraSpeedAt, massDriverRunProgress, createMassDriverRail } from '../gameplay';
import { BEAT_SECONDS, INTERLOCK_TIME, SHOT_TIME } from '../timing';
import {
  createArcMesh,
  createCapacitorMesh,
  createCoilMesh,
  createInterlockMesh,
  createThreaderMesh,
  projectileGeometry,
  type EnemyTintHandles,
  type FacetSpec,
} from './enemies';
import { createEnvironmentInternal, type Environment } from './environment';
import {
  burstShatter,
  burstSparks,
  createEffects,
  resetEffects,
  spawnArcLightning,
  spawnArcWhip,
  spawnFlashDisc,
  spawnGlint,
  spawnShockRing,
  updateEffects,
} from './effects';
import { createLetterMesh, setLetterState } from './letters';
import { chargeUniform, detonationUniform, flashUniform } from './post-fx';
import { ARC_BLUE, HAZARD_AMBER, HAZARD_RED, ION_WHITE, LOCK_GRADIENT, VOLT_VIOLET, hdr, heatRamp } from './palette';

export { composeMassDriverOutput } from './post-fx';

// Spine: palette lives in palette.ts, construction in the leaf files; this
// module owns event choreography, the per-frame tint pass that drives every
// enemy state, the reticle-as-charge-gauge, and the three screen overlays.

export type VisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  feel: CameraFeelRig;
  elapsed: number;
  runTime: number;
  running: boolean;
};

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockRing: Group | null;
  deniedUntil: number;
  hitFlashUntil: number;
};

type ProjectileRecord = {
  mesh: Object3D;
  trailAccumulator: number;
};

let environment: Environment | null = null;
let elapsedNow = 0;
let beatPulse = 0;
let charge = 0;
let postShot = false;
let strobeStart = -1;
let lastCrossedBeat = -1;
let flashLevel = 0;
let detonationLevel = 0;
let bankRoll = 0;
let interlockKills = 0;
const interlocksAlive = new Set<number>();
let cameraRef: PerspectiveCamera | null = null;

const visualCurve = createMassDriverRail();

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously
// right after calling it — the pending queue pairs mesh with id.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null, deniedUntil: -1, hitFlashUntil: -1 }),
  disposeRecord: (record) => lockRings.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({
  createRecord: (record) => record,
});

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  return environment.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = buildEnemyMesh(kind, letter);
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string, letter?: string): Group {
  switch (kind) {
    case 'letter':
      return createLetterMesh(letter ?? '?');
    case 'coil':
      return createCoilMesh();
    case 'threader':
      return createThreaderMesh();
    case 'capacitor':
      return createCapacitorMesh();
    case 'arc':
      return createArcMesh();
    case 'interlock':
      return createInterlockMesh();
    default:
      return createCoilMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) setLetterState(mesh as Group, locked ? 'locked' : 'idle');
}

export function setEnemyDenied(mesh: Object3D) {
  const record = findRecordByMesh(mesh);
  if (record) record.deniedUntil = elapsedNow + 0.5;
  if (mesh.userData.isLetter) setLetterState(mesh as Group, 'denied');
  spawnShockRing(mesh.getWorldPosition(new Vector3()), hdr(HAZARD_RED, 1.1), 2.6, 0.3);
}

function findRecordByMesh(mesh: Object3D): EnemyRecord | undefined {
  for (const record of enemyRecords.values()) {
    if (record.mesh === mesh) return record;
  }
  return undefined;
}

// The player shot: a cold ion dart — a stretched white-hot core in a
// translucent arc-blue shell, dropping a blue trail. Geometry and materials
// are shared across every shot.
const projectileCoreMaterial = new MeshBasicMaterial({ color: hdr(ION_WHITE, 2.8) });
const projectileShellMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.0), opacity: 0.5 });

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(projectileGeometry('core'), projectileCoreMaterial);
  core.scale.set(0.42, 0.42, 2.3);
  const shell = new Mesh(projectileGeometry('shell'), projectileShellMaterial);
  shell.scale.set(0.55, 0.55, 2.1);
  group.add(core, shell);
  projectileRecords.enqueue({ mesh: group, trailAccumulator: 0 });
  return group;
}

// Reticle = breech charge gauge: a thin arc-blue ring around an ion-white
// center dot, with six arc segments that light one per lock up the lock
// gradient — the sixth segment is ignition-white, so a full volley literally
// reads "fully charged".
export function createReticle() {
  const group = new Group();
  const dot = new Mesh(new CircleGeometry(0.05, 18), new MeshBasicMaterial({ color: hdr(ION_WHITE, 2.0) }));
  const innerRing = new Mesh(
    new RingGeometry(0.3, 0.325, 40),
    createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.1), side: DoubleSide }),
  );
  const spinner = new Group();
  const segmentMaterials: MeshBasicMaterial[] = [];
  for (let i = 0; i < 6; i += 1) {
    const material = createAdditiveBasicMaterial({ color: ARC_BLUE.clone().multiplyScalar(0.2), side: DoubleSide });
    const segment = new Mesh(new RingGeometry(0.46, 0.56, 10, 1, (i / 6) * Math.PI * 2 + 0.14, Math.PI / 3 - 0.28), material);
    spinner.add(segment);
    segmentMaterials.push(material);
  }
  group.add(dot, innerRing, spinner);
  group.userData.spinner = spinner;
  group.userData.segmentMaterials = segmentMaterials;
  group.userData.active = false;
  group.userData.lockCount = 0;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  // Grows slightly per lock; spins faster while charging (per-frame below).
  reticle.scale.setScalar(1 + lockCount * 0.055 + (active ? 0.05 : 0));
  const materials = reticle.userData.segmentMaterials as MeshBasicMaterial[];
  for (let i = 0; i < materials.length; i += 1) {
    if (i < lockCount) {
      const color = i === 5 ? hdr(ION_WHITE, 2.6) : colorForLockCount(i + 1, LOCK_GRADIENT);
      materials[i].color.copy(color).multiplyScalar(i === 5 ? 1 : 1.35);
    } else {
      materials[i].color.copy(ARC_BLUE).multiplyScalar(active ? 0.34 : 0.2);
    }
  }
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind === 'interlock') {
      interlocksAlive.add(enemyId);
      // Every event carries its tell: interlock spawns land a double hazard
      // ring and a camera jolt.
      spawnShockRing(worldPosition, hdr(HAZARD_AMBER, 1.4), 5.4, 0.5);
      spawnShockRing(worldPosition, hdr(HAZARD_AMBER, 0.8), 3.2, 0.36);
      feel.shake(0.16);
    } else if (kind === 'arc') {
      spawnShockRing(worldPosition, hdr(VOLT_VIOLET, 1.1), 2.0, 0.26);
    } else if (kind !== 'letter') {
      spawnShockRing(worldPosition, hdr(ARC_BLUE, 0.8), 2.8, 0.4);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = lockCount >= 6 ? hdr(ION_WHITE, 1.6) : colorForLockCount(lockCount, LOCK_GRADIENT);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockRing(lockColor, (record.mesh.userData.lockRingScale as number | undefined) ?? 1), scene);
    }
    spawnShockRing(worldPosition, hdr(lockColor, 1.3), 2.2, 0.26);
    // The sixth lock pumps a blinding bloom — fully charged.
    if (lockCount >= 6) {
      flashLevel = Math.max(flashLevel, 0.34);
      spawnGlint(worldPosition, hdr(ION_WHITE, 2.2), 1.7, 0.22);
    }
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    spawnGlint(worldPosition, hdr(ION_WHITE, 1.1), 0.5, 0.1);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (record) record.hitFlashUntil = elapsedNow + 0.22;
    // Cross-glints for the player's own impacts; chips whip a short arc.
    spawnGlint(worldPosition, hdr(ION_WHITE, 1.5), 0.9, 0.14);
    if (!lethal) {
      burstSparks(worldPosition, hdr(ARC_BLUE, 1.0), 6, 11, 0.7);
      spawnArcWhip(worldPosition, hdr(ARC_BLUE, 1.3), 2.2, 0.18);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const mesh = record.mesh;
    mesh.userData.exposed = true;
    // Capacitor staves shear off along the six stave directions; the
    // interlock cowl pops off the actuator core.
    const staves = mesh.userData.staves as Group | undefined;
    const cowl = mesh.userData.cowl as Group | undefined;
    const shed = staves ?? cowl;
    if (shed) shed.visible = false;
    const hiddenCore = mesh.userData.hiddenCore as Group | undefined;
    if (hiddenCore) hiddenCore.visible = true;
    const specs = mesh.userData.facetSpecs as FacetSpec[] | undefined;
    burstShatter(worldPosition, specs?.slice(0, 6), hdr(VOLT_VIOLET, 1.1), 0.8);
    spawnShockRing(worldPosition, hdr(VOLT_VIOLET, 1.4), 4.4, 0.4);
    spawnArcWhip(worldPosition, hdr(VOLT_VIOLET, 1.5), 3.0, 0.24);
    spawnGlint(worldPosition, hdr(ION_WHITE, 2.0), 1.4, 0.18);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const isInterlock = interlocksAlive.delete(enemyId);
    if (record) {
      const specs = record.mesh.userData.facetSpecs as FacetSpec[] | undefined;
      const accent = isInterlock ? hdr(HAZARD_AMBER, 1.1) : hdr(ARC_BLUE, 1.0);
      // Kills throw a shatter-burst and a whip of arc lightning; interlock
      // kills doubled and heavier.
      burstShatter(worldPosition, specs, accent, isInterlock ? 1.5 : 1);
      spawnArcWhip(worldPosition, isInterlock ? hdr(ION_WHITE, 1.8) : hdr(ARC_BLUE, 1.4), isInterlock ? 5 : 3.2);
      spawnShockRing(worldPosition, accent, isInterlock ? 7.5 : 4.6, isInterlock ? 0.55 : 0.4);
      spawnGlint(worldPosition, hdr(ION_WHITE, 1.4), isInterlock ? 2.0 : 0.8, 0.16);
      enemyRecords.delete(enemyId, { dispose: true });
    }
    if (isInterlock) {
      interlockKills += 1;
      spawnArcWhip(worldPosition, hdr(HAZARD_AMBER, 1.4), 4.2, 0.3);
      feel.shake(0.28);
      if (interlockKills >= 6) {
        // The sixth interlock kill runs a brief full-tunnel white strobe sweep.
        strobeStart = elapsedNow;
        flashLevel = Math.max(flashLevel, 0.5);
        feel.shake(0.4);
      }
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    interlocksAlive.delete(enemyId);
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    // Misses fizzle.
    burstSparks(worldPosition, VOLT_VIOLET.clone().multiplyScalar(0.4), 3, 3.5, 0.5);
  });

  bus.on('reject', () => {
    // Rejects pulse the detonation overlay — denial reads hazard red.
    detonationLevel = Math.max(detonationLevel, 0.16);
    if (cameraRef) {
      const front = new Vector3(0, 0, -6).applyQuaternion(cameraRef.quaternion).add(cameraRef.position);
      spawnArcLightning(
        front.clone().add(new Vector3(-2.4, -1.2, 0)),
        front.clone().add(new Vector3(2.4, 1.0, 0)),
        hdr(HAZARD_RED, 1.2),
        0.22,
        1.2,
      );
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatPulse = Math.max(beatPulse, isDownbeat ? 1 : 0.55);
  });

  bus.on('playerhit', () => {
    detonationLevel = Math.max(detonationLevel, 0.42);
    feel.shake(0.5, { rollDegrees: 1.4, frequency: 15 });
  });

  bus.on('volley', ({ size, kills }) => {
    if (kills < 4 || kills < size) return;
    // Smaller flash pumps on clean volleys; a perfect six blooms harder.
    flashLevel = Math.max(flashLevel, kills >= 6 ? 0.32 : 0.14);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    interlocksAlive.clear();
    interlockKills = 0;
    postShot = false;
    strobeStart = -1;
    lastCrossedBeat = -1;
    charge = 0;
    flashLevel = 0;
    detonationLevel = 0;
  });

  bus.on('runend', ({ died }) => {
    interlocksAlive.clear();
    if (died) {
      // Containment failure: hazard red bleeding to white, the barrel ringing.
      detonationLevel = 1.15;
      feel.shake(1.0, { rollDegrees: 1.8, pitchDegrees: 0.5, frequency: 13 });
      if (cameraRef) {
        const front = new Vector3(0, 0, -14).applyQuaternion(cameraRef.quaternion).add(cameraRef.position);
        spawnFlashDisc(front, hdr(HAZARD_RED, 1.6), 12, 0.7);
        for (let i = 0; i < 5; i += 1) {
          spawnArcWhip(front.clone().add(new Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8, 0)), hdr(HAZARD_RED, 1.4), 5, 0.4);
        }
      }
    }
  });
}

// Camera: a metallic gun-barrel rattle — more roll than pitch — plus a
// cosmetic bank into the weave and an FOV that breathes with airspeed.
export function updateCameraEffects(dt: number, context: { camera: PerspectiveCamera; runTime: number; running: boolean; feel: CameraFeelRig }) {
  const { camera, runTime, running, feel } = context;
  if (!running) return;
  const u = massDriverRunProgress(runTime);
  const t0 = visualCurve.getTangentAt(MathUtils.clamp(u, 0, 1));
  const t1 = visualCurve.getTangentAt(MathUtils.clamp(u + 0.004, 0, 1));
  const targetRoll = MathUtils.clamp((t1.x - t0.x) * 90, -0.16, 0.16);
  bankRoll += (targetRoll - bankRoll) * Math.min(1, dt * 5);
  camera.rotateZ(bankRoll);

  const speed = cameraSpeedAt(runTime);
  feel.setFovOffset(Math.min(10, speed * 0.052) + charge * 1.6);
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  cameraRef = ctx.camera;
  beatPulse = Math.max(0, beatPulse - dt * 4.2);
  flashLevel = Math.max(0, flashLevel - dt * 3.4);
  detonationLevel = Math.max(0, detonationLevel - dt * 1.7);

  const running = ctx.running;
  const runTime = ctx.runTime;
  const runProgress = running ? massDriverRunProgress(runTime) : 0;

  // The firing charge is already building: it ramps through the interlock
  // bars, held back enough that the fight stays readable until the last bar
  // and a half, and the whiteout belongs to THE SHOT.
  charge = running && !postShot
    ? MathUtils.clamp((runTime - INTERLOCK_TIME) / (SHOT_TIME - INTERLOCK_TIME), 0, 1)
    : 0;

  // Ring crossings land on the beat by construction; flash the just-passed
  // ring (environment) and throw a heat-colored shockwave at the crossing.
  if (running && !postShot) {
    const beatIndex = Math.floor(runTime / BEAT_SECONDS + 1e-4);
    if (beatIndex !== lastCrossedBeat) {
      lastCrossedBeat = beatIndex;
      beatPulse = Math.max(beatPulse, beatIndex % 4 === 0 ? 1 : 0.55);
      if (beatIndex > 0) {
        const isDownbeat = beatIndex % 4 === 0;
        const heat = heatRamp(Math.min(1, beatIndex / 112 + charge * 0.3));
        // The camera is exactly at the crossed ring, so the pulse is thrown
        // a few metres down-bore — it reads as the ring's shockwave racing
        // ahead of the payload.
        const forward = new Vector3(0, 0, -1).applyQuaternion(ctx.camera.quaternion);
        const position = ctx.camera.position.clone().addScaledVector(forward, 13);
        spawnShockRing(position, hdr(heat, isDownbeat ? 1.4 : 0.85), isDownbeat ? 8.5 : 6.5, isDownbeat ? 0.42 : 0.3);
        if (isDownbeat) ctx.feel.kickFov(0.9, { decay: 6 });
      }
    }
  }

  // THE SHOT: the single biggest moment in the game. Speed spike (gameplay),
  // whiteout, FOV kick, heavy shake, muzzle flash — simultaneous, on the
  // downbeat of bar 28. Only a cleared gun fires cleanly.
  if (running && !postShot && runTime >= SHOT_TIME && interlocksAlive.size === 0) {
    postShot = true;
    flashLevel = 1.15;
    ctx.feel.kickFov(16, { decay: 2.4 });
    ctx.feel.shake(0.85, { rollDegrees: 1.6, frequency: 17 });
    if (environment) spawnFlashDisc(environment.muzzlePosition, hdr(ION_WHITE, 2.2), 26, 0.6);
  }
  // Interlocks still standing past the deadline: the charge overloads red
  // while the detonation lands. Bounded so immortal debug runs decay back.
  if (running && runTime >= SHOT_TIME - 0.3 && runTime <= SHOT_TIME + 0.9 && interlocksAlive.size > 0) {
    detonationLevel = Math.max(detonationLevel, MathUtils.clamp((runTime - (SHOT_TIME - 0.3)) / 0.3, 0, 1));
  }

  environment?.update({
    dt,
    elapsed: ctx.elapsed,
    running,
    runTime,
    runProgress,
    camera: ctx.camera,
    cameraSpeed: running ? cameraSpeedAt(runTime) : 0,
    charge,
    postShot,
    strobeStart,
    beatPulse,
  });

  // Screen overlays decay quickly; charge pool is capped for readability.
  flashUniform.value = Math.min(1.35, flashLevel);
  detonationUniform.value = Math.min(1.2, detonationLevel);
  chargeUniform.value = postShot ? 0 : charge * 0.17 + MathUtils.smoothstep(charge, 0.8, 1) * 0.4 + (charge > 0 ? beatPulse * 0.045 : 0);

  // ---- per-enemy tint pass ---------------------------------------------------
  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    // Pop in with a quick overshoot.
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / 0.38)));

    const userData = record.mesh.userData;
    const tint = userData.tint as EnemyTintHandles | undefined;
    if (tint) {
      const distance = record.mesh.position.distanceTo(ctx.camera.position);
      const closeness = smootherstep(1 - MathUtils.clamp((distance - 13) / (52 - 13), 0, 1));
      const locked = userData.locked === true;
      const denied = record.deniedUntil > elapsedNow;
      const hitFlash = record.hitFlashUntil > elapsedNow ? (record.hitFlashUntil - elapsedNow) / 0.22 : 0;
      const exposed = userData.exposed === true;

      // One tint pass drives every state: enemies brighten as they close, a
      // lock turns them ion-white with a blue-tinted fill, a denial flushes
      // them hazard-red for a beat, a hit flashes them blinding.
      const hot = 0.35 + 0.65 * closeness;
      if (denied) {
        tint.edgeMaterial.color.copy(hdr(HAZARD_RED, 1.6));
        tint.fillMaterial.color.copy(HAZARD_RED.clone().multiplyScalar(0.25));
        tint.coreMaterial.color.copy(hdr(HAZARD_RED, 2.0));
        tint.glowMaterial.color.copy(hdr(HAZARD_RED, 0.9));
      } else if (locked) {
        tint.edgeMaterial.color.copy(hdr(ION_WHITE, 1.5));
        tint.fillMaterial.color.copy(ARC_BLUE.clone().multiplyScalar(0.3));
        tint.coreMaterial.color.copy(tint.baseCore).multiplyScalar(1.3);
        tint.glowMaterial.color.copy(hdr(ARC_BLUE, 1.0));
      } else {
        tint.edgeMaterial.color.copy(tint.baseEdge).multiplyScalar(0.55 + 0.45 * closeness);
        tint.fillMaterial.color.copy(tint.baseFill).multiplyScalar(0.5 + 0.5 * closeness);
        const coreBoost = exposed ? 1.55 + Math.sin(elapsedNow * 21) * 0.25 : 1;
        tint.coreMaterial.color.copy(tint.baseCore).multiplyScalar(hot * coreBoost);
        tint.glowMaterial.color.copy(tint.baseGlow).multiplyScalar(hot * (exposed ? 1.4 : 1));
      }
      if (hitFlash > 0) {
        tint.edgeMaterial.color.lerp(hdr(ION_WHITE, 2.4), hitFlash);
        tint.coreMaterial.color.lerp(hdr(ION_WHITE, 3.0), hitFlash);
        tint.fillMaterial.color.lerp(ION_WHITE.clone().multiplyScalar(0.5), hitFlash * 0.7);
      }
    }

    // Ball lightning: the wire shells re-randomize rotation and scale every
    // frame — the unstable "this is incoming" tell.
    const shells = userData.arcShells as Mesh[] | undefined;
    if (shells) {
      for (const shell of shells) {
        shell.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
        shell.scale.setScalar(0.72 + Math.random() * 0.55);
      }
    }

    // Letters recover from denial on their own.
    if (userData.isLetter && record.deniedUntil > 0 && record.deniedUntil <= elapsedNow && userData.locked !== true) {
      setLetterState(record.mesh, 'idle');
      record.deniedUntil = -1;
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy(ctx.camera.quaternion);
      record.lockRing.rotation.z += dt * 1.9;
      const pulse = 1 + Math.sin(elapsedNow * 9) * 0.05;
      record.lockRing.scale.setScalar(pulse * record.lockRing.userData.fit);
    }
  }

  // Projectile trails: a blue trail of splinters dropped along the dart.
  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    record.trailAccumulator += dt;
    if (record.trailAccumulator >= 0.016) {
      record.trailAccumulator = 0;
      burstSparks(record.mesh.position, hdr(ARC_BLUE, 0.9), 1, 1.6, 0.9);
    }
  }

  // Reticle spin: faster while charging.
  const reticle = findReticle(ctx.scene);
  if (reticle) {
    const spinner = reticle.userData.spinner as Group;
    const active = reticle.userData.active === true;
    const lockCount = (reticle.userData.lockCount as number) ?? 0;
    spinner.rotation.z -= dt * (active ? 1.9 + lockCount * 0.75 : 0.45);
  }

  updateEffects(dt, ctx.camera);
  ctx.feel.update(dt, {
    // Metallic gun-barrel rattle: quick and tight, more roll than pitch.
    shake: { rollDegrees: 1.0, pitchDegrees: 0.22, yawDegrees: 0.18, frequency: 15, smoothing: 26 },
  });
}

function findReticle(scene: Scene): Object3D | null {
  for (const child of scene.children) {
    if (child.userData.raildRole === 'reticle') return child;
  }
  return null;
}

// Lock ring: a hexagonal clamp of two nested rings, camera-facing, sized per
// enemy and oversized on the interlocks.
function makeLockRing(color: Color, fit: number): Group {
  const group = new Group();
  const outer = new Mesh(
    new RingGeometry(0.9, 0.97, 6),
    createAdditiveBasicMaterial({ color: hdr(color, 1.7), side: DoubleSide }),
  );
  const inner = new Mesh(
    new RingGeometry(0.7, 0.735, 6),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(ION_WHITE, 0.5), 1.3), side: DoubleSide }),
  );
  inner.rotation.z = Math.PI / 6;
  group.add(outer, inner);
  group.userData.fit = 1.9 * fit;
  return group;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function smootherstep(t: number): number {
  return t * t * (3 - 2 * t);
}
