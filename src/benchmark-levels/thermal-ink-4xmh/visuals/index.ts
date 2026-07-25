import {
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MeshBasicNodeMaterial } from 'three/webgpu';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { mulberry32 } from '../../../engine/rng';
import { createAdornmentSlot, createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { ARM_CONFIGS, octopusPose } from '../octopus';
import { setVisionHold, vision } from '../vision';
import { createCreatureMesh, disposeCreatureMaterials, paintCreature, type CreatureSkin } from './creatures';
import {
  burstChunks,
  createEffects,
  releaseSeveredArm,
  resetEffects,
  spawnGlint,
  spawnRing,
  sprayIchor,
  spraySear,
  updateEffects,
} from './effects';
import { createHarbour, type HarbourEnvironment } from './environment';
import { createLetterMesh, setLetterFlash, setLetterLocked, type LetterSkin } from './letters';
import { beatUniform, inkUniform, modalMesh, thermalUniform } from './materials';
import { createOctopusBody, poseLimb, type LimbShape, type OctopusBody } from './octopus-body';
import {
  COLD,
  COLD_EDGE,
  CREAM,
  EMBER,
  FLESH,
  FLESH_LIT,
  HAZE,
  HOT,
  ICHOR,
  INK,
  IRON,
  LAMP,
  RUST,
  SIGNAL,
  SILT,
  WARM,
  WATER,
  hdr,
} from './palette';
import { hurtUniform, lampsUniform } from './post-fx';

// The visual spine: which colours the two senses use, and what the harbour does
// when the player locks, fires, hits, kills, misses, or gets turned away. Mesh
// construction lives in the leaves; every decision lives here.

// --- Skins -----------------------------------------------------------------
// Each entry is one surface's answer to both senses. In murk the creature is an
// oily mass against rust and dirty cream; in infrared it is the brightest thing
// in the harbour and everything people built is cold.

const CREATURE_SKINS: Record<string, CreatureSkin> = {
  scuttler: {
    bodyMurk: hdr(RUST, 1.0),
    bodyThermal: hdr(HOT, 1.05),
    coreMurk: hdr(LAMP, 0.95),
    coreThermal: hdr(SIGNAL, 2.1),
    swallow: 0.93,
  },
  hatchling: {
    bodyMurk: hdr(FLESH_LIT, 1.25),
    bodyThermal: hdr(HOT, 1.25),
    coreMurk: hdr(LAMP, 0.75),
    coreThermal: hdr(SIGNAL, 2.3),
    swallow: 0.95,
  },
  pod: {
    bodyMurk: hdr(IRON, 2.0),
    bodyThermal: hdr(HOT, 0.72),
    coreMurk: hdr(LAMP, 1.25),
    coreThermal: hdr(SIGNAL, 2.5),
    swallow: 0.93,
  },
  bolt: {
    bodyMurk: hdr(FLESH, 1.7),
    bodyThermal: hdr(HOT, 1.35),
    coreMurk: hdr(LAMP, 2.2),
    coreThermal: hdr(SIGNAL, 2.8),
    swallow: 0.7,
  },
  arm: {
    bodyMurk: hdr(FLESH, 0.95),
    bodyThermal: hdr(HOT, 1.0),
    coreMurk: hdr(ICHOR, 1.1),
    coreThermal: hdr(SIGNAL, 2.3),
    swallow: 0.9,
  },
  core: {
    bodyMurk: hdr(FLESH, 0.85),
    bodyThermal: hdr(HOT, 0.62),
    coreMurk: hdr(ICHOR, 1.9),
    coreThermal: hdr(SIGNAL, 3.0),
    swallow: 0.86,
  },
};

const LETTER_SKIN: LetterSkin = {
  plateMurk: hdr(CREAM, 0.4),
  plateThermal: hdr(COLD, 2.2),
  edgeMurk: hdr(LAMP, 1.5),
  edgeThermal: hdr(COLD_EDGE, 1.6),
  lockedPlateMurk: hdr(LAMP, 0.55),
  lockedPlateThermal: hdr(HOT, 0.7),
  lockedEdgeMurk: hdr(LAMP, 2.6),
  lockedEdgeThermal: hdr(SIGNAL, 2.2),
};

const FLASH = {
  lock: { murk: hdr(LAMP, 1.5), thermal: hdr(HOT, 1.5) },
  hit: { murk: hdr(CREAM, 1.6), thermal: hdr(HOT, 1.9) },
  denied: { murk: hdr(RUST, 1.8), thermal: hdr(SIGNAL, 1.2) },
  stage: { murk: hdr(ICHOR, 2.0), thermal: hdr(EMBER, 2.0) },
};

const RING = {
  spawn: { murk: hdr(HAZE, 0.9), thermal: hdr(COLD_EDGE, 1.6) },
  lock: { murk: hdr(LAMP, 1.4), thermal: hdr(SIGNAL, 1.8) },
  kill: { murk: hdr(ICHOR, 1.5), thermal: hdr(HOT, 1.7) },
  stage: { murk: hdr(LAMP, 2.0), thermal: hdr(EMBER, 2.2) },
  denied: { murk: hdr(RUST, 2.2), thermal: hdr(SIGNAL, 2.4) },
  miss: { murk: hdr(SILT, 1.4), thermal: hdr(COLD_EDGE, 1.2) },
};

const BACKDROP = {
  murk: WATER.clone(),
  ink: INK.clone(),
  thermal: new Color(0.017, 0.019, 0.024),
};

// --- Records ---------------------------------------------------------------

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number | null;
  flashUntil: number;
  flashLife: number;
  flashMurk: Color;
  flashThermal: Color;
  bracket: Group | null;
};

// Brackets are attached and detached hundreds of times a run, so their geometry
// and material are shared and the slot never disposes them.
const brackets = createAdornmentSlot<EnemyRecord, Group>({
  get: (record) => record.bracket,
  set: (record, bracket) => {
    record.bracket = bracket;
  },
  disposeAdornment: () => {},
});

const enemyRecords = createPendingVisualRecords<Group, EnemyRecord>({
  createRecord: (mesh) => ({
    mesh,
    kind: (mesh.userData.kind as string | undefined) ?? 'scuttler',
    bornAt: null,
    flashUntil: -Infinity,
    flashLife: 0.2,
    flashMurk: new Color(),
    flashThermal: new Color(),
    bracket: null,
  }),
  disposeRecord: (record) => {
    brackets.detach(record);
    disposeCreatureMaterials(record.mesh);
  },
});

let harbour: HarbourEnvironment | null = null;
let body: OctopusBody | null = null;
let elapsedNow = 0;
let beatEnergy = 0;
let lampsGlow = 0;
let hurtGlow = 0;
const backdrop = new Color();
const limbOrigin = new Vector3();
const corpseDrift = new Vector3();
const armShapes: LimbShape[] = ARM_CONFIGS.map(() => ({
  tip: new Vector3(),
  bulge: new Vector3(),
  shoulder: new Vector3(),
  thickness: 1.35,
  wobble: 0.55,
  time: 0,
}));

export function createEnvironment(scene: Scene) {
  harbour = createHarbour(scene, {
    steelMurk: hdr(IRON, 0.62),
    steelThermal: hdr(COLD, 1.0),
    paintMurk: hdr(CREAM, 0.30),
    paintThermal: hdr(COLD, 1.5),
    edgeMurk: hdr(RUST, 0.85),
    edgeThermal: hdr(COLD_EDGE, 0.95),
    lampMurk: hdr(LAMP, 1.9),
    lampThermal: hdr(WARM, 0.55),
    gritMurk: hdr(HAZE, 0.55),
    gritThermal: hdr(COLD_EDGE, 0.3),
    bedMurk: hdr(SILT, 0.42),
    bedThermal: hdr(COLD, 0.55),
  });

  body = createOctopusBody({
    hideMurk: hdr(FLESH, 0.8),
    hideThermal: hdr(HOT, 0.92),
    glowMurk: hdr(LAMP, 1.15),
    glowThermal: hdr(SIGNAL, 1.9),
    wreckMurk: hdr(IRON, 0.55),
    wreckThermal: hdr(COLD, 1.1),
    cableMurk: hdr(RUST, 0.7),
    cableThermal: hdr(COLD_EDGE, 0.85),
    hurtMurk: hdr(ICHOR, 1.9),
    hurtThermal: hdr(EMBER, 1.7),
  }, mulberry32(20260731));
  harbour.root.add(body.group);

  createEffects(scene, {
    ichorMurk: hdr(ICHOR, 1.1),
    ichorThermal: hdr(HOT, 1.4),
    searMurk: hdr(LAMP, 1.7),
    searThermal: hdr(SIGNAL, 2.2),
    chunkMurk: hdr(IRON, 1.8),
    chunkThermal: hdr(COLD_EDGE, 1.5),
    limbMurk: hdr(FLESH, 0.95),
    limbThermal: hdr(HOT, 0.5),
  });

  return harbour.root;
}

export function createEnemyMesh(kind: string, letter?: string) {
  const mesh = kind === 'letter' || letter !== undefined
    ? createLetterMesh(letter ?? '?', LETTER_SKIN)
    : createCreatureMesh(kind, CREATURE_SKINS[kind] ?? CREATURE_SKINS.scuttler);
  mesh.userData.kind = kind === 'letter' ? 'letter' : kind;
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  if (mesh.userData.isLetter === true) {
    setLetterLocked(mesh as Group, locked);
    return;
  }
  paintCreature(mesh, locked ? { ...FLASH.lock, amount: 0.5 } : undefined);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.userData.deniedUntil = elapsedNow + 0.5;
  spawnRing(mesh.position, RING.denied.murk, RING.denied.thermal, 3.4, 0.36);
  if (mesh.userData.isLetter === true) {
    setLetterFlash(mesh as Group, FLASH.denied.murk, FLASH.denied.thermal);
    return;
  }
  paintCreature(mesh, { ...FLASH.denied, amount: 0.9 });
}

/** The harpoon: an iron bolt riding a lamp-lit thread of pressure. */
export function createProjectileMesh() {
  const group = new Group();
  const shaft = new Mesh(
    new SphereGeometry(0.3, 8, 6),
    modalMesh(hdr(LAMP, 2.4), hdr(HOT, 2.0), { swallow: 0.25, additive: true }),
  );
  shaft.scale.set(0.4, 0.4, 2.6);
  const head = new Mesh(
    new SphereGeometry(0.2, 7, 6),
    modalMesh(hdr(CREAM, 2.2), hdr(SIGNAL, 2.4), { swallow: 0.2, additive: true }),
  );
  head.position.z = 0.45;
  group.add(shaft, head);
  return group;
}

/**
 * A diver's caliper sight. The outer ring is drawn at the engine's lock radius
 * so what you see is exactly what acquires, the jaws close as the volley fills,
 * and the whole sight goes red the moment the imager takes over.
 */
export function createReticle() {
  const group = new Group();
  const ringMaterial = modalMesh(hdr(LAMP, 2.0), hdr(SIGNAL, 2.6), { swallow: 0, additive: true, side: DoubleSide });
  const jawMaterial = modalMesh(hdr(CREAM, 1.8), hdr(HOT, 2.2), { swallow: 0, additive: true, side: DoubleSide });
  const dotMaterial = modalMesh(hdr(CREAM, 2.4), hdr(SIGNAL, 3.0), { swallow: 0, additive: true, side: DoubleSide });

  group.add(new Mesh(new RingGeometry(1.14, 1.21, 44), ringMaterial));

  const jaws = new Group();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const jaw = new Mesh(new PlaneGeometry(0.5, 0.08), jawMaterial);
    jaw.position.set(Math.cos(angle) * 0.9, Math.sin(angle) * 0.9, 0);
    jaw.rotation.z = angle + Math.PI / 2;
    jaws.add(jaw);
  }
  group.add(jaws);
  group.add(new Mesh(new RingGeometry(0, 0.08, 12), dotMaterial));

  group.userData.jaws = jaws;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  // The only hold signal the engine hands a level — and this level's second
  // sense is built on it: holding the trigger is raising the imager.
  setVisionHold(active);
  reticle.userData.active = active;
  const jaws = reticle.userData.jaws as Group | undefined;
  if (jaws) {
    jaws.scale.setScalar(1 - Math.min(6, lockCount) * 0.05);
    jaws.rotation.z = Math.min(6, lockCount) * 0.1;
  }
  reticle.scale.setScalar(1 + (active ? 0.05 : 0) - Math.min(6, lockCount) * 0.012);
}

// --- Event choreography ----------------------------------------------------

export function installVisualEventHandlers(bus: EventBus, scene: Scene, feel: CameraFeelRig) {
  bus.on('spawn', ({ enemyId, worldPosition, kind }) => {
    const record = enemyRecords.claim(enemyId);
    if (!record || kind === 'letter') return;
    spawnRing(worldPosition, RING.spawn.murk, RING.spawn.thermal, kind === 'arm' ? 6.5 : 2.6, 0.5);
    if (kind === 'arm') {
      feel.shake(0.32);
      spawnGlint(worldPosition, RING.stage.murk, RING.stage.thermal, 2.2, 0.26);
    }
    if (kind === 'core') {
      feel.shake(0.5);
      spawnRing(worldPosition, RING.stage.murk, RING.stage.thermal, 9, 0.8);
    }
  });

  bus.on('lock', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record && !record.bracket) brackets.attach(record, createBracket(), scene);
    spawnRing(worldPosition, RING.lock.murk, RING.lock.thermal, 1.9, 0.26);
  });

  bus.on('unlock', ({ enemyId }) => {
    const record = enemyRecords.get(enemyId);
    if (record) brackets.detach(record);
  });

  bus.on('fire', ({ worldPosition }) => {
    spawnGlint(worldPosition, RING.lock.murk, RING.lock.thermal, 0.7, 0.13);
  });

  bus.on('hit', ({ enemyId, worldPosition, lethal }) => {
    if (lethal) return;
    const record = enemyRecords.get(enemyId);
    sprayIchor(worldPosition, 9, 6.5);
    spraySear(worldPosition, 5, 8);
    spawnRing(worldPosition, RING.lock.murk, RING.lock.thermal, 2.4, 0.24);
    if (record) flash(record, FLASH.hit, 0.22);
    if (record?.kind === 'arm' || record?.kind === 'core') feel.shake(0.16);
  });

  bus.on('stage', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) flash(record, FLASH.stage, 0.5);
    spawnRing(worldPosition, RING.stage.murk, RING.stage.thermal, 5.5, 0.5);
    spawnGlint(worldPosition, RING.stage.murk, RING.stage.thermal, 2.0, 0.24);
    sprayIchor(worldPosition, 18, 9);
    feel.shake(0.3);
  });

  bus.on('kill', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    const kind = record?.kind ?? 'scuttler';
    sprayIchor(worldPosition, kind === 'arm' || kind === 'core' ? 34 : 14, kind === 'core' ? 14 : 8);
    spraySear(worldPosition, 10, 11);
    burstChunks(worldPosition, kind === 'pod' ? 14 : 7, 7);
    spawnRing(worldPosition, RING.kill.murk, RING.kill.thermal, kind === 'arm' ? 8 : 3.6, 0.45);
    spawnGlint(worldPosition, RING.kill.murk, RING.kill.thermal, kind === 'core' ? 4 : 1.1, 0.2);

    if (record && kind === 'arm') {
      const index = record.mesh.userData.armIndex as number | undefined;
      if (index !== undefined) {
        corpseDrift.copy(octopusPose.up).multiplyScalar(-2.4).addScaledVector(octopusPose.forward, -1.4);
        releaseSeveredArm(armShapes[index], corpseDrift);
      }
      feel.shake(0.75);
      lampsGlow = Math.max(lampsGlow, 0.22);
    }
    if (kind === 'core') {
      feel.shake(1);
      lampsGlow = 1;
    }
    if (record) enemyRecords.delete(enemyId, { dispose: true });
  });

  bus.on('miss', ({ enemyId, worldPosition }) => {
    const record = enemyRecords.get(enemyId);
    if (record) enemyRecords.delete(enemyId, { dispose: true });
    spawnRing(worldPosition, RING.miss.murk, RING.miss.thermal, 2.2, 0.4);
    sprayIchor(worldPosition, 3, 2.4);
  });

  // The beak turns a volley away: the plates ring and the shot dies on them.
  bus.on('shielded', ({ shields }) => {
    for (const shield of shields) {
      const record = enemyRecords.get(shield.enemyId);
      if (record) flash(record, FLASH.denied, 0.6);
      spawnRing(shield.worldPosition, RING.denied.murk, RING.denied.thermal, 7, 0.5);
      spawnGlint(shield.worldPosition, RING.denied.murk, RING.denied.thermal, 2.4, 0.22);
    }
    feel.shake(0.4);
  });

  bus.on('beat', ({ isDownbeat }) => {
    beatEnergy = Math.max(beatEnergy, isDownbeat ? 1 : 0.4);
  });

  bus.on('playerhit', () => {
    hurtGlow = 1;
    feel.shake(0.85);
  });

  bus.on('bossphase', ({ phase }) => {
    if (phase === 'exposed') lampsGlow = Math.max(lampsGlow, 0.35);
  });

  bus.on('runstart', () => {
    resetEffects();
    enemyRecords.clear({ dispose: true, pending: true });
    beatEnergy = 0;
    lampsGlow = 0;
    hurtGlow = 0;
  });
}

function flash(record: EnemyRecord, colors: { murk: Color; thermal: Color }, life: number) {
  record.flashMurk.copy(colors.murk);
  record.flashThermal.copy(colors.thermal);
  record.flashLife = life;
  record.flashUntil = elapsedNow + life;
}

/** Lock bracket: four iron jaws clamped onto whatever is being held. */
let bracketGeometry: BufferGeometry | null = null;
let bracketMaterial: MeshBasicNodeMaterial | null = null;

function createBracket(): Group {
  if (!bracketGeometry) {
    const jaws: BufferGeometry[] = [];
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      jaws.push(new RingGeometry(0.92, 1.0, 8, 1, angle - 0.3, 0.6).toNonIndexed());
    }
    jaws.push(new RingGeometry(0.3, 0.36, 14).toNonIndexed());
    bracketGeometry = mergeGeometries(jaws) ?? jaws[0];
    for (const geometry of jaws) geometry.dispose();
  }
  bracketMaterial ??= modalMesh(hdr(LAMP, 2.2), hdr(SIGNAL, 2.6), { swallow: 0.15, additive: true, side: DoubleSide });
  const group = new Group();
  group.add(new Mesh(bracketGeometry, bracketMaterial));
  return group;
}

// --- Per-frame -------------------------------------------------------------

export type VisualContext = {
  scene: Scene;
  camera: Camera;
  feel: CameraFeelRig;
  elapsed: number;
  runProgress: number;
};

export function updateVisuals(dt: number, context: VisualContext) {
  elapsedNow = context.elapsed;
  const sight = vision();
  thermalUniform.value = sight.thermal;
  inkUniform.value = sight.ink;
  beatEnergy = Math.max(0, beatEnergy - dt * 3.4);
  beatUniform.value = beatEnergy;
  lampsGlow = Math.max(0, lampsGlow - dt * 0.85);
  hurtGlow = Math.max(0, hurtGlow - dt * 2.4);
  lampsUniform.value = lampsGlow * 0.32;
  hurtUniform.value = hurtGlow * 0.09;

  // The imager pulls the field of view in as it locks on; the murk breathes
  // with the industrial pulse.
  context.feel.setFovOffset(beatEnergy * 0.9 - sight.thermal * 2.4);

  backdrop.copy(BACKDROP.murk).lerp(BACKDROP.ink, Math.min(1, sight.ink * 1.05));
  backdrop.lerp(BACKDROP.thermal, sight.thermal);
  context.scene.background = backdrop;

  harbour?.update(context.runProgress, dt, context.camera);
  body?.update(octopusPose, context.elapsed, dt);

  // Arms are posed from the creature's shoulders out to the tip the player is
  // actually locking, in the target's own local space.
  for (let index = 0; index < armShapes.length; index += 1) {
    const shape = armShapes[index];
    const pose = octopusPose.arms[index];
    shape.tip.copy(pose.tip);
    shape.bulge.copy(pose.bulge);
    shape.shoulder.copy(pose.shoulder);
    shape.time = context.elapsed;
    shape.thickness = 1.15 + pose.uncoil * 0.35;
    shape.wobble = 0.35 + pose.uncoil * 0.4;
  }

  for (const [enemyId, record] of enemyRecords.entries()) {
    if (!record.mesh.parent) {
      enemyRecords.delete(enemyId, { dispose: true });
      continue;
    }
    if (record.bornAt === null) record.bornAt = elapsedNow;
    const age = elapsedNow - record.bornAt;
    const emergence = record.kind === 'arm' || record.kind === 'core' ? 0.75 : 0.35;
    record.mesh.scale.setScalar(easeOutBack(Math.min(1, age / emergence)));

    if (record.kind === 'arm') {
      const index = record.mesh.userData.armIndex as number | undefined;
      const limb = record.mesh.userData.limb as InstancedMesh | undefined;
      const tip = record.mesh.userData.tip as Group | undefined;
      if (index !== undefined && limb) {
        limbOrigin.copy(record.mesh.position);
        poseLimb(limb, limbOrigin, armShapes[index]);
      }
      if (tip) {
        tip.rotation.z = Math.sin(elapsedNow * 1.7 + (index ?? 0)) * 0.5;
        tip.rotation.x = Math.cos(elapsedNow * 1.1 + (index ?? 0)) * 0.35;
      }
    }

    const denied = (record.mesh.userData.deniedUntil as number | undefined) ?? -Infinity;
    const locked = record.mesh.userData.locked === true;
    if (record.mesh.userData.isLetter === true) {
      if (denied <= elapsedNow) setLetterLocked(record.mesh, locked);
    } else {
      const transient = Math.max(0, (record.flashUntil - elapsedNow) / Math.max(0.01, record.flashLife));
      const deniedAmount = Math.max(0, (denied - elapsedNow) / 0.5);
      if (deniedAmount > 0) {
        paintCreature(record.mesh, { ...FLASH.denied, amount: Math.min(1, deniedAmount) });
      } else if (transient > 0) {
        paintCreature(record.mesh, { murk: record.flashMurk, thermal: record.flashThermal, amount: Math.min(1, transient) });
      } else if (locked) {
        paintCreature(record.mesh, { ...FLASH.lock, amount: 0.42 + Math.sin(elapsedNow * 12) * 0.12 });
      } else {
        paintCreature(record.mesh);
      }
    }

    if (record.bracket) {
      record.mesh.getWorldPosition(record.bracket.position);
      record.bracket.quaternion.copy(context.camera.quaternion);
      record.bracket.rotation.z += dt * 1.4;
      const fit = (record.mesh.userData.lockRadius as number | undefined) ?? 1.8;
      record.bracket.scale.setScalar(fit * (1 + Math.sin(elapsedNow * 10) * 0.04));
    }
  }

  updateEffects(dt, context.camera);
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
