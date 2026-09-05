// Dev-only fixture for the authored rail frame. The rail runs a straight
// approach, an S-bend banked to 60 degrees, a vertical loop, a stretch that
// aims at a beacon, and a corridor that rides a body rotating about its axis.
import { CatmullRomCurve3, MathUtils, Matrix4, Vector3 } from 'three';
import type { EventBus } from '../../../events';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../../engine/lock-on-runner';
import { attachRailFrame, offsetFromRail, type RailFrameConfig } from '../../../engine/rail';

export const FIXTURE_BPM = 120;
export const FIXTURE_DURATION = 48;

export type FixtureEnemyKind = 'orb' | 'blade';
export type FixtureSpawnData = { lead: number; x: number; y: number };

const LOOP_RADIUS = 40;
const LOOP_CENTER_Z = -420;
const CORRIDOR_START_Z = -760;
const CORRIDOR_END_Z = -1060;
/** Lateral offset of the corridor rail from the rotating body's axis. */
const CORRIDOR_RAIL_OFFSET = 14;
const CORRIDOR_SPIN_RADIANS_PER_SECOND = 0.35;

export const BEACON_POSITION = new Vector3(70, 40, -680);

function railPoints() {
  const points: Vector3[] = [
    new Vector3(0, 0, 0),
    new Vector3(0, 0, -80),
    new Vector3(-30, 0, -150),
    new Vector3(-40, 0, -200),
    new Vector3(0, 0, -260),
    new Vector3(30, 0, -310),
    new Vector3(10, 0, -360),
  ];
  // Vertical loop in the YZ plane, drifting 8 units in x so the exit clears the entry.
  for (let step = 0; step <= 12; step += 1) {
    const theta = (step / 12) * Math.PI * 2;
    points.push(new Vector3(
      8 * (step / 12),
      LOOP_RADIUS - LOOP_RADIUS * Math.cos(theta),
      LOOP_CENTER_Z + LOOP_RADIUS * Math.sin(-theta),
    ));
  }
  points.push(new Vector3(8, 0, -520), new Vector3(8, 0, -600), new Vector3(8, 0, -680));
  // Corridor: authored at t = 0 in the rotating body's local frame, whose axis is x = 0, y = 0.
  points.push(new Vector3(CORRIDOR_RAIL_OFFSET, 0, CORRIDOR_START_Z));
  points.push(new Vector3(CORRIDOR_RAIL_OFFSET, 0, (CORRIDOR_START_Z + CORRIDOR_END_Z) / 2));
  points.push(new Vector3(CORRIDOR_RAIL_OFFSET, 0, CORRIDOR_END_Z));
  points.push(new Vector3(0, 0, -1140), new Vector3(0, 0, -1200));
  return points;
}

/** Arc-length rail parameter of a control point, so ranges can be authored by point index. */
function uAtControlPoint(curve: CatmullRomCurve3, index: number) {
  const lengths = curve.getLengths(2000);
  const t = index / (curve.points.length - 1);
  return lengths[Math.round(t * 2000)] / lengths[2000];
}

export function createFixtureRail() {
  const curve = new CatmullRomCurve3(railPoints(), false, 'catmullrom', 0.5);
  const bankStart = uAtControlPoint(curve, 2);
  const bankEnd = uAtControlPoint(curve, 5);
  const beaconStart = uAtControlPoint(curve, 20);
  const beaconEnd = uAtControlPoint(curve, 22);
  const corridorStart = uAtControlPoint(curve, 23);
  const corridorEnd = uAtControlPoint(curve, 25);
  const spin = new Matrix4();
  const config: RailFrameConfig = {
    frame: 'parallel-transport',
    roll: [
      [bankStart, 0],
      [bankStart + (bankEnd - bankStart) * 0.3, -60],
      [bankStart + (bankEnd - bankStart) * 0.7, 60],
      [bankEnd, 0],
    ],
    lookTargets: [{ range: [beaconStart, beaconEnd], target: BEACON_POSITION, blend: 0.015 }],
    sections: [{
      range: [corridorStart, corridorEnd],
      parent: (time) => spin.makeRotationZ(time * CORRIDOR_SPIN_RADIANS_PER_SECOND),
      blend: 0.01,
    }],
  };
  return attachRailFrame(curve, config);
}

export const FIXTURE_LANDMARKS = (() => {
  const curve = createFixtureRail();
  return {
    bank: uAtControlPoint(curve, 3),
    loop: uAtControlPoint(curve, 13),
    beacon: (uAtControlPoint(curve, 20) + uAtControlPoint(curve, 22)) / 2,
    corridor: uAtControlPoint(curve, 24),
  };
})();

function buildTimeline(): Array<LockOnSpawnEntry<FixtureEnemyKind, FixtureSpawnData>> {
  const entries: Array<LockOnSpawnEntry<FixtureEnemyKind, FixtureSpawnData>> = [];
  const lanes = [-5, 0, 5];
  for (let time = 2; time < FIXTURE_DURATION - 6; time += 2.5) {
    const index = entries.length;
    entries.push({
      time,
      kind: index % 3 === 0 ? 'blade' : 'orb',
      data: { lead: 4, x: lanes[index % 3], y: 1.5 + (index % 2) * 2 },
    });
  }
  return entries;
}

export function createFixtureGameplay(bus: EventBus): LockOnRunnerLevel<FixtureEnemyKind, FixtureSpawnData> {
  void bus;
  return {
    duration: FIXTURE_DURATION,
    bpm: FIXTURE_BPM,
    createRail: createFixtureRail,
    spawnTimeline: buildTimeline(),
    updateEnemy({ enemy, age, curve, camera, railAnchor, runProgress }) {
      const data = enemy.entry.data;
      const anchorU = railAnchor(data.lead);
      const bob = Math.sin(age * 2 + enemy.id) * 0.4;
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, new Vector3(data.x, data.y + bob, 0)));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * (enemy.kind === 'blade' ? 2.4 : 0.6));
      return runProgress > MathUtils.clamp(anchorU + 0.01, 0, 1);
    },
  };
}
