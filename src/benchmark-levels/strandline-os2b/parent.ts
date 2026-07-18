import { MathUtils, Vector3 } from 'three';
import { offsetFromRail } from '../../engine/rail';
import type { LockOnEnemy, LockOnEnemyUpdate, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import type { EventBus } from '../../events';
import { STRANDLINE_TIME } from './timing';

// The parent organism, dug into the crown where every strand roots into the
// bell. It does not fight you directly at first: it sits behind three sheets of
// its own webbing and pumps out broods. Each brood wave feeds one sheet, so
// clearing a wave kills the sheet it fed and the strands behind it come back on.
// With all three sheets dead the parent is bare, and two volleys tear it loose.

export const PARENT_WEBBING_PANELS = 3;
export const BROODS_PER_WAVE = 2;

export type StrandlineParentData =
  | { role: 'parent' }
  | { role: 'brood'; wave: number; direction: readonly [number, number] };

export type ParentKind = 'parent' | 'brood';

type ParentContext<TKind extends string, TData> = LockOnEnemyUpdate<TKind, TData>;

const time = STRANDLINE_TIME;

// Distance the parent holds ahead of the camera, in rail units. It closes as
// the fight goes on: shielded it hangs back in the murk, bare it is right on
// top of you.
const PARENT_STANDOFF = { shielded: 52, exposed: 38, final: 29 } as const;

const BROOD_EMERGE_SECONDS = 1.05;
const BROOD_SPREAD = 22;
const BROOD_CONTACT_DISTANCE = 3.4;
const BROOD_MAX_AGE = 13;

export type StrandlineParent = ReturnType<typeof createStrandlineParent>;

export function createStrandlineParent<TKind extends string, TData>(
  bus: EventBus,
  lash: (context: ParentContext<TKind, TData>, from: Vector3) => void,
) {
  let parentId = -1;
  let webbing = PARENT_WEBBING_PANELS;
  let exposed = false;
  let destroyed = false;
  let stageBroken = false;
  let broodsKilled = 0;
  let broodsLanded = 0;
  const waveAlive = [0, 0, 0];
  const waveSpawned = [0, 0, 0];
  const broodWave = new Map<number, number>();

  function reset() {
    parentId = -1;
    webbing = PARENT_WEBBING_PANELS;
    exposed = false;
    destroyed = false;
    stageBroken = false;
    broodsKilled = 0;
    broodsLanded = 0;
    waveAlive.fill(0);
    waveSpawned.fill(0);
    broodWave.clear();
  }

  function releaseBrood(enemyId: number) {
    const wave = broodWave.get(enemyId);
    if (wave === undefined) return;
    broodWave.delete(enemyId);
    waveAlive[wave] = Math.max(0, waveAlive[wave] - 1);
    if (waveSpawned[wave] < BROODS_PER_WAVE || waveAlive[wave] > 0) return;
    // The sheet this brood wave fed has nothing left to feed it.
    webbing = Math.max(0, webbing - 1);
    bus.emit('bossphase', { phase: webbing === 0 ? 'exposed' : 'summoned' });
    if (webbing === 0) exposed = true;
  }

  bus.on('runstart', reset);

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'parent') {
      parentId = enemyId;
      bus.emit('bossphase', { phase: 'summoned' });
    }
  });

  bus.on('kill', ({ enemyId }) => {
    if (enemyId === parentId) {
      destroyed = true;
      bus.emit('bossphase', { phase: 'destroyed' });
      return;
    }
    if (broodWave.has(enemyId)) broodsKilled += 1;
    releaseBrood(enemyId);
  });

  bus.on('miss', ({ enemyId }) => {
    if (broodWave.has(enemyId)) broodsLanded += 1;
    releaseBrood(enemyId);
  });

  /** Boss spawn entries, authored relative to the crown marker. */
  function entries(startTime: number): Array<LockOnSpawnEntry<TKind, TData>> {
    const list: Array<LockOnSpawnEntry<TKind, TData>> = [{
      time: startTime,
      kind: 'parent' as TKind,
      hitStages: [3, 3],
      data: { role: 'parent' } as unknown as TData,
    }];

    // Three broods waves, one per webbing sheet. Each pair splits left and
    // right of the crown so the player sweeps across the frame to answer them.
    const waves: Array<{ at: number; directions: Array<readonly [number, number]> }> = [
      { at: time.beats(2), directions: [[-0.86, 0.5], [0.86, 0.42]] },
      { at: time.beats(6), directions: [[0.72, -0.62], [-0.66, -0.58]] },
      { at: time.beats(10), directions: [[-0.95, -0.1], [0.9, 0.32]] },
    ];
    waves.forEach((wave, index) => {
      wave.directions.forEach((direction, slot) => {
        list.push({
          time: startTime + wave.at + slot * time.beats(0.5),
          kind: 'brood' as TKind,
          hitPoints: 2,
          data: { role: 'brood', wave: index, direction } as unknown as TData,
        });
      });
    });
    return list;
  }

  bus.on('stage', ({ enemyId }) => {
    if (enemyId === parentId) stageBroken = true;
  });

  function standoffDistance() {
    if (!exposed) return PARENT_STANDOFF.shielded;
    return stageBroken ? PARENT_STANDOFF.final : PARENT_STANDOFF.exposed;
  }

  function anchorAhead(context: ParentContext<TKind, TData>, distance: number) {
    const length = Math.max(1, context.curve.getLength());
    return MathUtils.clamp(context.runProgress + distance / length, 0, 1);
  }

  function updateParent(context: ParentContext<TKind, TData>) {
    const { enemy, runTime, age, curve, camera } = context;
    const state = context.enemyState(() => ({ nextLash: 2.4, standoff: PARENT_STANDOFF.shielded, lastAge: 0 }));
    const dt = Math.max(0, Math.min(0.1, age - state.lastAge));
    state.lastAge = age;
    // The standoff eases rather than snapping, so losing a webbing sheet reads
    // as the thing hauling itself closer to you.
    state.standoff += (standoffDistance() - state.standoff) * Math.min(1, dt * 1.1);
    const anchorU = anchorAhead(context, state.standoff);

    // A slow, heavy breath — the thing is bloated and rooted, not agile.
    const breathe = Math.sin(runTime * 1.05) * 0.5 + 0.5;
    const offset = new Vector3(
      Math.sin(runTime * 0.31) * 3.4,
      6.2 + Math.sin(runTime * 0.47 + 1.1) * 1.6,
      0,
    );
    enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.22) * 0.22);
    enemy.mesh.userData.breathe = breathe;
    enemy.mesh.userData.webbing = webbing;
    enemy.mesh.userData.exposed = exposed;
    enemy.mesh.userData.stageIndex = enemy.hitStageIndex;

    // Bare, it lashes: spore bolts thrown straight down the swim lane.
    if (exposed && age >= state.nextLash) {
      state.nextLash = age + (stageBroken ? 1.5 : 2.1);
      lash(context, enemy.mesh.position);
    }
    return false;
  }

  function updateBrood(context: ParentContext<TKind, TData>, data: Extract<StrandlineParentData, { role: 'brood' }>) {
    const { enemy, age, curve, camera, damagePlayer } = context;
    const state = context.enemyState(() => {
      broodWave.set(enemy.id, data.wave);
      waveAlive[data.wave] += 1;
      waveSpawned[data.wave] += 1;
      return { position: new Vector3(), velocity: new Vector3(), lastAge: 0, seeded: false };
    });
    const dt = Math.max(0, Math.min(0.1, age - state.lastAge));
    state.lastAge = age;

    if (age < BROOD_EMERGE_SECONDS) {
      // Squeezed out of the crown and pushed clear of the parent's bulk.
      const t = age / BROOD_EMERGE_SECONDS;
      const eased = t * t * (3 - 2 * t);
      const anchorU = anchorAhead(context, PARENT_STANDOFF.shielded - 4);
      const offset = new Vector3(
        data.direction[0] * BROOD_SPREAD * eased,
        6.2 + data.direction[1] * BROOD_SPREAD * 0.72 * eased,
        0,
      );
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, offset));
      state.position.copy(enemy.mesh.position);
      enemy.mesh.userData.emerge = eased;
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(age * 1.4);
      return false;
    }

    if (!state.seeded) {
      state.seeded = true;
      state.velocity.copy(camera.position).sub(state.position).normalize().multiplyScalar(5);
    }

    // A pulsing swim toward the swimmer: it accelerates as it closes, and the
    // sideways wobble keeps the whole pair legible instead of two dots growing.
    const toCamera = camera.position.clone().sub(state.position);
    const distance = toCamera.length();
    const speed = MathUtils.lerp(6.5, 15, MathUtils.clamp(1 - distance / 60, 0, 1));
    const pulse = 0.72 + Math.max(0, Math.sin(age * 4.1 + enemy.id)) * 0.7;
    const desired = toCamera.normalize().multiplyScalar(speed * pulse);
    state.velocity.lerp(desired, Math.min(1, dt * 2.4));
    state.position.addScaledVector(state.velocity, dt);
    state.position.x += Math.sin(age * 2.2 + enemy.id * 1.7) * dt * 4.2;
    state.position.y += Math.cos(age * 1.7 + enemy.id) * dt * 3.1;

    enemy.mesh.position.copy(state.position);
    enemy.mesh.userData.emerge = 1;
    enemy.mesh.userData.broodPulse = pulse;
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ(age * 1.1);

    if (state.position.distanceTo(camera.position) < BROOD_CONTACT_DISTANCE) {
      damagePlayer(1);
      return true;
    }
    return age > BROOD_MAX_AGE;
  }

  return {
    entries,
    update(context: ParentContext<TKind, TData>, data: StrandlineParentData) {
      if (data.role === 'parent') return updateParent(context);
      return updateBrood(context, data);
    },
    /** The webbing physically blocks shots at the parent until its broods are dead. */
    validateRelease(enemies: Array<LockOnEnemy<TKind, TData>>) {
      if (webbing === 0) return true;
      const blocked = enemies.filter((enemy) => enemy.id === parentId);
      if (blocked.length === 0) return true;
      bus.emit('shielded', {
        shields: blocked.map((enemy) => ({ enemyId: enemy.id, worldPosition: enemy.mesh.position.clone() })),
        blockedEnemyIds: blocked.map((enemy) => enemy.id),
      });
      return enemies.filter((enemy) => enemy.id !== parentId);
    },
    get parentId() {
      return parentId;
    },
    get webbing() {
      return webbing;
    },
    get exposed() {
      return exposed;
    },
    get destroyed() {
      return destroyed;
    },
    summary() {
      if (destroyed) return `Parent torn loose · ${broodsKilled}/${PARENT_WEBBING_PANELS * BROODS_PER_WAVE} brood cleared`;
      if (exposed) return `Parent bare but holding · ${broodsKilled} brood cleared`;
      return `${webbing}/${PARENT_WEBBING_PANELS} webbing sheets still fed`;
    },
    broodsLanded() {
      return broodsLanded;
    },
  };
}
