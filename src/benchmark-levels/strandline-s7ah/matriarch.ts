import { MathUtils, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { StrandlineSpawnData, StrandlineSpawnEntry, StrandlineUpdate } from './gameplay';

// The Matriarch: the parent parasite, dug into the crown where the strands
// root into the bell. It hides behind a lattice of its own webbing and keeps
// pumping out broods; each brood killed starves a webbing layer, and when the
// last one dies the web shrivels and the parent is bare. Tear it loose and
// the whole animal comes back to life.

export const BROOD_WAVE_SIZES = [4, 5] as const;
export const MATRIARCH_TOTAL_HP = 6; // hitStages [3, 3]
const FLINCH_SECONDS = 1.5;
const WEB_DISTANCE = 14; // webbing floats this far down-current of the parent
const VENOM_RANGE = 62;
const BROOD_VENOM_PERIOD = 5.4;
const BARE_VENOM_PERIOD = 4.2;

type MatriarchEntries = {
  matriarchEntry: StrandlineSpawnEntry;
  broodEntries: StrandlineSpawnEntry[];
  timeline: StrandlineSpawnEntry[];
};

type MatriarchOptions = {
  matriarchEntry: StrandlineSpawnEntry;
  broodEntries: StrandlineSpawnEntry[];
  crownPoint: Vector3;
  spawnVenom(context: StrandlineUpdate, from: Vector3): void;
};

export function createMatriarchEntries(time: number): MatriarchEntries {
  // The parent is lockable from the start — but while its web holds, any
  // release aimed at it is shed (validateRelease), so the fight teaches
  // itself: shots bounce until the broods are dead.
  const matriarchEntry: StrandlineSpawnEntry = {
    time,
    kind: 'matriarch',
    hitStages: [3, 3],
    data: { role: 'matriarch' },
  };
  const broodEntries: StrandlineSpawnEntry[] = [];
  // Wave one hatches as the ascent frames the crown; wave two on its heels.
  for (let slot = 0; slot < BROOD_WAVE_SIZES[0]; slot += 1) {
    broodEntries.push({
      time: time + 1.6 + slot * 0.14,
      kind: 'brood',
      lockable: false,
      data: { role: 'brood', wave: 0, slot },
    });
  }
  for (let slot = 0; slot < BROOD_WAVE_SIZES[1]; slot += 1) {
    broodEntries.push({
      time: time + 4.4 + slot * 0.14,
      kind: 'brood',
      lockable: false,
      data: { role: 'brood', wave: 1, slot },
    });
  }
  return { matriarchEntry, broodEntries, timeline: [matriarchEntry, ...broodEntries] };
}

export function createMatriarch(bus: EventBus, options: MatriarchOptions) {
  const boss = {
    matriarchId: -1,
    spawned: false,
    killed: false,
    exposed: false,
    flinchUntil: -1,
    lastRunTime: -1,
    nextVenomAt: -1,
    waveIds: [new Set<number>(), new Set<number>()] as [Set<number>, Set<number>],
    waveSpawned: [0, 0],
    waveCleared: [false, false],
    broodsKilled: 0,
    position: new Vector3(),
    webCenter: new Vector3(),
    webCenterValid: false,
  };

  bus.on('runstart', () => {
    boss.matriarchId = -1;
    boss.spawned = false;
    boss.killed = false;
    boss.exposed = false;
    boss.flinchUntil = -1;
    boss.lastRunTime = -1;
    boss.nextVenomAt = -1;
    boss.waveIds[0].clear();
    boss.waveIds[1].clear();
    boss.waveSpawned = [0, 0];
    boss.waveCleared = [false, false];
    boss.broodsKilled = 0;
    boss.webCenterValid = false;
    for (const entry of options.broodEntries) entry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'matriarch') {
      boss.spawned = true;
      boss.matriarchId = enemyId;
    }
  });

  const onBroodGone = (enemyId: number, wasKill: boolean) => {
    for (const wave of [0, 1] as const) {
      if (!boss.waveIds[wave].delete(enemyId)) continue;
      if (wasKill) boss.broodsKilled += 1;
      if (boss.waveIds[wave].size === 0 && boss.waveSpawned[wave] >= BROOD_WAVE_SIZES[wave]) {
        boss.waveCleared[wave] = true;
      }
      if (boss.waveCleared[0] && boss.waveCleared[1] && !boss.exposed && boss.spawned && !boss.killed) {
        boss.exposed = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
    }
  };

  bus.on('kill', ({ enemyId }) => {
    onBroodGone(enemyId, true);
    if (enemyId === boss.matriarchId) {
      boss.killed = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    onBroodGone(enemyId, false);
  });

  // Stage break: the parent's grip half-tears; it convulses and sheds shots
  // for a breath, then digs back in for the last stage.
  bus.on('stage', ({ enemyId }) => {
    if (enemyId !== boss.matriarchId) return;
    boss.flinchUntil = boss.lastRunTime + FLINCH_SECONDS;
  });

  // While the web holds (or the parent is mid-convulsion), releases aimed at
  // it are shed: the allowed subset still fires, the parent's lock is denied,
  // and the web flares to say why.
  function validateRelease(enemies: Array<{ id: number }>): true | Array<{ id: number }> {
    if (boss.matriarchId < 0 || boss.killed) return true;
    const webbed = !(boss.waveCleared[0] && boss.waveCleared[1]);
    const shedding = webbed || boss.flinchUntil > boss.lastRunTime;
    if (!shedding) return true;
    const allowed = enemies.filter((enemy) => enemy.id !== boss.matriarchId);
    if (allowed.length !== enemies.length) {
      bus.emit('shielded', {
        shields: [{ enemyId: boss.matriarchId, worldPosition: boss.position.clone() }],
        blockedEnemyIds: [boss.matriarchId],
      });
    }
    return allowed;
  }

  function updateMatriarch(context: StrandlineUpdate, _data: Extract<StrandlineSpawnData, { role: 'matriarch' }>) {
    const { enemy, runTime, camera } = context;
    boss.lastRunTime = runTime;
    const flinching = boss.flinchUntil > runTime;

    // Dug into the crown: it barely moves, but it is never still — a heavy
    // peristaltic sway, and a violent convulsion while a stage break flinches.
    const sway = flinching ? Math.sin(runTime * 9) * 1.4 : Math.sin(runTime * 0.9) * 0.7;
    enemy.mesh.position.copy(options.crownPoint);
    enemy.mesh.position.x += sway;
    enemy.mesh.position.y += Math.sin(runTime * 0.6) * 0.5;
    enemy.mesh.position.z += Math.cos(runTime * 0.8) * 0.6;
    boss.position.copy(enemy.mesh.position);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(runTime * 0.5) * 0.1 + (flinching ? Math.sin(runTime * 7) * 0.3 : 0));

    // The webbing hangs down-current of the parent, between it and the diver
    // (never past a diver who has closed to point-blank).
    const cameraDistance = camera.position.distanceTo(enemy.mesh.position);
    boss.webCenter
      .copy(camera.position)
      .sub(enemy.mesh.position)
      .normalize()
      .multiplyScalar(Math.min(WEB_DISTANCE, cameraDistance * 0.6))
      .add(enemy.mesh.position);
    boss.webCenterValid = true;

    enemy.mesh.userData.flinching = flinching;
    enemy.mesh.userData.exposed = boss.exposed && !flinching && !boss.killed;
    enemy.mesh.userData.webLayers = (boss.waveCleared[0] ? 0 : 1) + (boss.waveCleared[1] ? 0 : 1);

    // Venom pressure: singles while the web holds, paired lobs once bare.
    if (!boss.killed && !flinching && camera.position.distanceTo(enemy.mesh.position) < VENOM_RANGE) {
      if (boss.nextVenomAt < 0) boss.nextVenomAt = runTime + 2.4;
      if (runTime >= boss.nextVenomAt) {
        boss.nextVenomAt = runTime + (boss.exposed ? BARE_VENOM_PERIOD : BROOD_VENOM_PERIOD);
        const side = Math.sin(runTime * 11.3) > 0 ? 1 : -1;
        const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        options.spawnVenom(context, enemy.mesh.position.clone().addScaledVector(right, side * 5).addScaledVector(up, -2));
        if (boss.exposed) {
          options.spawnVenom(context, enemy.mesh.position.clone().addScaledVector(right, -side * 3.6).addScaledVector(up, 1.5));
        }
      }
    }
    return false;
  }

  function updateBrood(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'brood' }>) {
    const { enemy, runTime, age, camera } = context;
    const state = context.enemyState(() => {
      boss.waveIds[data.wave].add(enemy.id);
      boss.waveSpawned[data.wave] += 1;
      // Broods become targets a beat after hatching, once they've swum clear.
      enemy.entry.lockable = false;
      return { armed: false };
    });
    if (!state.armed && age > 0.7) {
      state.armed = true;
      enemy.entry.lockable = true;
    }

    const center = boss.webCenterValid
      ? boss.webCenter
      : options.crownPoint.clone().add(new Vector3(0, -WEB_DISTANCE, 0));
    // Orbits sit well inside the webbing's open funnel, so the raycast to any
    // brood never grazes the lattice.
    const radius = (data.wave === 0 ? 6.2 : 4.2) * Math.min(1, age / 1.1);
    const speed = data.wave === 0 ? 0.9 : -1.15;
    const phase = runTime * speed + (data.slot / BROOD_WAVE_SIZES[data.wave]) * Math.PI * 2;
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    enemy.mesh.position
      .copy(center)
      .addScaledVector(right, Math.cos(phase) * radius)
      .addScaledVector(up, Math.sin(phase) * radius * 0.8 + Math.sin(age * 2.3 + data.slot) * 0.6);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotation.z = phase + Math.PI / 2;
    enemy.mesh.userData.swimPhase = age * 9;
    return false;
  }

  return {
    updateMatriarch,
    updateBrood,
    validateRelease,
    freed: () => boss.killed,
    spawned: () => boss.spawned,
    exposed: () => boss.exposed,
    broodsKilled: () => boss.broodsKilled,
    broodLine() {
      if (!boss.spawned) return undefined;
      const total = BROOD_WAVE_SIZES[0] + BROOD_WAVE_SIZES[1];
      return `${boss.broodsKilled}/${total} brood parasites cleansed`;
    },
    summaryLine() {
      if (!boss.spawned) return undefined;
      if (boss.killed) return 'The Matriarch was torn loose — the jellyfish swims free';
      if (boss.exposed) return 'The Matriarch was bared, but still clings to the crown';
      return 'The Matriarch still hides behind its web';
    },
  };
}

export type Matriarch = ReturnType<typeof createMatriarch>;
