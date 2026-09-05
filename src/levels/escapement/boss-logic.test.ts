// Run with:
//   node --experimental-strip-types --experimental-loader ./scripts/benchmark/ts-extension-loader.mjs src/levels/escapement/boss-logic.test.ts
// @ts-ignore Node's assert types are intentionally not a production dependency.
import assert from 'node:assert/strict';
import {
  AMPLITUDE_BY_BROKEN_JEWELS,
  BOSS_DEADLINE,
  BOSS_START,
  type BossEvent,
  FORK_TRANSFER_DEGREES,
  type BossPart,
  JEWEL_HITS,
  TICK_POUR_SECONDS,
  TOTAL_RINGS,
  arborExposedFor,
  createEscapementBoss,
  pendulumPhase,
} from './boss-logic';
import { ESCAPEMENT_BAR, ESCAPEMENT_TIME, PENDULUM_PERIOD } from './timing';

declare const process: { argv: string[]; exitCode?: number } | undefined;

const BEAT = ESCAPEMENT_TIME.beatSeconds;

type ScriptedRun = {
  events: BossEvent[];
  killedAt: number | null;
  volleys: number;
};

/**
 * A scripted player: every `cadenceBars` bars (checked each beat), if a boss
 * part is lockable, lock it up to its stage HP and land the hits
 * `flightSeconds` later. Between volleys the player waits.
 */
function scriptedRun(cadenceBars: number, flightSeconds = 0.5, allHitsLand = true): ScriptedRun {
  const boss = createEscapementBoss();
  const events: BossEvent[] = [];
  const inFlight: Array<{ at: number; part: BossPart }> = [];
  let nextVolleyAt = 0;
  let killedAt: number | null = null;
  let volleys = 0;
  const step = BEAT / 8;
  for (let time = 0; time <= BOSS_DEADLINE + ESCAPEMENT_BAR; time += step) {
    events.push(...boss.update(time));
    while (inFlight.length > 0 && inFlight[0].at <= time) {
      const shot = inFlight.shift()!;
      if (allHitsLand) events.push(...boss.hit(shot.part, shot.at));
    }
    const snapshot = boss.snapshot();
    if (snapshot.stage === 'dead' && killedAt === null) killedAt = events.find((e) => e.type === 'killed')?.time ?? time;
    if (time < nextVolleyAt) continue;
    const parts = (Object.keys(snapshot.lockable) as BossPart[]).filter((part) => snapshot.lockable[part]);
    if (parts.length === 0) continue;
    const part = parts[0];
    const locks = part === 'arbor' ? 3 : JEWEL_HITS;
    for (let i = 0; i < locks; i += 1) inFlight.push({ at: time + flightSeconds + i * 0.05, part });
    inFlight.sort((a, b) => a.at - b.at);
    volleys += 1;
    nextVolleyAt = time + cadenceBars * ESCAPEMENT_BAR;
  }
  return { events, killedAt, volleys };
}

function barOf(time: number) {
  return time / ESCAPEMENT_BAR;
}

export function runBossLogicTests() {
  // Pendulum geometry: extremes sit on beat 2 of every bar, so a swing is two bars.
  assert.equal(PENDULUM_PERIOD, 2 * ESCAPEMENT_BAR);
  assert.ok(Math.abs(pendulumPhase(ESCAPEMENT_TIME.bar(42, 2)) - 1) < 1e-9, 'bar 42 beat 2 is the left extreme');
  assert.ok(Math.abs(pendulumPhase(ESCAPEMENT_TIME.bar(43, 2)) + 1) < 1e-9, 'bar 43 beat 2 is the right extreme');
  assert.ok(Math.abs(pendulumPhase(BOSS_START)) < 1e-9, 'the boss engages with the bob at centre');

  // Arbor exposure: the bottom third of the swing by height, symmetric about centre.
  assert.ok(arborExposedFor(0, 20));
  assert.ok(!arborExposedFor(20, 20));
  assert.ok(!arborExposedFor(-20, 20));
  const edge = (Math.acos(1 - (1 - Math.cos((Math.PI / 180) * 30)) / 3) * 180) / Math.PI;
  assert.ok(arborExposedFor(edge - 0.01, 30) && !arborExposedFor(edge + 0.01, 30), 'exposure edge at amplitude 30');

  // Before the boss engages nothing is lockable and hits are ignored.
  {
    const boss = createEscapementBoss();
    boss.update(BOSS_START - 1);
    assert.equal(boss.snapshot().stage, 'dormant');
    assert.deepEqual(boss.snapshot().lockable, { 'jewel-left': false, 'jewel-right': false, arbor: false });
    assert.deepEqual(boss.hit('jewel-left', BOSS_START - 1), []);
    assert.equal(boss.summaryLine(), undefined);
  }

  // An engaged jewel is never lockable; the arbor is never lockable while a jewel lives.
  {
    const boss = createEscapementBoss();
    let leftSeen = 0;
    let rightSeen = 0;
    for (let time = BOSS_START; time < BOSS_START + 4 * ESCAPEMENT_BAR; time += 0.01) {
      boss.update(time);
      const s = boss.snapshot();
      assert.equal(s.stage, 'jewels');
      if (s.lockable['jewel-left']) {
        leftSeen += 1;
        assert.ok(s.angle > 0, `left jewel lockable only while the left pallet is lifted (angle ${s.angle})`);
      }
      if (s.lockable['jewel-right']) {
        rightSeen += 1;
        assert.ok(s.angle < 0, `right jewel lockable only while the right pallet is lifted (angle ${s.angle})`);
      }
      assert.ok(!(s.lockable['jewel-left'] && s.lockable['jewel-right']), 'both jewels never lockable at once');
      assert.ok(!s.lockable.arbor, 'arbor stays closed while a jewel lives');
      assert.equal(s.liftedPallet, s.angle > FORK_TRANSFER_DEGREES ? 'left' : s.angle < -FORK_TRANSFER_DEGREES ? 'right' : null);
    }
    assert.ok(leftSeen > 0 && rightSeen > 0);
    assert.ok(Math.abs(leftSeen - rightSeen) <= 2, 'each jewel is lifted for half of every swing');
  }

  // Hits on a jewel that has re-engaged still land: the lock was valid.
  {
    const boss = createEscapementBoss();
    boss.update(ESCAPEMENT_TIME.bar(43, 1)); // right lifted
    assert.ok(boss.snapshot().lockable['jewel-right']);
    boss.update(ESCAPEMENT_TIME.bar(44, 1)); // right engaged
    assert.ok(!boss.snapshot().lockable['jewel-right']);
    const events = boss.hit('jewel-right', ESCAPEMENT_TIME.bar(44, 1));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'ring');
    assert.equal(boss.snapshot().jewelHits.right, 1);
  }

  // The full loop, hit by hit: amplitude, stage breaks, pour, ring degrees, kill.
  {
    const boss = createEscapementBoss();
    const all: BossEvent[] = [];
    let time = BOSS_START;
    all.push(...boss.update(time));
    assert.equal(all[0].type, 'engaged');
    assert.equal(boss.snapshot().amplitude, AMPLITUDE_BY_BROKEN_JEWELS[0]);
    for (let i = 0; i < JEWEL_HITS; i += 1) all.push(...boss.hit('jewel-left', (time += 0.1)));
    assert.equal(boss.snapshot().amplitude, 30, 'first broken jewel raises the amplitude to 30');
    assert.ok(!boss.snapshot().alive['jewel-left']);
    assert.deepEqual(boss.hit('jewel-left', time), [], 'a broken jewel takes no more hits');
    assert.deepEqual(boss.hit('arbor', time), [], 'the arbor takes no hits while a jewel lives');
    for (let i = 0; i < JEWEL_HITS; i += 1) all.push(...boss.hit('jewel-right', (time += 0.1)));
    assert.equal(boss.snapshot().amplitude, 40, 'second broken jewel raises the amplitude to 40');
    assert.equal(boss.snapshot().stage, 'arbor');
    assert.equal(boss.snapshot().arborStage, 1);
    for (let i = 0; i < 3; i += 1) all.push(...boss.hit('arbor', (time += 0.1)));
    const pour = all.find((e) => e.type === 'tickPour');
    assert.ok(pour && pour.type === 'tickPour');
    assert.equal(boss.snapshot().stage, 'pour');
    assert.ok(!boss.snapshot().lockable.arbor, 'the arbor closes for the pour');
    assert.equal(pour.until - pour.time, TICK_POUR_SECONDS, 'the pour lasts one bar');
    boss.update(pour.until - 0.01);
    assert.equal(boss.snapshot().stage, 'pour');
    all.push(...boss.update(pour.until));
    assert.equal(boss.snapshot().stage, 'arbor');
    assert.equal(boss.snapshot().arborStage, 2);
    time = pour.until;
    for (let i = 0; i < 3; i += 1) all.push(...boss.hit('arbor', (time += 0.1)));
    assert.equal(boss.snapshot().stage, 'dead');
    const rings = all.filter((e) => e.type === 'ring');
    assert.equal(rings.length, TOTAL_RINGS);
    rings.forEach((ring, i) => {
      assert.ok(ring.type === 'ring');
      assert.equal(ring.ring, i + 1);
      assert.equal(ring.degree, i + 1, 'each ring climbs one scale degree');
    });
    const killed = all.find((e) => e.type === 'killed');
    assert.ok(killed && killed.type === 'killed');
    assert.equal(killed.time, rings[TOTAL_RINGS - 1].time, 'the twelfth ring is the kill');
    assert.deepEqual(
      all.map((e) => e.type),
      ['engaged', 'ring', 'ring', 'ring', 'jewelBroken', 'ring', 'ring', 'ring', 'jewelBroken', 'arborStage',
        'ring', 'ring', 'ring', 'tickPour', 'arborStage', 'ring', 'ring', 'ring', 'killed'],
    );
    assert.equal(boss.summaryLine(), 'The clock struck twelve');
    assert.deepEqual(boss.hit('arbor', time), [], 'a dead boss takes no hits');
    assert.deepEqual(boss.update(BOSS_DEADLINE + 1), [], 'a dead boss has no deadline');
  }

  // No hits: the deadline fails the boss at bar 56 and the clock stays silent.
  {
    const boss = createEscapementBoss();
    boss.update(BOSS_START);
    boss.update(BOSS_DEADLINE - 0.01);
    assert.equal(boss.snapshot().stage, 'jewels');
    const events = boss.update(BOSS_DEADLINE);
    assert.deepEqual(events, [{ type: 'deadline', time: BOSS_DEADLINE }]);
    assert.equal(boss.snapshot().stage, 'failed');
    assert.deepEqual(boss.snapshot().lockable, { 'jewel-left': false, 'jewel-right': false, arbor: false });
    assert.equal(boss.summaryLine(), 'The hour never struck');
    assert.deepEqual(boss.hit('jewel-left', BOSS_DEADLINE), []);
  }

  // Scripted players. The floor player fires one volley per two bars and every lock hits.
  {
    const floor = scriptedRun(2);
    assert.ok(floor.killedAt !== null, 'a volley every two bars kills the boss');
    assert.ok(floor.killedAt < BOSS_DEADLINE, `floor player kills at bar ${barOf(floor.killedAt).toFixed(2)}, before bar 56`);
    assert.ok(barOf(floor.killedAt) <= 50, `floor player kills by bar 50 (got ${barOf(floor.killedAt).toFixed(2)})`);
    assert.equal(floor.events.filter((e) => e.type === 'ring').length, TOTAL_RINGS);
    assert.equal(floor.volleys, 4, 'three-lock volleys: two jewels, two arbor stages');

    const slow = scriptedRun(3);
    assert.ok(slow.killedAt !== null && slow.killedAt < BOSS_DEADLINE, 'a volley every three bars still kills before bar 56');

    const slower = scriptedRun(4);
    assert.ok(slower.killedAt !== null && slower.killedAt < BOSS_DEADLINE, `a volley every four bars still kills before bar 56 (bar ${slower.killedAt === null ? 'never' : barOf(slower.killedAt).toFixed(2)})`);

    const absent = scriptedRun(2, 0.5, false);
    assert.equal(absent.killedAt, null);
    assert.ok(absent.events.some((e) => e.type === 'deadline'), 'a player whose shots never land hits the deadline');
  }

  // Reset returns the machine to dormant.
  {
    const boss = createEscapementBoss();
    boss.update(BOSS_START);
    boss.hit('jewel-left', BOSS_START + 0.1);
    boss.reset();
    assert.equal(boss.snapshot().stage, 'dormant');
    assert.equal(boss.snapshot().rings, 0);
    assert.deepEqual(boss.snapshot().jewelHits, { left: 0, right: 0 });
  }

  // The floor player's schedule, for the notes.
  const floor = scriptedRun(2);
  return {
    floorKillBar: floor.killedAt === null ? null : barOf(floor.killedAt),
    slowKillBar: (() => { const r = scriptedRun(3); return r.killedAt === null ? null : barOf(r.killedAt); })(),
    slowerKillBar: (() => { const r = scriptedRun(4); return r.killedAt === null ? null : barOf(r.killedAt); })(),
    floorSchedule: floor.events
      .filter((e) => e.type !== 'ring')
      .map((e) => `${e.type} @ bar ${barOf(e.time).toFixed(2)}`),
  };
}

if (process && process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const report = runBossLogicTests();
    console.log('Escapement boss-logic tests passed.');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
