// Run with:
//   node --experimental-strip-types --experimental-loader ./scripts/benchmark/ts-extension-loader.mjs src/levels/escapement/choreography.test.ts
// @ts-ignore Node's assert types are intentionally not a production dependency.
import assert from 'node:assert/strict';
import { MAX_LOCKS } from '../../engine/locks';
import { BOSS_DEADLINE, atSwingExtreme, pendulumSide } from './boss-logic';
import {
  DIAL_NUMERALS,
  FLOOR_PLAYER,
  HANDOFF_CLEAR_SECONDS,
  HANDOFF_TIMES,
  STEADY_PLAYER,
  countsTowardTotal,
  createArborEntry,
  createEscapementTimeline,
  createRubyBolt,
  createTickPour,
  densityTable,
  hitStagesOf,
  screenSeconds,
  sectionNameAt,
  simulatePlausiblePlayer,
  type EscapementSpawnEntry,
} from './choreography';
import { ESCAPEMENT_BARS, ESCAPEMENT_DURATION, ESCAPEMENT_TIME, bar } from './timing';

declare const process: { argv: string[]; exitCode?: number } | undefined;

const BEAT = ESCAPEMENT_TIME.beatSeconds;

// The floor player holds for a bar, releases, and waits a bar: one six-lock
// sweep every two bars. The density must let that player clear most of the
// level and kill the boss. The steady player sweeps every bar.
export const FLOOR_KILL_RATE = 0.7;
export const STEADY_KILL_RATE = 0.9;

// Targets on screen at one instant, in any bar. Two sweeps' worth: the cap a
// player sweeping every two bars can honour when targets sit for about two bars.
export const PEAK_ON_SCREEN_CAP = 2 * MAX_LOCKS;

function describe(entry: EscapementSpawnEntry) {
  return `${entry.kind} at bar ${(entry.time / ESCAPEMENT_TIME.barSeconds).toFixed(3)}`;
}

export function runChoreographyTests() {
  const timeline = createEscapementTimeline();

  // Ordering, bounds, and the runner's hit-stage limits.
  for (let i = 1; i < timeline.length; i += 1) assert.ok(timeline[i - 1].time <= timeline[i].time, 'timeline is sorted');
  for (const entry of timeline) {
    assert.ok(entry.time >= 0 && entry.time < ESCAPEMENT_DURATION, `${describe(entry)} spawns inside the run`);
    const stages = hitStagesOf(entry);
    for (const hp of stages) assert.ok(hp >= 1 && hp <= MAX_LOCKS, `${describe(entry)} stage HP within 1..${MAX_LOCKS}`);
    assert.ok(screenSeconds(entry) > 0, `${describe(entry)} has an on-screen window`);
    assert.ok(entry.time + screenSeconds(entry) <= ESCAPEMENT_DURATION + 1e-9, `${describe(entry)} leaves before the run ends`);
    if (entry.data.role !== 'bolt') assert.ok(entry.data.placement.leadBeats > 0);
  }

  // Roster HP follows the spec: tick 2, ratchet three stages of 2, wasp 2, jewel 3, arbor 3 + 3.
  const byKind = (kind: EscapementSpawnEntry['kind']) => timeline.filter((entry) => entry.kind === kind);
  for (const entry of byKind('mote')) assert.deepEqual(hitStagesOf(entry), [1]);
  for (const entry of byKind('burr')) assert.deepEqual(hitStagesOf(entry), [1]);
  for (const entry of byKind('chime')) assert.deepEqual(hitStagesOf(entry), [1]);
  for (const entry of byKind('tick')) assert.deepEqual(hitStagesOf(entry), [2]);
  for (const entry of byKind('ratchet')) assert.deepEqual(hitStagesOf(entry), [2, 2, 2]);
  for (const entry of byKind('wasp')) assert.deepEqual(hitStagesOf(entry), [2]);
  for (const entry of byKind('jewel')) assert.deepEqual(hitStagesOf(entry), [3]);
  assert.equal(byKind('jewel').length, 2);
  for (const entry of byKind('jewel')) {
    assert.equal(entry.lockable, false, `${describe(entry)} starts unlockable; boss-logic opens it`);
    assert.equal(entry.time, bar(ESCAPEMENT_BARS.boss));
  }
  assert.equal(byKind('arbor').length, 0, 'the arbor spawns at runtime when both jewels are broken');
  const arbor = createArborEntry(bar(50));
  assert.deepEqual(hitStagesOf(arbor), [3, 3]);
  assert.equal(arbor.lockable, false);
  assert.ok(countsTowardTotal(arbor));
  assert.ok(Math.abs(arbor.time + screenSeconds(arbor) - BOSS_DEADLINE) < 1e-9, 'the arbor expires at the deadline');
  assert.equal(byKind('bolt').length, 0, 'bolts are fired at runtime, never authored');

  // Every kind sits in the sections the spec gives it.
  const sectionsOf = (kind: EscapementSpawnEntry['kind']) => new Set(byKind(kind).map((entry) => sectionNameAt(entry.time)));
  assert.deepEqual([...sectionsOf('mote')], ['barrel']);
  assert.deepEqual([...sectionsOf('ratchet')].sort(), ['pendulum', 'train']);
  assert.deepEqual([...sectionsOf('wasp')].sort(), ['boss', 'orrery']);
  assert.deepEqual([...sectionsOf('burr')].sort(), ['boss', 'orrery', 'train']);
  assert.deepEqual([...sectionsOf('tick')].sort(), ['pendulum', 'train']);
  assert.deepEqual([...sectionsOf('chime')].sort(), ['boss', 'free-run', 'pendulum']);

  // Tick: walk, a one-beat pause, then the leap.
  for (const entry of byKind('tick')) {
    assert.ok(entry.data.role === 'tick');
    assert.equal(entry.data.leapBeat, entry.data.walkBeats + 1, `${describe(entry)} pauses one beat before leaping`);
  }

  // Wasps fire every two bars while alive, on downbeats, and never after the camera passes them.
  for (const entry of byKind('wasp')) {
    assert.ok(entry.data.role === 'wasp');
    const passAt = entry.time + screenSeconds(entry);
    assert.ok(entry.data.fireTimes.length >= 1, `${describe(entry)} fires at least once`);
    entry.data.fireTimes.forEach((fire, i) => {
      assert.ok(Math.abs(fire - (entry.time + 8 * BEAT * (i + 1))) < 1e-9, 'fires every two bars from spawn');
      assert.ok(fire < passAt, 'fires only while on screen');
      const beatIndex = fire / BEAT;
      assert.ok(Math.abs(beatIndex - Math.round(beatIndex)) < 1e-9 && Math.round(beatIndex) % 4 === 0, 'fires on a downbeat');
    });
  }
  const bolt = createRubyBolt(bar(19), 7);
  assert.equal(bolt.countsTowardTotal, false);
  assert.equal(bolt.kind, 'bolt');
  assert.ok(bolt.data.role === 'bolt' && bolt.data.waspId === 7);

  // Swing-path chimes reach the reticle at a swing extreme, on the side the bob is on.
  const swingChimes = byKind('chime').filter((entry) => entry.data.role === 'chime' && entry.data.placement.anchor === 'swing-path');
  assert.ok(swingChimes.length >= 12);
  for (const entry of swingChimes) {
    assert.ok(entry.data.role === 'chime');
    const arrival = entry.time + screenSeconds(entry);
    assert.ok(atSwingExtreme(arrival, 1e-6), `${describe(entry)} arrives at a swing extreme`);
    assert.equal(entry.data.side, pendulumSide(arrival), `${describe(entry)} hangs on the side of its extreme`);
    assert.ok(arrival >= bar(ESCAPEMENT_BARS.pendulum), 'no swing chime before the pendulum attaches');
  }

  // Free Run: one chime per beat at the dial numerals, I to XII, gone before the run ends.
  const dialChimes = byKind('chime').filter((entry) => entry.data.role === 'chime' && entry.data.placement.anchor === 'dial-numeral');
  assert.equal(dialChimes.length, 12);
  dialChimes.forEach((entry, i) => {
    assert.ok(entry.data.role === 'chime');
    assert.equal(entry.letter, DIAL_NUMERALS[i]);
    assert.equal(entry.data.placement.index, i + 1);
    assert.ok(Math.abs(entry.time - (bar(ESCAPEMENT_BARS.freeRun) + i * BEAT)) < 1e-9);
  });

  // Hand-offs: nothing spawns within a beat of bars 10 and 14. The Strike is a breath.
  for (const entry of timeline) {
    for (const handoff of HANDOFF_TIMES) {
      assert.ok(
        entry.time <= handoff - HANDOFF_CLEAR_SECONDS || entry.time >= handoff + HANDOFF_CLEAR_SECONDS,
        `${describe(entry)} spawns clear of the hand-off at ${handoff}s`,
      );
    }
    assert.ok(
      entry.time < bar(ESCAPEMENT_BARS.strike) || entry.time >= bar(ESCAPEMENT_BARS.pendulum),
      `${describe(entry)} stays out of the Strike breath`,
    );
    assert.ok(entry.time >= bar(2), 'the first two bars are clear');
  }

  // The boss escort ends before the deadline and the boss parts expire at it.
  for (const entry of timeline.filter((e) => sectionNameAt(e.time) === 'boss')) {
    assert.ok(entry.time + screenSeconds(entry) <= BOSS_DEADLINE + 1e-9, `${describe(entry)} clears by bar 56`);
  }

  // Tick pour: eight ticks over one bar, not counted toward the total.
  const pour = createTickPour(bar(47));
  assert.equal(pour.length, 8);
  for (const entry of pour) assert.equal(entry.countsTowardTotal, false);
  assert.ok(pour[pour.length - 1].time < bar(48));

  // Density: 90-130 counted targets plus the arbor, peak concurrency within two
  // sweeps, the Orrery the busiest section by targets per bar, and the boss's
  // twelve rings the largest lock demand on any one target.
  const total = timeline.filter(countsTowardTotal).length + 1;
  assert.ok(total >= 90 && total <= 130, `counted targets ${total} within 90..130`);
  // The arbor opens when the player breaks both jewels; bar 46 stands in for that moment.
  const rows = densityTable([...timeline, createArborEntry(bar(46))].sort((a, b) => a.time - b.time));
  for (const row of rows) {
    assert.ok(row.peakOnScreen <= PEAK_ON_SCREEN_CAP, `bar ${row.bar}: ${row.peakOnScreen} on screen exceeds ${PEAK_ON_SCREEN_CAP}`);
  }
  const meanTargets = (section: string) => {
    const own = rows.filter((row) => row.section === section);
    return own.reduce((sum, row) => sum + row.targets, 0) / own.length;
  };
  const demandOf = (entry: EscapementSpawnEntry) => hitStagesOf(entry).reduce((sum, hp) => sum + hp, 0);
  const bossDemand = [...byKind('jewel'), arbor].reduce((sum, entry) => sum + demandOf(entry), 0);
  assert.equal(bossDemand, 12, 'the boss takes twelve hits');
  for (const entry of timeline) assert.ok(demandOf(entry) <= 6, `${describe(entry)} needs no more than one full volley`);
  for (const section of ['barrel', 'train', 'pendulum']) {
    assert.ok(meanTargets('orrery') > meanTargets(section), `the Orrery averages more targets per bar than the ${section}`);
  }

  // Plausible players. The floor player sweeps once every two bars.
  const floor = simulatePlausiblePlayer(FLOOR_PLAYER, createEscapementTimeline());
  assert.ok(floor.bossKilledAt !== null && floor.bossKilledAt < BOSS_DEADLINE, 'the floor player kills the boss before bar 56');
  assert.equal(floor.rings, 12);
  assert.ok(floor.killRate >= FLOOR_KILL_RATE, `floor kill rate ${floor.killRate.toFixed(3)} >= ${FLOOR_KILL_RATE}`);
  const steady = simulatePlausiblePlayer(STEADY_PLAYER, createEscapementTimeline());
  assert.ok(steady.bossKilledAt !== null && steady.bossKilledAt < BOSS_DEADLINE);
  assert.ok(steady.killRate >= STEADY_KILL_RATE, `steady kill rate ${steady.killRate.toFixed(3)} >= ${STEADY_KILL_RATE}`);

  return { total, rows, floor, steady };
}

if (process && process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const report = runChoreographyTests();
    console.log('Escapement choreography tests passed.');
    console.log(`Counted targets: ${report.total}`);
    console.log('bar | section | spawns | targets | lockDemand | peakOnScreen | kinds');
    for (const row of report.rows) {
      console.log(`${row.bar} | ${row.section} | ${row.spawns} | ${row.targets} | ${row.lockDemand} | ${row.peakOnScreen} | ${row.kinds}`);
    }
    for (const [name, result] of [['floor', report.floor], ['steady', report.steady]] as const) {
      console.log(`${name}: kills ${result.kills}/${result.total} (${(result.killRate * 100).toFixed(1)}%), volleys ${result.volleys}, boss killed at bar ${result.bossKilledAt === null ? 'never' : (result.bossKilledAt / ESCAPEMENT_TIME.barSeconds).toFixed(2)}`);
      console.log(`  per kind: ${Object.entries(result.perKind).map(([k, v]) => `${k} ${v.kills}/${v.total}`).join(', ')}`);
      console.log(`  per section: ${Object.entries(result.perSection).map(([k, v]) => `${k} ${v.kills}/${v.total}`).join(', ')}`);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
