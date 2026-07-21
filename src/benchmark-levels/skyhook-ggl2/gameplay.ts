import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import { offsetFromRail, sampleRailFrame } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { createDescender, DESCENDER_STAGES } from './descender';

// SKYHOOK — a 64-second climb up a space elevator, riding the climber car from
// the weather to the station. 120 BPM, 32 bars, 2s per bar = exactly 64s, which
// lands the docking on a clean 8-bar phrase boundary. Four movements:
//
//   Weather (0–16s / bars 0–8)   Storm grey, in the cloud deck. Wind-riding
//                                 kites and drifting mines. Music at its widest.
//   Blue    (16–32s / bars 8–16) Punch through the deck (bar 8) into sunlit
//                                 blue; ground drops away, first husks and the
//                                 first grapnels that go for the car.
//   Thin    (32–40s / bars 16–20) Sky to indigo, stars come out, air thins. The
//                                 mix loses layers; vacuum-hardened enemies.
//   Descent (40–60s / bars 20–30) The Descender latches onto the tether high
//                                 above and climbs down toward the car, getting
//                                 bigger. Kill it before it reaches the car.
//   Dock    (60–64s / bars 30–32) Station opens overhead, swallows the car,
//                                 everything decelerates and goes quiet, docked.
//
// The rail is a diagonal ascent (climbing +y while running −z), so the whole
// world visibly falls away beneath the car as the run climbs.

export const SKYHOOK_GGL2_BPM = 120;
export const SKYHOOK_GGL2_STEPS_PER_BAR = 16;
export const SKYHOOK_GGL2_TIME = createMusicTime(SKYHOOK_GGL2_BPM, { stepsPerBar: SKYHOOK_GGL2_STEPS_PER_BAR });
export const bar = SKYHOOK_GGL2_TIME.bar;

export const SKYHOOK_BARS = {
  launch: 0,
  cloudbreak: 8,
  blue: 8,
  thin: 16,
  descent: 20,
  dockApproach: 28,
  dock: 30,
  end: 32,
} as const;

export const SKYHOOK_MARKERS = SKYHOOK_GGL2_TIME.markers({
  launch: SKYHOOK_BARS.launch,
  cloudbreak: SKYHOOK_BARS.cloudbreak,
  thin: SKYHOOK_BARS.thin,
  descent: SKYHOOK_BARS.descent,
  dockApproach: SKYHOOK_BARS.dockApproach,
  dock: SKYHOOK_BARS.dock,
  end: SKYHOOK_BARS.end,
});

export const SKYHOOK_GGL2_RUN_DURATION = SKYHOOK_MARKERS.end;
export const CLOUDBREAK_TIME = SKYHOOK_MARKERS.cloudbreak;
export const THIN_TIME = SKYHOOK_MARKERS.thin;
export const DESCENT_TIME = SKYHOOK_MARKERS.descent;
export const DOCK_TIME = SKYHOOK_MARKERS.dock;

export const SKYHOOK_PLAYER_HEALTH = 5;

export const SKYHOOK_RUN_SECTIONS = [
  { name: 'weather', fromBar: SKYHOOK_BARS.launch, toBar: SKYHOOK_BARS.cloudbreak },
  { name: 'blue', fromBar: SKYHOOK_BARS.blue, toBar: SKYHOOK_BARS.thin },
  { name: 'thin', fromBar: SKYHOOK_BARS.thin, toBar: SKYHOOK_BARS.descent },
  { name: 'descent', fromBar: SKYHOOK_BARS.descent, toBar: SKYHOOK_BARS.dock },
  { name: 'dock', fromBar: SKYHOOK_BARS.dock, toBar: SKYHOOK_BARS.end },
] as const;

export type SkyhookGgl2EnemyKind = 'pod' | 'kite' | 'husk' | 'grapnel' | 'bolt' | 'descender';

export type SkyhookGgl2SpawnData =
  | { role: 'pod'; lead: number; offset: Vector3; spin: number }
  | { role: 'kite'; lead: number; fromX: number; toX: number; y: number; arc: number; crossTime: number; delay: number }
  | { role: 'husk'; lead: number; offset: Vector3; seed: number }
  | { role: 'grapnel'; lead: number; side: number; y: number; closeTime: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState; biasX: number; biasY: number }
  | { role: 'boss' };

export type SkyhookSpawnEntry = LockOnSpawnEntry<SkyhookGgl2EnemyKind, SkyhookGgl2SpawnData>;
export type SkyhookUpdate = LockOnEnemyUpdate<SkyhookGgl2EnemyKind, SkyhookGgl2SpawnData>;

// ---- speed profile → rail easing -------------------------------------------

// 1.0 ≈ cruise. Heavy in the weather, a real kick punching through the cloud
// deck, fast and light in the thin air, steady through the boss, then a hard
// decel into the station so docking reads as arrival.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.62],
  [bar(6), 0.86],
  [bar(7, 3.4), 1.0],
  [bar(8, 0.2), 1.85],
  [bar(9, 2.0), 1.18],
  [bar(15), 1.28],
  [bar(16, 1.0), 1.34],
  [bar(20), 1.06],
  [bar(27), 1.02],
  [bar(29, 2.0), 0.9],
  [bar(30, 1.0), 0.28],
  [bar(31, 2.0), 0.12],
  [bar(32), 0.06],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, SKYHOOK_GGL2_RUN_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function skyhookRunProgress(time: number, duration = SKYHOOK_GGL2_RUN_DURATION) {
  return speedProfile.runProgress(time, duration);
}

/** Rail parameter the camera occupies at run time `t` — for placing set pieces. */
export const railU = (time: number) => skyhookRunProgress(time);

// ---- rail ------------------------------------------------------------------

// A diagonal climb: running forward (−z) while gaining altitude (+y), with a
// gentle side sway so the car banks. The world (ground, cloud deck, planet)
// sits far below and falls away as the run climbs.
export function createSkyhookGgl2Rail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 1, 0),
      new Vector3(4, 9, -48),
      new Vector3(-7, 20, -98),
      new Vector3(6, 33, -150),
      new Vector3(-6, 48, -205),
      new Vector3(9, 66, -262),
      new Vector3(-9, 84, -320),
      new Vector3(7, 104, -378),
      new Vector3(-6, 126, -436),
      new Vector3(8, 148, -494),
      new Vector3(-7, 172, -552),
      new Vector3(6, 197, -610),
      new Vector3(-5, 223, -668),
      new Vector3(4, 250, -726),
      new Vector3(-3, 278, -784),
      new Vector3(2, 306, -840),
      new Vector3(0, 336, -894),
    ],
    false,
    'catmullrom',
    0.4,
  );
}

// The tether runs straight up the middle of the rail; the station caps the top.
// Exported so the environment and gameplay agree on where "up the cable" is.
export const TETHER_TOP = new Vector3(0, 372, -940);

// ---- spawn timeline --------------------------------------------------------

// Static formations are seated a little closer than the crossing enemies so
// their spread reads wider on screen (a fixed anchor at lead L sits ~L seconds
// ahead; closer anchors give the same world offset a larger screen offset).
const ANCHOR_LEAD_SCALE = 0.72;

const pods = (time: number, lead: number, spin: number, offsets: Array<[number, number]>): SkyhookSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.12,
    kind: 'pod',
    data: { role: 'pod', lead: lead * ANCHOR_LEAD_SCALE, spin, offset: new Vector3(offset[0], offset[1], 0) },
  }));

const kites = (
  time: number,
  lead: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc: number; delay?: number; crossTime?: number }>,
): SkyhookSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.1,
    kind: 'kite',
    data: {
      role: 'kite',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arc: run.arc,
      delay: run.delay ?? index * 0.4,
      crossTime: run.crossTime ?? 2.5,
    },
  }));

const husks = (time: number, lead: number, offsets: Array<[number, number]>): SkyhookSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.22,
    kind: 'husk',
    data: { role: 'husk', lead: lead * ANCHOR_LEAD_SCALE, seed: index * 2.31 + time, offset: new Vector3(offset[0], offset[1], 0) },
  }));

const grapnels = (time: number, entries: Array<[side: number, y: number]>, closeTime = 4.6): SkyhookSpawnEntry[] =>
  entries.map(([side, y], index) => ({
    time: time + index * 0.35,
    kind: 'grapnel',
    hitPoints: 2,
    data: { role: 'grapnel', lead: 3.8, side, y, closeTime },
  }));

function buildTimeline(bossEntries: SkyhookSpawnEntry[]): SkyhookSpawnEntry[] {
  return [
    // --- Weather (bars 0–8): learn the sweep among drifting mines and wind kites.
    // Offsets fan across the full width and height — low, high, and to the edges.
    ...pods(bar(1), 3.4, 0.3, [[-11, -3], [-5, 6], [5, 8], [11, 0]]),
    ...kites(bar(3), 3.4, [
      { fromX: -20, toX: 20, y: 7, arc: 2.6, crossTime: 2.2 },
      { fromX: 20, toX: -20, y: -4, arc: 2, crossTime: 2.2 },
      { fromX: -20, toX: 20, y: 2, arc: 3.4, crossTime: 2.2 },
    ]),
    ...pods(bar(5), 3.4, -0.34, [[-12, 2], [-6, -4], [0, 9], [6, -3], [12, 3]]),
    ...kites(bar(6, 2), 3.3, [
      { fromX: -22, toX: 22, y: -2, arc: 3, crossTime: 2.2, delay: 0 },
      { fromX: 22, toX: -22, y: 6, arc: 2.2, crossTime: 2.2, delay: 0.32 },
      { fromX: -22, toX: 22, y: 10, arc: 1.6, crossTime: 2.2, delay: 0.64 },
    ]),

    // (bars 7.5–8.3: screen kept clear for the cloud-deck break)

    // --- Blue (bars 8–16): out of the deck, ground drops away. Car threats arrive.
    ...pods(bar(9), 3.4, 0.42, [[-11, 5], [-5, -3], [2, 10], [7, 1], [12, 6]]),
    ...kites(bar(10, 2), 3.3, [
      { fromX: -24, toX: 24, y: -3, arc: 3.4, crossTime: 2.1, delay: 0 },
      { fromX: 24, toX: -24, y: 4, arc: 2.6, crossTime: 2.1, delay: 0.3 },
      { fromX: -24, toX: 24, y: 9, arc: 1.8, crossTime: 2.1, delay: 0.6 },
      { fromX: 24, toX: -24, y: 1, arc: 3, crossTime: 2.1, delay: 0.9 },
    ]),
    ...husks(bar(12), 3.6, [[-10, 6], [9, -3]]),
    ...grapnels(bar(12, 2), [[-1, 1.2], [1, 3.8]]),
    ...pods(bar(14), 3.4, -0.4, [[-12, -2], [-5, 7], [5, -4], [12, 4]]),
    ...kites(bar(14, 2), 3.3, [
      { fromX: -24, toX: 24, y: 8, arc: 2.8, crossTime: 2.1, delay: 0 },
      { fromX: 24, toX: -24, y: -3, arc: 2.2, crossTime: 2.1, delay: 0.34 },
    ]),
    ...husks(bar(15, 2), 3.5, [[-7, 9]]),

    // --- Thin (bars 16–20): indigo, stars, vacuum-hardened. Air loses layers.
    ...husks(bar(16, 2), 3.6, [[-10, 3], [9, 7]]),
    ...grapnels(bar(17), [[-1, 2.6], [1, 1.0], [-1, 4.4]], 4.0),
    ...kites(bar(18), 3.2, [
      { fromX: -24, toX: 24, y: -3, arc: 3.4, crossTime: 2.0, delay: 0 },
      { fromX: 24, toX: -24, y: 5, arc: 2.6, crossTime: 2.0, delay: 0.3 },
      { fromX: -24, toX: 24, y: 10, arc: 1.6, crossTime: 2.0, delay: 0.6 },
    ]),
    ...husks(bar(19), 3.4, [[-8, -2], [7, 8]]),

    // --- Descent (bars 20–29): the Descender fills the sky. Screen management.
    ...bossEntries,
    ...husks(bar(21, 2), 3.5, [[-10, 7], [9, -3]]),
    ...grapnels(bar(23), [[-1, 2.8], [1, 1.4]], 3.8),
    ...husks(bar(24, 2), 3.4, [[8, 6]]),
    ...kites(bar(25, 2), 3.2, [
      { fromX: -24, toX: 24, y: -2, arc: 3, crossTime: 2.0, delay: 0 },
      { fromX: 24, toX: -24, y: 8, arc: 2, crossTime: 2.0, delay: 0.32 },
    ]),
    ...grapnels(bar(26, 2), [[1, 2.4], [-1, 3.6]], 3.6),
    ...husks(bar(28), 3.4, [[-9, 8], [8, -2]]),

    // (bars 29–32: clear for the docking — station swallows the car, quiet)
  ];
}

export function createSkyhookTimeline() {
  const bossEntries = createDescenderEntries(DESCENT_TIME);
  return {
    bossEntry: bossEntries.bossEntry,
    timeline: buildTimeline(bossEntries.timeline).sort((a, b) => a.time - b.time),
  };
}

function createDescenderEntries(time: number): { bossEntry: SkyhookSpawnEntry; timeline: SkyhookSpawnEntry[] } {
  const bossEntry: SkyhookSpawnEntry = {
    time,
    kind: 'descender',
    hitStages: DESCENDER_STAGES,
    data: { role: 'boss' },
  };
  return { bossEntry, timeline: [bossEntry] };
}

export const SKYHOOK_GGL2_TIMELINE: SkyhookSpawnEntry[] = createSkyhookTimeline().timeline;

const KILL_SCORE: Record<SkyhookGgl2EnemyKind, number> = {
  pod: 100,
  kite: 130,
  husk: 190,
  grapnel: 240,
  bolt: 45,
  descender: 2400,
};

const BOLT_MAX_AGE = 12;

export function createSkyhookGgl2Gameplay(
  bus: EventBus,
): LockOnRunnerLevel<SkyhookGgl2EnemyKind, SkyhookGgl2SpawnData> {
  const { timeline, bossEntry } = createSkyhookTimeline();

  const interceptions = new Set<number>();
  const grapnelIds = new Set<number>();
  let hitsTaken = 0;
  let grapnelsStopped = 0;
  let carHits = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    grapnelIds.clear();
    hitsTaken = 0;
    grapnelsStopped = 0;
    carHits = 0;
  });
  bus.on('playerhit', () => {
    hitsTaken += 1;
  });
  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'grapnel') grapnelIds.add(enemyId);
  });
  bus.on('fire', ({ enemyId }) => interceptions.add(enemyId));
  bus.on('kill', ({ enemyId }) => {
    interceptions.delete(enemyId);
    if (grapnelIds.delete(enemyId)) grapnelsStopped += 1;
  });
  bus.on('miss', ({ enemyId }) => {
    interceptions.delete(enemyId);
    grapnelIds.delete(enemyId);
  });

  // Incoming shots aim just off the car's centre, spread out, so a volley of
  // debris fans across the view instead of stacking on the reticle — still a
  // hit if it lands, but it reads as a spray, not a single point.
  function fireBolt(context: SkyhookUpdate, from: Vector3, speed = 5) {
    const biasX = Math.sin(from.x * 1.7 + context.runTime * 3.1) * 0.5;
    const biasY = Math.sin(from.y * 1.3 + context.runTime * 2.3) * 0.4;
    const aim = boltAimPoint(context.camera, from, biasX, biasY);
    const initial = aim.sub(from).normalize().multiplyScalar(speed);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {}, biasX, biasY },
    });
  }

  // The lateral bias scales with depth, so a bolt fans out to the side while it
  // is far (spreading intercept kills across the view) but converges back toward
  // the car's centre as it closes in, so it still lands if it is not shot down.
  const boltForward = new Vector3();
  function boltAimPoint(camera: SkyhookUpdate['camera'], from: Vector3, biasX: number, biasY: number) {
    const aim = hostileShotAimPoint(camera, from);
    camera.getWorldDirection(boltForward);
    const depth = Math.max(0, from.clone().sub(camera.position).dot(boltForward));
    const scale = Math.min(depth, 24) * 0.3;
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    return aim.addScaledVector(right, biasX * scale).addScaledVector(up, biasY * scale);
  }

  const descender = createDescender(bus, { bossEntry, fireBolt, onCarHit: () => (carHits += 1) });

  // ---- movement -------------------------------------------------------------

  function updatePod(context: SkyhookUpdate, data: Extract<SkyhookGgl2SpawnData, { role: 'pod' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // The formation wheels slowly around its centre while each mine bobs and
    // tumbles — a field of drifting hazards, not a static wall.
    const angle = age * data.spin;
    const breathe = 1 + Math.sin(age * 1.1 + enemy.id) * 0.05;
    const x = (data.offset.x * Math.cos(angle) - data.offset.y * Math.sin(angle)) * breathe;
    const y = (data.offset.x * Math.sin(angle) + data.offset.y * Math.cos(angle)) * breathe + 1.4;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, 0)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * (0.4 + (enemy.id % 3) * 0.12) + enemy.id * 1.7);
    enemy.mesh.rotateX(Math.sin(age * 0.8 + enemy.id) * 0.4);
    return runProgress > anchorU + 0.012;
  }

  function updateKite(context: SkyhookUpdate, data: Extract<SkyhookGgl2SpawnData, { role: 'kite' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.15 || runProgress > anchorU + 0.012) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    // Wind arc plus a slower sway — riding the gusts across the deck.
    const y = data.y + Math.sin(clamped * Math.PI) * data.arc + Math.sin(age * 1.6 + enemy.id) * 0.5;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 2.4 + enemy.id) * 0.4)));
    // Nose into the direction of travel and bank hard into the turn.
    const ahead = offsetFromRail(curve, anchorU, new Vector3(
      MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.05)),
      data.y + Math.sin(Math.min(1, clamped + 0.05) * Math.PI) * data.arc,
      0,
    ));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ(Math.sin(clamped * Math.PI) * (data.toX > data.fromX ? -0.8 : 0.8));
    return false;
  }

  function updateHusk(context: SkyhookUpdate, data: Extract<SkyhookGgl2SpawnData, { role: 'husk' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const offset = data.offset.clone();
    offset.x += Math.sin(age * 1.05 + data.seed) * 2.4;
    offset.y += Math.sin(age * 1.6 + data.seed * 2.1) * 1.5;

    // Vacuum-hardened drone: hangs, rears back, dashes at the car, looses a bolt.
    const fire = context.enemyState(() => ({ nextAt: 1.7 }));
    const untilShot = fire.nextAt - age;
    if (untilShot < 0.9 && untilShot > 0.55) offset.z += (0.9 - untilShot) * 8;
    else if (untilShot <= 0.55 && untilShot > 0) offset.z -= (0.55 - untilShot) * 15;
    if (age >= fire.nextAt) {
      fire.nextAt = age + 3.6;
      fireBolt(context, enemy.mesh.position, 5.4);
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 1.9 + data.seed) * 0.4 + age * 0.6);
    return runProgress > anchorU + 0.012;
  }

  // The grapnel goes for the car: it eases in on the tether, then breaks toward
  // the climber. If it reaches the car it grabs on (damage) and is torn away.
  function updateGrapnel(context: SkyhookUpdate, data: Extract<SkyhookGgl2SpawnData, { role: 'grapnel' }>) {
    const { enemy, age, curve, camera, railAnchor, damagePlayer } = context;
    const anchorU = railAnchor(data.lead);
    const seat = offsetFromRail(curve, anchorU, new Vector3(data.side * 8, data.y, 0));
    const close = MathUtils.clamp(age / data.closeTime, 0, 1);

    if (close < 1) {
      // Approach: swing from the tether seat toward a grip point on the car's
      // flank (off to its side, low), so it reads as latching onto the hull.
      const dockPoint = carDockPoint(camera, data.side);
      const eased = close * close;
      enemy.mesh.position.copy(seat).lerp(dockPoint, eased);
      enemy.mesh.lookAt(camera.position);
      enemy.mesh.rotateZ(age * 2.2);
      enemy.mesh.userData.grapnelReach = eased;
      return false;
    }

    // Reached the car: grab, damage, tear away.
    enemy.mesh.position.copy(carDockPoint(camera, data.side));
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(age * 6);
    damagePlayer(1);
    return true;
  }

  function carDockPoint(camera: SkyhookUpdate['camera'], side: number) {
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const down = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(-1);
    return camera.position.clone()
      .addScaledVector(forward, 5)
      .addScaledVector(right, Math.sign(side || 1) * 3.4)
      .addScaledVector(down, 1.8);
  }

  function updateBolt(context: SkyhookUpdate, data: Extract<SkyhookGgl2SpawnData, { role: 'bolt' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const dt = Math.max(0, age - data.lastAge);
    data.lastAge = age;

    const impact = updateHostileShotImpact({
      age,
      camera,
      position: data.position,
      velocity: data.velocity,
      state: data.impact,
      intercepted: interceptions.delete(enemy.id),
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

    steerHomingShot(data.position, data.velocity, boltAimPoint(camera, data.position, data.biasX, data.biasY), age, dt, {
      baseSpeed: 5.2,
      maxSpeed: 11.5,
      accel: 3.0,
      turnRate: 2.2,
    });
    enemy.mesh.position.copy(data.position);
    orientAlongVelocity(enemy.mesh, data.velocity);
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function orientAlongVelocity(mesh: SkyhookUpdate['enemy']['mesh'], velocity: Vector3) {
    if (velocity.lengthSq() < 0.001) return;
    mesh.lookAt(mesh.position.clone().add(velocity));
  }

  // ---- level definition -----------------------------------------------------

  return {
    duration: SKYHOOK_GGL2_RUN_DURATION,
    bpm: SKYHOOK_GGL2_BPM,
    playerHealth: SKYHOOK_PLAYER_HEALTH,
    createRail: createSkyhookGgl2Rail,
    spawnTimeline: timeline,
    easeRunProgress: skyhookRunProgress,
    startWord: 'ASCEND',
    replayWord: 'REPLAY',
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'pod':
          return updatePod(context, data);
        case 'kite':
          return updateKite(context, data);
        case 'husk':
          return updateHusk(context, data);
        case 'grapnel':
          return updateGrapnel(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'boss':
          return descender.updateBoss(context);
      }
    },
    scoreForKill(volleySize, enemy) {
      const multiplier = 1 + Math.max(0, volleySize - 1) * 0.18;
      return Math.round(KILL_SCORE[enemy.kind] * multiplier);
    },
    // Chipping the Descender's armour pays a little each hit.
    scoreForHit: () => 55,
    scoreForVolley(results) {
      // A full, clean volley is the level's signature play; pay it like one.
      if (results.length < 4) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length === 6 ? 500 : results.length * 60;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (descender.bossKilled() && score >= 15000 && clearRate >= 0.85) return 'S';
      if (descender.bossKilled() && score >= 11000 && clearRate >= 0.6) return 'A';
      if (score >= 6500 && clearRate >= 0.42) return 'B';
      if (score >= 3000 && clearRate >= 0.22) return 'C';
      return 'D';
    },
    detailsForRun() {
      const hull = Math.max(0, SKYHOOK_PLAYER_HEALTH - hitsTaken);
      const lines = [`Hull ${hull}/${SKYHOOK_PLAYER_HEALTH}`];
      if (grapnelsStopped > 0) lines.push(`${grapnelsStopped} grapnel${grapnelsStopped === 1 ? '' : 's'} torn off the car`);
      if (carHits > 0) lines.push(`Car struck ${carHits}×`);
      const bossLine = descender.summaryLine();
      if (bossLine) lines.push(bossLine);
      return lines;
    },
  };
}
