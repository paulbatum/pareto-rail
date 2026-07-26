import {
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
  SphereGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import type { EventBus } from '../../../events';
import { colorForLockCount } from '../../../engine/locks';
import {
  createAdditiveBasicMaterial,
  createAdornmentSlot,
  createPendingVisualRecords,
  disposeObject3D,
} from '../../../engine/visual-kit';
import { gooFlashUniform, warmFlashUniform } from '../post-fx';
import { createTinkerBall, type TinkerBall } from './ball';
import {
  createBeetle,
  createGlob,
  createSnapper,
  createSpillCore,
  createSpillHeart,
  createStrider,
  type PieceSpec,
} from './creatures';
import { createEnvironmentInternal, type Environment } from './environment';
import {
  burstGoo,
  createEffects,
  resetEffects,
  scatterPieces,
  spawnGlint,
  spawnRing,
  updateEffects,
} from './effects';
import { createLetterMesh, setLetterDenied, setLetterLocked } from './letters';
import {
  CORE_HOT,
  CORE_VIOLET,
  CREAM,
  DENY_RED,
  GLUE_SHEEN,
  hdr,
  LAMP_CREAM,
  LOCK_AMBER,
  WARM_WHITE,
} from './palette';

// Visual spine: palette-level decisions and event choreography. The language
// is warm lamp light — the player owns cream/amber, the glue owns charcoal
// and violet — and every kill feeds the signature loop: body breaks into
// bright pieces, pieces land on the wood, then chase down and stick to the
// rolling ball.

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  feel: CameraFeelRig;
  elapsed: number;
  runProgress?: number;
};

type EnemyRecord = {
  mesh: Group;
  bornAt: number | null;
  lockRing: Group | null;
};

const lockRings = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.lockRing,
  set: (record, ring) => {
    record.lockRing = ring;
  },
});

// createEnemyMesh() has no id, but the runner emits `spawn` synchronously
// right after — the pending queue pairs mesh with id.
// Every creature bakes fresh merged geometry, so records must dispose it —
// otherwise a full run leaks hundreds of geometries.
const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({ mesh, bornAt: null, lockRing: null }),
  disposeRecord: (record) => {
    lockRings.detach(record);
    disposeObject3D(record.mesh);
  },
});

let environment: Environment | null = null;
let ball: TinkerBall | null = null;
let beatEnergy = 0;
let elapsedNow = 0;
let volleyKick = 0;

export function createEnvironment(scene: Scene) {
  environment = createEnvironmentInternal(scene);
  createEffects(scene);
  ball = createTinkerBall();
  scene.add(ball.root);
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
    case 'beetle':
      return createBeetle();
    case 'strider':
      return createStrider();
    case 'snapper':
      return createSnapper();
    case 'bolt':
      return createGlob();
    case 'spill-core':
      return createSpillCore();
    case 'spill-heart':
      return createSpillHeart();
    default:
      return createBeetle();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  const dot = mesh.userData.dotMaterial as MeshBasicMaterial | undefined;
  if (dot) dot.color.copy(locked ? hdr(LOCK_AMBER, 2.6) : hdr(CORE_VIOLET, 1.9));
  const sheen = mesh.userData.sheenMaterial as MeshBasicMaterial | undefined;
  if (sheen) sheen.color.copy(locked ? LOCK_AMBER.clone().multiplyScalar(0.5) : GLUE_SHEEN.clone().multiplyScalar(0.5));
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  if (mesh.userData.isLetter) setLetterDenied(mesh as Group);
  const dot = mesh.userData.dotMaterial as MeshBasicMaterial | undefined;
  if (dot) dot.color.copy(hdr(DENY_RED, 2.2));
  spawnRing(mesh.position, hdr(DENY_RED, 0.9), 2.6, 0.3);
}

// Shared across all shots (many fire per run): one geometry, two materials,
// nothing to dispose per projectile.
const projectileCoreGeometry = new OctahedronGeometry(0.3, 0);
const projectileShellGeometry = new OctahedronGeometry(0.48, 0);
const projectileCoreMaterial = new MeshBasicMaterial({ color: hdr(WARM_WHITE, 2.6) });
const projectileShellMaterial = createAdditiveBasicMaterial({ color: hdr(LOCK_AMBER, 0.9), opacity: 0.55 });

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(projectileCoreGeometry, projectileCoreMaterial);
  core.scale.set(0.42, 0.42, 2.2);
  const shell = new Mesh(projectileShellGeometry, projectileShellMaterial);
  shell.scale.set(0.55, 0.55, 2.0);
  group.add(core, shell);
  return group;
}

// The reticle is an embroidery hoop: two wooden rings, four pin markers, and
// a crossed-thread center. Warm cream at rest, hot amber while hunting.
export function createReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: Color; active: Color }> = [];

  const addPart = (mesh: Mesh, base: Color, active: Color) => {
    const material = mesh.material as MeshBasicMaterial;
    material.transparent = true;
    material.depthWrite = false;
    material.side = DoubleSide;
    material.color.copy(base);
    parts.push({ material, base, active });
  };

  const outer = new Mesh(new RingGeometry(0.6, 0.66, 40), new MeshBasicMaterial());
  addPart(outer, hdr(CREAM, 1.0), hdr(LOCK_AMBER, 1.8));
  const inner = new Mesh(new RingGeometry(0.5, 0.525, 40), new MeshBasicMaterial());
  addPart(inner, hdr(CREAM, 0.6), hdr(LOCK_AMBER, 1.1));

  const pins = new Group();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const tick = new Mesh(new PlaneGeometry(0.16, 0.045), new MeshBasicMaterial());
    addPart(tick, hdr(CREAM, 1.2), hdr(CORE_HOT, 1.8));
    tick.position.set(Math.cos(angle) * 0.72, Math.sin(angle) * 0.72, 0);
    tick.rotation.z = angle;
    const head = new Mesh(new CircleGeometry(0.045, 12), new MeshBasicMaterial());
    addPart(head, hdr(LOCK_AMBER, 1.2), hdr(CORE_HOT, 2.2));
    head.position.set(Math.cos(angle) * 0.82, Math.sin(angle) * 0.82, 0);
    pins.add(tick, head);
  }

  const threads = new Group();
  for (const angle of [0, Math.PI / 2]) {
    const thread = new Mesh(new PlaneGeometry(0.56, 0.018), new MeshBasicMaterial());
    addPart(thread, hdr(CREAM, 0.8), hdr(WARM_WHITE, 1.6));
    thread.rotation.z = angle;
    threads.add(thread);
  }
  const dot = new Mesh(new CircleGeometry(0.045, 16), new MeshBasicMaterial());
  addPart(dot, hdr(WARM_WHITE, 1.8), hdr(WARM_WHITE, 3));

  group.add(outer, inner, pins, threads, dot);
  group.userData.parts = parts;
  group.userData.spinner = pins;
  group.userData.threads = threads;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.05 : 0));
  const parts = reticle.userData.parts as Array<{ material: MeshBasicMaterial; base: Color; active: Color }>;
  for (const part of parts) {
    part.material.color.copy(active ? part.active : part.base);
  }
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record) return;
    if (kind !== 'letter' && kind !== 'bolt') {
      spawnRing(worldPosition, LAMP_CREAM.clone().multiplyScalar(0.55), 2.6, 0.4);
    }
    if (kind === 'spill-core' || kind === 'spill-heart') {
      spawnRing(worldPosition, hdr(CORE_VIOLET, 1.1), 5.5, 0.55);
      burstGoo(worldPosition, 8, 6);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition, lockCount }) => {
    const lockColor = colorForLockCount(lockCount, [LOCK_AMBER, CORE_HOT, WARM_WHITE]);
    const record = enemyRecords.get(enemyId);
    if (record && !record.lockRing) {
      lockRings.attach(record, makeLockRing(lockColor), scene);
    }
    spawnRing(worldPosition, hdr(lockColor, 1.3), 2.2, 0.28);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockRings.detach(record);
  });

  bus.on('fire', ({ worldPosition }) => {
    spawnGlint(worldPosition, hdr(WARM_WHITE, 1.1), 0.5, 0.12);
  });

  bus.on('hit', ({ enemyId, worldPosition, lethal }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    if (lethal) {
      spawnGlint(worldPosition, hdr(WARM_WHITE, 0.8), 0.6, 0.12);
      return;
    }
    // A chipped shell: one caked supply pops off the core and joins the
    // rescue loop; dark glue spatters where the shot landed.
    record.mesh.userData.damageFlashUntil = elapsedNow + 0.4;
    const shellPieces = record.mesh.userData.shellPieces as Mesh[] | undefined;
    if (shellPieces) {
      const next = shellPieces.find((piece) => piece.visible);
      if (next) next.visible = false;
    }
    const pieces = record.mesh.userData.pieces as PieceSpec[] | undefined;
    if (pieces && pieces.length > 0) {
      scatterPieces(worldPosition, [pieces[Math.floor(Math.random() * pieces.length)]]);
    }
    burstGoo(worldPosition, 5, 7);
    spawnRing(worldPosition, hdr(CORE_VIOLET, 1.2), 3.6, 0.3);
    spawnGlint(worldPosition, hdr(WARM_WHITE, 1.6), 1.1, 0.16);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record) return;
    const kind = record.mesh.userData.kind as string;
    const accent = (record.mesh.userData.accent as Color | undefined) ?? LOCK_AMBER;
    // The body breaks: dark glue bursts, bright pieces scatter and remain —
    // then chase the ball.
    scatterPieces(worldPosition, record.mesh.userData.pieces as PieceSpec[] | undefined);
    burstGoo(worldPosition, kind === 'bolt' ? 10 : 6, kind === 'bolt' ? 9 : 7);
    spawnRing(worldPosition, hdr(accent, 0.9), kind === 'spill-core' || kind === 'spill-heart' ? 7 : 4.2, 0.45);
    spawnGlint(worldPosition, hdr(WARM_WHITE, 1.0), 0.9, 0.15);
    if (kind === 'spill-core') {
      warmFlashUniform.value = Math.min(0.5, warmFlashUniform.value + 0.3);
      spawnRing(worldPosition, hdr(CORE_HOT, 1.3), 10, 0.6);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    burstGoo(worldPosition, 3, 3.5);
  });

  bus.on('reject', () => {
    gooFlashUniform.value = Math.min(0.6, gooFlashUniform.value + 0.4);
  });

  bus.on('playerhit', () => {
    beatEnergy = 1.5;
    gooFlashUniform.value = 0.85;
  });

  bus.on('volley', ({ kills, size }) => {
    if (kills >= 4 && kills >= size) {
      warmFlashUniform.value = Math.min(0.45, warmFlashUniform.value + 0.22);
      volleyKick = 1;
    }
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'destroyed') {
      environment?.spill.beginCollapse();
      warmFlashUniform.value = 0.85;
      if (environment) {
        burstGoo(environment.spillCenter.clone().add(new Vector3(0, 1.5, 0)), 24, 12);
      }
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.45);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    ball?.reset();
    environment?.spill.reset();
    warmFlashUniform.value = 0;
    gooFlashUniform.value = 0;
  });
}

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 4.0);
  volleyKick = Math.max(0, volleyKick - dt * 2.5);
  warmFlashUniform.value = Math.max(0, warmFlashUniform.value - dt * 1.6);
  gooFlashUniform.value = Math.max(0, gooFlashUniform.value - dt * 1.8);

  ctx.feel.setFovOffset(beatEnergy * 0.9 + volleyKick * 2.2);

  if (environment) {
    environment.bulbMaterial.color.copy(hdr(LAMP_CREAM, 1.0 + beatEnergy * 0.4));
    environment.patchGlowMaterial.color.copy(LAMP_CREAM.clone().multiplyScalar(0.06 + Math.sin(elapsedNow * 1.7) * 0.02 + beatEnergy * 0.025));
    environment.dust.update(elapsedNow, ctx.camera.quaternion, (ctx.camera as { position: Vector3 }).position);
    environment.spill.update(dt, beatEnergy, elapsedNow);
  }

  if (ball && environment) {
    ball.update(dt, environment.curve, ctx.runProgress ?? 0, beatEnergy, elapsedNow);
  }

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    let bodyScale = easeOutBack(Math.min(1, age / 0.4));

    const userData = record.mesh.userData;
    const gait = (userData.gaitPhase as number | undefined) ?? elapsedNow * 3;

    const legSets = userData.legSets as Mesh[] | undefined;
    if (legSets) {
      legSets[0].rotation.x = Math.sin(gait) * 0.22;
      legSets[1].rotation.x = -Math.sin(gait) * 0.22;
    }
    const wings = userData.wings as Mesh[] | undefined;
    if (wings) {
      const flap = Math.sin(gait) * 0.55;
      wings[0].rotation.z = 0.15 + flap;
      wings[1].rotation.z = -0.15 - flap;
    }
    const jaws = userData.jaws as Mesh[] | undefined;
    if (jaws) {
      const snap = Math.max(0, Math.sin(gait * 0.5)) * 0.35;
      jaws[0].rotation.z = snap;
      jaws[1].rotation.z = -snap;
    }

    // Glue-core glint: the sheen slides as things move, the dot pulses.
    const dot = userData.dotMaterial as MeshBasicMaterial | undefined;
    if (dot && userData.locked !== true && (userData.deniedUntil ?? 0) <= elapsedNow) {
      const pulse = 1.55 + Math.sin(elapsedNow * 5 + enemyId) * 0.45 + beatEnergy * 0.5;
      dot.color.copy(userData.isHeart ? hdr(CORE_HOT, pulse + 0.6) : hdr(CORE_VIOLET, pulse));
    }
    const spitFlash = userData.spitFlash as number | undefined;
    if (spitFlash !== undefined && spitFlash > 0) {
      userData.spitFlash = spitFlash - dt;
      if (dot) dot.color.copy(hdr(CORE_HOT, 2.6));
    }

    // Globs heat up as they close in — the read that glue is about to land —
    // and shrink near the camera so the final approach never floods the frame.
    if (userData.isGlob === true) {
      const distance = record.mesh.position.distanceTo((ctx.camera as { position: Vector3 }).position);
      const danger = smootherstep(1 - clamp01((distance - 4) / (28 - 4)));
      const rim = userData.rimMaterial as MeshBasicMaterial | undefined;
      if (rim) rim.color.copy(GLUE_SHEEN.clone().multiplyScalar(0.3).lerp(hdr(DENY_RED, 0.75), danger));
      if (dot && userData.locked !== true) dot.color.copy(hdr(CORE_VIOLET, 1.2).lerp(hdr(DENY_RED, 1.5), danger));
      bodyScale *= 1 - smootherstep(1 - clamp01((distance - 1.2) / (7 - 1.2))) * 0.6;
    }
    record.mesh.scale.setScalar(bodyScale);

    // The heart sheds its junk dome once the shells are gone.
    if (userData.isHeart === true && userData.exposed === true) {
      const dome = userData.dome as Mesh | undefined;
      if (dome && dome.visible) {
        if (userData.domeBlown !== true) {
          userData.domeBlown = true;
          scatterPieces(record.mesh.position, (userData.pieces as PieceSpec[]).slice(0, 4));
          burstGoo(record.mesh.position, 12, 9);
          spawnRing(record.mesh.position, hdr(CORE_HOT, 1.4), 8, 0.55);
        }
        dome.scale.multiplyScalar(Math.max(0.001, 1 - dt * 2.6));
        dome.rotation.y += dt * 5;
        if (dome.scale.x < 0.03) dome.visible = false;
      }
    }

    const deniedUntil = userData.deniedUntil as number | undefined;
    if (deniedUntil !== undefined && deniedUntil <= elapsedNow && userData.isLetter && userData.locked !== true) {
      setLetterLocked(record.mesh, false);
      userData.deniedUntil = undefined;
    }

    const damageFlashUntil = userData.damageFlashUntil as number | undefined;
    if ((damageFlashUntil ?? -Infinity) > elapsedNow) {
      const flash = clamp01(((damageFlashUntil ?? 0) - elapsedNow) / 0.4);
      const core = userData.coreMaterial as MeshBasicMaterial | undefined;
      if (core) core.color.setScalar(0.05 + flash * 0.5);
    } else {
      const core = userData.coreMaterial as MeshBasicMaterial | undefined;
      if (core && core.color.r > 0.06) core.color.setRGB(0.052, 0.048, 0.062);
    }

    if (record.lockRing) {
      record.mesh.getWorldPosition(record.lockRing.position);
      record.lockRing.quaternion.copy((ctx.camera as { quaternion: Group['quaternion'] }).quaternion);
      record.lockRing.rotation.z += dt * 2.2;
      const pulse = 1 + Math.sin(elapsedNow * 8) * 0.05;
      const fit = (userData.lockRingScale as number | undefined) ?? 1;
      record.lockRing.scale.setScalar(pulse * 1.9 * fit);
    }
  }

  const reticleSpinner = findReticleSpinner(ctx.scene);
  if (reticleSpinner) {
    const active = reticleSpinner.parent?.userData.active === true;
    reticleSpinner.rotation.z += dt * (active ? 3.6 : 1.1);
    const threads = reticleSpinner.parent?.userData.threads as Group | undefined;
    if (threads) threads.rotation.z -= dt * (active ? 2.4 : 0.5);
  }

  if (ball) {
    const ballPosition = ball.root.position;
    updateEffects(dt, ctx.camera, ballPosition, ball.radius(), (shape, color, size) => {
      ball?.addStick(shape, color, size);
      spawnGlint(ballPosition.clone().add(new Vector3(0, ball?.radius() ?? 0.5, 0)), hdr(LAMP_CREAM, 0.7), 0.4, 0.1);
    });
  }
}

function findReticleSpinner(scene: Scene): Group | null {
  for (const child of scene.children) {
    if (child.userData.raildRole === 'reticle' && child.userData.spinner) {
      return child.userData.spinner as Group;
    }
  }
  return null;
}

function makeLockRing(color: Color): Group {
  const group = new Group();
  const hoop = new Mesh(
    new RingGeometry(0.84, 0.9, 32),
    createAdditiveBasicMaterial({ color: hdr(color, 1.7), side: DoubleSide }),
  );
  const innerHoop = new Mesh(
    new RingGeometry(0.7, 0.725, 32),
    createAdditiveBasicMaterial({ color: hdr(color.clone().lerp(WARM_WHITE, 0.5), 1.3), side: DoubleSide }),
  );
  // Four pin heads around the hoop, like fabric pinned taut.
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const pin = new Mesh(
      new SphereGeometry(0.05, 8, 6),
      createAdditiveBasicMaterial({ color: hdr(color, 2.2) }),
    );
    pin.position.set(Math.cos(angle) * 0.87, Math.sin(angle) * 0.87, 0);
    group.add(pin);
  }
  group.add(hoop, innerHoop);
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
