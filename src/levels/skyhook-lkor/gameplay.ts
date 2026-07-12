import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import {
  hostileShotAimPoint,
  shotBehindCamera,
  steerHomingShot,
  updateHostileShotImpact,
  type HostileShotImpactState,
} from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import { createSkyhookLamprey, createSkyhookLampreyEntry } from './lamprey';
import {
  CAR_AHEAD_UNITS,
  LEECH_APPROACH_SECONDS,
  LEECH_BITE_PERIOD_SECONDS,
  LEECH_WINDUP_SECONDS,
  SKYHOOK_BPM,
  SKYHOOK_DURATION,
  SKYHOOK_MARKERS,
  SKYHOOK_PLAYER_HEALTH,
  TETHER_OFFSET_Y,
  bar,
} from './timing';

// SKYHOOK — a 64-second climb up a space-elevator tether, escorting a climber
// car from a storm at the base to an orbital dock. Five movements scored to a
// 112 BPM arrangement (one bar = 240/112 s; 30 bars = 64.29 s):
//
//   Storm  (0–17s)   Slow heave off the pad in the weather; squall kites.
//   Cloud  (17s)     Punch through the deck: surge kick, kites + darts above.
//   Thin   (30s)     Air thins; vacuum wasps and tether leeches go for the car.
//   Lamprey(37.5s)   A grinder-machine latches far up the tether and hauls
//                    itself down toward the car — kill it before it arrives.
//   Dock   (55.7s+)  Station aperture ahead; light the ring of guide beacons
//                    (the thematic final 6-lock) as everything decelerates.
//
// The rail climbs at ~32° (mostly -Z with steady +Y) so the tether reads as a
// vertical line of travel; the run rides a variable speed profile whose rail
// easing is the normalized integral of speed(t), so the cloud punch and the
// dock land as genuine changes of pace.

export type SkyhookEnemyKind = 'kite' | 'dart' | 'leech' | 'wasp' | 'bolt' | 'lamprey' | 'beacon';

// Timeline data is immutable — the runner reuses the timeline across runs.
// Per-enemy runtime state lives in the runner's enemyState bags, boss/run
// state lives in this module's closure, and dynamically spawned bolts get
// fresh data objects each launch.
export type SkyhookSpawnData =
  | { role: 'kite'; lead: number; baseX: number; baseY: number; sweepAmp: number; sweepFreq: number; phase: number; arcY: number }
  | { role: 'dart'; lead: number; fromX: number; toX: number; y: number; arcY: number; crossTime: number; delay: number }
  | { role: 'wasp'; lead: number; baseX: number; baseY: number; seed: number }
  | { role: 'leech'; latchX: number; latchY: number; spiralSide: number; spiralTurns: number }
  | { role: 'bolt'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'lamprey' }
  | { role: 'beacon'; dx: number; dy: number };

export type SkyhookSpawnEntry = LockOnSpawnEntry<SkyhookEnemyKind, SkyhookSpawnData>;
export type SkyhookUpdate = LockOnEnemyUpdate<SkyhookEnemyKind, SkyhookSpawnData>;

// ---- speed profile → rail easing ------------------------------------------

// Piecewise-linear felt airspeed over run time. 1.0 ≈ cruise. Slow heave off
// the pad, a surge kick punching the cloud deck at bar 8, a sustained cruise
// through the thin air and the boss, then a hard decel into the dock.
const SPEED_KEYS: Array<[number, number]> = [
  [bar(0), 0.55],
  [bar(3.5), 0.78],
  [bar(7.4), 0.96],
  [bar(8), 1.35],
  [bar(9.5), 1.22],
  [bar(14), 1.26],
  [bar(19), 1.3],
  [bar(25), 1.28],
  [bar(26), 1.16],
  [bar(28.5), 0.4],
  [bar(30), 0.18],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, SKYHOOK_DURATION);

export const speedFactorAt = speedProfile.speedAt;

export function skyhookRunProgress(time: number, duration = SKYHOOK_DURATION) {
  return speedProfile.runProgress(time, duration);
}

// ---- rail ------------------------------------------------------------------

// Authored climbing rail: mostly -Z with a steady +Y rise (~32° elevation) and
// a gentle, long-wavelength lateral sway so rail frames stay stable and the
// tether never reads near-vertical to the engine's world-up frame math.
const RAIL_POINTS = 14;
const RAIL_FORWARD = 452; // -Z extent
const RAIL_RISE = 282; // +Y extent — atan(282/452) ≈ 32°
const RAIL_SWAY = 6;
const RAIL_SWAY_WAVELENGTHS = 1.4;

export function createSkyhookRail() {
  const points: Vector3[] = [];
  for (let i = 0; i < RAIL_POINTS; i += 1) {
    const u = i / (RAIL_POINTS - 1);
    points.push(new Vector3(
      Math.sin(u * Math.PI * 2 * RAIL_SWAY_WAVELENGTHS + 0.4) * RAIL_SWAY,
      u * RAIL_RISE,
      -u * RAIL_FORWARD,
    ));
  }
  return new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

/** World point on the tether at rail progress u; visuals and gameplay share this line. */
export function tetherPointAt(curve: CatmullRomCurve3, u: number, out = new Vector3()) {
  return out.copy(offsetFromRail(curve, MathUtils.clamp(u, 0, 1), new Vector3(0, TETHER_OFFSET_Y, 0)));
}

// ---- spawn timeline --------------------------------------------------------

const KITE_LEAD = 4.4;
const DART_LEAD = 4.2;
const WASP_LEAD = 4.2;
const PASS_EPS = 0.014;

const kites = (
  time: number,
  offsets: Array<{ x: number; y: number; amp?: number; freq?: number; arc?: number }>,
  lead = KITE_LEAD,
): SkyhookSpawnEntry[] =>
  offsets.map((o, index) => ({
    time: time + index * 0.16,
    kind: 'kite',
    data: {
      role: 'kite',
      lead,
      baseX: o.x,
      baseY: o.y,
      sweepAmp: o.amp ?? 7,
      sweepFreq: o.freq ?? 0.9,
      phase: index * 1.7 + o.x * 0.2,
      arcY: o.arc ?? 2.4,
    },
  }));

const darts = (
  time: number,
  runs: Array<{ fromX: number; toX: number; y: number; arc?: number; crossTime?: number; delay?: number }>,
  lead = DART_LEAD,
): SkyhookSpawnEntry[] =>
  runs.map((run, index) => ({
    time: time + index * 0.14,
    kind: 'dart',
    data: {
      role: 'dart',
      lead,
      fromX: run.fromX,
      toX: run.toX,
      y: run.y,
      arcY: run.arc ?? 2,
      crossTime: run.crossTime ?? 2.3,
      delay: run.delay ?? 0,
    },
  }));

const wasps = (time: number, offsets: Array<[number, number]>, lead = WASP_LEAD): SkyhookSpawnEntry[] =>
  offsets.map((offset, index) => ({
    time: time + index * 0.22,
    kind: 'wasp',
    data: { role: 'wasp', lead, baseX: offset[0], baseY: offset[1], seed: time * 3.1 + index * 2.7 },
  }));

const leeches = (time: number, specs: Array<{ x: number; y: number; side: number; turns?: number }>): SkyhookSpawnEntry[] =>
  specs.map((spec, index) => ({
    time: time + index * 0.3,
    kind: 'leech',
    hitStages: [1, 1],
    data: { role: 'leech', latchX: spec.x, latchY: spec.y, spiralSide: spec.side, spiralTurns: spec.turns ?? 1.4 },
  }));

// Docking-ring guide beacons: the upper guide-light arc of the station
// aperture. Flat-bottom hexagon whose center is lifted above the tether axis
// so the whole ring — bottom pair included — projects clear of the climber
// car's screen footprint (occlusion gate). Lighting all six in one release as
// the aperture opens is the thematic final 6-lock volley.
const BEACON_RING_RADIUS = 7;
const BEACON_RING_LIFT = 5; // ring center sits this far above the tether line
const BEACON_RING_ANGLES_DEG = [0, 60, 120, 180, 240, 300];
// Anchored past the run's end so railAnchor clamps to the rail end — the ring
// sits fixed at the station mouth while the decelerating camera closes on it.
const BEACON_LEAD = 10;

const beacons = (time: number): SkyhookSpawnEntry[] =>
  BEACON_RING_ANGLES_DEG.map((deg, index) => {
    const angle = MathUtils.degToRad(deg);
    return {
      time: time + index * 0.12,
      kind: 'beacon' as const,
      countsTowardTotal: false,
      data: {
        role: 'beacon' as const,
        dx: Math.cos(angle) * BEACON_RING_RADIUS,
        dy: Math.sin(angle) * BEACON_RING_RADIUS,
      },
    };
  });

function buildSkyhookTimeline(bossEntry: SkyhookSpawnEntry): SkyhookSpawnEntry[] {
  return [
    // --- Storm: slow heave off the pad, squall kites riding the wind. Wide,
    //     sweeping formations teach the sweep among rain and cloud wisps.
    ...kites(bar(1), [
      { x: -10, y: 1.5, amp: 8 }, { x: -4, y: 4.5 }, { x: 4, y: 4.5 }, { x: 10, y: 1.5, amp: 8 },
    ]),
    ...kites(bar(3), [
      { x: -12, y: -1, amp: 8, freq: 0.8 }, { x: -6, y: 2.5 }, { x: 0, y: 6, arc: 3 },
      { x: 6, y: 2.5 }, { x: 12, y: -1, amp: 8, freq: 0.8 },
    ]),
    ...kites(bar(5), [
      { x: -9, y: 3, amp: 9 }, { x: -3, y: 6.5, arc: 3 }, { x: 3, y: 6.5, arc: 3 }, { x: 9, y: 3, amp: 9 },
    ]),
    // Last low squall before the deck: a tight, close pass with short leads so
    // the frame is clear by the punch without leaving a lull under the storm.
    ...kites(bar(6.4), [
      { x: -7, y: 6, amp: 5 }, { x: 7, y: 4, amp: 5 },
    ], 2.6),

    // (bars 7.6–8.4: screen kept clear for the cloud-deck punch)

    // --- Cloud: burst above the deck into sunlit blue. Kites keep sweeping,
    //     stratos darts cross low and fast, alternating direction.
    ...kites(bar(8.4), [
      { x: -11, y: 2, amp: 8 }, { x: -4, y: 5.5, arc: 3 }, { x: 4, y: 5.5, arc: 3 }, { x: 11, y: 2, amp: 8 },
    ]),
    ...darts(bar(10), [
      { fromX: -20, toX: 20, y: -2, crossTime: 2.2 },
      { fromX: 20, toX: -20, y: 2, crossTime: 2.4 },
      { fromX: -20, toX: 20, y: 5.5, crossTime: 2.6 },
      { fromX: 20, toX: -20, y: 0.5, crossTime: 2.3 },
    ]),
    ...kites(bar(11.5), [
      { x: -12, y: 0, amp: 9 }, { x: -5, y: 4, arc: 3 }, { x: 5, y: 4, arc: 3 }, { x: 12, y: 0, amp: 9 },
    ]),
    ...darts(bar(13), [
      { fromX: 22, toX: -22, y: 3, crossTime: 2.2 },
      { fromX: -22, toX: 22, y: -1.5, crossTime: 2.4 },
      { fromX: 22, toX: -22, y: 6, crossTime: 2.6 },
      { fromX: -22, toX: 22, y: 1, crossTime: 2.3 },
    ]),

    // --- Thin air: the sky goes indigo. Vacuum wasps hop and spit bolts;
    //     the first tether leeches spiral in and go for the car.
    ...wasps(bar(14), [[-11, 4], [11, 4]]),
    ...leeches(bar(15), [{ x: -1.6, y: 1.3, side: -1 }]),
    ...darts(bar(16), [
      { fromX: -21, toX: 21, y: 4, crossTime: 2.2 },
      { fromX: 21, toX: -21, y: -1, crossTime: 2.4 },
      { fromX: -21, toX: 21, y: 7, crossTime: 2.6 },
    ]),
    ...leeches(bar(17), [{ x: 1.8, y: 1.1, side: 1 }]),

    // --- Lamprey: the boss hauls itself down the tether (spawned at bossClank
    //     far up the line; lockable at bossFight). Sparse escorts interleave
    //     so volleys stay wide and interesting, all clear after bar 24.
    bossEntry,
    ...darts(bar(19.5), [
      { fromX: -21, toX: 21, y: 5, crossTime: 2.2 },
      { fromX: 21, toX: -21, y: -2, crossTime: 2.4 },
    ]),
    ...wasps(bar(20.5), [[-12, 3], [12, 5]]),
    ...leeches(bar(21.5), [{ x: -1.9, y: 1.4, side: -1 }]),
    ...wasps(bar(22.5), [[12, 2], [-12, 6]]),
    ...darts(bar(23.5), [
      { fromX: 21, toX: -21, y: 6, crossTime: 2.2 },
      { fromX: -21, toX: 21, y: -1, crossTime: 2.4 },
    ]),

    // --- Dock: clear sky after the boss dies, then the station's guide-light
    //     ring appears at the aperture. Sweep all six as the run decelerates;
    //     unlit beacons expire at dockSeal when the aperture swallows the car.
    ...beacons(bar(26.3)),
  ];
}

const KILL_SCORE: Record<SkyhookEnemyKind, number> = {
  kite: 100,
  dart: 120,
  wasp: 140,
  leech: 150,
  bolt: 40,
  lamprey: 1500,
  beacon: 80,
};

const LEECH_CLEAN_EXTRACTION_BONUS = 150;
const BOLT_MAX_AGE = 12;

export function createSkyhookGameplay(bus: EventBus): LockOnRunnerLevel<SkyhookEnemyKind, SkyhookSpawnData> {
  const bossEntry = createSkyhookLampreyEntry(SKYHOOK_MARKERS.bossClank);
  const timeline = buildSkyhookTimeline(bossEntry).sort((a, b) => a.time - b.time);

  // Bus-driven run state, all reset on 'runstart' so the headless simulator's
  // repeated runs start clean.
  const interceptions = new Set<number>();
  const leechBitten = new Set<number>();
  let hitsTaken = 0;

  bus.on('runstart', () => {
    interceptions.clear();
    leechBitten.clear();
    hitsTaken = 0;
  });
  bus.on('playerhit', ({ damage }) => {
    hitsTaken += damage;
  });
  bus.on('fire', ({ enemyId }) => interceptions.add(enemyId));
  bus.on('kill', ({ enemyId }) => interceptions.delete(enemyId));
  bus.on('miss', ({ enemyId }) => interceptions.delete(enemyId));

  // Cache the rail arc length once so unit→u conversions (car lead, boss
  // descent) adapt automatically if the rail is retuned.
  let cachedLength = 0;
  const deltaUForUnits = (curve: CatmullRomCurve3, units: number) => {
    if (cachedLength <= 0) cachedLength = curve.getLength();
    return units / cachedLength;
  };

  function fireBolt(context: SkyhookUpdate, from: Vector3) {
    const initial = hostileShotAimPoint(context.camera, from).sub(from).normalize().multiplyScalar(5);
    context.spawnEnemy({
      time: context.runTime,
      kind: 'bolt',
      countsTowardTotal: false,
      data: { role: 'bolt', position: from.clone(), velocity: initial, lastAge: 0, impact: {} },
    });
  }

  const lamprey = createSkyhookLamprey(bus, {
    bossEntry,
    bossFightTime: SKYHOOK_MARKERS.bossFight,
    deadlineTime: SKYHOOK_MARKERS.bossDeadline,
    carAheadUnits: CAR_AHEAD_UNITS,
    deltaUForUnits,
  });

  // ---- movement ------------------------------------------------------------

  function updateKite(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'kite' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    // Wind-riding banked sine sweep across the frame, buffeted by turbulence.
    const sweep = Math.sin(age * data.sweepFreq + data.phase);
    const sweepNext = Math.sin((age + 0.06) * data.sweepFreq + data.phase);
    const turb = Math.sin(age * 5.3 + enemy.id) * 0.5 + Math.sin(age * 8.9 + enemy.id * 1.7) * 0.3;
    const x = data.baseX + sweep * data.sweepAmp + turb * 0.6;
    const y = data.baseY + Math.cos(age * data.sweepFreq * 0.7 + data.phase) * data.arcY + turb * 0.45;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 2 + enemy.id) * 0.3)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    const bank = MathUtils.clamp((sweepNext - sweep) * data.sweepAmp * 4, -1, 1);
    enemy.mesh.userData.bank = bank;
    enemy.mesh.rotateZ(-bank * 0.5);
    return runProgress > anchorU + PASS_EPS;
  }

  function updateDart(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'dart' }>) {
    const { enemy, runProgress, age, curve, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const t = (age - data.delay) / data.crossTime;
    if (t > 1.12 || runProgress > anchorU + PASS_EPS) return true;
    const clamped = MathUtils.clamp(t, 0, 1);
    const eased = clamped * clamped * (3 - 2 * clamped);
    const x = MathUtils.lerp(data.fromX, data.toX, eased);
    const y = data.y + Math.sin(clamped * Math.PI) * data.arcY;
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(x, y, Math.sin(age * 4 + enemy.id) * 0.3)));
    const ahead = offsetFromRail(curve, anchorU, new Vector3(MathUtils.lerp(data.fromX, data.toX, Math.min(1, eased + 0.05)), y, 0));
    enemy.mesh.lookAt(ahead);
    enemy.mesh.rotateZ(age * 5);
    enemy.mesh.userData.thrust = clamped <= 0 || clamped >= 1 ? 0.2 : 0.4 + 0.6 * Math.sin(clamped * Math.PI);
    return false;
  }

  function updateWasp(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'wasp' }>) {
    const { enemy, runProgress, age, curve, camera, railAnchor } = context;
    const anchorU = railAnchor(data.lead);
    const st = context.enemyState(() => ({
      curX: data.baseX,
      curY: data.baseY,
      tgtX: data.baseX,
      tgtY: data.baseY,
      nextHopAt: 0.55,
      nextFireAt: 1.4,
      hopIndex: 0,
      burn: 0,
      lastAge: 0,
    }));
    const dt = Math.max(0, age - st.lastAge);
    st.lastAge = age;

    // Impulse hop: drift…burst…drift. No air resistance up here, so motion is
    // staccato — snap to a new anchor, then coast.
    if (age >= st.nextHopAt) {
      st.hopIndex += 1;
      const h = hash01(data.seed + st.hopIndex * 4.13);
      const h2 = hash01(data.seed * 1.7 + st.hopIndex * 2.9);
      st.tgtX = MathUtils.clamp(data.baseX + (h - 0.5) * 12, -13, 13);
      st.tgtY = MathUtils.clamp(data.baseY + (h2 - 0.5) * 8, -3, 9);
      st.nextHopAt = age + 0.9 + h * 0.8;
      st.burn = 1;
    }
    st.burn = Math.max(0, st.burn - dt * 3.5);
    st.curX = MathUtils.lerp(st.curX, st.tgtX, Math.min(1, dt * 11));
    st.curY = MathUtils.lerp(st.curY, st.tgtY, Math.min(1, dt * 11));
    enemy.mesh.userData.burn = st.burn;

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(st.curX, st.curY, Math.sin(age * 1.3 + enemy.id) * 0.4)));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 1.6 + enemy.id);

    if (age >= st.nextFireAt && runProgress < anchorU) {
      st.nextFireAt = age + 2.4;
      fireBolt(context, enemy.mesh.position);
    }
    return runProgress > anchorU + PASS_EPS;
  }

  function updateLeech(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'leech' }>) {
    const { enemy, age, runProgress, curve, camera, damagePlayer } = context;
    const st = context.enemyState(() => ({ nextBiteAge: LEECH_APPROACH_SECONDS + LEECH_WINDUP_SECONDS, bites: 0, bite: 0, lastAge: 0 }));
    const dt = Math.max(0, age - st.lastAge);
    st.lastAge = age;

    // Latch a touch ahead of the camera, beside/above the tether so it sits
    // low-center near the car without hiding behind it.
    const latchU = MathUtils.clamp(runProgress + deltaUForUnits(curve, CAR_AHEAD_UNITS - 1), 0, 1);
    const latch = offsetFromRail(curve, latchU, new Vector3(data.latchX, TETHER_OFFSET_Y + data.latchY, 0));

    const approach = MathUtils.clamp(age / LEECH_APPROACH_SECONDS, 0, 1);
    if (approach < 1) {
      // Spiral in from off-screen: a shrinking radius in the camera plane so it
      // visibly crosses the frame before it grabs on.
      enemy.mesh.userData.leechPhase = 'approach';
      const radius = (1 - approach) * 13;
      const angle = data.spiralSide * data.spiralTurns * Math.PI * 2 * approach + data.spiralSide * 1.2;
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      enemy.mesh.position.copy(latch)
        .addScaledVector(right, Math.cos(angle) * radius)
        .addScaledVector(up, Math.sin(angle) * radius);
      enemy.mesh.userData.chew = 0;
    } else {
      enemy.mesh.userData.leechPhase = 'latched';
      enemy.mesh.position.copy(latch);
      // Wind-up charge ramps toward the next bite, then bites and resets.
      const sinceLatch = age - LEECH_APPROACH_SECONDS;
      const cycleStart = st.bites === 0 ? 0 : LEECH_WINDUP_SECONDS + (st.bites - 1) * LEECH_BITE_PERIOD_SECONDS;
      const cycleLen = st.bites === 0 ? LEECH_WINDUP_SECONDS : LEECH_BITE_PERIOD_SECONDS;
      enemy.mesh.userData.chew = MathUtils.clamp((sinceLatch - cycleStart) / cycleLen, 0, 1);
      if (age >= st.nextBiteAge) {
        st.bites += 1;
        st.nextBiteAge = age + LEECH_BITE_PERIOD_SECONDS;
        st.bite = 1;
        leechBitten.add(enemy.id);
        damagePlayer(1);
      }
    }
    st.bite = Math.max(0, st.bite - dt * 4);
    enemy.mesh.userData.bite = st.bite;
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 2.1 + enemy.id) * 0.25);
    // Latched leeches never pass the camera — they ride the car until killed.
    return false;
  }

  function updateBolt(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'bolt' }>) {
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

    steerHomingShot(data.position, data.velocity, hostileShotAimPoint(camera, data.position), age, dt, {
      baseSpeed: 5.2,
      maxSpeed: 11.5,
      accel: 3,
      turnRate: 2.2,
    });
    enemy.mesh.position.copy(data.position);
    if (data.velocity.lengthSq() > 0.001) enemy.mesh.lookAt(data.position.clone().add(data.velocity));
    return age > BOLT_MAX_AGE || shotBehindCamera(camera, data.position);
  }

  function updateBeacon(context: SkyhookUpdate, data: Extract<SkyhookSpawnData, { role: 'beacon' }>) {
    const { enemy, runTime, curve, camera, railAnchor } = context;
    // The whole ring shares one anchor (the lead clamps to the rail end), so it
    // reads as fixed station hardware the decelerating camera closes on.
    const anchorU = railAnchor(BEACON_LEAD);
    // Gentle synchronized breathing: the ring exhales together while a shared
    // beat phase drives the blink visuals read from userData.pulse.
    const breathe = 1 + Math.sin(runTime * 1.4) * 0.05;
    const beats = runTime * (SKYHOOK_BPM / 60);
    enemy.mesh.userData.pulse = 1 - (beats - Math.floor(beats));
    enemy.mesh.position.copy(offsetFromRail(
      curve,
      anchorU,
      new Vector3(data.dx * breathe, TETHER_OFFSET_Y + BEACON_RING_LIFT + data.dy * breathe, 0),
    ));
    enemy.mesh.quaternion.copy(camera.quaternion);
    // Unlit beacons wink out as the aperture swallows the car.
    return runTime >= SKYHOOK_MARKERS.dockSeal;
  }

  // ---- level definition ----------------------------------------------------

  return {
    duration: SKYHOOK_DURATION,
    bpm: SKYHOOK_BPM,
    playerHealth: SKYHOOK_PLAYER_HEALTH,
    createRail: createSkyhookRail,
    spawnTimeline: timeline,
    easeRunProgress: skyhookRunProgress,
    timing: { shotDelay: { maxGridSeconds: 0.24 } },
    updateEnemy(context) {
      const data = context.enemy.entry.data;
      switch (data.role) {
        case 'kite':
          return updateKite(context, data);
        case 'dart':
          return updateDart(context, data);
        case 'wasp':
          return updateWasp(context, data);
        case 'leech':
          return updateLeech(context, data);
        case 'bolt':
          return updateBolt(context, data);
        case 'lamprey':
          return lamprey.updateLamprey(context);
        case 'beacon':
          return updateBeacon(context, data);
      }
    },
    updateAttractCamera({ camera, curve, modeTime }) {
      // A slow drift near the rail start, looking up along the climb into the storm.
      const base = curve.getPointAt(0.008);
      const look = curve.getPointAt(0.05);
      camera.position.copy(base).add(new Vector3(
        Math.sin(modeTime * 0.5) * 0.3,
        Math.cos(modeTime * 0.4) * 0.2,
        Math.sin(modeTime * 0.3) * 0.15,
      ));
      camera.lookAt(look.add(new Vector3(Math.sin(modeTime * 0.45) * 0.4, Math.cos(modeTime * 0.6) * 0.25, 0)));
    },
    scoreForKill(volleySize, enemy) {
      let award = KILL_SCORE[enemy.kind];
      // Clean extraction: kill a leech before it ever bites the car.
      if (enemy.kind === 'leech' && !leechBitten.has(enemy.id)) award += LEECH_CLEAN_EXTRACTION_BONUS;
      return Math.round(award * (1 + Math.max(0, volleySize - 1) * 0.12));
    },
    // Cracking a leech shell or blowing a boss arm/petal pays a little.
    scoreForHit: () => 40,
    scoreForVolley(results) {
      // Quadratic-ish so a full six-lock release is a genuine event.
      if (results.length < 2) return 0;
      if (!results.every((result) => result.killed)) return 0;
      return results.length * results.length * 30;
    },
    rankForRun(score, kills, totalEnemies) {
      const clearRate = totalEnemies === 0 ? 0 : kills / totalEnemies;
      if (lamprey.isKilled() && clearRate >= 0.92 && score >= 9000) return 'ORBITAL';
      if (lamprey.isKilled() && clearRate >= 0.78) return 'EXO';
      if (clearRate >= 0.6) return 'MESO';
      if (clearRate >= 0.4) return 'STRATO';
      if (clearRate >= 0.2) return 'TROPO';
      return 'GROUNDED';
    },
    detailsForRun() {
      const hull = Math.max(0, SKYHOOK_PLAYER_HEALTH - hitsTaken);
      const lines = [`HULL ${hull}/${SKYHOOK_PLAYER_HEALTH}`];
      if (lamprey.isKilled()) {
        lines.push(`LAMPREY DOWN T-${lamprey.marginSeconds().toFixed(1)}s TO IMPACT`);
      } else if (lamprey.reachedCar()) {
        lines.push('LAMPREY REACHED THE CAR');
      } else if (hull <= 0) {
        lines.push('CLIMBER LOST');
      }
      return lines;
    },
  };
}

// Cheap deterministic hash → [0,1), for wasp hop scatter without an rng object.
function hash01(n: number) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
