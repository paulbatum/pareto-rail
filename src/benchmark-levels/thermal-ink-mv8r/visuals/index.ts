import { Color, Group, MathUtils, Object3D, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import type { Camera } from 'three';
import { densityFogFactor, fog, mix, positionLocal, smoothstep, vec3 } from 'three/tsl';
import type { CameraFeelRig, CameraFeelShakeOptions } from '../../../engine/camera-feel';
import { colorForLockCount } from '../../../engine/locks';
import { createAdornmentSlot, createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { ARM_ATTACKS, createViewPose, inkDensityAt, viewPoseAt, type FightState } from '../gameplay';
import { NODE_INDEX, type OctopusRig } from '../octopus';
import { sense, setThermalOn } from '../sense';
import { BARS, BEAT, INK_CLOUDS, bar } from '../timing';
import { createEffects, type Effects } from './effects';
import { createBarb, createBellbuoy, createCore, createEel, createNode, createScrapper, EEL_SEGMENTS, type EnemyParts } from './enemies';
import { createHarbor, type Harbor } from './environment';
import { createLetterMesh, type LetterParts } from './letters';
import { senseUniforms } from './materials';
import { createOctopusVisual, type OctopusVisual } from './octopus-mesh';
import { DENY, LOCK_GRADIENT, MERCURY, MERCURY_WHITE, MURK, THERMAL, hdr } from './palette';
import { postUniforms } from './post-fx';
import { createHarpoon, createLockMarker, createSight, sightBoost, type ReticleParts, type SightPart } from './sight';

// Spine: the look of the fight, beat by beat. Palette and every reaction to
// the bus live here; leaves build meshes; gameplay owns motion.

export { composeThermalInkOutput } from './post-fx';

const SHAKE: CameraFeelShakeOptions = {
  decay: 2.2,
  maxTrauma: 1.8,
  pitchDegrees: 0.42,
  yawDegrees: 0.34,
  rollDegrees: 0.9,
  frequency: 7,
  smoothing: 18,
};

// Sense timing: the sight snaps on in a 0.14 s scan wipe, holds while a
// volley is in the air, and gutters out over 0.3 s.
const SWEEP_SECONDS = 0.14;
const THERMAL_FADE_SECONDS = 0.3;
const THERMAL_MIN_INK = 0.3;
const HOLD_AFTER_SHOT = 0.5;
/** The dead creature's thermal silhouette is held on screen while it cools. */
const COLLAPSE_THERMAL_SECONDS = 2.8;
const LAMPS_RELIGHT_DELAY = 2.4;
const LAMPS_RELIGHT_SECONDS = 1.8;

// The crane the creature tears down during the circling.
const CRANE_FALL_BAR = BARS.crane;
const CRANE_FALL_SECONDS = 1.6;
const CRANE_FALL_DIRECTION = new Vector3(0.98, 0, -0.2).normalize();

type EnemyRecord = {
  mesh: Group;
  kind: string;
  parts?: EnemyParts;
  letter?: LetterParts;
  bornAt: number | null;
  marker: Group | null;
  flash: number;
  trail: Vector3[];
  stage: number;
  lockedAt: number;
};

type ProjectileRecord = { mesh: Object3D };

let harbor: Harbor | null = null;
let octopus: OctopusVisual | null = null;
let fx: Effects | null = null;
let rig: OctopusRig | null = null;
let fight: FightState | null = null;
let feel: CameraFeelRig | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let lastRunTime = -1;
let lastShotAt = -10;
let reticleDenyUntil = 0;
let craneFallAt = -1;
let craneImpacted = false;
let blackoutAt = -1;
let relightAt = -1;
let bleedClock = 0;
let lensSpatter = true;

/** Dev inspection: suppress hull-hit lens spatter for clean captures. */
export function setLensSpatter(enabled: boolean) {
  lensSpatter = enabled;
}
const splashed = new Set<number>();
const pose = createViewPose();

const lockMarkers = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.marker,
  set: (record, marker) => {
    record.marker = marker;
  },
  // Markers share geometry and material; nothing to free.
  disposeAdornment: () => {},
});

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({
    mesh,
    kind: mesh.userData.kind as string,
    parts: mesh.userData.parts as EnemyParts | undefined,
    letter: mesh.userData.letterParts as LetterParts | undefined,
    bornAt: null,
    marker: null,
    flash: 0,
    trail: [],
    stage: 0,
    lockedAt: -10,
  }),
  disposeRecord: (record) => lockMarkers.detach(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({ createRecord: (record) => record });

// ---- environment ------------------------------------------------------------------

export function createEnvironment(scene: Scene, octopusRig: OctopusRig, fightState: FightState) {
  rig = octopusRig;
  fight = fightState;
  harbor = createHarbor(scene);
  octopus = createOctopusVisual(octopusRig);
  scene.add(octopus.root);
  fx = createEffects(scene);

  // Sky: ochre haze low, tobacco dark overhead; a charcoal field in thermal.
  const up = positionLocal.normalize().y;
  const murkSky = mix(
    vec3(MURK.haze.r, MURK.haze.g, MURK.haze.b),
    vec3(MURK.skyHigh.r, MURK.skyHigh.g, MURK.skyHigh.b),
    smoothstep(-0.02, 0.45, up),
  ).mul(senseUniforms.lamps.mul(0.55).add(0.45));
  const thermalSky = mix(
    vec3(THERMAL.haze.r, THERMAL.haze.g, THERMAL.haze.b),
    vec3(THERMAL.skyHigh.r, THERMAL.skyHigh.g, THERMAL.skyHigh.b),
    smoothstep(-0.02, 0.5, up),
  );
  const sceneNodes = scene as Scene & { backgroundNode: unknown; fogNode: unknown };
  sceneNodes.backgroundNode = mix(murkSky, thermalSky, senseUniforms.thermal);
  // Sodium haze thick enough that the far quays are silhouettes; thermal
  // cuts through it.
  const hazeColor = mix(
    vec3(MURK.haze.r, MURK.haze.g, MURK.haze.b).mul(senseUniforms.lamps.mul(0.55).add(0.45)),
    vec3(THERMAL.haze.r, THERMAL.haze.g, THERMAL.haze.b),
    senseUniforms.thermal,
  );
  sceneNodes.fogNode = fog(hazeColor, densityFogFactor(mix(0.0052, 0.0024, senseUniforms.thermal)));
  return harbor.root;
}

// ---- factories ---------------------------------------------------------------------

export function createEnemyMesh(kind: string, letter?: string) {
  let mesh: Group;
  switch (kind) {
    case 'letter':
      mesh = createLetterMesh(letter ?? 'A');
      break;
    case 'scrapper':
      mesh = createScrapper();
      break;
    case 'eel':
      mesh = createEel();
      break;
    case 'bellbuoy':
      mesh = createBellbuoy();
      break;
    case 'barb':
      mesh = createBarb();
      break;
    case 'node':
      mesh = createNode();
      break;
    case 'core':
      mesh = createCore();
      break;
    default:
      mesh = createScrapper();
  }
  mesh.userData.kind = kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.45;
  fx?.ring(mesh.position, DENY.clone().multiplyScalar(1.4), 2.4, 0.3);
}

export function createProjectileMesh() {
  const mesh = createHarpoon(MERCURY_WHITE);
  projectileRecords.enqueue({ mesh });
  return mesh;
}

export function createReticle() {
  return createSight(MERCURY, MERCURY_WHITE, 1.22);
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  const sight = reticle.userData.sight as ReticleParts | undefined;
  if (!sight) return;
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + (active ? 0.06 : 0) - lockCount * 0.025);
  const denied = reticleDenyUntil > elapsedNow;
  const charge = lockCount > 0 ? colorForLockCount(lockCount, LOCK_GRADIENT) : null;
  for (const part of sight.parts) {
    if (denied) part.color.value.copy(DENY).multiplyScalar(1.6);
    else if (charge) part.color.value.copy(charge).multiplyScalar(active ? 1.5 : 1.2);
    else part.color.value.copy(part.base).multiplyScalar(active ? 1.35 : 1);
  }
  sight.pips.forEach((pip: SightPart, index: number) => {
    if (index < lockCount) pip.color.value.copy(colorForLockCount(index + 1, LOCK_GRADIENT)).multiplyScalar(2.2);
    else pip.color.value.copy(pip.base);
  });
}

// ---- event choreography --------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, cameraFeel: CameraFeelRig) {
  feel = cameraFeel;

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (record) record.trail = [];
    if (!fx) return;
    if (kind === 'barb') {
      // Spat: a cough of ink where it leaves the spawner.
      fx.ink(worldPosition, { count: 4, size: 1.6, spread: 0.6, life: 1.1, speed: 1.5 });
      fx.ring(worldPosition, hdr(MURK.sodium, 0.8), 1.8, 0.3);
    } else if (kind === 'core') {
      cameraFeel.shake(0.9, SHAKE);
      fx.ring(worldPosition, hdr(MURK.sodiumHot, 1.6), 14, 1.0);
      fx.ring(worldPosition, hdr(MURK.bile, 1.1), 8, 0.7);
      fx.ink(worldPosition, { count: 14, size: 5, spread: 4, life: 2.4, speed: 5 });
    } else if (kind === 'node') {
      fx.ring(worldPosition, hdr(MURK.sodium, 1.2), 4, 0.5);
    }
  });

  bus.on('lock', ({ enemyId, lockCount, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const color = colorForLockCount(lockCount, LOCK_GRADIENT);
    if (record) {
      record.lockedAt = elapsedNow;
      if (!record.marker) lockMarkers.attach(record, createLockMarker(hdr(color, 1.8)), scene);
      else (record.marker.userData.sightColor as Color).copy(color).multiplyScalar(1.8);
    }
    fx?.ring(worldPosition, hdr(color, 1.3), 1.6 + lockCount * 0.25, 0.25);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) lockMarkers.detach(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    projectileRecords.claim(projectileId);
    lastShotAt = elapsedNow;
    fx?.burstSparks(worldPosition, hdr(MERCURY_WHITE, 1.4), 3, 4, { size: 0.25, life: 0.2, gravity: 0 });
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    projectileRecords.delete(projectileId);
    const record = enemyRecords.get(enemyId);
    if (!fx) return;
    fx.burstSparks(worldPosition, hdr(MERCURY_WHITE, 1.3), 5, 9, { size: 0.3, life: 0.3 });
    if (lethal || !record) return;
    record.flash = 1;
    if (record.kind === 'node' || record.kind === 'core') {
      // Wounded flesh bleeds ink.
      fx.ink(worldPosition, { count: 3, size: 1.8, spread: 0.8, life: 1.4, speed: 3 });
      fx.burstSparks(worldPosition, hdr(MURK.sodiumHot, 1.6), 8, 10, { size: 0.35 });
      cameraFeel.shake(record.kind === 'core' ? 0.35 : 0.2, SHAKE);
    }
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record || !fx) return;
    record.stage += 1;
    if (record.kind === 'node') {
      // The gland cluster bursts, baring the core.
      fx.debris(worldPosition, record.parts?.burst.flesh ?? MURK.flesh, 8, 9, 0.45);
      fx.ink(worldPosition, { count: 6, size: 2.4, spread: 1.2, life: 1.8, speed: 4 });
      fx.ring(worldPosition, hdr(MURK.sodiumHot, 1.4), 5, 0.45);
      cameraFeel.shake(0.45, SHAKE);
    } else if (record.kind === 'core') {
      // First membrane broken: it seals itself under folded arms until the dark.
      fx.debris(worldPosition, MURK.fleshDark, 14, 12, 0.6);
      fx.ink(worldPosition, { count: 12, size: 4, spread: 2.5, life: 2.4, speed: 6 });
      fx.ring(worldPosition, hdr(MURK.sodiumHot, 1.8), 12, 0.7);
      postUniforms.flash.value = Math.max(postUniforms.flash.value, 0.35);
      cameraFeel.shake(0.9, SHAKE);
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (!record || !fx) return;
    const burst = record.parts?.burst;
    if (record.kind === 'letter') {
      fx.debris(worldPosition, MURK.rust, 6, 7, 0.3);
      fx.burstSparks(worldPosition, hdr(MURK.sodiumHot, 1.5), 10, 8);
    } else if (record.kind === 'node') {
      // An arm is severed at the node: ink geysers from the wound.
      fx.debris(worldPosition, burst?.flesh ?? MURK.flesh, 16, 13, 0.6);
      fx.ink(worldPosition, { count: 18, size: 3.4, spread: 2, life: 2.6, speed: 7, up: 2 });
      fx.burstSparks(worldPosition, hdr(MURK.sodiumHot, 2), 26, 16, { size: 0.45 });
      fx.ring(worldPosition, hdr(MURK.sodiumHot, 1.8), 9, 0.6);
      fx.ring(worldPosition, hdr(MURK.bile, 1.2), 5, 0.45);
      postUniforms.flash.value = Math.max(postUniforms.flash.value, 0.45);
      cameraFeel.shake(1.0, SHAKE);
      cameraFeel.kickFov(3.5);
    } else if (record.kind === 'core') {
      // The killing blow: the heart bursts; its heat bleeds out of the whole body.
      fx.debris(worldPosition, MURK.fleshDark, 30, 18, 0.7);
      fx.ink(worldPosition, { count: 40, size: 6, spread: 5, life: 4, speed: 10, up: 3 });
      fx.burstSparks(worldPosition, hdr(MURK.sodiumHot, 2.4), 60, 24, { size: 0.6, life: 1.2 });
      fx.ring(worldPosition, hdr(MURK.sodiumHot, 2), 40, 1.4);
      fx.ring(worldPosition, hdr(MERCURY_WHITE, 1.5), 22, 1.0);
      postUniforms.flash.value = 1.1;
      cameraFeel.shake(1.6, SHAKE);
      cameraFeel.kickFov(6);
    } else {
      // The brood bursts into flesh, scrap, and a puff of its own ink.
      fx.debris(worldPosition, burst?.debris ?? MURK.rust, 5, 8, 0.3);
      fx.debris(worldPosition, burst?.flesh ?? MURK.flesh, 3, 6, 0.25);
      fx.ink(worldPosition, { count: 4, size: 2.2, spread: 0.8, life: 1.5, speed: 2.5 });
      fx.burstSparks(worldPosition, hdr(MURK.sodiumHot, 1.8), 12, 10);
      fx.ring(worldPosition, hdr(MURK.sodium, 1.1), 3.4, 0.35);
      if (record.kind === 'bellbuoy') fx.ring(worldPosition, hdr(MURK.cream, 1.2), 6, 0.6);
    }
    enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    if (record?.kind === 'core') {
      // It slips away: a last pall of ink over where the heart was.
      fx?.ink(worldPosition, { count: 20, size: 7, spread: 6, life: 3, speed: 3 });
    }
  });

  bus.on('reject', () => {
    reticleDenyUntil = elapsedNow + 0.35;
    cameraFeel.shake(0.18, SHAKE);
  });

  bus.on('volley', ({ size, kills }) => {
    if (size === 6 && kills === 6) {
      cameraFeel.kickFov(2.5);
      postUniforms.flash.value = Math.max(postUniforms.flash.value, 0.2);
      beatEnergy = 1.4;
    }
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.5);
    postUniforms.pulse.value = 0;
  });

  bus.on('playerhit', () => {
    cameraFeel.shake(1.2, SHAKE);
    if (lensSpatter) postUniforms.splat.value = 1;
  });

  bus.on('runstart', () => {
    fx?.clear();
    enemyRecords.clear({ dispose: true, pending: true });
    projectileRecords.clear({ pending: true });
    lastRunTime = -1;
    craneFallAt = -1;
    craneImpacted = false;
    blackoutAt = -1;
    relightAt = -1;
    splashed.clear();
    if (harbor) {
      harbor.crane.pivot.quaternion.identity();
      harbor.lampPower.fill(1);
    }
    sense.lamps = 1;
    sense.collapse = 0;
    postUniforms.flash.value = 0;
    postUniforms.splat.value = 0;
    cameraFeel.restore();
  });

  bus.on('runend', () => {
    cameraFeel.restore();
  });
}

// ---- senses ----------------------------------------------------------------------------

export type SenseContext = { running: boolean; runTime: number; holding: boolean; dt: number };

/** Decide the player's senses for this frame. */
export function updateSenses({ running, runTime, holding, dt }: SenseContext) {
  const targetInk = running && fight ? fight.ink : 0;
  sense.ink = running ? targetInk : Math.max(0, sense.ink - dt * 0.8);
  const inFlight = projectileRecords.size > 0 || elapsedNow - lastShotAt < HOLD_AFTER_SHOT;
  const killedAt = fight?.coreKilledAt ?? -1;
  const collapsing = running && killedAt >= 0 && runTime - killedAt < COLLAPSE_THERMAL_SECONDS;
  const want = collapsing || (sense.ink > THERMAL_MIN_INK && (holding || inFlight));
  const wasOn = sense.thermalOn;
  setThermalOn(want);
  sense.sinceSwitch += dt;
  if (want) {
    sense.thermal = 1;
    if (!wasOn) {
      postUniforms.sweep.value = 0;
      feel?.kickFov(-3, { decay: 5 });
    }
    postUniforms.sweep.value = Math.min(1.2, (postUniforms.sweep.value as number) + (dt * 1.2) / SWEEP_SECONDS);
  } else {
    if (wasOn) postUniforms.static.value = 0.9;
    sense.thermal = Math.max(0, sense.thermal - dt / THERMAL_FADE_SECONDS);
    postUniforms.sweep.value = 1.2;
  }
  sense.collapse = killedAt >= 0 && running ? MathUtils.clamp((runTime - killedAt) / COLLAPSE_THERMAL_SECONDS, 0, 1) : sense.collapse;

  senseUniforms.thermal.value = sense.thermal;
  senseUniforms.veil.value = sense.ink * (1 - sense.thermal);
  senseUniforms.bodyHeat.value = 1 - sense.collapse * 0.92;
  postUniforms.ink.value = sense.ink;
  postUniforms.thermal.value = sense.thermal;
  const swallow = Math.min(1, sense.ink * 1.3) * 0.97 * (1 - sense.thermal);
  sightBoost.value = Math.min(10, 1 / Math.max(0.1, 1 - swallow));
}

// ---- per frame ------------------------------------------------------------------------------

export type VisualContext = {
  scene: Scene;
  camera: PerspectiveCamera;
  elapsed: number;
  running: boolean;
  runTime: number;
};

export function updateVisuals(dt: number, ctx: VisualContext) {
  elapsedNow = ctx.elapsed;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.2);
  senseUniforms.beat.value = beatEnergy;

  if (ctx.running) updateSetPieces(ctx);
  else lastRunTime = -1;
  updateLamps(ctx);
  updateCrane(ctx);

  octopus?.update(dt, ctx.camera);
  updateSeveredArms(dt);
  updateEnemies(dt, ctx);
  updateProjectiles();
  updateReticleMotion(dt, ctx.scene);

  postUniforms.flash.value = Math.max(0, (postUniforms.flash.value as number) - dt * 1.8);
  postUniforms.splat.value = Math.max(0, (postUniforms.splat.value as number) - dt * 0.55);
  postUniforms.static.value = Math.max(0, (postUniforms.static.value as number) - dt * 3.5);
  postUniforms.pulse.value = Math.min(1, (postUniforms.pulse.value as number) + dt / BEAT);

  harbor?.update(dt, ctx.camera);
  fx?.update(dt, ctx.camera);
}

function crossed(ctx: VisualContext, time: number) {
  return lastRunTime >= 0 && lastRunTime < time && ctx.runTime >= time;
}

function updateSetPieces(ctx: VisualContext) {
  if (!rig || !fx) {
    lastRunTime = ctx.runTime;
    return;
  }
  // Arms erupting from the harbor: a column of dirty water where each breaks surface.
  for (const attack of ARM_ATTACKS) {
    if (crossed(ctx, attack.from + attack.riseSeconds * 0.35)) {
      const arm = rig.arms[attack.arm];
      const surfacing = arm.points.find((point, index) => index > 8 && point.y > -1) ?? arm.points[12];
      fx.splash(surfacing, 3.2, 16);
      fx.burstSparks(surfacing.clone().setY(1), hdr(MURK.cream, 0.7), 14, 9, { size: 0.5, up: 8, gravity: 16, life: 1.1 });
      feel?.shake(0.35, SHAKE);
    }
  }
  // Ink jets: the creature turns and blows a cloud across the route ahead.
  INK_CLOUDS.forEach((cloud, index) => {
    const jetTime = bar(cloud[0]) - 1.4;
    if (!crossed(ctx, jetTime)) return;
    const siphon = rig!.body.position.clone().add(new Vector3(0, 4, 0));
    const puffs = index === 2 ? 70 : 48;
    const enter = bar(cloud[0]);
    const clear = bar(cloud[3]);
    for (let i = 0; i < puffs; i += 1) {
      const t = enter + ((clear - enter) * i) / puffs;
      viewPoseAt(t, pose, rig!.body.rear);
      const target = pose.position.clone()
        .addScaledVector(pose.right, (Math.random() - 0.5) * 34)
        .addScaledVector(pose.up, (Math.random() - 0.35) * 14)
        .addScaledVector(pose.forward, 6 + Math.random() * 14);
      // Thinner where the cloud is thinning, so the mass reads its own shape.
      const density = Math.max(0.35, inkDensityAt(t));
      fx!.inkJet(siphon, target, {
        size: 9 + Math.random() * 8,
        travel: 0.9 + (i / puffs) * 1.2,
        life: t - ctx.runTime + 1.4,
        delay: (i / puffs) * 0.5,
        opacity: 0.85 * density,
      });
    }
    fx!.ink(siphon, { count: 16, size: 6, spread: 3, life: 2.5, speed: 8, up: 4 });
    feel?.shake(0.4, SHAKE);
  });
  if (crossed(ctx, bar(CRANE_FALL_BAR))) {
    craneFallAt = elapsedNow;
    craneImpacted = false;
  }
  // The final blackout: the lamps fail as the last ink comes down.
  if (crossed(ctx, bar(BARS.blackout) - BEAT) && harbor) {
    blackoutAt = elapsedNow;
    for (const lamp of harbor.lamps) {
      if (lamp.order < 0.25) fx.burstSparks(lamp.position, hdr(MURK.sodiumHot, 1.8), 6, 6, { size: 0.3, life: 0.8 });
    }
  }
  if (fight && relightAt < 0) {
    if (fight.coreKilledAt >= 0) relightAt = elapsedNow + Math.max(0, fight.coreKilledAt + LAMPS_RELIGHT_DELAY - ctx.runTime);
    else if (fight.coreEscaped) relightAt = elapsedNow + 0.6;
  }
  lastRunTime = ctx.runTime;
}

function updateLamps(ctx: VisualContext) {
  if (!harbor) return;
  const power = harbor.lampPower;
  let total = 0;
  harbor.lamps.forEach((lamp, index) => {
    let level = 1;
    if (ctx.running && blackoutAt >= 0) {
      // Fail in a stutter, nearest the creature first.
      const since = elapsedNow - blackoutAt - lamp.order * 0.5;
      level = since < 0 ? 1 : since < 0.35 ? (Math.sin(since * 70 + index) > 0 ? 0.8 : 0.1) : 0;
      if (relightAt >= 0) {
        const on = elapsedNow - relightAt - lamp.order * LAMPS_RELIGHT_SECONDS;
        if (on > 0) level = on < 0.25 ? (Math.sin(on * 60 + index * 3) > -0.2 ? 1.2 : 0.2) : 1;
      }
    }
    power[index] = level;
    total += level;
  });
  sense.lamps = harbor.lamps.length ? total / harbor.lamps.length : 1;
  senseUniforms.lamps.value = sense.lamps;
}

const craneAxis = new Vector3().crossVectors(new Vector3(0, 1, 0), CRANE_FALL_DIRECTION).normalize();
const craneQuat = new Quaternion();

function updateCrane(ctx: VisualContext) {
  if (!harbor) return;
  if (!ctx.running || craneFallAt < 0) {
    if (!ctx.running && lastRunTime < 0) harbor.crane.pivot.quaternion.identity();
    return;
  }
  const t = (elapsedNow - craneFallAt) / CRANE_FALL_SECONDS;
  // Toppling mass: slow to start, accelerating, one heavy bounce on the water.
  const fall = t < 1 ? t * t : 1 + Math.sin(Math.min(1, (t - 1) * 3) * Math.PI) * 0.03 * (t < 1.34 ? 1 : 0);
  craneQuat.setFromAxisAngle(craneAxis, fall * 1.62);
  harbor.crane.pivot.quaternion.copy(craneQuat);
  if (t < 1 && t > 0.25 && fx && Math.random() < 0.3) {
    const along = harbor.crane.base.clone().addScaledVector(CRANE_FALL_DIRECTION, 10 + Math.random() * 18);
    along.y = 8 + Math.random() * 16;
    fx.burstSparks(along, hdr(MURK.sodiumHot, 1.6), 3, 6, { size: 0.3, life: 0.8 });
  }
  if (t >= 1 && !craneImpacted && fx) {
    craneImpacted = true;
    const top = harbor.crane.base.clone().addScaledVector(CRANE_FALL_DIRECTION, 30);
    fx.splash(top, 5, 22);
    fx.splash(harbor.crane.base.clone().addScaledVector(CRANE_FALL_DIRECTION, 16), 4, 14);
    fx.debris(top.clone().setY(2), MURK.rust, 16, 14, 0.8);
    fx.burstSparks(top.clone().setY(3), hdr(MURK.sodiumHot, 2), 30, 16, { size: 0.5, life: 1 });
    feel?.shake(1.2, SHAKE);
  }
}

function updateSeveredArms(dt: number) {
  if (!rig || !fx) return;
  bleedClock += dt;
  const bleed = bleedClock > 0.12;
  if (bleed) bleedClock = 0;
  rig.arms.forEach((arm, index) => {
    const piece = arm.piece;
    if (piece.active) {
      const middle = piece.points[Math.floor(piece.count / 2)];
      if (middle.y < 0.5 && !splashed.has(index)) {
        splashed.add(index);
        fx!.splash(middle, 4, 18);
        fx!.ink(middle.clone().setY(1), { count: 8, size: 4, spread: 3, life: 2.5, speed: 2 });
      }
      if (bleed && piece.age < 2.2) fx!.ink(piece.points[0], { count: 1, size: 1.6, spread: 0.3, life: 1.3, speed: 1.5 });
    } else {
      splashed.delete(index);
    }
    // The stump leaks ink while it withdraws.
    if (bleed && arm.phase === 'severed' && arm.rise > 0.05) {
      fx!.ink(arm.points[NODE_INDEX - 3], { count: 1, size: 2.2, spread: 0.5, life: 1.6, speed: 1 });
    }
  });
}

const markerPosition = new Vector3();

function updateEnemies(dt: number, ctx: VisualContext) {
  const camera = ctx.camera;
  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const grow = Math.min(1, age / 0.35);
    const pop = 1 + 2.70158 * (grow - 1) ** 3 + 1.70158 * (grow - 1) ** 2;
    let size = Math.max(0.001, pop);
    // A barb reaching the lens dissolves into the spatter instead of filling the frame.
    if (record.kind === 'barb') size *= MathUtils.clamp((record.mesh.position.distanceTo(camera.position) - 1.4) / 3, 0.001, 1);
    record.mesh.scale.setScalar(size);
    record.flash = Math.max(0, record.flash - dt * 5);
    const userData = record.mesh.userData;
    const denied = (userData.deniedUntil as number | undefined ?? -1) > elapsedNow;
    const locked = userData.locked === true;

    if (record.letter) {
      const tint = record.letter.tint;
      tint.deny = denied ? 1 : 0;
      tint.charge = locked ? 0.9 + Math.sin(elapsedNow * 14) * 0.1 : 0;
      tint.flash = record.flash;
      continue;
    }

    const parts = record.parts;
    if (!parts) continue;
    parts.tint.flash = record.flash;
    parts.tint.deny = denied ? 1 : 0;
    const lockGlow = locked ? 0.25 + Math.max(0, 1 - (elapsedNow - record.lockedAt) * 4) * 0.5 : 0;
    parts.tint.charge = lockGlow;

    switch (record.kind) {
      case 'scrapper': {
        const airborne = (userData.airborne as number | undefined) ?? 0;
        parts.legs?.forEach((leg) => {
          const side = leg.userData.side as number;
          const phase = leg.userData.phase as number;
          leg.rotation.z = side * (Math.sin(elapsedNow * 16 + phase) * 0.18 * (1 - airborne) - airborne * 0.7);
        });
        break;
      }
      case 'eel':
        updateEelTrail(record);
        break;
      case 'bellbuoy': {
        const pulse = (userData.pulse as number | undefined) ?? 0;
        const squeeze = pulse < 0.3 ? Math.sin((pulse / 0.3) * Math.PI) : 0;
        parts.bell?.scale.set(1 + squeeze * 0.12, 1 - squeeze * 0.22, 1 + squeeze * 0.12);
        parts.tendrils?.forEach((tendril) => {
          tendril.rotation.z = Math.sin(elapsedNow * 3 + (tendril.userData.phase as number)) * 0.25 + squeeze * 0.4;
          tendril.rotation.x = Math.cos(elapsedNow * 2.4 + (tendril.userData.phase as number)) * 0.2;
        });
        break;
      }
      case 'node': {
        const telegraph = (userData.telegraph as number | undefined) ?? 0;
        parts.tint.charge = Math.max(lockGlow, telegraph * (0.35 + Math.sin(elapsedNow * 30) * 0.25));
        parts.glands?.forEach((gland) => {
          gland.visible = record.stage === 0;
        });
        const beat = 1 + beatEnergy * 0.12 + telegraph * 0.35;
        parts.heart?.scale.setScalar(0.85 * beat * (record.stage > 0 ? 1.3 : 1));
        break;
      }
      case 'core': {
        const sealed = (userData.sealed as number | undefined) ?? 0;
        const open = (userData.open as number | undefined) ?? 0;
        if (parts.membrane) {
          const shut = Math.max(sealed, 1 - open);
          parts.membrane.visible = shut > 0.05;
          parts.membrane.scale.setScalar(2.9 * Math.max(0.05, shut));
        }
        parts.heart?.scale.setScalar(2.3 * (1 + beatEnergy * 0.08));
        parts.beak?.forEach((plate, index) => {
          const angle = (index / 8) * Math.PI * 2;
          const spread = 3.4 + open * 1.6 * (1 - sealed);
          plate.position.set(Math.cos(angle) * spread, Math.sin(angle) * spread, -0.4);
        });
        break;
      }
      default:
        break;
    }

    if (record.marker) {
      record.mesh.getWorldPosition(markerPosition);
      record.marker.position.copy(markerPosition);
      record.marker.quaternion.copy(camera.quaternion);
      const clamp = 1 - Math.min(1, (elapsedNow - record.lockedAt) * 6);
      const breathe = 1 + Math.sin(elapsedNow * 9) * 0.04;
      record.marker.scale.setScalar(parts.markerScale * (breathe + clamp * 0.8));
    }
  }
}

const trailScratch = new Vector3();

function updateEelTrail(record: EnemyRecord) {
  const segments = record.parts?.segments;
  if (!segments) return;
  const head = record.mesh.position;
  const trail = record.trail;
  if (trail.length === 0 || trail[0].distanceToSquared(head) > 0.04) trail.unshift(head.clone());
  if (trail.length > 90) trail.length = 90;
  record.mesh.updateMatrixWorld();
  // Walk back along the recorded path, one segment every 0.9 units.
  let segmentIndex = 0;
  let travelled = 0;
  const spacing = 0.9;
  for (let i = 1; i < trail.length && segmentIndex < EEL_SEGMENTS; i += 1) {
    travelled += trail[i].distanceTo(trail[i - 1]);
    while (segmentIndex < EEL_SEGMENTS && travelled >= spacing * (segmentIndex + 1)) {
      trailScratch.copy(trail[i]);
      segments[segmentIndex].position.copy(record.mesh.worldToLocal(trailScratch));
      segments[segmentIndex].visible = true;
      segmentIndex += 1;
    }
  }
  // Segments without history yet coil up behind the head.
  for (; segmentIndex < EEL_SEGMENTS; segmentIndex += 1) {
    segments[segmentIndex].position.set(-0.9 * (segmentIndex + 1), 0, 0);
  }
}

function updateProjectiles() {
  if (!fx) return;
  for (const [projectileId, record] of projectileRecords.entries()) {
    if (!record.mesh.parent) {
      projectileRecords.delete(projectileId);
      continue;
    }
    fx.trail(record.mesh.position, hdr(MERCURY, 0.9), 0.32, 0.3);
  }
}

function updateReticleMotion(dt: number, scene: Scene) {
  for (const child of scene.children) {
    const sight = child.userData.sight as ReticleParts | undefined;
    if (!sight) continue;
    const active = child.userData.active === true;
    const lockCount = (child.userData.lockCount as number | undefined) ?? 0;
    sight.spinner.rotation.z += dt * (active ? 2.2 + lockCount * 0.6 : 0.4);
    // The crane-hook brackets close in as the volley charges.
    const close = active ? 0.9 - lockCount * 0.035 : 1;
    sight.brackets.scale.setScalar(close + Math.sin(elapsedNow * 6) * (active ? 0.015 : 0));
  }
}

// ---- camera ------------------------------------------------------------------------------

let cameraRoll = 0;

export function updateCameraFeel(dt: number, camera: PerspectiveCamera, running: boolean, runTime: number) {
  if (!feel) return;
  if (running) {
    // Bank gently with the rail's turn.
    viewPoseAt(runTime, pose);
    const ahead = createViewPose();
    viewPoseAt(runTime + 0.6, ahead);
    const turn = pose.forward.clone().cross(ahead.forward).y;
    const target = MathUtils.clamp(-turn * 4.5, -0.07, 0.07);
    cameraRoll += (target - cameraRoll) * Math.min(1, dt * 2.5);
    camera.rotateZ(cameraRoll);
  } else {
    cameraRoll = 0;
  }
  // Thermal narrows the view a touch: a focused instrument, not an eye.
  feel.setFovOffset(-sense.thermal * 2.5 + beatEnergy * 0.35, { response: 10 });
  feel.update(dt, { shake: SHAKE });
}

export function thermalWarmup(scene: Scene, camera: Camera) {
  // Build one of each creature once, in view, so their shaders compile
  // before the first wave instead of hitching it.
  const group = new Group();
  const kinds = [createScrapper(), createEel(), createBellbuoy(), createBarb(), createNode(), createCore()];
  for (const mesh of kinds) {
    mesh.scale.setScalar(0.02);
    group.add(mesh);
  }
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  group.position.copy(camera.position).addScaledVector(forward, 30);
  scene.add(group);
  return () => scene.remove(group);
}
