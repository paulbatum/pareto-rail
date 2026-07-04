import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { Hud } from '../../ui/hud';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { sampleRailFrame, smoothRunProgress } from '../../engine/rail';
import { isWord } from './words';

// 84 BPM: one 4/4 bar is 60/84*4 s, so 21 bars land on exactly 60 seconds.
export const BPM = 84;
export const BAR = (60 / BPM) * 4;
export const REZDLE_RUN_DURATION = 60;

export type RezdleEnemyKind = 'vowel' | 'consonant' | 'bonus';

export type RezdleSpawnData = {
  slot: Vector3;
  flyFrom: Vector3;
  holdEnd: number;
  anchorU: number;
  seed: number;
};

type RezdleSpawnEntry = LockOnSpawnEntry<RezdleEnemyKind, RezdleSpawnData>;

const VOWELS = new Set([...'AEIOU']);
const RARE = new Set([...'JKQVWXZ']);
const WORD_BONUS = [0, 0, 0, 100, 250, 500, 900, 1400, 2200];
const FLY_IN = 1.0;
const EXIT_LIFE = 1.15;
const RACK_DISTANCE = 18;

export function kindForLetter(letter: string): RezdleEnemyKind {
  if (VOWELS.has(letter)) return 'vowel';
  if (RARE.has(letter)) return 'bonus';
  return 'consonant';
}

export function createRezdleRail() {
  // Long and gentle: slow S-curves and shallow rises so aim stays steady
  // while a rack is on screen.
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

// Racks of type: each is one intended word plus decoy letters, arriving on a
// phrase boundary of the 84 BPM score and holding in formation while the
// camera closes in.
type RackShape = 'line' | 'arch' | 'stagger';
type Rack = { bar: number; holdBars: number; word: string; decoys: string; shape: RackShape };

const RACKS: Rack[] = [
  { bar: 1, holdBars: 2.5, word: 'MOON', decoys: 'TS', shape: 'line' },
  { bar: 3.5, holdBars: 2.5, word: 'TRAIN', decoys: 'EO', shape: 'arch' },
  { bar: 6, holdBars: 2.5, word: 'LIGHT', decoys: 'SAE', shape: 'stagger' },
  { bar: 8.5, holdBars: 2.5, word: 'STORM', decoys: 'EAI', shape: 'arch' },
  { bar: 11, holdBars: 2.5, word: 'WINTER', decoys: 'AOS', shape: 'stagger' },
  { bar: 13.5, holdBars: 2.5, word: 'SILVER', decoys: 'TAO', shape: 'stagger' },
  { bar: 16, holdBars: 2.25, word: 'MACHINE', decoys: 'ORS', shape: 'stagger' },
  { bar: 18.25, holdBars: 2.5, word: 'MIDNIGHT', decoys: 'EA', shape: 'arch' },
];

function lcg(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function shuffled<T>(items: T[], rand: () => number) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function slotOffsets(shape: RackShape, count: number): Array<{ x: number; y: number }> {
  const offsets: Array<{ x: number; y: number }> = [];
  if (shape === 'stagger') {
    const columns = Math.ceil(count / 2);
    for (let i = 0; i < count; i += 1) {
      const column = Math.floor(i / 2);
      const top = i % 2 === 0;
      offsets.push({
        x: (column - (columns - 1) / 2) * 2.7 + (top ? 0 : 1.1),
        y: top ? 1.9 : -0.9,
      });
    }
    return offsets;
  }
  const spacing = count >= 10 ? 2.1 : 2.35;
  for (let i = 0; i < count; i += 1) {
    const centered = i - (count - 1) / 2;
    const arc = (centered / Math.max(1, (count - 1) / 2)) * (Math.PI / 2);
    offsets.push({
      x: centered * spacing,
      y: shape === 'arch' ? Math.cos(arc) * 2.2 - 0.4 : (i % 2 === 0 ? 0.35 : -0.35),
    });
  }
  return offsets;
}

function buildTimeline(): RezdleSpawnEntry[] {
  const rail = createRezdleRail();
  const entries: RezdleSpawnEntry[] = [];

  RACKS.forEach((rack, rackIndex) => {
    const rand = lcg(rackIndex * 7919 + 17);
    const letters = shuffled([...(rack.word + rack.decoys)], rand);
    const spawnTime = rack.bar * BAR;
    const holdEnd = (rack.bar + rack.holdBars) * BAR;
    const anchorU = smoothRunProgress(holdEnd, REZDLE_RUN_DURATION);
    const frame = sampleRailFrame(rail, anchorU);
    const anchor = frame.position.clone().addScaledVector(frame.tangent, RACK_DISTANCE);
    const offsets = slotOffsets(rack.shape, letters.length);

    letters.forEach((letter, index) => {
      const offset = offsets[index];
      const slot = anchor
        .clone()
        .addScaledVector(frame.right, offset.x)
        .addScaledVector(frame.up, offset.y + 0.5);
      const side = rand() > 0.5 ? 1 : -1;
      const flyFrom = slot
        .clone()
        .addScaledVector(frame.right, side * (7 + rand() * 6))
        .addScaledVector(frame.up, 4 + rand() * 5)
        .addScaledVector(frame.tangent, -6 - rand() * 4);
      entries.push({
        // Letters ripple in left to right like a line of type being set.
        time: spawnTime + (offset.x + 12) * 0.028,
        kind: kindForLetter(letter),
        letter,
        data: { slot, flyFrom, holdEnd, anchorU, seed: rand() * Math.PI * 2 },
      });
    });
  });

  return entries.sort((a, b) => a.time - b.time);
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
      const { slot, flyFrom, holdEnd, anchorU, seed } = enemy.entry.data;
      const mesh = enemy.mesh;
      const locked = mesh.userData.locked === true;
      const exitAge = runTime - holdEnd;

      if (exitAge <= 0) {
        if (age < FLY_IN) {
          // Ease into the rack slot.
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

      // Rack expired: loose type falls off the press.
      mesh.position.copy(slot);
      mesh.position.y -= exitAge * exitAge * 7;
      mesh.position.x += Math.sin(seed) * exitAge * 2.2;
      mesh.quaternion.copy(camera.quaternion);
      mesh.rotateZ(exitAge * (1.5 + Math.sin(seed)) * (seed > Math.PI ? 1 : -1));
      mesh.scale.setScalar(Math.max(0.05, 1 - exitAge * 0.55));
      return exitAge > EXIT_LIFE || runProgress > MathUtils.clamp(anchorU + 0.05, 0, 1);
    },
  };
}
