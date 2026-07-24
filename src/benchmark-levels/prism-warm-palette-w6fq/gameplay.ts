import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { WARM_BPM, WARM_MARKERS, WARM_RUN_DURATION, WARM_TIME } from './timing';

export { WARM_BPM, WARM_RUN_DURATION } from './timing';

export type WarmEnemyKind = 'gate' | 'comet' | 'echo';
export type WarmPattern = 'spiral' | 'zipper' | 'bloom';

export type WarmSpawnData = {
  lead: number;
  lane: number;
  radius: number;
  phase: number;
  pattern: WarmPattern;
};

export function createWarmRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 1, 0),
      new Vector3(-8, 6, -28),
      new Vector3(8, -4, -58),
      new Vector3(18, 4, -92),
      new Vector3(-16, -6, -126),
      new Vector3(-8, 7, -162),
      new Vector3(15, -2, -198),
      new Vector3(0, 2, -238),
    ],
    false,
    'catmullrom',
    0.28,
  );
}

type WarmSpawnEntry = {
  time: number;
  kind: WarmEnemyKind;
  data: WarmSpawnData;
};

const FAN_STAGGER = WARM_TIME.seconds(0.14);

type WarmFan = {
  time: number;
  kind: WarmEnemyKind;
  pattern: WarmPattern;
  count: number;
  radius: number;
  lead?: number;
};

const WARM_FANS: readonly WarmFan[] = [
  { time: WARM_MARKERS.firstGateFan, kind: 'gate', pattern: 'spiral', count: 5, radius: 4.8, lead: 4.6 },
  { time: WARM_MARKERS.firstCometFan, kind: 'comet', pattern: 'zipper', count: 6, radius: 6.4, lead: 4.2 },
  { time: WARM_MARKERS.firstEchoFan, kind: 'echo', pattern: 'bloom', count: 4, radius: 3.4, lead: 5.0 },
  { time: WARM_MARKERS.secondGateFan, kind: 'gate', pattern: 'spiral', count: 7, radius: 6.0, lead: 4.6 },
  { time: WARM_MARKERS.secondCometFan, kind: 'comet', pattern: 'zipper', count: 5, radius: 7.2, lead: 4.0 },
  { time: WARM_MARKERS.secondEchoFan, kind: 'echo', pattern: 'bloom', count: 6, radius: 4.2, lead: 4.8 },
  { time: WARM_MARKERS.finalGateFan, kind: 'gate', pattern: 'spiral', count: 8, radius: 6.8, lead: 3.4 },
] as const;

function buildFan({ time, kind, pattern, count, radius, lead = 4.4 }: WarmFan): WarmSpawnEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    time: time + i * FAN_STAGGER,
    kind,
    data: {
      lead,
      lane: i - (count - 1) / 2,
      radius,
      phase: (i / Math.max(1, count)) * Math.PI * 2,
      pattern,
    },
  }));
}

function buildWarmTimeline() {
  return WARM_FANS.flatMap(buildFan).sort((a, b) => a.time - b.time);
}

export const WARM_TIMELINE = buildWarmTimeline();

export const prismWarmGameplay: LockOnRunnerLevel<WarmEnemyKind, WarmSpawnData> = {
  duration: WARM_RUN_DURATION,
  bpm: WARM_BPM,
  createRail: createWarmRail,
  spawnTimeline: WARM_TIMELINE,
  easeRunProgress: smoothRunProgress,
  scoreForKill(volleySize, enemy) {
    const base = enemy.kind === 'echo' ? 140 : enemy.kind === 'comet' ? 115 : 100;
    return Math.round(base * (1 + Math.max(0, volleySize - 1) * 0.12));
  },
  updateEnemy({ enemy, runTime, runProgress, age, curve, camera, railAnchor }) {
    const { data } = enemy.entry;
    const anchorU = railAnchor(data.lead);
    const drift = new Vector3();

    if (data.pattern === 'spiral') {
      const angle = data.phase + age * 1.7 + runTime * 0.16;
      drift.set(Math.cos(angle) * data.radius, Math.sin(angle) * data.radius, 0);
    } else if (data.pattern === 'zipper') {
      const side = data.lane % 2 === 0 ? 1 : -1;
      drift.set(side * (data.radius - age * 3.2), Math.sin(data.phase + age * 2.5) * 2.1, Math.sin(age * 3) * 1.5);
    } else {
      const flower = data.radius + Math.sin(age * 2.8 + data.phase) * 2.0;
      drift.set(Math.cos(data.phase) * flower, data.lane * 1.45 + Math.sin(age * 1.7) * 0.8, Math.sin(data.phase) * 1.2);
    }

    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, drift));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(data.phase + runTime * (enemy.kind === 'comet' ? -1.2 : 0.8));
    enemy.mesh.rotateX(Math.sin(runTime + enemy.id) * 0.35);

    return runProgress > anchorU + 0.022;
  },
};
