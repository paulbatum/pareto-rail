import fs from 'node:fs/promises';
import path from 'node:path';
import { Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import { createLockOnRunner } from '../src/engine/lock-on-runner';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../src/engine/lock-on-runner';
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
  engagement: boolean;
};

type SimTarget = {
  id: number;
  kind: string;
  letter?: string;
  mesh: Object3D;
  spawnedAt: number;
  locks: number;
  inFlight: boolean;
  entry?: LockOnSpawnEntry<string, unknown>;
  timelineIndex?: number;
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
  engagement?: EngagementRunReport;
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
  engagement?: EngagementRunReport;
};

type EngagementContract = {
  readableFor: number;
  enterSeconds: number;
  exitSeconds: number;
  holdStart: number;
  holdEnd: number;
  exitComplete: number;
};

type EngagementPhaseSeconds = {
  enter: number;
  hold: number;
  exit: number;
  afterExit: number;
};

type EngagementTargetReport = {
  enemyId: number;
  timelineIndex: number;
  time: number;
  kind: string;
  label: string;
  firstLockableAt?: number;
  lastLockableAt?: number;
  lockableSeconds: number;
  phaseSeconds: EngagementPhaseSeconds;
  contract?: {
    readableFor: number;
    measuredFromHoldStart: number;
    result: 'OK' | 'FAIL';
    shortBy?: number;
  };
};

type EngagementRunReport = {
  tolerance: number;
  targets: EngagementTargetReport[];
  summary: {
    total: number;
    withContracts: number;
    passed: number;
    failed: number;
    measuredOnly: number;
  };
};

type EngagementAccumulator = {
  enemyId: number;
  timelineIndex: number;
  entry: LockOnSpawnEntry<string, unknown>;
  label: string;
  contract?: EngagementContract;
  firstLockableAt?: number;
  lastLockableAt?: number;
  lockableSeconds: number;
  holdLockableSeconds: number;
  phaseSeconds: EngagementPhaseSeconds;
};

const EVENT_TYPES = [
  'spawn', 'lock', 'unlock', 'fire', 'hit', 'kill', 'miss', 'reject', 'stage', 'volley', 'playerhit', 'beat',
] as const satisfies Array<keyof GameEvents>;
const LOG_EVENT_TYPES = [
  ...EVENT_TYPES,
  'runstart', 'runend', 'shielded', 'bossphase',
] as const satisfies Array<keyof GameEvents>;

type LevelTarget = {
  canonical: string;
  folder: string;
  title: string;
};

async function resolveLevelTarget(levelIdOrAlias: string, rootDir: string): Promise<LevelTarget> {
  const registryPath = path.resolve(rootDir, 'src/levels/index.ts');
  const registrySource = await fs.readFile(registryPath, 'utf8');

  // Find dynamic import case mappings
  const caseRegex = /case\s+['"]([^'"]+)['"]:\s*\r?\n\s*return\s*\(await\s*import\(['"]([^'"]+)['"]\)\)\.([A-Za-z0-9_]+);/g;
  const cases = new Map<string, string>();
  let match: RegExpExecArray | null;
  while ((match = caseRegex.exec(registrySource))) {
    const canonicalId = match[1];
    const importPath = match[2];
    const folder = importPath.replace(/^\.\//, '');
    cases.set(canonicalId, folder);
  }

  // Parse levelMetadatas to get aliases/IDs
  const arrayMatch = registrySource.match(/export const levelMetadatas: LevelMetadata\[] = \[([\s\S]*?)\n\];/);
  if (!arrayMatch) throw new Error('Could not find levelMetadatas array in src/levels/index.ts');
  
  const entryRegex = /\{\s*id:\s*['"]([^'"]+)['"]\s*,\s*title:\s*['"]([^'"]+)['"](?:\s*,\s*aliases:\s*\[([^\]]*)\])?/g;
  let canonicalId = '';
  let title = '';
  while ((match = entryRegex.exec(arrayMatch[1]))) {
    const entryId = match[1];
    const entryTitle = match[2];
    const entryAliases = match[3] 
      ? match[3].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean) 
      : [];
    if (entryId === levelIdOrAlias || entryAliases.includes(levelIdOrAlias)) {
      canonicalId = entryId;
      title = entryTitle;
      break;
    }
  }

  if (!canonicalId || !cases.has(canonicalId)) {
    // Fallback search: if it doesn't match the strict patterns, try to see if the directory exists
    const directPath = path.resolve(rootDir, 'src/levels', levelIdOrAlias);
    try {
      const stats = await fs.stat(directPath);
      if (stats.isDirectory()) {
        canonicalId = levelIdOrAlias;
        title = levelIdOrAlias;
        cases.set(canonicalId, levelIdOrAlias);
      }
    } catch {
      // ignore
    }
  }

  if (!canonicalId || !cases.has(canonicalId)) {
    throw new Error(`Unsupported simulation level: ${levelIdOrAlias}`);
  }

  const folder = cases.get(canonicalId)!;
  return { canonical: canonicalId, folder, title };
}

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
    policies: ['none', 'perfect', 'imperfect'],
    seed: 1,
    dt: 1 / 60,
    json: false,
    suite: true,
    gapThreshold: 4,
    engagement: false,
    ...options,
  };
  if (fullOptions.engagement) fullOptions.policies = ['none'];
  return runSuite(fullOptions);
}

export const simulationLevels: string[] = [];

async function runSuite(options: CliOptions): Promise<SuiteResult> {
  const runs: RunResult[] = [];
  for (const policy of options.policies) {
    runs.push(await simulateRun({ ...options, policy, seed: policy === 'imperfect' ? options.seed : 0 }));
  }
  const fired = new Set<keyof GameEvents>();
  for (const run of runs) for (const event of run.events) fired.add(event.type);
  const coverageTypes = options.policies.includes('reject')
    ? EVENT_TYPES
    : EVENT_TYPES.filter((type) => type !== 'reject');
  return {
    level: runs[0].level,
    seed: options.seed,
    runs,
    eventCoverage: {
      fired: coverageTypes.filter((type) => fired.has(type)),
      neverFired: coverageTypes.filter((type) => !fired.has(type)),
    },
    engagement: runs.find((run) => run.policy === 'none')?.engagement,
  };
}

async function simulateRun(options: CliOptions & { policy: SimPolicy }): Promise<RunResult> {
  const target = await resolveLevelTarget(options.level, process.cwd());

  window.__raildDebug = { ...(window.__raildDebug ?? {}), immortal: options.engagement };
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
  const engagementTargets = new Map<number, EngagementAccumulator>();
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
  let timelineCursor = 0;
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
        const timelineMatch = spawn.kind === 'letter'
          ? undefined
          : matchTimelineEntry(level.spawnTimeline, timelineCursor, spawn.kind, now, options.dt);
        if (timelineMatch) timelineCursor = timelineMatch.index + 1;
        if (mesh) {
          const target: SimTarget = {
            id: spawn.enemyId,
            kind: spawn.kind,
            letter: spawn.letter,
            mesh,
            spawnedAt: now,
            locks: 0,
            inFlight: false,
            entry: timelineMatch?.entry,
            timelineIndex: timelineMatch?.index,
          };
          activeTargets.set(spawn.enemyId, target);
          if (options.engagement && timelineMatch) engagementTargets.set(spawn.enemyId, createEngagementAccumulator(spawn.enemyId, timelineMatch.index, timelineMatch.entry));
        }
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
    if (options.engagement && runner.state === 'running') sampleEngagement(now + options.dt, options.dt, camera, activeTargets, engagementTargets);
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
    engagement: options.engagement ? finalizeEngagementReport(engagementTargets) : undefined,
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
  const mod = await import(`../src/levels/${folder}/gameplay`);

  // Pattern 1: Any function starting with 'create' and ending with 'Gameplay'
  const factoryKey = Object.keys(mod).find(key => key.startsWith('create') && key.endsWith('Gameplay'));
  if (factoryKey && typeof mod[factoryKey] === 'function') {
    return mod[factoryKey](bus, folder === 'rezdle' ? hud : undefined) as LockOnRunnerLevel<string, unknown>;
  }

  // Pattern 2: Any object ending with 'Gameplay' (e.g. prismGameplay, crystalGameplay)
  const objectKey = Object.keys(mod).find(key => key.endsWith('Gameplay'));
  if (objectKey && typeof mod[objectKey] === 'object' && mod[objectKey] !== null) {
    return mod[objectKey] as LockOnRunnerLevel<string, unknown>;
  }

  throw new Error(`Could not find a gameplay factory or object in level folder: ${folder}`);
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

function matchTimelineEntry(
  timeline: Array<LockOnSpawnEntry<string, unknown>>,
  cursor: number,
  kind: string,
  now: number,
  dt: number,
): { index: number; entry: LockOnSpawnEntry<string, unknown> } | undefined {
  const tolerance = Math.max(dt * 2.5, 0.05);
  for (let index = cursor; index < Math.min(timeline.length, cursor + 12); index += 1) {
    const entry = timeline[index];
    if (entry.kind === kind && Math.abs(entry.time - now) <= tolerance) return { index, entry };
    if (entry.time > now + tolerance) break;
  }
  return undefined;
}

function createEngagementAccumulator(enemyId: number, timelineIndex: number, entry: LockOnSpawnEntry<string, unknown>): EngagementAccumulator {
  const contract = readEngagementContract(entry);
  return {
    enemyId,
    timelineIndex,
    entry,
    label: labelForEntry(entry),
    contract,
    lockableSeconds: 0,
    holdLockableSeconds: 0,
    phaseSeconds: { enter: 0, hold: 0, exit: 0, afterExit: 0 },
  };
}

function readEngagementContract(entry: LockOnSpawnEntry<string, unknown>): EngagementContract | undefined {
  const data = entry.data;
  if (!data || typeof data !== 'object') return undefined;
  const engagement = (data as { engagement?: unknown }).engagement;
  if (!engagement || typeof engagement !== 'object') return undefined;
  const source = engagement as Partial<Record<'readableFor' | 'enterSeconds' | 'exitSeconds', unknown>>;
  const readableFor = Number(source.readableFor);
  const enterSeconds = Number(source.enterSeconds);
  const exitSeconds = Number(source.exitSeconds ?? 0);
  if (!Number.isFinite(readableFor) || !Number.isFinite(enterSeconds) || !Number.isFinite(exitSeconds)) return undefined;
  const holdStart = entry.time + enterSeconds;
  const holdEnd = holdStart + readableFor;
  const exitComplete = holdEnd + exitSeconds;
  return { readableFor, enterSeconds, exitSeconds, holdStart, holdEnd, exitComplete };
}

function labelForEntry(entry: LockOnSpawnEntry<string, unknown>) {
  const data = entry.data;
  if (!data || typeof data !== 'object') return entry.kind;
  const record = data as Record<string, unknown>;
  const parts = [entry.kind];
  if (typeof record.lane === 'number') parts.push(`lane ${record.lane}`);
  if (typeof record.row === 'number') parts.push(`row ${record.row}`);
  return parts.join(' ');
}

function sampleEngagement(
  time: number,
  dt: number,
  camera: PerspectiveCamera,
  targets: Map<number, SimTarget>,
  accumulators: Map<number, EngagementAccumulator>,
) {
  const projected = new Vector3();
  for (const [enemyId, accumulator] of accumulators) {
    const target = targets.get(enemyId);
    if (!target || accumulator.entry.lockable === false) continue;
    projected.copy(target.mesh.position).project(camera);
    const lockable = projected.z >= -1
      && projected.z <= 1
      && Math.abs(projected.x) <= 1
      && Math.abs(projected.y) <= 1;
    if (!lockable) continue;

    const sampleTime = round(time);
    accumulator.firstLockableAt ??= sampleTime;
    accumulator.lastLockableAt = sampleTime;
    accumulator.lockableSeconds += dt;

    const contract = accumulator.contract;
    if (!contract) continue;
    if (time < contract.holdStart) accumulator.phaseSeconds.enter += dt;
    else if (time < contract.holdEnd) {
      accumulator.phaseSeconds.hold += dt;
      accumulator.holdLockableSeconds += dt;
    } else if (time < contract.exitComplete) {
      accumulator.phaseSeconds.exit += dt;
      accumulator.holdLockableSeconds += dt;
    } else {
      accumulator.phaseSeconds.afterExit += dt;
      accumulator.holdLockableSeconds += dt;
    }
  }
}

const ENGAGEMENT_TOLERANCE_SECONDS = 0.08;

function finalizeEngagementReport(accumulators: Map<number, EngagementAccumulator>): EngagementRunReport {
  const targets = [...accumulators.values()]
    .sort((a, b) => a.timelineIndex - b.timelineIndex)
    .map((accumulator): EngagementTargetReport => {
      const contract = accumulator.contract;
      const measuredFromHoldStart = round(accumulator.holdLockableSeconds);
      const result = contract && measuredFromHoldStart + ENGAGEMENT_TOLERANCE_SECONDS >= contract.readableFor ? 'OK' : 'FAIL';
      return {
        enemyId: accumulator.enemyId,
        timelineIndex: accumulator.timelineIndex,
        time: round(accumulator.entry.time),
        kind: accumulator.entry.kind,
        label: accumulator.label,
        firstLockableAt: accumulator.firstLockableAt,
        lastLockableAt: accumulator.lastLockableAt,
        lockableSeconds: round(accumulator.lockableSeconds),
        phaseSeconds: {
          enter: round(accumulator.phaseSeconds.enter),
          hold: round(accumulator.phaseSeconds.hold),
          exit: round(accumulator.phaseSeconds.exit),
          afterExit: round(accumulator.phaseSeconds.afterExit),
        },
        contract: contract ? {
          readableFor: round(contract.readableFor),
          measuredFromHoldStart,
          result,
          shortBy: result === 'FAIL' ? round(Math.max(0, contract.readableFor - measuredFromHoldStart)) : undefined,
        } : undefined,
      };
    });
  const withContracts = targets.filter((target) => target.contract);
  const failed = withContracts.filter((target) => target.contract?.result === 'FAIL');
  return {
    tolerance: ENGAGEMENT_TOLERANCE_SECONDS,
    targets,
    summary: {
      total: targets.length,
      withContracts: withContracts.length,
      passed: withContracts.length - failed.length,
      failed: failed.length,
      measuredOnly: targets.length - withContracts.length,
    },
  };
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
  let engagement = false;

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
    else if (arg === '--engagement') engagement = true;
    else if (arg === '-h' || arg === '--help') printHelpAndExit();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!level) throw new Error('Missing --level <id>');
  if (!Number.isFinite(seed)) throw new Error('--seed must be a number');
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('--dt must be positive');
  if (!Number.isFinite(gapThreshold) || gapThreshold < 0) throw new Error('--gap-threshold must be non-negative');
  const policies = policy === 'suite'
    ? ['none', 'perfect', 'imperfect'] as SimPolicy[]
    : policy.split(',').map((item) => item.trim()).filter(Boolean) as SimPolicy[];
  for (const item of policies) if (!['none', 'perfect', 'imperfect', 'reject'].includes(item)) throw new Error(`Unknown policy: ${item}`);
  return { level, policies, seed, dt, json, write, suite: policy === 'suite', gapThreshold, engagement };
}

function formatSuite(result: SuiteResult, _gapThreshold: number) {
  if (result.engagement) return formatEngagementReport(result);
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

function formatEngagementReport(result: SuiteResult) {
  const report = result.engagement;
  if (!report) return formatSuite(result, 4);
  const noneRun = result.runs.find((run) => run.policy === 'none');
  const lines: string[] = [];
  lines.push(`${result.level.title} engagement report (${result.level.duration.toFixed(1)}s @ ${result.level.bpm} BPM, policy none)`);
  if (noneRun) {
    const impossible = noneRun.pressure.impossibleMoments.length;
    lines.push(`pressure: peak ${Math.max(0, ...noneRun.pressure.samples.map((sample) => sample.count))}, impossible moments ${impossible}`);
  }
  lines.push(`contracts: ${report.summary.passed}/${report.summary.withContracts} passed, ${report.summary.failed} failed, ${report.summary.measuredOnly} measured-only, tolerance ${report.tolerance.toFixed(2)}s`);
  for (const target of report.targets) {
    lines.push(``);
    lines.push(`${result.level.id} ${target.time.toFixed(1)}s ${target.label}`);
    if (target.contract) lines.push(`  contract: readableFor=${target.contract.readableFor.toFixed(2)}s (hold)`);
    else lines.push(`  contract: none`);
    const first = target.firstLockableAt === undefined ? 'never' : `${target.firstLockableAt.toFixed(2)}s`;
    const last = target.lastLockableAt === undefined ? 'never' : `${target.lastLockableAt.toFixed(2)}s`;
    const phase = target.contract
      ? ` (enter ${target.phaseSeconds.enter.toFixed(2)}s + hold ${target.phaseSeconds.hold.toFixed(2)}s + exit ${target.phaseSeconds.exit.toFixed(2)}s + grace ${target.phaseSeconds.afterExit.toFixed(2)}s)`
      : '';
    lines.push(`  measured lockable: ${target.lockableSeconds.toFixed(2)}s${phase}; first ${first}, last ${last}`);
    if (target.contract) {
      const suffix = target.contract.result === 'FAIL' ? `, short by ${(target.contract.shortBy ?? 0).toFixed(2)}s` : '';
      lines.push(`  result: ${target.contract.result}${suffix}`);
    } else {
      lines.push(`  result: measured only`);
    }
  }
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
  console.log(`Usage: npm run simulate -- --level <id> [--policy suite|none|perfect|imperfect|reject] [--engagement] [--seed n] [--json] [--write path]`);
  process.exit(0);
}
