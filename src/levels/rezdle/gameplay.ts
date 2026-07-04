import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { Hud } from '../../ui/hud';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { sampleRailFrame, smoothRunProgress } from '../../engine/rail';
import { setGlyphLocked } from './glyphs';
import { isWord } from './words';

// 84 BPM: one 4/4 bar is 60/84*4 s, so 21 bars land on exactly 60 seconds.
export const BPM = 84;
export const BAR = (60 / BPM) * 4;
const BEAT = 60 / BPM;
export const REZDLE_RUN_DURATION = 60;

export type RezdleEnemyKind = 'vowel' | 'consonant' | 'bonus';

export type RezdleSpawnData = {
  slot: Vector3;
  flyFrom: Vector3;
  exitAt: number;
  anchorU: number;
  seed: number;
};

type RezdleSpawnEntry = LockOnSpawnEntry<RezdleEnemyKind, RezdleSpawnData>;

const VOWELS = new Set([...'AEIOU']);
const RARE = new Set([...'JKQVWXZ']);
const WORD_BONUS = [0, 0, 0, 100, 250, 500, 900, 1400, 2200];
const FLY_IN = 1.3;
const EXIT_LIFE = 1.4;
const LIFETIME = 4.5 * BAR;
const MAX_LOCK_HOLD = BAR;
const FLOW_DISTANCE = 17;

export function kindForLetter(letter: string): RezdleEnemyKind {
  if (VOWELS.has(letter)) return 'vowel';
  if (RARE.has(letter)) return 'bonus';
  return 'consonant';
}

export function createRezdleRail() {
  // Long and gentle: slow S-curves and shallow rises so aim stays steady
  // while letters drift through.
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0.6, 0),
      new Vector3(1.5, 0.9, -44),
      new Vector3(4, 1.3, -90),
      new Vector3(1, 0.7, -136),
      new Vector3(-3.5, 1.1, -182),
      new Vector3(-1, 1.5, -228),
      new Vector3(2.5, 0.9, -274),
      new Vector3(0, 1.2, -318),
    ],
    false,
    'catmullrom',
    0.3,
  );
}

// The letter stream: authored words flow through the case in order, each
// followed by a decoy that extends it (MOON→S, RAIN→T for TRAIN, SILVER→Y).
// Trios of consecutive letters float in every bar and each letter floats out
// ~4.5 bars later, so the pool slowly flows instead of arriving in racks.
const STREAM: string[] = [
  ...'MOON', 'S',
  ...'RAIN', 'T',
  ...'LIGHT', 'S',
  ...'STORM', 'E',
  ...'WINTER', 'S',
  ...'SILVER', 'Y',
  ...'MACHINE',
  ...'MIDNIGHT',
];

// 18 hand-scattered slots with comfortable lock spacing; consecutive letters
// take consecutive slots, so a trio lands as a loose neighborhood cluster.
// With ~14 letters alive at once, a slot is long vacant before it recurs.
const SLOTS: Array<[number, number]> = [
  [-8.2, 2.8], [-4.6, 3.2], [-1.0, 2.6], [2.6, 3.3], [6.2, 2.7], [9.0, 1.4],
  [-9.6, 0.6], [-6.0, 0.9], [-2.6, 0.4], [0.8, 1.0], [4.2, 0.6], [7.4, -0.6],
  [-7.8, -1.6], [-4.2, -1.9], [-0.8, -1.4], [2.4, -1.8], [5.8, -2.4], [9.8, -3.0],
];

const TRIO_OFFSETS = [0, BEAT * (2 / 3), BEAT];

function lcg(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function buildTimeline(): RezdleSpawnEntry[] {
  const rail = createRezdleRail();

  return STREAM.map((letter, index) => {
    const rand = lcg(index * 7919 + 29);
    const trio = Math.floor(index / 3);
    const time = (1 + trio) * BAR + TRIO_OFFSETS[index % 3];
    const exitAt = time + LIFETIME;
    const anchorU = smoothRunProgress(exitAt, REZDLE_RUN_DURATION);
    const frame = sampleRailFrame(rail, anchorU);
    const [slotX, slotY] = SLOTS[index % SLOTS.length];
    const slot = frame.position
      .clone()
      .addScaledVector(frame.tangent, FLOW_DISTANCE)
      .addScaledVector(frame.right, slotX)
      .addScaledVector(frame.up, slotY + 0.5);
    const side = rand() > 0.5 ? 1 : -1;
    const flyFrom = slot
      .clone()
      .addScaledVector(frame.right, side * (6 + rand() * 5))
      .addScaledVector(frame.up, 5 + rand() * 4)
      .addScaledVector(frame.tangent, -8 - rand() * 4);
    return {
      time,
      kind: kindForLetter(letter),
      letter,
      data: { slot, flyFrom, exitAt, anchorU, seed: rand() * Math.PI * 2 },
    };
  });
}

export const REZDLE_TIMELINE: RezdleSpawnEntry[] = buildTimeline();

export function createRezdleGameplay(bus: EventBus, hud: Hud): LockOnRunnerLevel<RezdleEnemyKind, RezdleSpawnData> {
  const formedWords: string[] = [];

  bus.on('runstart', () => {
    formedWords.length = 0;
  });

  return {
    duration: REZDLE_RUN_DURATION,
    createRail: createRezdleRail,
    spawnTimeline: REZDLE_TIMELINE,
    lockRadiusNdc: 0.06,

    scoreForKill(_volleySize, enemy) {
      if (enemy.kind === 'vowel') return 10;
      if (enemy.kind === 'bonus') return 40;
      return 20;
    },

    validateRelease(enemies) {
      const candidate = enemies.map((enemy) => enemy.letter ?? '').join('');
      return candidate.length >= 3 && isWord(candidate);
    },

    scoreForVolley(results) {
      const candidate = results
        .filter((result) => result.killed)
        .map((result) => result.enemy.letter ?? '')
        .join('');
      if (candidate.length < 3 || !isWord(candidate)) return 0;
      const bonus = WORD_BONUS[Math.min(candidate.length, WORD_BONUS.length - 1)];
      formedWords.push(candidate);
      hud.setCallout(`${candidate} +${bonus}`);
      return bonus;
    },

    detailsForRun() {
      return formedWords.length > 0 ? formedWords : undefined;
    },

    rankForRun(score) {
      if (score >= 5200) return 'S';
      if (score >= 3600) return 'A';
      if (score >= 2200) return 'B';
      if (score >= 1000) return 'C';
      return 'D';
    },

    updateEnemy({ enemy, runTime, runProgress, age, camera }) {
      const { slot, flyFrom, exitAt, anchorU, seed } = enemy.entry.data;
      const mesh = enemy.mesh;
      const locked = mesh.userData.locked === true;

      // Rejected release: the type jams — blink the ink red, then settle.
      if (mesh.userData.denied === true) {
        const deniedAt = (mesh.userData.deniedAt as number | undefined) ?? runTime;
        mesh.userData.deniedAt = deniedAt;
        const deniedFor = runTime - deniedAt;
        if (deniedFor > 0.55) {
          mesh.userData.denied = false;
          mesh.userData.deniedAt = undefined;
          setGlyphLocked(mesh, locked);
        } else {
          setGlyphLocked(mesh, Math.floor(deniedFor * 9) % 2 === 0);
        }
      }

      // A locked letter waits (up to a bar) before floating out, so a word
      // in progress does not dissolve under the reticle.
      let exitDelay = (mesh.userData.exitDelay as number | undefined) ?? 0;
      if (locked) {
        exitDelay = Math.min(Math.max(exitDelay, runTime + 0.25 - exitAt), MAX_LOCK_HOLD);
        mesh.userData.exitDelay = exitDelay;
      }
      const exitAge = runTime - (exitAt + exitDelay);

      if (exitAge <= 0) {
        if (age < FLY_IN) {
          // Float in from above the case.
          const t = age / FLY_IN;
          const eased = t * t * (3 - 2 * t);
          mesh.position.copy(flyFrom).lerp(slot, eased);
          mesh.quaternion.copy(camera.quaternion);
          mesh.rotateZ((1 - eased) * Math.sin(seed) * 0.9);
          mesh.scale.setScalar(0.6 + 0.4 * eased);
          return false;
        }

        // Hold: each kind idles differently. Vowels breathe, consonants sit
        // almost still, rare letters swing like hanging ligatures.
        const hold = age - FLY_IN;
        mesh.position.copy(slot);
        mesh.quaternion.copy(camera.quaternion);
        let scale = 1;
        if (enemy.kind === 'vowel') {
          mesh.position.y += Math.sin(hold * 1.7 + seed) * 0.18;
          scale = 1 + Math.sin(hold * 2.1 + seed) * 0.04;
        } else if (enemy.kind === 'bonus') {
          mesh.rotateZ(Math.sin(hold * 1.9 + seed) * 0.14);
          mesh.position.y += Math.cos(hold * 1.9 + seed) * 0.12;
        } else {
          mesh.position.x += Math.sin(hold * 0.9 + seed) * 0.06;
        }
        mesh.scale.setScalar(scale * (locked ? 1.12 : 1));
        return false;
      }

      // Time's up: the letter floats up and away, back into the dark.
      mesh.position.copy(slot);
      mesh.position.y += exitAge * 2.2;
      mesh.position.x += Math.sin(seed) * exitAge * 1.5;
      mesh.quaternion.copy(camera.quaternion);
      mesh.rotateZ(exitAge * 0.8 * (seed > Math.PI ? 1 : -1));
      mesh.scale.setScalar(Math.max(0.05, 1 - exitAge * 0.65));
      return exitAge > EXIT_LIFE || runProgress > MathUtils.clamp(anchorU + 0.045, 0, 1);
    },
  };
}
