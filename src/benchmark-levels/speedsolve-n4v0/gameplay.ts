import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
} from '../../engine/hostile-shot';
import type { LockOnEnemy, LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { sortTimeline } from '../../engine/spawn-patterns';
import type { EventBus } from '../../events';
import {
  STICKER_TARGETS_PER_FACE,
  createCubeFight,
  type CoreSpawnData,
  type CubeFight,
  type HubSpawnData,
  type MechanismSpawnData,
  type StickerSpawnData,
} from './cube';
import { FACE_ORDER, attractPose, createOrbitRail, orbitPose, orbitRunProgress, type OrbitPose } from './orbit';
import {
  BEAT_SECONDS,
  EIGHTH_SECONDS,
  FACE_COUNT,
  SPEEDSOLVE_BPM,
  SS_BARS,
  SS_DURATION,
  SS_TIME,
  faceWindowStart,
} from './timing';

// SPEEDSOLVE — one continuous boss fight against a colossal puzzle cube. The
// rail orbits the cube; each four-bar window presents one face, arms a handful
// of wrong stickers as targets, and every kill snaps a layer on the grid. Solve
// the face and it falls away to expose the hub underneath; six faces down and
// the shell blows open around the naked core. The cube fight itself lives in
// cube.ts; this file owns the spawn timeline, the swarm that harasses you while
// you solve, the camera orbit hooks, and scoring.

export { SPEEDSOLVE_BPM, SS_DURATION } from './timing';
export const SPEEDSOLVE_PLAYER_HEALTH = 3;

export type SpeedsolveEnemyKind = 'mechanism' | 'sticker' | 'hub' | 'core' | 'tetra' | 'octa' | 'prism' | 'bolt';
export type SpeedsolveTargetKind = SpeedsolveEnemyKind | 'letter';
export type SwarmKind = 'tetra' | 'octa' | 'prism';

export type SwarmSpawnData = {
  role: 'swarm';
  kind: SwarmKind;
  /** Solve-colour index 0–5 the polyhedron wears. */
  color: number;
  /** tetra: vertical lane; octa: start angle; prism: corner index. */
  lane: number;
  side: 1 | -1;
  /** Seconds on screen before the enemy leaves (and counts as missed). */
  life: number;
  /** prism: bolts fired during its hold. */
  shots: number;
};

export type BoltSpawnData = {
  role: 'bolt';
  position: Vector3;
  velocity: Vector3;
  lastAge: number;
  color: number;
  impactAt?: number;
  impactDirection?: Vector3;
  interceptUntil?: number;
};

export type SpeedsolveSpawnData =
  | MechanismSpawnData
  | StickerSpawnData
  | HubSpawnData
  | CoreSpawnData
  | SwarmSpawnData
  | BoltSpawnData;
export type SpeedsolveSpawnEntry = LockOnSpawnEntry<SpeedsolveEnemyKind, SpeedsolveSpawnData>;
export type SpeedsolveUpdate = LockOnEnemyUpdate<SpeedsolveEnemyKind, SpeedsolveSpawnData>;
type SpeedsolveEnemy = LockOnEnemy<SpeedsolveEnemyKind, SpeedsolveSpawnData>;

// ---- swarm geometry (camera space: x right, y up, depth forward) -------------

const TETRA_DEPTH = 15;
const TETRA_SPAN = 25;
const TETRA_LIFE = 2.7;
const OCTA_DEPTH = 15.5;
const OCTA_RADIUS_X = 13;
const OCTA_RADIUS_Y = 7.7;
const OCTA_LIFE = 3.3;
const OCTA_SPEED = 0.72;
const PRISM_DEPTH = 17;
const PRISM_LIFE = 3.9;
const PRISM_CORNERS: ReadonlyArray<readonly [number, number]> = [[12.5, 6.6], [-12.5, 6.6], [12.5, -6.6], [-12.5, -6.6]];
const BOLT_MAX_AGE = 12;

// ---- timeline ------------------------------------------------------------------

const beatAt = (window: number, beat: number) => faceWindowStart(window) + beat * BEAT_SECONDS;

function stickers(window: number): SpeedsolveSpawnEntry[] {
  const count = STICKER_TARGETS_PER_FACE[window];
  return Array.from({ length: count }, (_, index) => ({
    time: faceWindowStart(window) + index * EIGHTH_SECONDS,
    kind: 'sticker' as const,
    data: { role: 'sticker', window, index } as StickerSpawnData,
  }));
}

function swarm(kind: SwarmKind, time: number, color: number, lane: number, side: 1 | -1, life: number, shots = 0): SpeedsolveSpawnEntry {
  return { time, kind, data: { role: 'swarm', kind, color, lane, side, life, shots } };
}

function tetras(time: number, lanes: number[], side: 1 | -1, color: number): SpeedsolveSpawnEntry[] {
  return lanes.map((lane, index) => swarm('tetra', time + index * EIGHTH_SECONDS, (color + index) % 6, lane, side, TETRA_LIFE));
}

function octas(time: number, count: number, color: number, spin: 1 | -1 = 1): SpeedsolveSpawnEntry[] {
  return Array.from({ length: count }, (_, index) => swarm(
    'octa',
    time + index * EIGHTH_SECONDS,
    (color + index * 2) % 6,
    (index / count) * Math.PI * 2 + 0.4,
    spin,
    OCTA_LIFE,
  ));
}

function prisms(time: number, corners: number[], color: number, shots = 2): SpeedsolveSpawnEntry[] {
  return corners.map((corner, index) => swarm('prism', time + index * EIGHTH_SECONDS, (color + index * 3) % 6, corner, 1, PRISM_LIFE, shots));
}

function createTimeline(): SpeedsolveSpawnEntry[] {
  const entries: SpeedsolveSpawnEntry[] = [
    { time: 0, kind: 'mechanism', countsTowardTotal: false, lockable: false, data: { role: 'mechanism' } },
  ];
  for (let window = 0; window < FACE_COUNT; window += 1) entries.push(...stickers(window));

  // The swarm never lets you solve in peace. Each window's escort is authored
  // against the beat: darts sweep on the fourth beat, orbiters ring the face
  // from the eighth, gunners take a corner and shoot back before the swing.
  // Colours avoid the face being solved so the wrong stickers stay legible.
  const avoid = (window: number, offset: number) => {
    const face = FACE_ORDER[window];
    const color = (face + offset) % 6;
    return color === face ? (color + 1) % 6 : color;
  };

  entries.push(
    // Window 1 — learn the face: a dart pair over the top, three orbiters.
    ...tetras(beatAt(0, 4), [7.6, -7.4], 1, avoid(0, 1)),
    ...octas(beatAt(0, 7.5), 3, avoid(0, 2)),

    // Window 2 — the first gunner.
    ...tetras(beatAt(1, 3.5), [-7.6, 7.2], -1, avoid(1, 3)),
    ...prisms(beatAt(1, 5), [0], avoid(1, 4)),
    ...octas(beatAt(1, 8), 3, avoid(1, 1), -1),

    // Window 3 — three darts stagger down the screen, a gunner low-left.
    ...tetras(beatAt(2, 3), [7.8, 0.4, -7.6], 1, avoid(2, 2)),
    ...octas(beatAt(2, 6), 3, avoid(2, 5)),
    ...prisms(beatAt(2, 8.5), [3], avoid(2, 1)),

    // Window 4 — two gunners open the window, darts cross late.
    ...prisms(beatAt(3, 3.5), [1, 2], avoid(3, 3)),
    ...tetras(beatAt(3, 7), [-7.8, 7.4], -1, avoid(3, 1)),
    ...octas(beatAt(3, 9), 3, avoid(3, 4), -1),

    // Window 5 — the top face: darts skim, orbiters ring, one gunner.
    ...tetras(beatAt(4, 3), [7.6, -7.6], 1, avoid(4, 2)),
    ...octas(beatAt(4, 5.5), 3, avoid(4, 5)),
    ...prisms(beatAt(4, 8.5), [0], avoid(4, 1)),

    // Window 6 — the bottom face, the heaviest escort before the finale.
    ...tetras(beatAt(5, 3), [-7.6, 0.6, 7.8], -1, avoid(5, 3)),
    ...prisms(beatAt(5, 5.5), [2, 1], avoid(5, 2)),
    ...octas(beatAt(5, 8.5), 3, avoid(5, 4), -1),

    // Finale — the exposed core's last defenders, thin enough to leave the
    // core itself as the star.
    ...octas(SS_TIME.bar(SS_BARS.finale, 2), 3, 0),
    ...tetras(SS_TIME.bar(SS_BARS.finale + 1, 2), [7.6, -7.6], 1, 2),
    ...prisms(SS_TIME.bar(SS_BARS.finale + 2, 1), [3], 4),
    ...tetras(SS_TIME.bar(SS_BARS.finale + 3, 2), [-7.8, 7.4], -1, 1),
    ...octas(SS_TIME.bar(SS_BARS.lastStretch, 0.5), 3, 3, -1),
  );
  return sortTimeline(entries);
}

export const SPEEDSOLVE_TIMELINE: SpeedsolveSpawnEntry[] = createTimeline();

const KILL_SCORE: Record<SpeedsolveEnemyKind, number> = {
  mechanism: 0,
  sticker: 120,
  hub: 600,
  core: 3000,
  tetra: 100,
  octa: 100,
  prism: 160,
  bolt: 40,
};
const HUB_SPEED_BONUS_PER_SECOND = 60;
const CLEAN_VOLLEY_BONUS = 300;

// ---- camera math ------------------------------------------------------------------

const scratchMatrix = new Matrix4();
const CAMERA_UP = new Vector3(0, 1, 0);

function lookAtQuaternion(out: Quaternion, eye: Vector3, target: Vector3) {
  scratchMatrix.lookAt(eye, target, CAMERA_UP);
  return out.setFromRotationMatrix(scratchMatrix);
}

function smoothstep(x: number) {
  const t = MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

export type SpeedsolveGameplay = LockOnRunnerLevel<SpeedsolveEnemyKind, SpeedsolveSpawnData> & {
  fight: CubeFight;
  pose: () => OrbitPose;
};

export function createSpeedsolveGameplay(bus: EventBus): SpeedsolveGameplay {
  const fight = createCubeFight(bus);
  const boltInterceptions = new Set<number>();
  let currentPose: OrbitPose = attractPose(0);
  const attract = { position: attractPose(0).position.clone(), forward: new Vector3(0, 0, -1) };
  const baseQuaternion = new Quaternion();
  const delta = new Quaternion();
  const authored = new Quaternion();
  const basePosition = new Vector3();
  const baseTarget = new Vector3();
  const scratch = new Vector3();
  const forward = new Vector3();
  const right = new Vector3();
  const up = new Vector3();

  bus.on('runstart', () => {
    boltInterceptions.clear();
  });
  bus.on('fire', ({ enemyId }) => {
    boltInterceptions.add(enemyId);
  });
  bus.on('kill', ({ enemyId }) => {
    boltInterceptions.delete(enemyId);
  });
  bus.on('miss', ({ enemyId }) => {
    boltInterceptions.delete(enemyId);
  });

  function cameraBasis(camera: SpeedsolveUpdate['camera']) {
    camera.getWorldDirection(forward);
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  }

  function placeInView(context: SpeedsolveUpdate, x: number, y: number, depth: number) {
    const { enemy, camera } = context;
    cameraBasis(camera);
    enemy.mesh.position.copy(camera.position)
      .addScaledVector(forward, depth)
      .addScaledVector(right, x)
      .addScaledVector(up, y);
  }

  function fireBolt(context: SpeedsolveUpdate, from: Vector3, color: number) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(4);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, color },
    });
  }

  function updateSwarm(context: SpeedsolveUpdate, data: SwarmSpawnData) {
    const { enemy, age, camera, runTime } = context;
    enemy.mesh.userData.color = data.color;
    switch (data.kind) {
      case 'tetra': {
        // A dart: enters off one edge, arcs across the view in front of the
        // cube and exits the other side. Being passed is the miss.
        const s = age / data.life;
        const x = data.side * MathUtils.lerp(-TETRA_SPAN, TETRA_SPAN, s);
        const bob = Math.sin(s * Math.PI) * (data.lane > 0 ? -1.6 : 1.6);
        const y = data.lane + bob + Math.sin(age * 5.2 + enemy.id) * 0.35;
        const depth = TETRA_DEPTH - Math.sin(s * Math.PI) * 3.2;
        placeInView(context, x, y, depth);
        enemy.mesh.quaternion.copy(camera.quaternion);
        enemy.mesh.rotateZ(data.side * age * 6.5);
        enemy.mesh.rotateX(age * 3.1 + enemy.id);
        return s >= 1;
      }
      case 'octa': {
        // An orbiter: rings the face on a wide ellipse, breathes on the beat,
        // then slings itself outward when its time is up.
        const leaving = Math.max(0, (age - (data.life - 0.55)) / 0.55);
        const grow = 1 + leaving * leaving * 2.4;
        const angle = data.lane + data.side * age * OCTA_SPEED;
        const pulse = 1 + Math.sin((runTime * Math.PI * 2) / BEAT_SECONDS) * 0.04;
        const x = Math.cos(angle) * OCTA_RADIUS_X * grow * pulse;
        const y = Math.sin(angle) * OCTA_RADIUS_Y * grow * pulse;
        placeInView(context, x, y, OCTA_DEPTH - Math.sin(age * 1.7 + enemy.id) * 1.2);
        enemy.mesh.quaternion.copy(camera.quaternion);
        enemy.mesh.rotateY(age * 2.4 + enemy.id * 0.7);
        enemy.mesh.rotateZ(Math.sin(age * 1.3) * 0.5);
        return age >= data.life;
      }
      case 'prism': {
        // A gunner: slides in from its corner, holds, telegraphs with a lunge
        // toward the camera before each shot, then retreats off-screen.
        const corner = PRISM_CORNERS[data.lane % PRISM_CORNERS.length];
        const enter = smoothstep(age / 0.55);
        const leave = smoothstep((age - (data.life - 0.5)) / 0.5);
        const offscreen = 1.7;
        const slide = MathUtils.lerp(offscreen, 1, enter) * MathUtils.lerp(1, offscreen, leave);
        const fire = context.enemyState(() => ({ shotsLeft: data.shots, nextAt: 1.4 }));
        const timeToShot = fire.nextAt - age;
        const telegraph = fire.shotsLeft > 0 && timeToShot < 0.6 && timeToShot > 0 ? 1 - timeToShot / 0.6 : 0;
        const depth = PRISM_DEPTH - telegraph * 2.2;
        placeInView(context, corner[0] * slide, corner[1] * slide + Math.sin(age * 2.2) * 0.4, depth);
        enemy.mesh.quaternion.copy(camera.quaternion);
        enemy.mesh.rotateZ(Math.sin(age * 1.1 + enemy.id) * 0.25);
        enemy.mesh.rotateX(age * 1.6);
        enemy.mesh.userData.telegraph = telegraph;
        if (fire.shotsLeft > 0 && age >= fire.nextAt) {
          fire.shotsLeft -= 1;
          fire.nextAt = age + 1.45;
          fireBolt(context, enemy.mesh.position, data.color);
        }
        return age >= data.life;
      }
    }
  }

  function updateBolt(context: SpeedsolveUpdate, data: BoltSpawnData) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;
    enemy.mesh.userData.color = data.color;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data,
      intercepted: boltInterceptions.delete(enemy.id),
      config: { hitDistance: 3.4, impactBrake: 0.34, damageDistance: 1.6 },
    });
    if (impact.phase === 'braking') {
      enemy.mesh.position.copy(data.position);
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 9);
      if (impact.damaged) {
        damagePlayer(1);
        return true;
      }
      return false;
    }

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 4.5,
      maxSpeed: 10.5,
      accel: 3,
      turnRate: 2.1,
    });
    enemy.mesh.position.copy(data.position);
    enemy.mesh.rotation.set(age * 2.7, age * 3.9, age * 1.3);
    return shotBehindCamera(camera, data.position) || age > BOLT_MAX_AGE;
  }

  const level: SpeedsolveGameplay = {
    duration: SS_DURATION,
    bpm: SPEEDSOLVE_BPM,
    playerHealth: SPEEDSOLVE_PLAYER_HEALTH,
    startWord: 'SOLVE',
    replayWord: 'REPLAY',
    createRail: createOrbitRail,
    spawnTimeline: SPEEDSOLVE_TIMELINE,
    easeRunProgress: orbitRunProgress,
    // Speedsolve is quick: cap the impact grid at a half bar so a six-lock
    // volley resolves inside two beats and the layer snaps read as a roll.
    timing: { shotDelay: { maxGridSeconds: BEAT_SECONDS * 2 } },
    fight,
    pose: () => currentPose,

    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'mechanism':
          return fight.updateMechanism(context);
        case 'sticker':
          return fight.updateSticker(context, data);
        case 'hub':
          return fight.updateHub(context, data);
        case 'core':
          return fight.updateCore(context);
        case 'swarm':
          return updateSwarm(context, data);
        case 'bolt':
          return updateBolt(context, data);
      }
    },

    // The runner looks along the rail; this level looks at the cube. Extract
    // the edge-look rotation the runner applied on top of its own base pose,
    // then rebuild the pose around the orbit model and re-apply that rotation.
    updateAttractCamera({ camera, modeTime }) {
      const pose = attractPose(modeTime);
      currentPose = pose;
      camera.position.copy(pose.position);
      lookAtQuaternion(camera.quaternion, camera.position, pose.aim);
      attract.position.copy(pose.position);
      attract.forward.copy(pose.aim).sub(pose.position).normalize();
      camera.updateMatrixWorld();
    },

    updateCameraEffects({ camera, curve, runTime, runProgress }) {
      const eased = smoothstep(Math.min(1, runTime));
      basePosition.copy(attract.position).lerp(curve.getPointAt(runProgress), eased);
      baseTarget.copy(attract.position).add(attract.forward).lerp(curve.getPointAt(MathUtils.clamp(runProgress + 0.025, 0, 1)), eased);
      lookAtQuaternion(baseQuaternion, basePosition, baseTarget);
      delta.copy(baseQuaternion).invert().multiply(camera.quaternion);

      const pose = orbitPose(runTime);
      currentPose = pose;
      scratch.copy(attract.position).lerp(pose.position, eased);
      camera.position.copy(scratch);
      lookAtQuaternion(authored, camera.position, pose.aim);
      camera.quaternion.copy(authored).multiply(delta);
      camera.updateMatrixWorld();
    },

    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.15;
      let base = KILL_SCORE[enemy.kind];
      if (enemy.kind === 'hub') base += Math.round(fight.hubBonusSeconds(enemy.id) * HUB_SPEED_BONUS_PER_SECOND);
      if (enemy.kind === 'core') base += Math.round(Math.max(0, SS_DURATION - fight.runTime) * 120);
      return Math.round(base * multiplier);
    },
    scoreForHit: (_volleySize, enemy) => (enemy.kind === 'core' ? 90 : 50),
    scoreForVolley(results) {
      // A clean six-for-six volley is the level's signature moment: the music
      // applauds it and the scoreboard does too.
      if (results.length < 6 || !results.every((result) => result.killed)) return 0;
      return CLEAN_VOLLEY_BONUS;
    },
    rankForRun(score) {
      const solved = fight.facesSolved();
      const coreDown = fight.core.killed;
      if (solved >= 6 && coreDown && score >= 16000) return 'S';
      if (solved >= 5 && coreDown) return 'A';
      if (coreDown || solved >= 4) return 'B';
      if (solved >= 2) return 'C';
      return 'D';
    },
    detailsForRun() {
      const solved = fight.facesSolved();
      const lines = [`Faces ${solved}/${FACE_COUNT}`];
      const splits = fight.splits();
      if (splits.length > 0) lines.push(`Best split ${Math.min(...splits).toFixed(2)}s`);
      lines.push(fight.core.killed ? 'Core destroyed' : fight.core.spawned ? 'Core escaped' : 'Core sealed');
      lines.push(`Hull ${Math.max(0, SPEEDSOLVE_PLAYER_HEALTH - fight.hitsTaken)}/${SPEEDSOLVE_PLAYER_HEALTH}`);
      return lines;
    },
  };

  return level;
}

export type { SpeedsolveEnemy };
