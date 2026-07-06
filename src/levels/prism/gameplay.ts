import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { PRISM_BPM, PRISM_MARKERS, PRISM_RUN_DURATION, PRISM_TIME } from './timing';

export { PRISM_BPM, PRISM_RUN_DURATION } from './timing';

export type PrismEnemyKind = 'gate' | 'comet' | 'echo';
export type PrismPattern = 'spiral' | 'zipper' | 'bloom';

export type PrismSpawnData = {
  lead: number;
  lane: number;
  radius: number;
  phase: number;
  pattern: PrismPattern;
};

export function createPrismRail() {
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

type PrismSpawnEntry = {
  time: number;
  kind: PrismEnemyKind;
  data: PrismSpawnData;
};

const FAN_STAGGER = PRISM_TIME.seconds(0.14);

type PrismFan = {
  time: number;
  kind: PrismEnemyKind;
  pattern: PrismPattern;
  count: number;
  radius: number;
  lead?: number;
};

const PRISM_FANS: readonly PrismFan[] = [
  { time: PRISM_MARKERS.firstGateFan, kind: 'gate', pattern: 'spiral', count: 5, radius: 4.8, lead: 4.6 },
  { time: PRISM_MARKERS.firstCometFan, kind: 'comet', pattern: 'zipper', count: 6, radius: 6.4, lead: 4.2 },
  { time: PRISM_MARKERS.firstEchoFan, kind: 'echo', pattern: 'bloom', count: 4, radius: 3.4, lead: 5.0 },
  { time: PRISM_MARKERS.secondGateFan, kind: 'gate', pattern: 'spiral', count: 7, radius: 6.0, lead: 4.6 },
  { time: PRISM_MARKERS.secondCometFan, kind: 'comet', pattern: 'zipper', count: 5, radius: 7.2, lead: 4.0 },
  { time: PRISM_MARKERS.secondEchoFan, kind: 'echo', pattern: 'bloom', count: 6, radius: 4.2, lead: 4.8 },
  { time: PRISM_MARKERS.finalGateFan, kind: 'gate', pattern: 'spiral', count: 8, radius: 6.8, lead: 3.4 },
] as const;

function buildFan({ time, kind, pattern, count, radius, lead = 4.4 }: PrismFan): PrismSpawnEntry[] {
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

function buildPrismTimeline() {
  return PRISM_FANS.flatMap(buildFan).sort((a, b) => a.time - b.time);
}

export const PRISM_TIMELINE = buildPrismTimeline();

export const prismGameplay: LockOnRunnerLevel<PrismEnemyKind, PrismSpawnData> = {
  duration: PRISM_RUN_DURATION,
  bpm: PRISM_BPM,
  createRail: createPrismRail,
  spawnTimeline: PRISM_TIMELINE,
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
