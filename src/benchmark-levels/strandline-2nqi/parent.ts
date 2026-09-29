import { MathUtils, Quaternion, Vector3 } from 'three';
import type { EventBus } from '../../events';
import { bar, STRANDLINE_TIME } from './timing';
import type { StrandlineData, StrandlineEntry, StrandlineUpdate } from './types';
import { JELLY_MATRIX, PARENT_Y, toWorld, VEILS } from './world';

// The parent, dug in at the crown. It hides behind two veils of its own
// webbing and pumps out broods onto them; kill a veil's broods and that veil
// dies back. When both are gone the parent is bare and can be torn loose —
// two stages, the second a full six-lock volley.

export const PARENT_HIT_STAGES = [4, 6];
export const PARENT_START = bar(12);
// If the water is not clean by here the bell's own pulse throws the parent
// off, so the ending always gets its full pull-back.
export const PARENT_FAILSAFE = bar(21);

const BEAT = STRANDLINE_TIME.beatSeconds;
const HATCH_TRAVEL = 0.9;
const HATCH_STAGGER = BEAT * 0.5;
const VEIL_DIE_BACK = 1.15;
const SPORE_PERIOD = BEAT * 6;
export const VEIL_SPIN = [0.11, -0.15];

type Phase = 'idle' | 'wave' | 'dieback' | 'exposed' | 'freed';
export type FreedBy = 'kill' | 'pulse';

type SporeLauncher = (context: StrandlineUpdate, from: Vector3, speed?: number) => number;

const PARENT_CENTER_LOCAL = new Vector3(0, PARENT_Y, 0);
const PROXY_HOME = new Vector3(0, -4000, 0);
// The parent's face points down the axis at the rail: mesh +Z → jelly −Y.
const PARENT_ORIENTATION = new Quaternion()
  .setFromRotationMatrix(JELLY_MATRIX)
  .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));

/** Dev/inspection only: start the fight already bare, or let go a moment after it begins. */
export type ParentDebug = 'exposed' | 'freed';

export function createParentController(bus: EventBus, debug?: ParentDebug) {
  const parentEntry: StrandlineEntry = {
    time: PARENT_START,
    kind: 'parent',
    hitStages: PARENT_HIT_STAGES,
    lockable: false,
    data: { role: 'parent' },
  };

  let phase: Phase = 'idle';
  let veil = 0;
  let summonedAt = -1;
  let phaseSince = 0;
  let nextHatchAt = Infinity;
  let hatchQueue: Array<{ at: number; slot: number }> = [];
  let alive = new Set<number>();
  let parentId = -1;
  let nextSporeAt = Infinity;
  let sporeSide = 1;
  let freedAt: number | null = null;
  let freedBy: FreedBy | null = null;
  let lastRunTime = 0;
  let veilsCleared = 0;
  let stageBroken = false;

  const center = new Vector3();
  const scratch = new Vector3();

  function reset() {
    phase = 'idle';
    veil = 0;
    summonedAt = -1;
    phaseSince = 0;
    nextHatchAt = Infinity;
    hatchQueue = [];
    alive = new Set();
    parentId = -1;
    nextSporeAt = Infinity;
    sporeSide = 1;
    freedAt = null;
    freedBy = null;
    veilsCleared = 0;
    stageBroken = false;
    parentEntry.lockable = false;
  }

  function free(by: FreedBy) {
    if (phase === 'freed') return;
    phase = 'freed';
    freedAt = lastRunTime;
    freedBy = by;
    bus.emit('bossphase', { phase: 'destroyed' });
  }

  bus.on('runstart', reset);
  bus.on('kill', ({ enemyId }) => {
    alive.delete(enemyId);
    if (enemyId === parentId) free('kill');
  });
  bus.on('miss', ({ enemyId }) => {
    alive.delete(enemyId);
  });
  bus.on('stage', ({ enemyId }) => {
    if (enemyId === parentId) stageBroken = true;
  });

  const quantizeToBeat = (time: number) => Math.ceil(time / BEAT - 1e-6) * BEAT;

  function queueWave(at: number) {
    const count = VEILS[veil].broods;
    hatchQueue = Array.from({ length: count }, (_, slot) => ({ at: at + slot * HATCH_STAGGER, slot }));
  }

  function updateParent(context: StrandlineUpdate, launchSpore: SporeLauncher) {
    const { enemy, runTime, age } = context;
    lastRunTime = runTime;
    parentId = enemy.id;

    if (phase === 'idle') {
      phase = 'wave';
      veil = 0;
      summonedAt = runTime;
      phaseSince = runTime;
      queueWave(quantizeToBeat(runTime + BEAT * 1.1));
      nextSporeAt = quantizeToBeat(runTime + BEAT * 8);
      bus.emit('bossphase', { phase: 'summoned' });
      if (debug === 'exposed' || debug === 'freed') {
        hatchQueue = [];
        veilsCleared = VEILS.length;
        phase = 'exposed';
        parentEntry.lockable = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
    }

    if (debug === 'freed' && runTime - summonedAt >= 3.2) {
      free('kill');
      return true;
    }

    if (runTime >= PARENT_FAILSAFE && phase !== 'freed') {
      free('pulse');
      return true;
    }

    // Hatch queued broods onto the current veil.
    while (hatchQueue.length > 0 && runTime >= hatchQueue[0].at) {
      const { slot } = hatchQueue.shift()!;
      const id = context.spawnEnemy({
        time: runTime,
        kind: 'brood',
        data: { role: 'brood', veil, slot, count: VEILS[veil].broods },
      });
      if (id >= 0) alive.add(id);
    }

    if (phase === 'wave' && hatchQueue.length === 0 && alive.size === 0) {
      veilsCleared += 1;
      phase = 'dieback';
      phaseSince = runTime;
    } else if (phase === 'dieback' && runTime - phaseSince >= VEIL_DIE_BACK) {
      if (veil + 1 < VEILS.length) {
        veil += 1;
        phase = 'wave';
        phaseSince = runTime;
        queueWave(quantizeToBeat(runTime + BEAT * 0.5));
      } else {
        phase = 'exposed';
        phaseSince = runTime;
        parentEntry.lockable = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
    }

    // Spores from behind the webbing keep the rail honest.
    if (phase !== 'dieback' && runTime >= nextSporeAt) {
      nextSporeAt = runTime + SPORE_PERIOD;
      sporeSide = -sporeSide;
      scratch.set(sporeSide * (5 + Math.sin(runTime) * 2), PARENT_Y - 6, 3.5 * Math.cos(runTime * 1.3));
      launchSpore(context, toWorld(scratch, new Vector3()), 4.6);
    }

    // The parent's body is drawn by the crown scenery. The target the runner
    // sees is a proxy that only exists at the crown once the parent is bare;
    // until then it waits far out of reach, so nothing can lock the webbing.
    const exposed = phase === 'exposed';
    if (exposed) {
      const breath = Math.sin(age * 3.4);
      center.set(0, PARENT_Y + breath * 0.5, 0);
      center.x += Math.sin(age * 23) * 0.12 * (stageBroken ? 2 : 1);
      center.z += Math.cos(age * 19) * 0.1 * (stageBroken ? 2 : 1);
      enemy.mesh.position.copy(toWorld(center, scratch));
    } else {
      enemy.mesh.position.copy(PROXY_HOME);
    }
    enemy.mesh.quaternion.copy(PARENT_ORIENTATION);
    enemy.mesh.userData.phase = phase;
    enemy.mesh.userData.veil = veil;
    enemy.mesh.userData.stageBroken = stageBroken;
    return false;
  }

  function updateBrood(
    context: StrandlineUpdate,
    data: Extract<StrandlineData, { role: 'brood' }>,
    launchSpore: SporeLauncher,
  ) {
    const { enemy, runTime, age, camera } = context;
    void launchSpore;
    if (runTime >= PARENT_FAILSAFE) return true;
    const spec = VEILS[data.veil];
    const orbit = (runTime - summonedAt) * VEIL_SPIN[data.veil];
    const angle = (data.slot / data.count) * Math.PI * 2 + orbit + data.veil * 0.4;

    // Rest position: a knot on the veil, bobbing.
    const knot = new Vector3(
      Math.cos(angle) * spec.rx,
      spec.y + Math.sin(age * 1.3 + data.slot * 1.7) * 0.7,
      Math.sin(angle) * spec.rz,
    );
    // Hatching: it squeezes out of the parent and swims up the thread to its knot.
    const h = MathUtils.clamp(age / HATCH_TRAVEL, 0, 1);
    const eased = 1 - (1 - h) ** 3;
    const local = PARENT_CENTER_LOCAL.clone().lerp(knot, eased);
    local.x += Math.sin(h * Math.PI) * Math.cos(angle + 1.2) * 3.2 * (1 - h);
    local.z += Math.sin(h * Math.PI) * Math.sin(angle + 1.2) * 2.4 * (1 - h);

    // Snap-lunges: a brood strains at the web toward the rail now and then.
    const cycle = 3.1 + (data.slot % 3) * 0.37;
    const phaseT = ((age + data.slot * 0.6) % cycle) / cycle;
    const lunge = h < 1 ? 0 : phaseT > 0.88 ? Math.sin(((phaseT - 0.88) / 0.12) * Math.PI) : 0;
    local.y -= lunge * 3.2;

    enemy.mesh.position.copy(toWorld(local, scratch));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(age * 5 + data.slot) * 0.5 + angle);
    enemy.mesh.userData.hatch = h;
    enemy.mesh.userData.lunge = lunge;
    return false;
  }

  reset();

  return {
    parentEntry,
    updateParent,
    updateBrood,
    freedAt: () => freedAt,
    freedBy: () => freedBy,
    phase: () => phase,
    veilsCleared: () => veilsCleared,
    summonedAt: () => summonedAt,
    summaryLine() {
      if (freedBy === 'kill') return 'Parent torn loose — the animal is clean';
      if (freedBy === 'pulse') return 'The bell threw the parent off';
      if (veilsCleared > 0) return `${veilsCleared} of ${VEILS.length} veils cleansed`;
      return undefined;
    },
  };
}

export type ParentController = ReturnType<typeof createParentController>;
