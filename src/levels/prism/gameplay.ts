import { CatmullRomCurve3, Vector3 } from 'three';
import type { LockOnRunnerLevel } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';

export const PRISM_RUN_DURATION = 30;

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

const PRISM_WAVES: PrismSpawnEntry[] = [];

function addFan(time: number, kind: PrismEnemyKind, pattern: PrismPattern, count: number, radius: number, lead = 4.4) {
  for (let i = 0; i < count; i += 1) {
    PRISM_WAVES.push({
      time: time + i * 0.14,
      kind,
      data: {
        lead,
        lane: i - (count - 1) / 2,
        radius,
        phase: (i / Math.max(1, count)) * Math.PI * 2,
        pattern,
      },
    });
  }
}

addFan(1.0, 'gate', 'spiral', 5, 4.8, 4.6);
addFan(4.4, 'comet', 'zipper', 6, 6.4, 4.2);
addFan(8.2, 'echo', 'bloom', 4, 3.4, 5.0);
addFan(11.8, 'gate', 'spiral', 7, 6.0, 4.6);
addFan(16.0, 'comet', 'zipper', 5, 7.2, 4.0);
addFan(20.2, 'echo', 'bloom', 6, 4.2, 4.8);
addFan(25.0, 'gate', 'spiral', 8, 6.8, 3.4);

export const PRISM_TIMELINE = PRISM_WAVES.sort((a, b) => a.time - b.time);

export const prismGameplay: LockOnRunnerLevel<PrismEnemyKind, PrismSpawnData> = {
  duration: PRISM_RUN_DURATION,
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
