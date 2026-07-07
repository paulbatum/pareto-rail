import fs from 'node:fs/promises';
import path from 'node:path';
import { Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import { createLockOnRunner } from '../src/engine/lock-on-runner';
import type { LockOnRunnerLevel } from '../src/engine/lock-on-runner';
import { MAX_LOCKS } from '../src/engine/locks';
import { createEventBus, type GameEvents } from '../src/events';
import type { Hud } from '../src/ui/hud';

export type SimPolicy = 'none' | 'perfect' | 'imperfect' | 'reject';

type CliOptions = {
  level: string;
  policies: SimPolicy[];
  seed: number;
  dt: number;
  json: boolean;
  write?: string;
  suite: boolean;
  gapThreshold: number;
};

type SimTarget = {
  id: number;
  kind: string;
  letter?: string;
  mesh: Object3D;
  spawnedAt: number;
  locks: number;
  inFlight: boolean;
};

type LoggedEvent = {
  time: number;
  type: keyof GameEvents;
  payload: unknown;
};

type PressureSample = {
  time: number;
  count: number;
  kinds: Record<string, number>;
};

type RunResult = {
  level: { id: string; folder: string; title: string; duration: number; bpm: number };
  policy: SimPolicy;
  seed: number;
  dt: number;
  endedAt: number;
  summary?: GameEvents['runend'];
  events: LoggedEvent[];
  pressure: {
    samples: PressureSample[];
    byBar: Array<{ bar: number; peak: number; average: number }>;
    spawnFreeGaps: Array<{ from: number; to: number; seconds: number }>;
    impossibleMoments: Array<{ time: number; count: number; reason: string }>;
  };
  counts: {
    events: Record<string, number>;
    spawnedKinds: Record<string, number>;
    kills: number;
    misses: number;
    playerHits: number;
  };
};

type SuiteResult = {
  level: RunResult['level'];
  seed: number;
  runs: RunResult[];
  eventCoverage: { fired: string[]; neverFired: string[] };
};

const EVENT_TYPES = [
  'spawn', 'lock', 'unlock', 'fire', 'hit', 'kill', 'miss', 'reject', 'stage', 'volley', 'playerhit', 'beat',
] as const satisfies Array<keyof GameEvents>;
const LOG_EVENT_TYPES = [
  ...EVENT_TYPES,
  'runstart', 'runend', 'shielded', 'bossphase',
] as const satisfies Array<keyof GameEvents>;

const LEVEL_ALIASES: Record<string, { canonical: string; folder: string; title: string }> = {
  crystal: { canonical: 'crystal-corridor', folder: 'crystal', title: 'Crystal Corridor' },
  'crystal-corridor': { canonical: 'crystal-corridor', folder: 'crystal', title: 'Crystal Corridor' },
  helios: { canonical: 'helios', folder: 'helios', title: 'Helios' },
  prism: { canonical: 'prism-bloom', folder: 'prism', title: 'Prism Bloom' },
  'prism-bloom': { canonical: 'prism-bloom', folder: 'prism', title: 'Prism Bloom' },
  rezdle: { canonical: 'rezdle', folder: 'rezdle', title: 'Rezdle' },
};

export async function main(argv = process.argv.slice(2), env: { root?: string } = {}) {
  const root = env.root ?? process.cwd();
  const options = parseArgs(argv);
  const result = await runSimulationSuite(options);

  if (options.write) {
    const outPath = path.resolve(root, options.write);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    if (!options.json) console.log(`wrote ${path.relative(process.cwd(), outPath)}`);
  }

  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatSuite(result, options.gapThreshold));
}

export async function runSimulationSuite(options: Partial<CliOptions> & { level: string }): Promise<SuiteResult> {
  installDomStubs();
  const fullOptions: CliOptions = {
    policies: ['none', 'perfect', 'imperfect', 'reject'],
    seed: 1,
    dt: 1 / 60,
    json: false,
    suite: true,
    gapThreshold: 4,
    ...options,
  };
  return runSuite(fullOptions);
}

export const simulationLevels = Object.keys(LEVEL_ALIASES);

async function runSuite(options: CliOptions): Promise<SuiteResult> {
  const runs: RunResult[] = [];
  for (const policy of options.policies) {
    runs.push(await simulateRun({ ...options, policy, seed: policy === 'imperfect' ? options.seed : 0 }));
  }
  const fired = new Set<keyof GameEvents>();
  for (const run of runs) for (const event of run.events) fired.add(event.type);
  return {
    level: runs[0].level,
    seed: options.seed,
    runs,
    eventCoverage: {
      fired: EVENT_TYPES.filter((type) => fired.has(type)),
      neverFired: EVENT_TYPES.filter((type) => !fired.has(type)),
    },
  };
}

async function simulateRun(options: CliOptions & { policy: SimPolicy }): Promise<RunResult> {
  const target = LEVEL_ALIASES[options.level];
  if (!target) throw new Error(`Unsupported simulation level: ${options.level}`);

  const bus = createEventBus();
  const hud = createStubHud();
  const level = await createGameplay(target.folder, bus, hud);
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  const canvas = createCanvasStub(1280, 720) as HTMLCanvasElement;
  const createdEnemyMeshes: Object3D[] = [];
  const activeTargets = new Map<number, SimTarget>();
  const events: LoggedEvent[] = [];
  const eventCounts: Record<string, number> = {};
  const spawnedKinds: Record<string, number> = {};
  const pressureSamples: PressureSample[] = [];
  const rng = lcg(options.seed || 1);
  let now = 0;
  let currentLocks = 0;
  let ended = false;
  let summary: GameEvents['runend'] | undefined;
  let lastLockAt = -Infinity;
  let rejectSeen = false;
  let beatNumber = 0;
  let nextBeatAt = 0;
  let nextPressureAt = 0;
  let pointerDown = false;
  let lastImperfectActionAt = -Infinity;
  let imperfectReleaseAt = Infinity;
  let imperfectTargetId = -1;

  for (const type of LOG_EVENT_TYPES) {
    bus.on(type, (payload) => {
      eventCounts[type] = (eventCounts[type] ?? 0) + 1;
      events.push({ time: round(now), type, payload: serializePayload(payload) });
      if (type === 'spawn') {
        const spawn = payload as GameEvents['spawn'];
        const mesh = createdEnemyMeshes.shift();
        if (mesh) activeTargets.set(spawn.enemyId, {
          id: spawn.enemyId,
          kind: spawn.kind,
          letter: spawn.letter,
          mesh,
          spawnedAt: now,
          locks: 0,
          inFlight: false,
        });
        if (spawn.kind !== 'letter') spawnedKinds[spawn.kind] = (spawnedKinds[spawn.kind] ?? 0) + 1;
      } else if (type === 'lock') {
        const lock = payload as GameEvents['lock'];
        currentLocks = lock.lockCount;
        lastLockAt = now;
        const target = activeTargets.get(lock.enemyId);
        if (target) target.locks += 1;
      } else if (type === 'fire') {
        const fire = payload as GameEvents['fire'];
        const target = activeTargets.get(fire.enemyId);
        if (target) target.inFlight = true;
      } else if (type === 'hit') {
        const hit = payload as GameEvents['hit'];
        const target = activeTargets.get(hit.enemyId);
        if (target) target.inFlight = false;
      } else if (type === 'unlock') {
        const unlock = payload as GameEvents['unlock'];
        currentLocks = unlock.lockCount;
        const target = activeTargets.get(unlock.enemyId);
        if (target) {
          target.locks = 0;
          if (target.kind !== 'letter') target.inFlight = true;
        }
      } else if (type === 'kill' || type === 'miss') {
        activeTargets.delete((payload as GameEvents['kill'] | GameEvents['miss']).enemyId);
      } else if (type === 'reject') {
        rejectSeen = true;
        currentLocks = 0;
        for (const target of activeTargets.values()) {
          target.locks = 0;
          target.inFlight = false;
        }
      } else if (type === 'runend') {
        ended = true;
        summary = payload as GameEvents['runend'];
      }
    });
  }

  const runner = createLockOnRunner({
    scene,
    camera,
    canvas,
    bus,
    hud,
    onPause: () => {},
    onFullscreen: () => {},
    startTip: '',
    level,
    visuals: {
      createEnemyMesh(kind: string) {
        const mesh = new Object3D();
        mesh.userData.kind = kind;
        createdEnemyMeshes.push(mesh);
        return mesh;
      },
      setEnemyLocked(mesh, locked) { mesh.userData.locked = locked; },
      setEnemyDenied(mesh) { mesh.userData.denied = true; },
      createProjectileMesh() { return new Object3D(); },
      createReticle() { return new Object3D(); },
      setReticleActive() {},
    },
  });

  if (options.policy !== 'reject') runner.start();

  const maxTime = level.duration + 12;
  const release = () => {
    if (!pointerDown) return;
    dispatchPointer(canvas, 'pointerup', 0, 0, 0);
    pointerDown = false;
  };
  const aim = (ndc: { x: number; y: number }) => {
    const x = ((ndc.x + 1) / 2) * 1280;
    const y = ((1 - ndc.y) / 2) * 720;
    dispatchPointer(canvas, pointerDown ? 'pointermove' : 'pointerdown', x, y, 1);
    pointerDown = true;
  };

  while (!ended && now < maxTime) {
    if (runner.state === 'running') emitDueBeats();
    drivePolicy();
    runner.update(options.dt);
    now += options.dt;
    if (now >= nextPressureAt && runner.state === 'running') {
      pressureSamples.push(measurePressure(now, camera, activeTargets));
      nextPressureAt += 0.5;
    }
  }
  release();
  runner.dispose();

  return {
    level: { id: target.canonical, folder: target.folder, title: target.title, duration: level.duration, bpm: level.bpm },
    policy: options.policy,
    seed: options.policy === 'imperfect' ? options.seed : 0,
    dt: options.dt,
    endedAt: round(Math.min(now, maxTime)),
    summary,
    events,
    pressure: summarizePressure(pressureSamples, level.bpm, options.gapThreshold),
    counts: {
      events: eventCounts,
      spawnedKinds,
      kills: eventCounts.kill ?? 0,
      misses: eventCounts.miss ?? 0,
      playerHits: eventCounts.playerhit ?? 0,
    },
  };

  function emitDueBeats() {
    while (now + 1e-9 >= nextBeatAt && nextBeatAt <= level.duration) {
      bus.emit('beat', { beatNumber, isDownbeat: beatNumber % 4 === 0, audioTime: nextBeatAt });
      beatNumber += 1;
      nextBeatAt = beatNumber * (60 / level.bpm);
    }
  }

  function drivePolicy() {
    if (options.policy === 'none') return;

    if (options.policy === 'reject' && runner.state !== 'running') {
      if (rejectSeen) {
        release();
        runner.start();
        return;
      }
      const letter = visibleTargets(camera, activeTargets, true)[0];
      if (letter) {
        if (currentLocks > 0) release();
        else aim(letter.ndc);
      }
      return;
    }

    if (runner.state !== 'running') return;
    if (options.policy === 'perfect') {
      if (currentLocks >= MAX_LOCKS) {
        release();
        return;
      }
      const candidates = visibleTargets(camera, activeTargets, false).filter((candidate) => candidate.target.locks === 0 && !candidate.target.inFlight);
      if (candidates.length === 0) {
        if (currentLocks > 0) release();
        return;
      }
      aim(candidates[0].ndc);
      return;
    }

    if (options.policy === 'imperfect') {
      if (currentLocks >= 3 || now >= imperfectReleaseAt) {
        release();
        imperfectReleaseAt = Infinity;
        imperfectTargetId = -1;
        return;
      }
      if (now - lastImperfectActionAt < 0.23) return;
      const candidates = visibleTargets(camera, activeTargets, false).filter(() => rng() > 0.18);
      if (candidates.length === 0) {
        if (currentLocks > 0 && now - lastLockAt > 0.45) release();
        return;
      }
      if (imperfectTargetId < 0 || !activeTargets.has(imperfectTargetId)) {
        const chosen = candidates[Math.floor(rng() * candidates.length)] ?? candidates[0];
        imperfectTargetId = chosen.target.id;
        imperfectReleaseAt = now + 0.35 + rng() * 0.4;
      }
      const chosen = candidates.find((candidate) => candidate.target.id === imperfectTargetId) ?? candidates[0];
      aim(chosen.ndc);
      lastImperfectActionAt = now;
    }
  }
}

async function createGameplay(folder: string, bus: ReturnType<typeof createEventBus>, hud: Hud): Promise<LockOnRunnerLevel<string, unknown>> {
  switch (folder) {
    case 'crystal': {
      const mod = await import('../src/levels/crystal/gameplay');
      return mod.createCrystalGameplay(bus) as LockOnRunnerLevel<string, unknown>;
    }
    case 'helios': {
      const mod = await import('../src/levels/helios/gameplay');
      return mod.createHeliosGameplay(bus) as LockOnRunnerLevel<string, unknown>;
    }
    case 'prism': {
      const mod = await import('../src/levels/prism/gameplay');
      return mod.prismGameplay as LockOnRunnerLevel<string, unknown>;
    }
    case 'rezdle': {
      const mod = await import('../src/levels/rezdle/gameplay');
      return mod.createRezdleGameplay(bus, hud) as LockOnRunnerLevel<string, unknown>;
    }
    default:
      throw new Error(`Unsupported simulation folder: ${folder}`);
  }
}

function visibleTargets(camera: PerspectiveCamera, targets: Map<number, SimTarget>, includeLetters: boolean) {
  const projected = new Vector3();
  return [...targets.values()]
    .filter((target) => includeLetters ? target.kind === 'letter' : target.kind !== 'letter')
    .map((target) => {
      projected.copy(target.mesh.position).project(camera);
      return { target, ndc: { x: projected.x, y: projected.y }, z: projected.z, distance: Math.hypot(projected.x, projected.y) };
    })
    .filter((target) => target.z >= -1 && target.z <= 1 && Math.abs(target.ndc.x) <= 0.98 && Math.abs(target.ndc.y) <= 0.98)
    .sort((a, b) => priority(a.target) - priority(b.target) || a.distance - b.distance);
}

function priority(target: SimTarget) {
  if (target.kind === 'bolt' || target.kind === 'flare') return -2;
  if (target.locks > 0) return 2;
  return 0;
}

function measurePressure(time: number, camera: PerspectiveCamera, targets: Map<number, SimTarget>): PressureSample {
  const kinds: Record<string, number> = {};
  for (const visible of visibleTargets(camera, targets, false)) kinds[visible.target.kind] = (kinds[visible.target.kind] ?? 0) + 1;
  return { time: round(time), count: Object.values(kinds).reduce((sum, count) => sum + count, 0), kinds };
}

function summarizePressure(samples: PressureSample[], bpm: number, gapThreshold: number) {
  const barSeconds = (60 / bpm) * 4;
  const byBarMap = new Map<number, { total: number; samples: number; peak: number }>();
  for (const sample of samples) {
    const bar = Math.floor(sample.time / barSeconds) + 1;
    const bucket = byBarMap.get(bar) ?? { total: 0, samples: 0, peak: 0 };
    bucket.total += sample.count;
    bucket.samples += 1;
    bucket.peak = Math.max(bucket.peak, sample.count);
    byBarMap.set(bar, bucket);
  }

  const spawnFreeGaps: Array<{ from: number; to: number; seconds: number }> = [];
  let gapStart: number | undefined;
  for (const sample of samples) {
    if (sample.count === 0 && gapStart === undefined) gapStart = sample.time;
    if (sample.count > 0 && gapStart !== undefined) {
      const seconds = sample.time - gapStart;
      if (seconds >= gapThreshold) spawnFreeGaps.push({ from: round(gapStart), to: round(sample.time), seconds: round(seconds) });
      gapStart = undefined;
    }
  }
  if (gapStart !== undefined && samples.length) {
    const to = samples[samples.length - 1].time;
    const seconds = to - gapStart;
    if (seconds >= gapThreshold) spawnFreeGaps.push({ from: round(gapStart), to: round(to), seconds: round(seconds) });
  }

  return {
    samples,
    byBar: [...byBarMap.entries()].map(([bar, bucket]) => ({
      bar,
      peak: bucket.peak,
      average: round(bucket.total / Math.max(1, bucket.samples)),
    })),
    spawnFreeGaps,
    impossibleMoments: samples
      .filter((sample) => sample.count > MAX_LOCKS)
      .map((sample) => ({ time: sample.time, count: sample.count, reason: `visible targets exceed ${MAX_LOCKS}-lock volley cap` })),
  };
}

function parseArgs(argv: string[]): CliOptions {
  let level = '';
  let policy = 'suite';
  let seed = 1;
  let dt = 1 / 60;
  let json = false;
  let write: string | undefined;
  let gapThreshold = 4;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };
    if (arg === '--level') level = readValue();
    else if (arg === '--policy') policy = readValue();
    else if (arg === '--seed') seed = Number(readValue());
    else if (arg === '--dt') dt = Number(readValue());
    else if (arg === '--json') json = true;
    else if (arg === '--write') write = readValue();
    else if (arg === '--gap-threshold') gapThreshold = Number(readValue());
    else if (arg === '-h' || arg === '--help') printHelpAndExit();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!level) throw new Error('Missing --level <id>');
  if (!Number.isFinite(seed)) throw new Error('--seed must be a number');
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('--dt must be positive');
  if (!Number.isFinite(gapThreshold) || gapThreshold < 0) throw new Error('--gap-threshold must be non-negative');
  const policies = policy === 'suite'
    ? ['none', 'perfect', 'imperfect', 'reject'] as SimPolicy[]
    : policy.split(',').map((item) => item.trim()).filter(Boolean) as SimPolicy[];
  for (const item of policies) if (!['none', 'perfect', 'imperfect', 'reject'].includes(item)) throw new Error(`Unknown policy: ${item}`);
  return { level, policies, seed, dt, json, write, suite: policy === 'suite', gapThreshold };
}

function formatSuite(result: SuiteResult, _gapThreshold: number) {
  const lines: string[] = [];
  lines.push(`${result.level.title} simulation (${result.level.duration.toFixed(1)}s @ ${result.level.bpm} BPM)`);
  for (const run of result.runs) {
    const summary = run.summary;
    const spawned = Object.entries(run.counts.spawnedKinds).map(([kind, count]) => `${kind}=${count}`).join(', ') || 'none';
    const gaps = run.pressure.spawnFreeGaps.length
      ? run.pressure.spawnFreeGaps.map((gap) => `${gap.from.toFixed(1)}–${gap.to.toFixed(1)}s`).join(', ')
      : 'none';
    const impossible = run.pressure.impossibleMoments.length;
    lines.push(``);
    lines.push(`${run.policy}${run.policy === 'imperfect' ? ` seed=${run.seed}` : ''}`);
    lines.push(`  outcome: ${summary ? `${summary.kills}/${summary.totalEnemies} kills, ${summary.missed} missed, score ${summary.score}, rank ${summary.rank}${summary.died ? ', died' : ''}` : 'no runend'} at ${run.endedAt.toFixed(2)}s`);
    lines.push(`  events: locks ${run.counts.events.lock ?? 0}, fires ${run.counts.events.fire ?? 0}, hits ${run.counts.events.hit ?? 0}, kills ${run.counts.events.kill ?? 0}, misses ${run.counts.events.miss ?? 0}, player hits ${run.counts.playerHits}`);
    lines.push(`  spawned: ${spawned}`);
    lines.push(`  pressure: peak ${Math.max(0, ...run.pressure.samples.map((sample) => sample.count))}, gaps ${gaps}, impossible moments ${impossible}`);
  }
  lines.push(``);
  lines.push(`Event coverage never fired: ${result.eventCoverage.neverFired.join(', ') || 'none'}`);
  return lines.join('\n');
}

function createCanvasStub(width: number, height: number) {
  const target = createEventTarget();
  return {
    ...target,
    width,
    height,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height, right: width, bottom: height }),
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  };
}

function dispatchPointer(canvas: HTMLCanvasElement, type: string, clientX: number, clientY: number, buttons: number) {
  (canvas as unknown as ReturnType<typeof createEventTarget>).dispatchEvent({
    type,
    clientX,
    clientY,
    buttons,
    button: type === 'pointerup' ? 0 : 0,
    pointerId: 1,
    preventDefault() {},
  });
}

function createEventTarget() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  return {
    addEventListener(type: string, handler: (event: any) => void) {
      const bucket = listeners.get(type) ?? new Set();
      bucket.add(handler);
      listeners.set(type, bucket);
    },
    removeEventListener(type: string, handler: (event: any) => void) {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent(event: { type: string }) {
      for (const handler of listeners.get(event.type) ?? []) handler(event);
    },
  };
}

function installDomStubs() {
  const windowStub = { ...createEventTarget(), __raildDebug: {} };
  const documentStub = { ...createEventTarget(), fullscreenElement: null };
  globalThis.window = (globalThis.window ?? windowStub) as Window & typeof globalThis;
  globalThis.document = (globalThis.document ?? documentStub) as Document;
}

function createStubHud(): Hud {
  return {
    update() {},
    flashDamage() {},
    flashMaxLock() {},
    showEnd() {},
    hideEnd() {},
    setHudActive() {},
    setCallout() {},
    setTip() {},
    showTip() {},
    hideTip() {},
  } as Hud;
}

function serializePayload(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number') return round(value);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(serializePayload);
  if (value instanceof Vector3) return [round(value.x), round(value.y), round(value.z)];
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, serializePayload(child)]));
  return String(value);
}

function lcg(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function printHelpAndExit(): never {
  console.log(`Usage: npm run simulate -- --level <id> [--policy suite|none|perfect|imperfect|reject] [--seed n] [--json] [--write path]`);
  process.exit(0);
}
