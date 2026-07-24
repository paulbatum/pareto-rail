import { MathUtils, Vector3 } from 'three';
import type { CatmullRomCurve3 } from 'three';
import type { LockOnEnemy } from '../../engine/lock-on-runner';
import type { EventBus } from '../../events';
import { AXIS, AXIS_RIGHT, AXIS_UP, type StrandlineData, type StrandlineKind, type StrandlineUpdate } from './gameplay';
import { CLEAR_TIME } from './timing';

// THE PARENT — the thing the whole infestation came out of, dug into the crown
// where the strands root into the bell.
//
// It hides behind a lattice of its own webbing and answers every threat by
// pumping out a fresh brood. While a brood is in the water the webbing is fed
// and shots on the parent bounce; clear the brood and that third of the lattice
// dies back, leaving a window to tear into the mantle underneath. Three broods,
// three windows, three bites — then it comes loose.

// It is dug into the crown, so it rides the crown: the animal's own station
// curve decides how far away the boss is, which keeps the fight framed against
// the bell instead of against empty water.
const PARENT_BACK = 34;
const PARENT_DROP = 4;

const BROODS_PER_WAVE = 3;
const WAVE_COUNT = 3;

const BROOD_BURST = 1.0;
const BROOD_CLOSE = 4.0;
const BROOD_DIVE = 5.3;
const BROOD_FAR_DEPTH = 62;
const BROOD_NEAR_DEPTH = 24;

export type ParentOptions = {
  spitSpore(context: StrandlineUpdate, from: Vector3): void;
  /** Where the crown is right now, supplied by the level so both agree exactly. */
  crownPosition(curve: CatmullRomCurve3, runTime: number, out: Vector3): Vector3;
};

export function createParent(bus: EventBus, options: ParentOptions) {
  const worldPosition = new Vector3();
  const broodsAlive = new Set<number>();
  const scratch = new Vector3();
  const forward = new Vector3();
  const right = new Vector3();
  const up = new Vector3();

  let parentId = -1;
  let wave = 0;
  let webPanels = WAVE_COUNT;
  let exposed = false;
  let destroyed = false;
  let escaped = false;
  let broodsKilled = 0;

  bus.on('runstart', () => {
    broodsAlive.clear();
    parentId = -1;
    wave = 0;
    webPanels = WAVE_COUNT;
    exposed = false;
    destroyed = false;
    escaped = false;
    broodsKilled = 0;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'parent') parentId = enemyId;
  });

  const forgetBrood = (enemyId: number) => {
    if (!broodsAlive.delete(enemyId)) return;
    if (broodsAlive.size === 0 && !destroyed) openWindow();
  };

  bus.on('kill', ({ enemyId }) => {
    if (enemyId === parentId) {
      destroyed = true;
      broodsAlive.clear();
      bus.emit('bossphase', { phase: 'destroyed' });
      return;
    }
    if (broodsAlive.has(enemyId)) broodsKilled += 1;
    forgetBrood(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    if (enemyId === parentId) return;
    forgetBrood(enemyId);
  });

  // A cleared brood is a third of the lattice starving: the webbing withers
  // back and the mantle underneath is bare until the next brood is pumped out.
  function openWindow() {
    if (exposed) return;
    exposed = true;
    webPanels = Math.max(0, WAVE_COUNT - wave);
    bus.emit('bossphase', { phase: 'exposed' });
  }

  function releaseWave(context: StrandlineUpdate) {
    if (destroyed || wave >= WAVE_COUNT) return;
    wave += 1;
    exposed = false;
    for (let slot = 0; slot < BROODS_PER_WAVE; slot += 1) {
      const id = context.spawnEnemy({
        time: context.runTime,
        kind: 'brood' as StrandlineKind,
        data: { role: 'brood', wave, slot, seed: wave * 3.1 + slot * 2.7 } as StrandlineData,
      });
      if (id >= 0) broodsAlive.add(id);
    }
    bus.emit('bossphase', { phase: 'summoned' });
  }

  function updateParent(context: StrandlineUpdate) {
    const { enemy, runTime, age, curve } = context;
    const state = context.enemyState(() => ({ nextWaveAtStage: 0, released: false }));

    // It hangs in the crown, breathing, swinging a little on its anchor roots.
    const bob = Math.sin(runTime * 0.9) * 2.2 + Math.sin(runTime * 2.3) * 0.7;
    const sway = Math.sin(runTime * 0.6 + 1.1) * 3.0;
    options.crownPosition(curve, runTime, worldPosition);
    worldPosition
      .addScaledVector(AXIS, -PARENT_BACK)
      .addScaledVector(AXIS_RIGHT, sway)
      .addScaledVector(AXIS_UP, bob - PARENT_DROP);
    enemy.mesh.position.copy(worldPosition);
    enemy.mesh.lookAt(context.camera.position);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.45) * 0.25);

    enemy.mesh.userData.webPanels = webPanels;
    enemy.mesh.userData.exposed = exposed && broodsAlive.size === 0;
    enemy.mesh.userData.stage = enemy.hitStageIndex;
    enemy.mesh.userData.broods = broodsAlive.size;

    // First brood comes out as soon as it registers you.
    if (!state.released && age > 0.65) {
      state.released = true;
      state.nextWaveAtStage = 1;
      releaseWave(context);
    }
    // Every bite it takes buys it another brood.
    if (state.released && enemy.hitStageIndex >= state.nextWaveAtStage && wave < WAVE_COUNT) {
      state.nextWaveAtStage = enemy.hitStageIndex + 1;
      releaseWave(context);
    }

    // The rail leaves the crown whether or not the colony is off it.
    if (runTime >= CLEAR_TIME) {
      escaped = true;
      return true;
    }
    return false;
  }

  /** Broods burst from the parent, then wheel around the rim of the frame,
   *  closing until they finally throw themselves at you. */
  function updateBrood(context: StrandlineUpdate, data: Extract<StrandlineData, { role: 'brood' }>) {
    const { enemy, age, camera, damagePlayer } = context;
    const state = context.enemyState(() => ({ bit: false }));

    camera.getWorldDirection(forward);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    up.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

    const depth = age < BROOD_CLOSE
      ? MathUtils.lerp(BROOD_FAR_DEPTH, BROOD_NEAR_DEPTH, MathUtils.clamp((age - BROOD_BURST) / (BROOD_CLOSE - BROOD_BURST), 0, 1))
      : MathUtils.lerp(BROOD_NEAR_DEPTH, 2.2, ((age - BROOD_CLOSE) / (BROOD_DIVE - BROOD_CLOSE)) ** 1.8);
    const halfHeight = Math.tan(MathUtils.degToRad(camera.fov / 2)) * depth;
    const swing = data.slot * ((Math.PI * 2) / BROODS_PER_WAVE) + data.wave * 1.1 + age * 0.62;
    const rim = age < BROOD_CLOSE ? 0.72 : MathUtils.lerp(0.72, 0.12, (age - BROOD_CLOSE) / (BROOD_DIVE - BROOD_CLOSE));

    const orbit = scratch.copy(camera.position)
      .addScaledVector(forward, depth)
      .addScaledVector(right, Math.cos(swing) * halfHeight * rim * 1.55)
      .addScaledVector(up, Math.sin(swing) * halfHeight * rim);

    if (age < BROOD_BURST) {
      // Out of the webbing on a hard kick, then it finds its lane.
      const k = age / BROOD_BURST;
      const eased = k * k * (3 - 2 * k);
      enemy.mesh.position.copy(worldPosition).lerp(orbit, eased);
      enemy.mesh.position.addScaledVector(up, Math.sin(k * Math.PI) * 6);
    } else {
      enemy.mesh.position.copy(orbit);
    }

    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(age * 1.9 + data.seed);
    enemy.mesh.userData.breathe = Math.max(0, Math.sin(age * 5.4 + data.seed));
    enemy.mesh.userData.diving = age >= BROOD_CLOSE;

    if (age >= BROOD_DIVE) {
      if (!state.bit) {
        state.bit = true;
        damagePlayer(1);
      }
      return true;
    }
    return false;
  }

  /** Shots at the parent bounce off the lattice while it still has a brood feeding it. */
  function validateRelease(enemies: Array<LockOnEnemy<StrandlineKind, StrandlineData>>) {
    if (destroyed || broodsAlive.size === 0) return true;
    const blocked = enemies.filter((enemy) => enemy.kind === 'parent');
    if (blocked.length === 0) return true;
    bus.emit('shielded', {
      shields: [{ enemyId: parentId, worldPosition: worldPosition.clone() }],
      blockedEnemyIds: blocked.map((enemy) => enemy.id),
    });
    return enemies.filter((enemy) => enemy.kind !== 'parent');
  }

  return {
    updateParent,
    updateBrood,
    validateRelease,
    killed: () => destroyed,
    position: () => worldPosition,
    summaryLine() {
      if (destroyed) return `The colony is off the animal — ${broodsKilled}/${WAVE_COUNT * BROODS_PER_WAVE} broods cut down`;
      if (escaped) return 'The parent held on';
      return `Broods cut down ${broodsKilled}/${WAVE_COUNT * BROODS_PER_WAVE}`;
    },
  };
}
