import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { Hud } from '../../ui/hud';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail, smoothRunProgress } from '../../engine/rail';
import { isWord } from './words';

export const REZDLE_RUN_DURATION = 60;

export type RezdleEnemyKind = 'vowel' | 'consonant' | 'bonus';

export type RezdleSpawnData = {
  lead: number;
  offset: Vector3;
  drift: number;
  lifetime: number;
};

type RezdleSpawnEntry = LockOnSpawnEntry<RezdleEnemyKind, RezdleSpawnData>;

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

export function createRezdleRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0, 0),
      new Vector3(0, 0.8, -32),
      new Vector3(5, 1.4, -72),
      new Vector3(-4, 0.2, -116),
      new Vector3(6, 1.2, -164),
      new Vector3(-3, 0.6, -212),
      new Vector3(0, 1.1, -260),
      new Vector3(2, 0.4, -310),
    ],
    false,
    'catmullrom',
    0.35,
  );
}

function kindForLetter(letter: string, index: number, wordLength: number): RezdleEnemyKind {
  if (index === wordLength - 1) return 'bonus';
  return VOWELS.has(letter) ? 'vowel' : 'consonant';
}

function wave(time: number, word: string, extras: string[], row: number): RezdleSpawnEntry[] {
  const letters = [...word, ...extras].map((letter) => letter.toUpperCase());
  const radius = 4.4 + (row % 2) * 0.8;
  const yBase = (row % 3 - 1) * 1.4;
  return letters.map((letter, index) => {
    const centered = index - (letters.length - 1) / 2;
    const arc = (centered / Math.max(1, letters.length - 1)) * Math.PI;
    return {
      time: time + index * 0.1,
      kind: kindForLetter(letter, index, word.length),
      letter,
      data: {
        lead: 8.5 + (row % 2) * 0.8,
        offset: new Vector3(centered * 2.15, yBase + Math.sin(arc) * radius * 0.32, 0),
        drift: row * 0.71 + index * 0.43,
        lifetime: 10.5,
      },
    };
  });
}

export const REZDLE_TIMELINE: RezdleSpawnEntry[] = [
  ...wave(1.0, 'CODE', ['A', 'N', 'S'], 0),
  ...wave(6.0, 'PLAY', ['E', 'R', 'T'], 1),
  ...wave(11.0, 'RAIL', ['O', 'D', 'S'], 2),
  ...wave(16.0, 'FIRE', ['A', 'L', 'N'], 3),
  ...wave(21.0, 'WAVE', ['I', 'T', 'S'], 4),
  ...wave(26.0, 'STAR', ['E', 'O', 'N'], 5),
  ...wave(31.0, 'LINE', ['A', 'C', 'K'], 6),
  ...wave(36.0, 'LOCK', ['E', 'A', 'R'], 7),
  ...wave(41.0, 'BEAM', ['O', 'S', 'T'], 8),
  ...wave(46.0, 'GLOW', ['A', 'I', 'N'], 9),
  ...wave(51.0, 'NOTE', ['R', 'S', 'U'], 10),
  ...wave(55.0, 'GRID', ['A', 'E', 'T'], 11),
].sort((a, b) => a.time - b.time);

export function createRezdleGameplay(bus: EventBus, hud: Hud): LockOnRunnerLevel<RezdleEnemyKind, RezdleSpawnData> {
  const formedWords: string[] = [];

  bus.on('runstart', () => {
    formedWords.length = 0;
    hud.setCallout('');
  });

  return {
    duration: REZDLE_RUN_DURATION,
    createRail: createRezdleRail,
    spawnTimeline: REZDLE_TIMELINE,
    easeRunProgress: smoothRunProgress,
    lockRadiusNdc: 0.06,
    scoreForKill: () => 25,
    scoreForVolley(results) {
      const candidate = results
        .filter((result) => result.killed)
        .map((result) => result.enemy.letter ?? '')
        .join('')
        .toUpperCase();
      if (candidate.length < 3 || !isWord(candidate)) return 0;
      const bonus = 100 * (candidate.length - 2) ** 2;
      formedWords.push(candidate);
      hud.setCallout(candidate);
      return bonus;
    },
    detailsForRun() {
      return formedWords.length > 0 ? formedWords : undefined;
    },
    updateEnemy({ enemy, runTime, runProgress, age, curve, camera }) {
      const anchorTime = Math.min(REZDLE_RUN_DURATION, enemy.entry.time + enemy.entry.data.lead + age * 0.16);
      const anchorU = smoothRunProgress(anchorTime, REZDLE_RUN_DURATION);
      const offset = enemy.entry.data.offset.clone();
      offset.x += Math.sin(age * 0.52 + enemy.entry.data.drift) * 0.42;
      offset.y += Math.cos(age * 0.48 + enemy.entry.data.drift) * 0.3;
      offset.z += Math.sin(age * 0.35 + enemy.id) * 0.55;

      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(Math.sin(runTime * 0.65 + enemy.entry.data.drift) * 0.08);
      const tooFarBehind = runProgress > MathUtils.clamp(anchorU + 0.065, 0, 1);
      return age > enemy.entry.data.lifetime || tooFarBehind;
    },
  };
}
