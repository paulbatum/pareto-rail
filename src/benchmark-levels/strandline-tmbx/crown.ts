import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { StrandlineSpawnEntry, StrandlineUpdate } from './gameplay';
import { BEAT_SECONDS, bar } from './timing';
import { PARENT_POS, cameraFrameAt } from './world';

// The parent organism, dug in at the crown where the strands root into the
// bell. It hides in a three-sector cage of its own webbing and pumps a brood
// out of one sector at a time. Clear a brood completely and the sector that
// fed it withers; let any of it slip back into the web and the same sector
// pumps again. With all three sectors dead the parent is bare: two full
// volleys tear it loose. Bar 22 is the deadline — after it the colony holds.
//
// While it is walled in, the parent is part of the crown, not a target: an
// unlockable 'crown' entity sits out of sight and runs the fight's clock, and
// the visuals draw the webbed parent as scenery. The lockable parent only
// exists once it is bare.

export type CrownSpawnData =
  | { role: 'hatchling'; brood: number; sector: number; slot: number; count: number; radius: number; spin: 1 | -1 }
  | { role: 'crown' }
  | { role: 'parent' };

export type CrownPhase = 'waiting' | 'broods' | 'exposed' | 'torn' | 'dead' | 'burrowed';

export type CrownSignal =
  | { type: 'arrive' }
  | { type: 'pump'; sector: number; brood: number; count: number; repump: boolean }
  | { type: 'wither'; sector: number; remaining: number }
  | { type: 'expose' }
  | { type: 'tear' }
  | { type: 'burrow' };

type CrownListener = (signal: CrownSignal) => void;

const channels = new WeakMap<EventBus, Set<CrownListener>>();

/** A side channel for the fight's own beats (pumps, withering), shared by audio and visuals. */
export function crownChannel(bus: EventBus) {
  let listeners = channels.get(bus);
  if (!listeners) {
    listeners = new Set();
    channels.set(bus, listeners);
  }
  const set = listeners;
  return {
    on(listener: CrownListener) {
      set.add(listener);
      return () => set.delete(listener);
    },
    emit(signal: CrownSignal) {
      for (const listener of set) listener(signal);
    },
  };
}

export const CROWN_TIMES = {
  arrive: bar(14.5),
  pumps: [bar(15.25), bar(16.5), bar(17.75)] as const,
  exposeNoEarlierThan: bar(19),
  deadline: bar(22.5),
  sporeBars: [16.25, 17.25, 18.25, 19.25, 21.5].map((b) => bar(b)),
};

const BROOD_ORBITS: ReadonlyArray<{ radii: readonly number[]; spin: 1 | -1 }> = [
  { radii: [13], spin: 1 },
  { radii: [16.5], spin: -1 },
  { radii: [10.5, 19], spin: 1 },
];
const BROOD_SIZE = 6;
const REPUMP_SIZE = 4;
const EMERGE_SECONDS = 0.8;
const ORBIT_BARS = 2.75;
const RETREAT_SECONDS = 1.1;

/** Sector centres on the web, as angles in the parent's facing plane. */
export const SECTOR_ANGLES = [Math.PI / 2, Math.PI / 2 + (Math.PI * 2) / 3, Math.PI / 2 + (Math.PI * 4) / 3];
export const WEB_RADIUS = 9;

/** The authored frame the fight is seen in (the camera has settled by then). */
export function fightFrame() {
  const frame = cameraFrameAt(bar(16));
  return {
    position: frame.position.clone(),
    quaternion: frame.quaternion.clone(),
    forward: frame.forward.clone(),
    right: frame.right.clone(),
    up: frame.up.clone(),
  };
}

const FRAME = fightFrame();
const TO_CAMERA = FRAME.forward.clone().negate();
const FACING = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(FRAME.right, FRAME.up, TO_CAMERA));

/**
 * Where the parent sits and how it faces, shared by the lockable parent and
 * the webbed scenery: seated in the crown facing down the approach, heaving
 * on a four-beat breath; torn half loose it sags and shudders; burrowing it
 * sinks back into the bell.
 */
export function parentPose(time: number, state: { torn: boolean; burrowK: number }, out: { position: Vector3; quaternion: Quaternion }) {
  const heave = Math.sin(time * (Math.PI * 2) / (BEAT_SECONDS * 4)) * 0.25;
  out.position.copy(PARENT_POS).addScaledVector(FRAME.up, heave);
  out.quaternion.copy(FACING);
  if (state.torn) {
    out.position.addScaledVector(FRAME.up, -1.6).addScaledVector(FRAME.right, Math.sin(time * 23) * 0.18);
    out.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.32));
  }
  if (state.burrowK > 0) out.position.addScaledVector(TO_CAMERA, -state.burrowK * 2.4);
  return out;
}

export function sectorPoint(sector: number, out = new Vector3()) {
  const angle = SECTOR_ANGLES[sector];
  return out.copy(PARENT_POS)
    .addScaledVector(FRAME.right, Math.cos(angle) * WEB_RADIUS * 0.62)
    .addScaledVector(FRAME.up, Math.sin(angle) * WEB_RADIUS * 0.62)
    .addScaledVector(TO_CAMERA, WEB_RADIUS * 0.55);
}

export function createCrownEntries() {
  const crownEntry: StrandlineSpawnEntry = {
    time: CROWN_TIMES.arrive,
    kind: 'crown',
    lockable: false,
    countsTowardTotal: false,
    data: { role: 'crown' },
  };
  return { entries: [crownEntry] };
}

type Brood = {
  serial: number;
  sector: number;
  ids: Set<number>;
  total: number;
  killed: number;
  lost: number;
};

export function createCrown(
  bus: EventBus,
  options: {
    spawnSpore(context: StrandlineUpdate, from: Vector3, kick: Vector3): void;
    /** Inspection only: force the parent's death at this run time. */
    rehearseFreedAt?: number;
  },
) {
  const channel = crownChannel(bus);

  let phase: CrownPhase = 'waiting';
  let sectorsAlive = [true, true, true];
  let brood: Brood | null = null;
  let broodSerial = 0;
  let nextSector = 0;
  let nextPumpAt = CROWN_TIMES.pumps[0];
  let exposeAt = -1;
  let parentId = -1;
  let runTime = 0;
  let endingAt = -1;
  let broodsCleared = 0;
  let nextSpore = 0;
  let pendingTearSpores = false;
  let repumpNext = false;
  let parentSpawned = false;

  bus.on('runstart', () => {
    phase = 'waiting';
    sectorsAlive = [true, true, true];
    brood = null;
    broodSerial = 0;
    nextSector = 0;
    nextPumpAt = CROWN_TIMES.pumps[0];
    exposeAt = -1;
    parentId = -1;
    runTime = 0;
    endingAt = -1;
    broodsCleared = 0;
    nextSpore = 0;
    pendingTearSpores = false;
    repumpNext = false;
    parentSpawned = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'crown') {
      phase = 'broods';
      channel.emit({ type: 'arrive' });
      bus.emit('bossphase', { phase: 'summoned' });
    }
    if (kind === 'parent') parentId = enemyId;
    if (kind === 'hatchling' && brood) brood.ids.add(enemyId);
  });

  bus.on('kill', ({ enemyId }) => {
    if (enemyId === parentId) {
      phase = 'dead';
      endingAt = runTime;
      bus.emit('bossphase', { phase: 'destroyed' });
      return;
    }
    if (brood?.ids.has(enemyId)) {
      brood.killed += 1;
      resolveBrood();
    }
  });

  bus.on('miss', ({ enemyId }) => {
    if (brood?.ids.has(enemyId)) {
      brood.lost += 1;
      resolveBrood();
    }
  });

  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== parentId) return;
    phase = 'torn';
    pendingTearSpores = true;
    channel.emit({ type: 'tear' });
  });

  function nextBeatAfter(time: number) {
    return Math.ceil(time / BEAT_SECONDS - 1e-4) * BEAT_SECONDS;
  }

  function resolveBrood() {
    if (!brood || brood.killed + brood.lost < brood.total) return;
    const done = brood;
    brood = null;
    if (done.lost === 0) {
      sectorsAlive[done.sector] = false;
      broodsCleared += 1;
      const remaining = sectorsAlive.filter(Boolean).length;
      channel.emit({ type: 'wither', sector: done.sector, remaining });
      if (remaining === 0) {
        exposeAt = Math.max(CROWN_TIMES.exposeNoEarlierThan, nextBeatAfter(runTime + BEAT_SECONDS * 1.5));
        return;
      }
      nextSector = sectorsAlive.findIndex(Boolean);
      repumpNext = false;
      const floor = CROWN_TIMES.pumps[Math.min(CROWN_TIMES.pumps.length - 1, broodsCleared)];
      nextPumpAt = Math.max(floor, nextBeatAfter(runTime + BEAT_SECONDS * 1.5));
    } else {
      // Some of it slipped back into the web: the same sector pumps again on
      // the next downbeat.
      nextSector = done.sector;
      repumpNext = true;
      nextPumpAt = Math.ceil((runTime + BEAT_SECONDS) / bar(1)) * bar(1);
    }
  }

  function pump(context: StrandlineUpdate) {
    const sector = nextSector;
    const isRepump = repumpNext;
    const count = isRepump ? REPUMP_SIZE : BROOD_SIZE;
    const orbit = BROOD_ORBITS[Math.min(BROOD_ORBITS.length - 1, broodsCleared)];
    broodSerial += 1;
    brood = { serial: broodSerial, sector, ids: new Set(), total: count, killed: 0, lost: 0 };
    channel.emit({ type: 'pump', sector, brood: broodSerial, count, repump: isRepump });
    for (let slot = 0; slot < count; slot += 1) {
      const radius = orbit.radii[slot % orbit.radii.length];
      context.spawnEnemy({
        time: context.runTime,
        kind: 'hatchling',
        data: { role: 'hatchling', brood: broodSerial, sector, slot, count, radius, spin: orbit.spin },
      });
    }
  }

  // The crown's clock. Its own body is out of sight behind the camera; it
  // pumps broods, spits spores, bares the parent, and calls the deadline.
  function updateCrown(context: StrandlineUpdate) {
    runTime = context.runTime;
    if (options.rehearseFreedAt !== undefined && runTime >= options.rehearseFreedAt && phase !== 'dead') {
      phase = 'dead';
      endingAt = runTime;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
    const mesh = context.enemy.mesh;
    mesh.position.copy(context.camera.position).addScaledVector(FRAME.forward, -12);
    mesh.visible = false;

    if (phase === 'broods' && !brood && exposeAt < 0 && runTime >= nextPumpAt) pump(context);

    if (phase === 'broods' && exposeAt >= 0 && runTime >= exposeAt && !parentSpawned) {
      parentSpawned = true;
      phase = 'exposed';
      channel.emit({ type: 'expose' });
      context.spawnEnemy({ time: runTime, kind: 'parent', hitStages: [6, 6], data: { role: 'parent' } });
      bus.emit('bossphase', { phase: 'exposed' });
    }

    // A spore on the second beat of the fight's bars, from the parent's mouth.
    while (nextSpore < CROWN_TIMES.sporeBars.length && runTime >= CROWN_TIMES.sporeBars[nextSpore]) {
      const due = CROWN_TIMES.sporeBars[nextSpore];
      nextSpore += 1;
      if (runTime - due > 0.25 || phase === 'burrowed' || phase === 'dead') continue;
      const side = nextSpore % 2 === 0 ? 1 : -1;
      const kick = FRAME.right.clone().multiplyScalar(side * 3.2).addScaledVector(TO_CAMERA, 3).addScaledVector(FRAME.up, -1.2);
      options.spawnSpore(context, PARENT_POS.clone().addScaledVector(TO_CAMERA, 3.5), kick);
    }
    if (pendingTearSpores) {
      pendingTearSpores = false;
      for (let i = 0; i < 3; i += 1) {
        const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
        const kick = FRAME.right.clone().multiplyScalar(Math.cos(angle) * 4.5)
          .addScaledVector(FRAME.up, Math.sin(angle) * 3.4)
          .addScaledVector(TO_CAMERA, 2.4);
        options.spawnSpore(context, PARENT_POS.clone().addScaledVector(TO_CAMERA, 3), kick);
      }
    }

    if (runTime >= CROWN_TIMES.deadline && (phase === 'broods' || phase === 'exposed' || phase === 'torn')) {
      phase = 'burrowed';
      endingAt = runTime;
      channel.emit({ type: 'burrow' });
    }
    return false;
  }

  function updateParent(context: StrandlineUpdate) {
    runTime = context.runTime;
    const mesh = context.enemy.mesh;
    mesh.userData.crownPhase = phase;
    const burrowK = phase === 'burrowed' ? MathUtils.clamp((runTime - endingAt) / 1.6, 0, 1) : 0;
    parentPose(runTime, { torn: phase === 'torn' || (phase === 'burrowed' && context.enemy.hitStageIndex > 0), burrowK }, mesh);
    // Burrowed back into the bell, it is out of reach for the rest of the run.
    return burrowK >= 1;
  }

  function updateHatchling(context: StrandlineUpdate, data: Extract<CrownSpawnData, { role: 'hatchling' }>) {
    runTime = context.runTime;
    const { enemy, age } = context;
    const mesh = enemy.mesh;
    const origin = sectorPoint(data.sector);
    const beats = age / BEAT_SECONDS;
    const stroke = Math.floor(beats) + 1 - (1 - (beats - Math.floor(beats))) ** 3;
    mesh.userData.jet = beats - Math.floor(beats);
    const angle = (data.slot / data.count) * Math.PI * 2 + SECTOR_ANGLES[data.sector] + data.spin * stroke * 0.3;
    const breathe = 1 + Math.sin(beats * Math.PI) * 0.08;
    const slot = PARENT_POS.clone()
      .addScaledVector(FRAME.right, Math.cos(angle) * data.radius * 1.35 * breathe)
      .addScaledVector(FRAME.up, Math.sin(angle) * data.radius * 0.82 * breathe)
      .addScaledVector(TO_CAMERA, 5 + (data.slot % 2) * 2.5);

    const orbitEnd = EMERGE_SECONDS + bar(ORBIT_BARS);
    const previous = mesh.position.clone();
    if (age < EMERGE_SECONDS) {
      const k = age / EMERGE_SECONDS;
      mesh.position.copy(origin).lerp(slot, 1 - (1 - k) ** 3);
      mesh.userData.emerging = 1 - k;
    } else if (age < orbitEnd && phase !== 'burrowed') {
      mesh.position.copy(slot);
      mesh.userData.emerging = 0;
    } else {
      // Nobody cleared it: it slinks back into the web to feed the sector.
      const k = MathUtils.clamp((age - Math.min(age, orbitEnd)) / RETREAT_SECONDS, 0, 1);
      mesh.position.copy(slot).lerp(origin, phase === 'burrowed' ? 1 : k * k);
      mesh.userData.emerging = k;
      if (k >= 1 || phase === 'burrowed') return true;
    }
    const heading = mesh.position.clone().sub(previous);
    if (heading.lengthSq() > 1e-6) {
      const z = heading.normalize();
      const x = new Vector3().crossVectors(TO_CAMERA, z).normalize();
      const y = new Vector3().crossVectors(z, x);
      mesh.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    }
    return false;
  }

  return {
    updateCrown,
    updateParent,
    updateHatchling,
    endingAt: () => endingAt,
    phase: () => phase,
    outcome(): 'pending' | 'freed' | 'blighted' {
      if (phase === 'dead') return 'freed';
      if (phase === 'burrowed') return 'blighted';
      return 'pending';
    },
    summaryLine() {
      if (phase === 'dead') return 'The parent was torn loose';
      if (phase === 'burrowed') return `The colony held the crown (${broodsCleared}/3 broods cleared)`;
      return `${broodsCleared}/3 broods cleared`;
    },
  };
}
