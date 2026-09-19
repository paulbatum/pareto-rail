import { BoxGeometry, Color, Group, MathUtils, Mesh, MeshBasicMaterial, Scene, Vector3 } from 'three';
import type { BufferGeometry, Object3D, PerspectiveCamera } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WebGPURenderer } from 'three/webgpu';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { warmUpShaders, type ShaderWarmUp } from '../../../engine/shader-cache';
import type { TimeFeel } from '../../../engine/time-feel';
import { createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { createBossMesh, type BossPart } from '../boss';
import type { CableState } from '../enemies';
import { waterHeightAt } from '../world';
import { createEffects, type CableDraw, type Effects, type TrailHandle } from './effects';
import {
  createClampMesh,
  createFlareMesh,
  createPodMesh,
  createRivetMesh,
  createSkiffMesh,
  createSpotterModel,
  createSpotterSwarm,
  createWinchLine,
  enemyWarmUpObjects,
  SPOTTER_DUCTS,
  type EnemyColors,
  type ModelFx,
} from './enemies';
import { createEnvironment as buildEnvironment, type Environment } from './environment';
import { createLetterMesh, type LetterColors } from './letters';
import { EFFECT, MACHINE, RIVET, SIGNAL } from './machine-palette';

// Spine: palette and event choreography. The world is built in environment.ts,
// the machines in enemies.ts, the pools in effects.ts. This file decides what
// every gameplay event looks like: splashdowns and wakes, the pod's charging
// lamp, the red lock brackets and the flare trails, debris into the river,
// the cable whipping away, and the kick of a full volley.

const ENEMY_COLORS: EnemyColors = {
  paint: MACHINE.paint,
  steel: MACHINE.steel,
  darkSteel: MACHINE.darkSteel,
  hazard: MACHINE.hazard,
  rubber: MACHINE.rubber,
  lamp: MACHINE.lamp,
  glass: MACHINE.glass,
  rivetHot: RIVET.hot,
  rivetShank: RIVET.shank,
};

const LETTER_COLORS: LetterColors = {
  paint: MACHINE.paint,
  steel: MACHINE.steel,
  darkSteel: MACHINE.darkSteel,
  hazard: MACHINE.hazard,
  lamp: MACHINE.lamp,
  stencil: MACHINE.hazard,
  locked: SIGNAL.red,
};

const PAINTED_DEBRIS = [MACHINE.paint, MACHINE.paintFaded, MACHINE.steel, MACHINE.darkSteel];
const STEEL_DEBRIS = [MACHINE.darkSteel, MACHINE.steel, MACHINE.darkSteel];
const DENY_GREY = new Color(0.45, 0.45, 0.45);
const FOAM_RING = EFFECT.foam.clone().multiplyScalar(0.45);
const SPOTTER_CAPACITY = 36;
const CABLE_RADIUS = 0.13;
/** Sag of a released span, and how long a cut cable takes to whip away and sink. */
const CABLE_DROP = 2.6;
const CABLE_WHIP_SECONDS = 1.4;

type EnemyRecord = {
  kind: string;
  mesh: Object3D;
  fx: (ModelFx & { locked?: number }) | null;
  bornAt: number;
  marker: Group | null;
  lockCount: number;
  trail: TrailHandle | null;
  phase: string | undefined;
  splashAt: number | undefined;
  firedAt: number | undefined;
  swarm: { body: number; rotors: Object3D[] } | null;
  winchCable: Group | null;
};

type ProjectileRecord = { mesh: Object3D; smoke: TrailHandle | null; glow: TrailHandle | null };

type CableVisual = { cable: CableState; endedAt: number; draw: CableDraw };

let environment: Environment | null = null;
let effects: Effects | null = null;
let swarm: ReturnType<typeof createSpotterSwarm> | null = null;
let warmUp: ShaderWarmUp | null = null;
let warmSpotter: Object3D | null = null;
let feel: { camera: CameraFeelRig; time: TimeFeel } | null = null;
let elapsed = 0;
let reticleRejectAt = -10;
let lastCamera: PerspectiveCamera | null = null;
const snapped: Array<{ cable: Group; from: Vector3; top: Vector3; at: number }> = [];

const cableVisuals = new Map<CableState, CableVisual>();

const enemyRecords = createPendingVisualRecords<EnemyRecord, EnemyRecord>({
  createRecord: (record) => ({ ...record, bornAt: elapsed }),
  disposeRecord: (record) => releaseRecord(record),
});
const projectileRecords = createPendingVisualRecords<ProjectileRecord, ProjectileRecord>({ createRecord: (record) => record });

// ---- world -------------------------------------------------------------------------

export function createEnvironment(scene: Scene, renderer: WebGPURenderer) {
  environment = buildEnvironment(scene, renderer);
  const spray = environment.spray;
  effects = createEffects(scene, {
    paint: MACHINE.paint,
    steel: MACHINE.steel,
    darkSteel: MACHINE.darkSteel,
    spark: EFFECT.spark,
    smoke: EFFECT.flareSmoke,
    flareGlow: SIGNAL.flare.clone().multiplyScalar(0.35),
    heat: RIVET.trail,
    wake: EFFECT.wake,
    cable: MACHINE.darkSteel,
  }, {
    waterAt: waterHeightAt,
    splash: (at, count, speed, size) => spray.spray({ at, count, speed, size, spread: 0.7, life: 1 }),
  });
  swarm = createSpotterSwarm(ENEMY_COLORS, SPOTTER_CAPACITY);
  scene.add(swarm.bodies.mesh, swarm.blades.mesh, swarm.discs.mesh);
  // One spotter drawn behind the camera on the start screen, so the swarm's shaders compile before the run.
  const warm = acquireSpotterSlots();
  if (warm) {
    scene.add(warm.body);
    warmSpotter = warm.body;
  }
  warmUp = warmUpShaders(scene, [...enemyWarmUpObjects(ENEMY_COLORS), createLetterMesh('S', LETTER_COLORS), createFlareMesh(SIGNAL.flareCore, SIGNAL.flare)]);
  return environment;
}

/** The live world: dam gates, spray emitters and the walker stand-in, for gameplay and effects. */
export function spillwayEnvironment() {
  if (!environment) throw new Error('Spillway environment is not built yet');
  return environment;
}

export function disposeVisuals() {
  enemyRecords.clear({ dispose: true, pending: true });
  projectileRecords.clear({ pending: true });
  cableVisuals.clear();
  effects?.dispose();
  for (const part of swarm ? [swarm.bodies, swarm.blades, swarm.discs] : []) {
    part.dispose();
    part.mesh.removeFromParent();
  }
  environment?.dispose();
  environment = null;
  effects = null;
  swarm = null;
  warmUp = null;
  warmSpotter = null;
  feel = null;
}

// ---- factories ---------------------------------------------------------------------

export function createEnemyMesh(kind: string, letter?: string) {
  const record: EnemyRecord = {
    kind,
    mesh: new Group(),
    fx: null,
    bornAt: 0,
    marker: null,
    lockCount: 0,
    trail: null,
    phase: undefined,
    splashAt: undefined,
    firedAt: undefined,
    swarm: null,
    winchCable: null,
  };
  switch (kind) {
    case 'letter':
      record.mesh = createLetterMesh(letter ?? 'A', LETTER_COLORS);
      break;
    case 'skiff':
      record.mesh = createSkiffMesh(ENEMY_COLORS);
      break;
    case 'spotter':
      record.mesh = acquireSpotter(record);
      break;
    case 'pod':
      record.mesh = createPodMesh(ENEMY_COLORS);
      record.winchCable = createWinchLine(ENEMY_COLORS);
      break;
    case 'clamp':
      record.mesh = createClampMesh(ENEMY_COLORS);
      break;
    case 'rivet':
      record.mesh = createRivetMesh(ENEMY_COLORS);
      break;
    case 'leg':
    case 'core':
    case 'slab':
      record.mesh = createBossMesh(kind as BossPart);
      break;
  }
  record.fx = (record.mesh.userData.fx as EnemyRecord['fx']) ?? null;
  record.mesh.userData.kind = kind;
  enemyRecords.enqueue(record);
  return record.mesh;
}

/** A body slot plus a blade and blur-disc slot per duct, the rotors parented to the body proxy. */
function acquireSpotterSlots() {
  if (!swarm) return null;
  const body = swarm.bodies.acquire();
  const rotors: Object3D[] = [];
  for (const [x, y, z] of SPOTTER_DUCTS) {
    const blades = swarm.blades.acquire();
    const disc = swarm.discs.acquire();
    if (blades) rotors.push(blades.proxy);
    if (disc) rotors.push(disc.proxy);
    if (!body || !blades || !disc) continue;
    blades.proxy.position.set(x, y + 0.02, z);
    blades.proxy.rotation.set(0, x, 0);
    blades.proxy.userData.spin = x < 0 ? -1 : 1;
    disc.proxy.position.set(x, y + 0.03, z);
    body.proxy.add(blades.proxy, disc.proxy);
  }
  if (!body || rotors.length < SPOTTER_DUCTS.length * 2) {
    if (body) swarm.bodies.release(body.index);
    for (const rotor of rotors) (rotor.userData.spin === undefined ? swarm.discs : swarm.blades).release(rotor);
    return null;
  }
  swarm.bodies.write(body.index, 'flashAt', -100);
  swarm.bodies.write(body.index, 'denyAt', -100);
  return { index: body.index, body: body.proxy, rotors };
}

function acquireSpotter(record: EnemyRecord): Object3D {
  const slots = acquireSpotterSlots();
  if (!slots) return createSpotterModel(ENEMY_COLORS);
  slots.body.scale.setScalar(1.45);
  slots.body.userData.lockSize = 4.2;
  record.swarm = { body: slots.index, rotors: slots.rotors };
  return slots.body;
}

function releaseRecord(record: EnemyRecord) {
  detachMarker(record);
  record.trail?.retire();
  record.trail = null;
  record.winchCable?.removeFromParent();
  if (record.swarm && swarm) {
    swarm.bodies.release(record.swarm.body);
    for (const rotor of record.swarm.rotors) {
      rotor.removeFromParent();
      (rotor.userData.spin === undefined ? swarm.discs : swarm.blades).release(rotor);
    }
  }
  record.swarm = null;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  const fx = mesh.userData.fx as { locked?: number } | undefined;
  if (fx && 'locked' in fx) fx.locked = locked ? 1 : 0;
}

export function setEnemyDenied(mesh: Object3D) {
  const fx = mesh.userData.fx as ModelFx | undefined;
  if (fx) fx.deny = 1;
  const index = mesh.userData.raildSwarmIndex as number | undefined;
  if (swarm && index !== undefined && swarm.bodies.indexOf(mesh) === index) swarm.bodies.write(index, 'denyAt', swarm.bodies.time);
  effects?.ring(mesh.position, DENY_GREY, 3, 0.35);
}

export function createProjectileMesh() {
  const mesh = createFlareMesh(SIGNAL.flareCore, SIGNAL.flare);
  mesh.userData.raildIgnoreOcclusion = true;
  projectileRecords.enqueue({ mesh, smoke: null, glow: null });
  return mesh;
}

// ---- reticle: a signal-red ring over a dark rim, with a pip per lock ----

const RETICLE_RADIUS = 1.18;
const reticleRed = new MeshBasicMaterial({ color: SIGNAL.red });
const reticleDark = new MeshBasicMaterial({ color: SIGNAL.underlay });
const pipOff = new MeshBasicMaterial({ color: new Color(0x3a3533) });

function ringGeometry(radius: number, width: number, segments = 48) {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = ((i + 0.5) / segments) * Math.PI * 2;
    const box = new BoxGeometry((2 * Math.PI * radius) / segments + 0.01, width, 0.01);
    box.rotateZ(angle + Math.PI / 2).translate(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    parts.push(box);
  }
  return mergeGeometries(parts);
}

export function createReticle() {
  const group = new Group();
  const spinner = new Group();
  group.add(new Mesh(ringGeometry(RETICLE_RADIUS, 0.2), reticleDark));
  group.add(new Mesh(ringGeometry(RETICLE_RADIUS, 0.09), reticleRed));
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const tick = new Mesh(new BoxGeometry(0.42, 0.1, 0.01), reticleRed);
    const rim = new Mesh(new BoxGeometry(0.5, 0.2, 0.01), reticleDark);
    for (const part of [rim, tick]) {
      part.position.set(Math.cos(angle) * (RETICLE_RADIUS + 0.38), Math.sin(angle) * (RETICLE_RADIUS + 0.38), part === tick ? 0.005 : 0);
      part.rotation.z = angle;
      spinner.add(part);
    }
  }
  const pips: Mesh[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = Math.PI / 2 - (i / 6) * Math.PI * 2;
    const pip = new Mesh(new BoxGeometry(0.17, 0.17, 0.01), pipOff);
    pip.position.set(Math.cos(angle) * (RETICLE_RADIUS - 0.3), Math.sin(angle) * (RETICLE_RADIUS - 0.3), 0);
    pip.rotation.z = Math.PI / 4;
    pips.push(pip);
    group.add(pip);
  }
  const dot = new Mesh(new BoxGeometry(0.12, 0.12, 0.01), reticleRed);
  dot.rotation.z = Math.PI / 4;
  group.add(spinner, dot);
  group.userData.spinner = spinner;
  group.userData.pips = pips;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  const rejected = elapsed - reticleRejectAt < 0.3;
  const shake = rejected ? Math.sin(elapsed * 70) * 0.06 : 0;
  reticle.scale.setScalar((active ? 0.92 : 1) + lockCount * 0.02);
  reticle.rotation.z += shake;
  (reticle.userData.pips as Mesh[]).forEach((pip, index) => {
    pip.material = index < lockCount ? reticleRed : pipOff;
  });
  reticle.userData.active = active;
}

// ---- lock markers: red corner brackets around the target ----

const MARKER_RED = new MeshBasicMaterial({ color: SIGNAL.red, depthTest: false, transparent: true });
const MARKER_DARK = new MeshBasicMaterial({ color: SIGNAL.underlay, depthTest: false, transparent: true, opacity: 0.8 });

function bracketGeometry(width: number) {
  const parts: BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      parts.push(new BoxGeometry(0.34, width, 0.01).translate(sx * 0.33, sy * 0.5, 0));
      parts.push(new BoxGeometry(width, 0.34, 0.01).translate(sx * 0.5, sy * 0.33, 0));
    }
  }
  return mergeGeometries(parts);
}

const BRACKET_RED = bracketGeometry(0.06);
const BRACKET_DARK = bracketGeometry(0.13);

function attachMarker(record: EnemyRecord, scene: Scene) {
  if (record.marker) return;
  const marker = new Group();
  const dark = new Mesh(BRACKET_DARK, MARKER_DARK);
  const red = new Mesh(BRACKET_RED, MARKER_RED);
  dark.renderOrder = 998;
  red.renderOrder = 999;
  red.position.z = 0.01;
  marker.add(dark, red);
  marker.userData.raildIgnoreOcclusion = true;
  marker.userData.attachedAt = elapsed;
  record.marker = marker;
  scene.add(marker);
}

function detachMarker(record: EnemyRecord) {
  record.marker?.removeFromParent();
  record.marker = null;
  record.lockCount = 0;
}

// ---- events ------------------------------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, rigs: { camera: CameraFeelRig; time: TimeFeel }) {
  feel = rigs;
  const spray = () => environment?.spray;

  bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record || !effects) return;
    if (kind === 'skiff' && record.mesh.userData.phase === 'air') {
      // Thrown off the rack: a kick of exhaust smoke at the walker.
      spray()?.spray({ at: worldPosition, count: 40, speed: 3, spread: 0.8, life: 1.6, size: 2.2, color: EFFECT.smoke });
    } else if (kind === 'clamp') {
      splash(worldPosition, 90, 7, 1);
      effects.ring(waterPoint(worldPosition), FOAM_RING, 4, 0.9, true);
    } else if (kind === 'pod' && record.winchCable) {
      scene.add(record.winchCable);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) {
      attachMarker(record, scene);
      record.lockCount += 1;
      record.marker!.userData.attachedAt = elapsed;
    }
    effects?.ring(worldPosition, SIGNAL.red, 2.2, 0.22);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) detachMarker(record);
  });

  bus.on('fire', ({ projectileId, worldPosition }) => {
    const record = projectileRecords.claim(projectileId);
    if (record && effects) {
      record.smoke = effects.smokeTrail();
      record.glow = effects.glowTrail();
    }
    effects?.sparks(worldPosition, 4, 6, SIGNAL.flare, 0.18);
  });

  bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
    retireProjectile(projectileId);
    const record = enemyRecords.get(enemyId);
    if (!record || !effects) return;
    record.lockCount -= 1;
    if (record.lockCount <= 0) detachMarker(record);
    if (lethal) return;
    if (record.fx) record.fx.flash = 1;
    effects.sparks(worldPosition, 14, 12);
    if (record.kind === 'pod') {
      // The claw tears out of the rock.
      effects.debris(worldPosition, 5, 7, 0.35, STEEL_DEBRIS);
      spray()?.spray({ at: worldPosition, count: 50, speed: 5, spread: 0.9, life: 1.4, size: 1.6, color: 0x8f887e });
    }
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record && effects) {
      explode(record, worldPosition);
      enemyRecords.delete(enemyId, { dispose: true });
    }
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    if (record?.kind !== 'rivet') spray()?.spray({ at: worldPosition, count: 8, speed: 1.5, spread: 1, life: 1.2, size: 1.2, color: EFFECT.smoke });
  });

  bus.on('reject', () => {
    reticleRejectAt = elapsed;
  });

  bus.on('volley', ({ size, kills }) => {
    if (kills < size || size < 4 || !feel) return;
    // A clean six is an event: a short freeze, a lens kick and a roll.
    if (size >= 6) {
      feel.time.hitStop(0.07);
      feel.camera.kickFov(-4.5, { decay: 5 });
      feel.camera.kickRoll(Math.random() < 0.5 ? -2.5 : 2.5, { decay: 5 });
      feel.camera.shake(0.35);
    } else {
      feel.camera.kickFov(-2, { decay: 6 });
    }
  });

  bus.on('playerhit', () => {
    feel?.camera.shake(0.9);
    feel?.camera.kickRoll(Math.random() < 0.5 ? -5 : 5, { decay: 4 });
    if (lastCamera) {
      // Spray over the lens.
      const ahead = lastCamera.getWorldDirection(new Vector3()).multiplyScalar(4).add(lastCamera.position);
      spray()?.spray({ at: ahead, count: 160, speed: 6, spread: 1, life: 0.8, size: 0.6, radius: 1.2 });
    }
  });

  bus.on('runstart', () => {
    resetVisuals();
  });
  bus.on('runend', () => {
    for (const [id] of [...enemyRecords.entries()]) enemyRecords.delete(id, { dispose: true });
  });
}

function resetVisuals() {
  for (const line of snapped) line.cable.removeFromParent();
  snapped.length = 0;
  enemyRecords.clear({ dispose: true, pending: true });
  projectileRecords.clear({ pending: true });
  cableVisuals.clear();
  effects?.reset();
  swarm?.bodies.reset();
  swarm?.blades.reset();
  swarm?.discs.reset();
  warmSpotter?.removeFromParent();
  warmSpotter = null;
  reticleRejectAt = -10;
}

function retireProjectile(projectileId: number) {
  const record = projectileRecords.get(projectileId);
  if (!record) return;
  record.smoke?.retire();
  record.glow?.retire();
  projectileRecords.delete(projectileId);
}

const scratch = new Vector3();

function waterPoint(position: Vector3) {
  return scratch.copy(position).setY(waterHeightAt(position.x, position.z) + 0.05);
}

function splash(at: Vector3, count: number, speed: number, size: number) {
  environment?.spray.spray({ at: waterPoint(at), count, speed, spread: 0.55, life: 1.4, size, direction: new Vector3(0, 1, 0), radius: 0.8 });
}

/** Each kind breaks up its own way; things near the river throw water too. */
function explode(record: EnemyRecord, at: Vector3) {
  if (!effects) return;
  const nearWater = at.y - waterHeightAt(at.x, at.z) < 4;
  switch (record.kind) {
    case 'skiff':
      effects.debris(at, 14, 11, 0.45, PAINTED_DEBRIS);
      effects.sparks(at, 16, 13);
      if (nearWater) {
        splash(at, 220, 9, 1.3);
        effects.ring(waterPoint(at), FOAM_RING, 6, 1.1, true);
      }
      break;
    case 'spotter':
      effects.sparks(at, 34, 16);
      effects.debris(at, 5, 8, 0.25, STEEL_DEBRIS);
      effects.ring(at, EFFECT.spark, 3.2, 0.3);
      break;
    case 'pod':
      effects.debris(at, 22, 12, 0.6, PAINTED_DEBRIS);
      effects.sparks(at, 30, 15);
      environment?.spray.spray({ at, count: 70, speed: 4, spread: 0.9, life: 2.2, size: 2.6, color: EFFECT.smoke });
      if (record.winchCable && record.mesh.userData.cableTop) {
        // The winch line snaps back up to the rim.
        snapped.push({ cable: record.winchCable, from: at.clone(), top: (record.mesh.userData.cableTop as Vector3).clone(), at: elapsed });
        record.winchCable = null;
      }
      break;
    case 'clamp': {
      effects.debris(at, 10, 9, 0.4, PAINTED_DEBRIS);
      effects.sparks(at.clone().setY(at.y + 2.4), 18, 10);
      splash(at, 150, 8, 1.1);
      const cable = record.mesh.userData.cable as CableState | undefined;
      if (cable && cable.state === 'cut') cableCut(cable);
      break;
    }
    case 'rivet':
      effects.sparks(at, 22, 12, RIVET.hot, 0.3);
      effects.ring(at, RIVET.hot.clone().multiplyScalar(0.3), 2.2, 0.25);
      break;
    case 'letter':
      effects.debris(at, 10, 8, 0.35, [MACHINE.paint, MACHINE.hazard]);
      effects.sparks(at, 12, 9);
      break;
    default:
      effects.debris(at, 12, 10, 0.5, PAINTED_DEBRIS);
      effects.sparks(at, 20, 12);
  }
  record.winchCable?.removeFromParent();
}

/** The last clamp is gone: spray bursts along the whole cable as it whips away. */
function cableCut(cable: CableState) {
  const spray = environment?.spray;
  if (!spray) return;
  const from = cable.ends[0];
  const to = cable.ends[1];
  const middle = scratch.addVectors(from, to).multiplyScalar(0.5);
  spray.spray({ at: middle, count: 200, speed: 7, spread: 0.35, life: 1.1, size: 0.8, direction: new Vector3(0, 1, 0), line: to.clone().sub(from).multiplyScalar(0.5) });
  feel?.camera.shake(0.25);
}

// ---- per-frame -----------------------------------------------------------------------

export function updateVisuals(frame: { runTime: number; dt: number; camera: PerspectiveCamera }) {
  const { dt, camera } = frame;
  elapsed += dt;
  lastCamera = camera;
  environment?.update(frame);
  warmUp?.update(camera);
  if (warmSpotter) warmSpotter.position.copy(camera.position).addScaledVector(camera.getWorldDirection(scratch), -2);

  for (const [enemyId, record] of [...enemyRecords.entries()]) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    updateRecord(record, frame);
  }

  for (const [projectileId, record] of [...projectileRecords.entries()]) {
    if (!record.mesh.parent) {
      retireProjectile(projectileId);
      continue;
    }
    record.smoke?.push(record.mesh.position);
    record.glow?.push(record.mesh.position);
    record.mesh.rotateZ(dt * 20);
  }

  for (let i = snapped.length - 1; i >= 0; i -= 1) {
    const line = snapped[i];
    const retract = (elapsed - line.at) / 0.5;
    if (retract >= 1) {
      line.cable.removeFromParent();
      snapped.splice(i, 1);
    } else {
      placeWinchCable(line.cable, line.from, line.top, retract * retract);
    }
  }

  updateCables();
  swarm?.bodies.update(dt);
  swarm?.blades.update(dt);
  swarm?.discs.update(dt);
  effects?.update(dt, camera, [...cableVisuals.values()].map((visual) => visual.draw));
}

const stern = new Vector3();
const toCamera = new Vector3();

function updateRecord(record: EnemyRecord, frame: { dt: number; camera: PerspectiveCamera }) {
  const { dt, camera } = frame;
  const mesh = record.mesh;
  const age = elapsed - record.bornAt;
  const fx = record.fx;
  if (fx) {
    fx.flash = Math.max(0, fx.flash - dt * 5);
    fx.deny = Math.max(0, fx.deny - dt * 2.2);
  }

  // Spawn pop, except for things that arrive by their own motion.
  if (record.kind === 'pod' || record.kind === 'letter') mesh.scale.setScalar(Math.min(1, 0.3 + age * 3));

  switch (record.kind) {
    case 'skiff': {
      const phase = mesh.userData.phase as string | undefined;
      const splashAt = mesh.userData.splashAt as number | undefined;
      if ((phase === 'water' && record.phase === 'air') || (splashAt !== undefined && splashAt !== record.splashAt)) {
        splash(mesh.position, 260, 10, 1.4);
        effects?.ring(waterPoint(mesh.position), FOAM_RING, 7, 1.2, true);
      }
      record.phase = phase;
      record.splashAt = splashAt;
      if (phase === 'water') {
        record.trail ??= effects?.wake() ?? null;
        mesh.localToWorld(stern.set(0, -1.2, -3.5));
        stern.y = waterHeightAt(stern.x, stern.z) + 0.08;
        record.trail?.push(stern);
        // A rooster tail off the rear foil.
        environment?.spray.spray({ at: stern, count: dt * 70, speed: 4.5, spread: 0.35, life: 0.7, size: 0.55, direction: toCamera.set(0, 1.4, 0).addScaledVector(mesh.getWorldDirection(scratch), -1) });
        // Carving, the outside foil tip throws a plume sideways out of the turn.
        const carve = (mesh.userData.carve as number | undefined) ?? 0;
        if (Math.abs(carve) > 0.08) {
          const side = carve > 0 ? 1 : -1;
          mesh.localToWorld(stern.set(side * 2.2, -1.9, 1.2));
          stern.y = waterHeightAt(stern.x, stern.z) + 0.1;
          const out = toCamera.set(side, 0, 0).transformDirection(mesh.matrixWorld).setY(0.9);
          environment?.spray.spray({ at: stern, count: dt * 160 * Math.min(1, Math.abs(carve) * 2.2), speed: 5.5, spread: 0.3, life: 0.8, size: 0.75, direction: out });
        }
      } else if (record.trail) {
        record.trail.retire();
        record.trail = null;
      }
      break;
    }
    case 'spotter':
      if (record.swarm) for (const rotor of record.swarm.rotors) if (rotor.userData.spin) rotor.rotation.y += dt * 45 * (rotor.userData.spin as number);
      break;
    case 'pod': {
      const claw = mesh.userData.claw as Object3D | undefined;
      const loose = Boolean(mesh.userData.loose);
      if (loose && claw?.visible) {
        // The claw tears out of the rock: it goes, with a burst of rock dust and sparks at the wall.
        claw.visible = false;
        const normal = mesh.userData.wallNormal as Vector3;
        scratch.copy(mesh.position).addScaledVector(normal, -3.2);
        effects?.debris(scratch, 9, 7, 0.4, STEEL_DEBRIS);
        effects?.sparks(scratch, 24, 12);
        environment?.spray.spray({ at: scratch, count: 90, speed: 3.5, spread: 1, life: 1.8, size: 2.2, color: EFFECT.dust });
        fx && (fx.flash = 1);
      }
      if (fx) {
        // The lamp charges before each rivet, blinking faster as it comes; a loose pod blinks in distress.
        const charge = (mesh.userData.charge as number | undefined) ?? 0;
        const blink = loose ? 1.5 + 1.5 * Math.sign(Math.sin(elapsed * 34)) : 0;
        fx.lamp = 1 + blink + charge * charge * (2.5 + 2.5 * Math.sign(Math.sin(elapsed * (10 + charge * 30))));
      }
      const firedAt = mesh.userData.firedAt as number | undefined;
      if (firedAt !== undefined && firedAt !== record.firedAt) {
        const normal = mesh.userData.wallNormal as Vector3;
        scratch.copy(mesh.position).addScaledVector(normal, 2.9);
        effects?.sparks(scratch, 10, 9, RIVET.hot, 0.25);
        environment?.spray.spray({ at: scratch, count: 25, speed: 3, spread: 0.6, life: 1.2, size: 1.2, color: EFFECT.smoke });
      }
      record.firedAt = firedAt;
      const top = mesh.userData.cableTop as Vector3 | undefined;
      if (record.winchCable && top) placeWinchCable(record.winchCable, mesh.position, top);
      break;
    }
    case 'rivet': {
      const spinner = mesh.userData.spinner as Object3D;
      spinner.rotation.x += dt * 16;
      record.trail ??= effects?.heatTrail() ?? null;
      record.trail?.push(mesh.position);
      effects?.sparks(mesh.position, 1, 1.5, RIVET.hot, 0.35);
      break;
    }
    case 'clamp': {
      const cable = mesh.userData.cable as CableState | undefined;
      if (cable && !cableVisuals.has(cable)) cableVisuals.set(cable, { cable, endedAt: -1, draw: { points: [], radius: CABLE_RADIUS } });
      break;
    }
    case 'letter':
      mesh.position.y += Math.sin(elapsed * 1.6 + mesh.id) * 0.08;
      break;
  }

  if (record.marker) {
    const size = (mesh.userData.lockSize as number | undefined) ?? 2.5;
    const snap = Math.min(1, (elapsed - (record.marker.userData.attachedAt as number)) / 0.12);
    record.marker.position.copy(mesh.position);
    record.marker.position.y += (mesh.userData.lockOffset as number | undefined) ?? 0;
    record.marker.quaternion.copy(camera.quaternion);
    // A second lock on the same target pulls the brackets in tight.
    const tighten = record.lockCount > 1 ? 0.8 : 1;
    record.marker.scale.setScalar(size * tighten * MathUtils.lerp(1.7, 1, snap) * (1 + Math.sin(elapsed * 14) * 0.03));
  }
}

/** The winch line runs from the shackle on top of the pod to the trolley on the rim; `retract` reels a snapped line in. */
function placeWinchCable(line: Group, pod: Vector3, top: Vector3, retract = 0) {
  const cable = line.userData.cable as Mesh;
  const trolley = line.userData.trolley as Mesh;
  const from = scratch.copy(pod).setY(pod.y + 2.9).lerp(top, retract);
  cable.position.copy(from);
  cable.scale.set(1, Math.max(0.01, from.distanceTo(top)), 1);
  cable.lookAt(top);
  cable.rotateX(Math.PI / 2);
  trolley.position.copy(top).setY(top.y + 0.3);
}

const released = new Vector3();

/** Rebuild each cable's segments: taut through the jaws that hold, sagging into the water where they let go, whipping away once cut. */
function updateCables() {
  for (const [cable, visual] of cableVisuals) {
    if (cable.state !== 'taut' && visual.endedAt < 0) visual.endedAt = elapsed;
    const since = visual.endedAt < 0 ? 0 : elapsed - visual.endedAt;
    if (since > CABLE_WHIP_SECONDS) {
      cableVisuals.delete(cable);
      continue;
    }
    const anchors = [cable.ends[0], ...cable.jaws, cable.ends[1]];
    const points = visual.draw.points;
    let n = 0;
    const put = (x: number, y: number, z: number) => {
      points[n] ??= new Vector3();
      points[n].set(x, y, z);
      n += 1;
    };
    for (let span = 0; span < anchors.length - 1; span += 1) {
      const a = anchors[span];
      const b = anchors[span + 1];
      const aHeld = span === 0 || cable.held[span - 1];
      const bHeld = span === anchors.length - 2 || cable.held[span];
      const steps = 6;
      for (let i = span === 0 ? 0 : 1; i <= steps; i += 1) {
        const t = i / steps;
        released.lerpVectors(a, b, t);
        // A released jaw lets its side of the span fall to the water.
        const drop = (aHeld ? 0 : (1 - t) * CABLE_DROP) + (bHeld ? 0 : t * CABLE_DROP);
        const sag = a.distanceTo(b) * 0.015 + drop * 0.35;
        let y = released.y - drop - sag * 4 * t * (1 - t);
        if (since > 0) {
          // Whip: a travelling kink, then the whole line drops into the river.
          const k = (span + t) / (anchors.length - 1);
          // A swept cable is snapped by the camera itself: it drops clear of the lens at once.
          y += Math.sin(since * 16 - k * 9) * Math.exp(-since * 3) * 1.6 - since * since * 7 - (cable.state === 'swept' ? since * 40 : 0);
          released.x += Math.sin(since * 11 + k * 6) * Math.exp(-since * 2.5) * 1.2;
        }
        put(released.x, y, released.z);
      }
    }
    points.length = n;
    visual.draw.radius = CABLE_RADIUS * (since > 0 ? Math.max(0.2, 1 - since / CABLE_WHIP_SECONDS) : 1);
  }
}

/** One enemy on its own, for model snapshots. */
export function createEnemyModel(kind: string, letter = 'S') {
  switch (kind) {
    case 'skiff':
      return createSkiffMesh(ENEMY_COLORS);
    case 'spotter':
      return createSpotterModel(ENEMY_COLORS);
    case 'pod':
    case 'pod-loose': {
      const pod = createPodMesh(ENEMY_COLORS);
      (pod.userData.claw as Object3D).visible = kind === 'pod';
      const line = createWinchLine(ENEMY_COLORS);
      placeWinchCable(line, pod.position, new Vector3(0, 7, 0));
      pod.add(line);
      return pod;
    }
    case 'clamp':
      return createClampMesh(ENEMY_COLORS);
    case 'rivet':
      return createRivetMesh(ENEMY_COLORS);
    case 'flare':
      return createFlareMesh(SIGNAL.flareCore, SIGNAL.flare);
    default:
      return createLetterMesh(letter, LETTER_COLORS);
  }
}
