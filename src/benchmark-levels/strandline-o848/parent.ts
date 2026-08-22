import { MathUtils, Vector3 } from 'three';
import { sampleRailFrame } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { StrandlineSpawnData, StrandlineSpawnEntry, StrandlineUpdate } from './gameplay';
import { bar, PARENT_TIME } from './timing';

// THE PARENT — dug into the crown where the strands root into the bell. It
// hides behind a lattice of its own webbing and pumps out fresh broods. Each
// web panel is fed by one brood wave: while the wave lives the panel is taut
// and uncuttable; kill the wave (or let it wash past) and the panel starves,
// withers, and can be torn loose. Strip all four panels and the parent itself
// is exposed.

/** Brood waves launch on the musical schedule, one per web panel. */
export const BROOD_WAVE_TIMES = [
  bar(16.75),
  bar(17.75),
  bar(18.75),
  bar(19.6),
];

/** Broodlings per wave — the last wave is a thinning scatter. */
export const BROOD_WAVE_COUNTS = [3, 3, 3, 2];

// Panels sit in a shallow arc across the approach, strung between strand roots.
const PANEL_SOCKETS: Array<[number, number, number]> = [
  [-8.5, -6, 26],
  [-4, -9.5, 16],
  [4, -7, 19],
  [8.5, -11, 29],
];

type WebPanelState = {
  fedWave: number;
  withered: boolean;
};

type ParentState = {
  parentId: number;
  parentSpawned: boolean;
  parentKilled: boolean;
  exposedAt: number;
  panelIds: Array<number | undefined>;
  panels: WebPanelState[];
  waveAlive: number[][];
  wavesLaunched: boolean[];
  nextNettleAt: number;
  nextFrenzyAt: number;
};

export type ParentAnchor = {
  position: Vector3;
  right: Vector3;
  up: Vector3;
  forward: Vector3;
};

export type ParentOptions = {
  anchor: ParentAnchor;
  /** The four panel entries, so brood kills can unlock their panel. */
  panelEntries: StrandlineSpawnEntry[];
  /** The parent entry itself — unlocked when every panel has withered. */
  parentEntry: StrandlineSpawnEntry;
  spawnBrood(context: StrandlineUpdate, wave: number): void;
  spawnNettle(context: StrandlineUpdate, spreadX: number): void;
};

export function createParentEntries(time: number): { parentEntry: StrandlineSpawnEntry; timeline: StrandlineSpawnEntry[] } {
  const parentEntry: StrandlineSpawnEntry = {
    time,
    kind: 'parent',
    hitStages: [3, 2],
    lockable: false,
    data: { role: 'parent' },
  };
  const panels: StrandlineSpawnEntry[] = PANEL_SOCKETS.map((_socket, index) => ({
    time,
    kind: 'panel',
    hitPoints: 1,
    lockable: false,
    data: { role: 'panel', socket: index },
  }));
  return { parentEntry, timeline: [parentEntry, ...panels] };
}

export function createStrandlineParent(bus: EventBus, options: ParentOptions) {
  const state: ParentState = {
    parentId: -1,
    parentSpawned: false,
    parentKilled: false,
    exposedAt: -1,
    panelIds: [undefined, undefined, undefined, undefined],
    panels: PANEL_SOCKETS.map((_socket, index) => ({ fedWave: index, withered: false })),
    waveAlive: [[], [], [], []],
    wavesLaunched: [false, false, false, false],
    nextNettleAt: 3.2,
    nextFrenzyAt: Number.POSITIVE_INFINITY,
  };

  bus.on('runstart', () => {
    state.parentId = -1;
    state.parentSpawned = false;
    state.parentKilled = false;
    state.exposedAt = -1;
    state.panelIds = [undefined, undefined, undefined, undefined];
    state.panels.forEach((panel) => {
      panel.withered = false;
    });
    state.waveAlive = [[], [], [], []];
    state.wavesLaunched = [false, false, false, false];
    state.nextNettleAt = 3.2;
    state.nextFrenzyAt = Number.POSITIVE_INFINITY;
    for (const entry of options.panelEntries) entry.lockable = false;
    options.parentEntry.lockable = false;
  });

  bus.on('spawn', ({ enemyId, kind }) => {
    if (kind === 'parent') {
      state.parentSpawned = true;
      state.parentId = enemyId;
      return;
    }
    if (kind === 'panel') {
      const slot = state.panelIds.indexOf(undefined);
      if (slot >= 0) state.panelIds[slot] = enemyId;
    }
  });

  // A wave dying back starves the panel it fed: the webbing withers, loses its
  // violet sheen, and can finally be torn.
  function registerBrood(wave: number, enemyId: number) {
    state.waveAlive[wave]?.push(enemyId);
  }

  function dropBrood(enemyId: number) {
    for (const [wave, alive] of state.waveAlive.entries()) {
      const index = alive.indexOf(enemyId);
      if (index < 0) continue;
      alive.splice(index, 1);
      if (alive.length === 0) witherPanel(wave);
      return true;
    }
    return false;
  }

  function witherPanel(wave: number) {
    const panelIndex = state.panels.findIndex((panel) => panel.fedWave === wave && !panel.withered);
    if (panelIndex < 0) return;
    state.panels[panelIndex].withered = true;
    const entry = options.panelEntries[panelIndex];
    if (entry) entry.lockable = true;
    if (isExposed()) {
      options.parentEntry.lockable = true;
      bus.emit('bossphase', { phase: 'exposed' });
    } else {
      bus.emit('bossphase', { phase: 'summoned' }); // repurposed: a panel opens
    }
  }

  bus.on('kill', ({ enemyId }) => {
    dropBrood(enemyId);
    if (enemyId === state.parentId && !state.parentKilled) {
      state.parentKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('miss', ({ enemyId }) => {
    dropBrood(enemyId);
  });

  function updateParent(context: StrandlineUpdate, _data: Extract<StrandlineSpawnData, { role: 'parent' }>) {
    const { enemy, age, runTime, camera } = context;

    for (const [wave, waveTime] of BROOD_WAVE_TIMES.entries()) {
      if (!state.wavesLaunched[wave] && runTime >= waveTime) {
        state.wavesLaunched[wave] = true;
        options.spawnBrood(context, wave);
      }
    }

    // Nettle volleys: sparse while veiled, relentless once exposed.
    const exposed = isExposed();
    if (age > state.nextNettleAt) {
      state.nextNettleAt = age + (exposed ? 3.4 : 4.6);
      const spread = exposed ? [-6, 0, 6] : [-4.5, 4.5];
      for (const x of spread) options.spawnNettle(context, x);
    }

    // Exposed, it panics: fresh broods in a continuous defensive frenzy.
    if (exposed && age > state.nextFrenzyAt) {
      state.nextFrenzyAt = age + 2.3;
      options.spawnBrood(context, 4); // frenzy broods feed no panel
    }

    // The parent breathes: a slow ponderous bob against its own tendrils.
    const bob = Math.sin(age * 0.7) * 1.6;
    const sway = Math.sin(age * 0.45 + 1.2) * 2.2;
    enemy.mesh.position
      .copy(options.anchor.position)
      .addScaledVector(options.anchor.right, sway)
      .addScaledVector(options.anchor.up, bob);
    enemy.mesh.lookAt(camera.position);
    enemy.mesh.rotateZ(Math.sin(age * 0.5) * 0.1);

    enemy.mesh.userData.exposed = isExposed();
    void runTime;
    return false;
  }

  function updatePanel(context: StrandlineUpdate, data: Extract<StrandlineSpawnData, { role: 'panel' }>) {
    const { enemy, age, camera } = context;
    const socket = PANEL_SOCKETS[data.socket];
    const panel = state.panels[data.socket];
    // Taut webbing shivers; withered webbing hangs dead still except for a
    // faint broken flutter.
    const live = !(panel?.withered ?? false);
    const shiver = live ? Math.sin(age * 7 + data.socket * 2.1) * 0.22 : Math.sin(age * 1.7 + data.socket) * 0.06;
    enemy.mesh.position
      .copy(options.anchor.position)
      .addScaledVector(options.anchor.right, socket[0] + Math.sin(age * 0.8 + data.socket * 1.7) * 0.8)
      .addScaledVector(options.anchor.up, socket[1] + shiver)
      .addScaledVector(options.anchor.forward, socket[2]);
    enemy.mesh.quaternion.copy(camera.quaternion);
    enemy.mesh.rotateZ((live ? 1 : 0.25) * Math.sin(age * 0.9 + data.socket * 2.6) * 0.35 + data.socket * 0.4);
    enemy.mesh.userData.withered = !live;
    return false;
  }

  function witheredCount() {
    return state.panels.filter((panel) => panel.withered).length;
  }

  // Three starved panels is enough to bare the parent; the fourth stays as an
  // optional tear for players who want everything clean.
  function isExposed() {
    return state.parentSpawned && witheredCount() >= 3;
  }

  function parentStageBreak(enemyId: number) {
    return enemyId === state.parentId;
  }

  function summaryLine(): string | undefined {
    if (!state.parentSpawned) return undefined;
    return state.parentKilled ? 'The parent drifts free' : 'The parent still grips the crown';
  }

  return {
    state,
    registerBrood,
    updateParent,
    updatePanel,
    parentStageBreak,
    isExposed,
    summaryLine,
    anchor: options.anchor,
  };
}

export type StrandlineParent = ReturnType<typeof createStrandlineParent>;

/** World-space anchor for the parent: above the rail's end, under the bell's crown. */
export function createParentAnchor(curve: import('three').CatmullRomCurve3, railU: (time: number) => number): ParentAnchor {
  const u = MathUtils.clamp(railU(PARENT_TIME + 15.2), 0, 0.995);
  const frame = sampleRailFrame(curve, u);
  return {
    position: frame.position
      .clone()
      .addScaledVector(frame.up, 24)
      .addScaledVector(frame.tangent, 26),
    right: frame.right.clone(),
    up: frame.up.clone(),
    forward: frame.tangent.clone().negate(),
  };
}
