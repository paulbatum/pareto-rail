import { CatmullRomCurve3, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { Hud } from '../../ui/hud';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { setGlyphLocked } from './glyphs';
import { isWord } from './words';

// 84 BPM: one 4/4 bar is 60/84*4 s, so 21 bars land on exactly 60 seconds.
export const BPM = 84;
export const BAR = (60 / BPM) * 4;
const BEAT = 60 / BPM;
export const REZDLE_RUN_DURATION = 60;

export type RezdleEnemyKind = 'vowel' | 'consonant' | 'bonus';

export type RezdleSpawnData = {
  slotX: number;
  slotY: number;
  exitAt: number;
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
// Letters hold a fixed angular slot on screen (offsets are world units at
// REFERENCE_DISTANCE) while easing from FAR to NEAR, so nothing ever covers
// anything else — a letter owns its patch of screen for its whole life.
const REFERENCE_DISTANCE = 22;
const FAR_DISTANCE = 30;
const NEAR_DISTANCE = 16;

export function kindForLetter(letter: string): RezdleEnemyKind {
  if (VOWELS.has(letter)) return 'vowel';
  if (RARE.has(letter)) return 'bonus';
  return 'consonant';
}

export function createRezdleRail() {
  // A slow weaving arc through the press room; letters are camera-relative,
  // so the curvature is scenery and parallax, not an aiming hazard.
  return new CatmullRomCurve3(
    [
      new Vector3(0, 0.8, 0),
      new Vector3(5, 1.4, -40),
      new Vector3(12, 2.4, -84),
      new Vector3(6, 1.0, -128),
      new Vector3(-6, 2.0, -172),
      new Vector3(-13, 3.0, -216),
      new Vector3(-6, 1.4, -262),
      new Vector3(3, 1.8, -318),
    ],
    false,
    'catmullrom',
    0.4,
  );
}

// The letter stream: authored words flow through the case in order, each
// followed by a decoy that extends it (MOON→S, RAIN→T for TRAIN, SILVER→Y).
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

// Two batches of four open the run so the case fills quickly, trios keep it
// flowing, and a final four densify the MIDNIGHT finale.
const BATCH_SIZES = [4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4];

// 20 hand-scattered screen slots (world units at REFERENCE_DISTANCE), rows
// left-to-right so a batch lands as a loose neighborhood cluster. With ~14
// letters alive at once, a slot is long vacant before it recurs.
const SLOTS: Array<[number, number]> = [
  [-8.2, 3.3], [-4.6, 3.7], [-1.0, 3.1], [2.6, 3.8], [6.2, 3.2], [9.0, 1.9],
  [-12.2, 0.1], [-9.6, 1.1], [-6.0, 1.4], [-2.6, 0.9], [0.8, 1.5], [4.2, 1.1], [7.4, -0.1], [12.2, 0.7],
  [-7.8, -1.1], [-4.2, -1.4], [-0.8, -0.9], [2.4, -1.3], [5.8, -1.9], [9.8, -2.5],
];

const SPAWN_OFFSETS = [0, BEAT * (2 / 3), BEAT, BEAT * (5 / 3)];

function lcg(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function buildTimeline(): RezdleSpawnEntry[] {
  const entries: RezdleSpawnEntry[] = [];
  let index = 0;

  BATCH_SIZES.forEach((batchSize, batch) => {
    for (let within = 0; within < batchSize; within += 1) {
      const letter = STREAM[index];
      const rand = lcg(index * 7919 + 29);
      const time = (1 + batch) * BAR + SPAWN_OFFSETS[within];
      const [slotX, slotY] = SLOTS[index % SLOTS.length];
      entries.push({
        time,
        kind: kindForLetter(letter),
        letter,
        data: { slotX, slotY, exitAt: time + LIFETIME, seed: rand() * Math.PI * 2 },
      });
      index += 1;
    }
  });

  return entries;
}

export const REZDLE_TIMELINE: RezdleSpawnEntry[] = buildTimeline();

const cameraForward = new Vector3();
const cameraRight = new Vector3();
const cameraUp = new Vector3();

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

    updateEnemy({ enemy, runTime, age, camera }) {
      const { slotX, slotY, exitAt, seed } = enemy.entry.data;
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

      let distance = FAR_DISTANCE - (FAR_DISTANCE - NEAR_DISTANCE) * Math.min(age / LIFETIME, 1);
      let offsetX = slotX;
      let offsetY = slotY;
      let scale = 1;
      let tilt = 0;
      let dead = false;

      if (exitAge <= 0) {
        if (age < FLY_IN) {
          // Float in from beyond the slot's own edge of the screen.
          const t = age / FLY_IN;
          const eased = t * t * (3 - 2 * t);
          const spread = 1 + (1 - eased) * 1.1;
          offsetX *= spread;
          offsetY = offsetY * spread + (1 - eased) * 5;
          distance += (1 - eased) * 9;
          scale = 0.55 + 0.45 * eased;
          tilt = (1 - eased) * Math.sin(seed) * 0.9;
        } else {
          // Hold: each kind idles differently. Vowels breathe, consonants
          // sit almost still, rare letters swing like hanging ligatures.
          const hold = age - FLY_IN;
          if (enemy.kind === 'vowel') {
            offsetY += Math.sin(hold * 1.7 + seed) * 0.18;
            scale = 1 + Math.sin(hold * 2.1 + seed) * 0.04;
          } else if (enemy.kind === 'bonus') {
            tilt = Math.sin(hold * 1.9 + seed) * 0.14;
            offsetY += Math.cos(hold * 1.9 + seed) * 0.12;
          } else {
            offsetX += Math.sin(hold * 0.9 + seed) * 0.06;
          }
          scale *= locked ? 1.12 : 1;
        }
      } else {
        // Time's up: the letter drifts out through its own edge and fades.
        const spread = 1 + exitAge * 1.1;
        offsetX *= spread;
        offsetY = offsetY * spread + exitAge * 2.0;
        tilt = exitAge * 0.8 * (seed > Math.PI ? 1 : -1);
        scale = Math.max(0.05, 1 - exitAge * 0.65);
        dead = exitAge > EXIT_LIFE;
      }

      const angular = distance / REFERENCE_DISTANCE;
      camera.getWorldDirection(cameraForward);
      cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      mesh.position
        .copy(camera.position)
        .addScaledVector(cameraForward, distance)
        .addScaledVector(cameraRight, offsetX * angular)
        .addScaledVector(cameraUp, offsetY * angular);
      mesh.quaternion.copy(camera.quaternion);
      if (tilt !== 0) mesh.rotateZ(tilt);
      mesh.scale.setScalar(scale);
      return dead;
    },
  };
}
