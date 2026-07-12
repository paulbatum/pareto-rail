import fs from 'node:fs/promises';
import path from 'node:path';
import { Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import {
  DEFAULT_ACTION_SFX_QUANTIZATION,
  DEFAULT_SHOT_DELAY_SETTINGS,
  resolveActionSfxQuantization,
  resolveShotDelaySettings,
} from '../src/engine/action-sfx-quantization';
import type { ActionSfxQuantizationSettings, ShotDelaySettings } from '../src/engine/action-sfx-quantization';
import { createLockOnRunner, LOCK_RADIUS_NDC } from '../src/engine/lock-on-runner';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../src/engine/lock-on-runner';
import { MAX_LOCKS } from '../src/engine/locks';
import { createEventBus, type GameEvents } from '../src/events';
import type { Hud } from '../src/ui/hud';

export type SimPolicy = 'none' | 'perfect' | 'imperfect' | 'reject';

type CliOptions = {
  level: string;
  rootDir?: string;
  policies: SimPolicy[];
  seed: number;
  dt: number;
  json: boolean;
  write?: string;
  suite: boolean;
  gapThreshold: number;
  engagement: boolean;
  heatmap: boolean;
  all: boolean;
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

type KillPosition = {
  enemyId: number;
  kind: string;
  ndc: { x: number; y: number; z: number };
  distance: number;
  time: number;
};

type RunResult = {
  level: { id: string; folder: string; sourceRoot: 'levels' | 'benchmark-levels'; title: string; duration: number; bpm: number };
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
  heatmapKills?: KillPosition[];
};

type FieldSource = 'level-authored' | 'engine default';

type EngineDefaultsReport = {
  shotRhythm: {
    profile: ShotDelaySettings;
    fields: Record<keyof ShotDelaySettings, FieldSource>;
    inheritedProfile: boolean;
  };
  actionSfxSnap: {
    status: 'inherited-default' | 'overridden-grid' | 'disabled-by-level';
    enabled: boolean;
    gridThirtyseconds: number;
    fields: Record<keyof ActionSfxQuantizationSettings, FieldSource>;
  };
  lockRadius: {
    value: number;
    source: FieldSource;
    engineDefault: number;
  };
  identityHooks: {
    declared: string[];
    inherited: string[];
  };
};

type SimulatedRunResult = RunResult & { engineDefaults: EngineDefaultsReport };

type SuiteResult = {
  level: RunResult['level'];
  seed: number;
  engineDefaults: EngineDefaultsReport;
  runs: RunResult[];
  eventCoverage: { fired: string[]; neverFired: string[] };
  engagement?: EngagementRunReport;
};

type EngagementContract = {
  /** Authored lead: the window the builder asked for. */
  leadSeconds: number;
  /** Lead clamped to the rail end; smaller than leadSeconds means the spawn cannot fit its window. */
  windowSeconds: number;
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
  contract?: {
    leadSeconds: number;
    measuredLockable: number;
    result: 'OK' | 'FAIL';
    shortBy?: number;
    clippedByRailEnd?: boolean;
  };
};

type EngagementRunReport = {
  tolerance: { flatSeconds: number; windowFraction: number };
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
  sourceRoot: 'levels' | 'benchmark-levels';
  title: string;
};

async function resolveLevelTarget(levelIdOrAlias: string, rootDir: string): Promise<LevelTarget> {
  const registryPath = path.resolve(rootDir, 'src/levels/index.ts');
  const registrySource = await fs.readFile(registryPath, 'utf8');

  // Find the human-maintained built-in loader mappings.
  const caseRegex = /['"]([^'"]+)['"]:\s*async\s*\(\)\s*=>\s*\(await\s*import\(['"]([^'"]+)['"]\)\)\.([A-Za-z0-9_]+),/g;
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

  if (canonicalId && cases.has(canonicalId)) {
    return { canonical: canonicalId, folder: cases.get(canonicalId)!, sourceRoot: 'levels', title };
  }

  const benchmarkPath = path.resolve(rootDir, 'src/benchmark-levels', levelIdOrAlias);
  try {
    const descriptor = JSON.parse(await fs.readFile(path.join(benchmarkPath, 'level.json'), 'utf8')) as { id?: string; title?: string; aliases?: string[] };
    if (descriptor.id === levelIdOrAlias || descriptor.aliases?.includes(levelIdOrAlias)) {
      return { canonical: descriptor.id!, folder: descriptor.id!, sourceRoot: 'benchmark-levels', title: descriptor.title ?? descriptor.id! };
    }
  } catch {
    // The benchmark directory is optional for built-in-only worktrees.
  }

  throw new Error(`Unsupported simulation level: ${levelIdOrAlias}`);
}

export async function main(argv = process.argv.slice(2), env: { root?: string } = {}) {
  const root = env.root ?? process.cwd();
  const options = parseArgs(argv);

  if (options.all) {
    const levels = await getAllLevels(root);
    const results: Array<{
      levelId: string;
      levelTitle: string;
      policyResults: Array<{
        policy: string;
        metrics: ReturnType<typeof computeCenterMetrics>;
      }>;
    }> = [];

    console.log(`Simulating ${levels.length} levels...`);
    
    for (const levelTarget of levels) {
      const result = await runSimulationSuite({
        ...options,
        rootDir: root,
        level: levelTarget.canonical,
      });
      
      const policyResults = result.runs.map(run => ({
        policy: run.policy,
        metrics: computeCenterMetrics(run),
      }));

      results.push({
        levelId: levelTarget.canonical,
        levelTitle: levelTarget.title,
        policyResults,
      });
    }

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      const policiesUsed = options.policies;
      for (const policy of policiesUsed) {
        console.log(`\nSimulation comparison (policy: ${policy})`);
        const header = `Level`.padEnd(25) + `Kills`.padStart(7) + `Avg Offset (NDC)`.padStart(18) + `Center % (r<0.25)`.padStart(19) + `Avg Dist (m)`.padStart(14) + `Off-Screen %`.padStart(14);
        console.log(header);
        console.log(`-`.repeat(header.length));
        
        for (const res of results) {
          const runRes = res.policyResults.find(pr => pr.policy === policy);
          if (!runRes) continue;
          const m = runRes.metrics;
          console.log(
            res.levelTitle.padEnd(25) +
            String(m.kills).padStart(7) +
            (m.kills > 0 ? m.avgOffset.toFixed(2) : '-').padStart(18) +
            (m.kills > 0 ? `${m.centerPercent.toFixed(1)}%` : '-').padStart(19) +
            (m.kills > 0 ? `${m.avgDistance.toFixed(1)}m` : '-').padStart(14) +
            (m.kills > 0 ? `${m.offScreenPercent.toFixed(1)}%` : '-').padStart(14)
          );
        }
      }
    }
    return;
  }

  const result = await runSimulationSuite({ ...options, rootDir: root });

  if (options.write) {
    const outPath = path.resolve(root, options.write);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    if (!options.json) console.log(`wrote ${path.relative(process.cwd(), outPath)}`);
  }

  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatSuite(result, options.gapThreshold, options.heatmap));
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
    heatmap: false,
    all: false,
    ...options,
  };
  if (fullOptions.engagement) fullOptions.policies = ['none'];
  return runSuite(fullOptions);
}

export const simulationLevels: string[] = [];

export async function validateLevelAudioConfig(levelIdOrAlias: string, rootDir = process.cwd()): Promise<string[]> {
  installDomStubs();
  const target = await resolveLevelTarget(levelIdOrAlias, rootDir);
  const bus = createEventBus();
  try {
    const mod = await import(`../src/${target.sourceRoot}/${target.folder}/audio`);
    if (typeof mod.createAudio !== 'function') return [`${target.canonical} audio module does not export createAudio`];
    const audio = mod.createAudio(bus);
    audio.dispose();
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  } finally {
    bus.clear();
  }
}

async function runSuite(options: CliOptions): Promise<SuiteResult> {
  const simulatedRuns: SimulatedRunResult[] = [];
  for (const policy of options.policies) {
    simulatedRuns.push(await simulateRun({ ...options, policy, seed: policy === 'imperfect' ? options.seed : 0 }));
  }
  const runs: RunResult[] = simulatedRuns.map(({ engineDefaults: _engineDefaults, ...run }) => run);
  const fired = new Set<keyof GameEvents>();
  for (const run of runs) for (const event of run.events) fired.add(event.type);
  const coverageTypes = options.policies.includes('reject')
    ? EVENT_TYPES
    : EVENT_TYPES.filter((type) => type !== 'reject');
  return {
    level: runs[0].level,
    seed: options.seed,
    engineDefaults: simulatedRuns[0].engineDefaults,
    runs,
    eventCoverage: {
      fired: coverageTypes.filter((type) => fired.has(type)),
      neverFired: coverageTypes.filter((type) => !fired.has(type)),
    },
    engagement: runs.find((run) => run.policy === 'none')?.engagement,
  };
}

async function simulateRun(options: CliOptions & { policy: SimPolicy }): Promise<SimulatedRunResult> {
  const target = await resolveLevelTarget(options.level, options.rootDir ?? process.cwd());

  window.__raildDebug = { ...(window.__raildDebug ?? {}), immortal: options.engagement };
  const bus = createEventBus();
  const hud = createStubHud();
  const level = await createGameplay(target.sourceRoot, target.folder, bus, hud);
  const engineDefaults = summarizeEngineDefaults(level);
  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  const canvas = createCanvasStub(1280, 720) as HTMLCanvasElement;
  const createdEnemyMeshes: Object3D[] = [];
  const activeTargets = new Map<number, SimTarget>();
  const events: LoggedEvent[] = [];
  const killPositions: KillPosition[] = [];
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
      } else if (type === 'kill') {
        const kill = payload as GameEvents['kill'];
        const target = activeTargets.get(kill.enemyId);
        if (target) {
          const projected = new Vector3().copy(kill.worldPosition).project(camera);
          const distance = camera.position.distanceTo(kill.worldPosition);
          killPositions.push({
            enemyId: kill.enemyId,
            kind: target.kind,
            ndc: { x: projected.x, y: projected.y, z: projected.z },
            distance: round(distance),
            time: round(now),
          });
        }
        activeTargets.delete(kill.enemyId);
      } else if (type === 'miss') {
        const miss = payload as GameEvents['miss'];
        activeTargets.delete(miss.enemyId);
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
    engineDefaults,
    level: { id: target.canonical, folder: target.folder, sourceRoot: target.sourceRoot, title: target.title, duration: level.duration, bpm: level.bpm },
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
    heatmapKills: killPositions,
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

async function createGameplay(sourceRoot: 'levels' | 'benchmark-levels', folder: string, bus: ReturnType<typeof createEventBus>, hud: Hud): Promise<LockOnRunnerLevel<string, unknown>> {
  const mod = await import(`../src/${sourceRoot}/${folder}/gameplay`);

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

function summarizeEngineDefaults(level: LockOnRunnerLevel<string, unknown>): EngineDefaultsReport {
  const shotDelay = level.timing?.shotDelay ?? {};
  const shotFields = sourceMap(DEFAULT_SHOT_DELAY_SETTINGS, shotDelay);
  const shotProfile = resolveShotDelaySettings(shotDelay);

  const actionSfx = level.timing?.actionSfx ?? {};
  const actionFields = sourceMap(DEFAULT_ACTION_SFX_QUANTIZATION, actionSfx);
  const actionSettings = resolveActionSfxQuantization(actionSfx);
  const actionStatus = actionSfx.enabled === false
    ? 'disabled-by-level'
    : actionSfx.gridThirtyseconds !== undefined
      ? 'overridden-grid'
      : 'inherited-default';

  const declaredHooks = IDENTITY_HOOKS.filter((hook) => level[hook] !== undefined);
  const inheritedHooks = IDENTITY_HOOKS.filter((hook) => level[hook] === undefined);

  return {
    shotRhythm: {
      profile: shotProfile,
      fields: shotFields,
      inheritedProfile: Object.values(shotFields).every((source) => source === 'engine default'),
    },
    actionSfxSnap: {
      status: actionStatus,
      enabled: actionSettings.enabled,
      gridThirtyseconds: actionSettings.gridThirtyseconds,
      fields: actionFields,
    },
    lockRadius: {
      value: level.lockRadiusNdc ?? LOCK_RADIUS_NDC,
      source: level.lockRadiusNdc === undefined ? 'engine default' : 'level-authored',
      engineDefault: LOCK_RADIUS_NDC,
    },
    identityHooks: {
      declared: declaredHooks,
      inherited: inheritedHooks,
    },
  };
}

function sourceMap<T extends Record<string, unknown>>(defaults: T, authored: Partial<T>): Record<keyof T, FieldSource> {
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [key, authored[key as keyof T] === undefined ? 'engine default' : 'level-authored']),
  ) as Record<keyof T, FieldSource>;
}

const IDENTITY_HOOKS = [
  'scoreForHit',
  'scoreForKill',
  'scoreForVolley',
  'validateRelease',
  'rankForRun',
  'easeRunProgress',
  'updateCameraEffects',
  'updateAttractCamera',
  'playerHealth',
  'allowLockUndo',
  'detailsForRun',
] as const satisfies Array<keyof LockOnRunnerLevel<string, unknown>>;

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
  };
}

function readEngagementContract(entry: LockOnSpawnEntry<string, unknown>): EngagementContract | undefined {
  const data = entry.data;
  if (!data || typeof data !== 'object') return undefined;
  const engagement = (data as { engagement?: unknown }).engagement;
  if (!engagement || typeof engagement !== 'object') return undefined;
  const source = engagement as { leadSeconds?: unknown; windowSeconds?: unknown };
  const leadSeconds = Number(source.leadSeconds);
  if (!Number.isFinite(leadSeconds) || leadSeconds <= 0) return undefined;
  const windowSeconds = Number(source.windowSeconds);
  return { leadSeconds, windowSeconds: Number.isFinite(windowSeconds) ? windowSeconds : leadSeconds };
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
  }
}

const ENGAGEMENT_TOLERANCE_FLAT_SECONDS = 0.08;
// A target that overtakes (or is overtaken by) the camera leaves the lock frustum
// shortly before the pass; the clipped time scales with the window, bounded by
// lateral offset over spawn distance. 15% covers the widest lanes with margin.
const ENGAGEMENT_TOLERANCE_WINDOW_FRACTION = 0.15;

function engagementTolerance(windowSeconds: number) {
  return ENGAGEMENT_TOLERANCE_FLAT_SECONDS + ENGAGEMENT_TOLERANCE_WINDOW_FRACTION * windowSeconds;
}

function finalizeEngagementReport(accumulators: Map<number, EngagementAccumulator>): EngagementRunReport {
  const targets = [...accumulators.values()]
    .sort((a, b) => a.timelineIndex - b.timelineIndex)
    .map((accumulator): EngagementTargetReport => {
      const contract = accumulator.contract;
      const measuredLockable = round(accumulator.lockableSeconds);
      const result = contract && measuredLockable + engagementTolerance(contract.leadSeconds) >= contract.leadSeconds ? 'OK' : 'FAIL';
      return {
        enemyId: accumulator.enemyId,
        timelineIndex: accumulator.timelineIndex,
        time: round(accumulator.entry.time),
        kind: accumulator.entry.kind,
        label: accumulator.label,
        firstLockableAt: accumulator.firstLockableAt,
        lastLockableAt: accumulator.lastLockableAt,
        lockableSeconds: measuredLockable,
        contract: contract ? {
          leadSeconds: round(contract.leadSeconds),
          measuredLockable,
          result,
          shortBy: result === 'FAIL' ? round(Math.max(0, contract.leadSeconds - measuredLockable)) : undefined,
          clippedByRailEnd: contract.windowSeconds < contract.leadSeconds - 1e-3 ? true : undefined,
        } : undefined,
      };
    });
  const withContracts = targets.filter((target) => target.contract);
  const failed = withContracts.filter((target) => target.contract?.result === 'FAIL');
  return {
    tolerance: { flatSeconds: ENGAGEMENT_TOLERANCE_FLAT_SECONDS, windowFraction: ENGAGEMENT_TOLERANCE_WINDOW_FRACTION },
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
  let policy = '';
  let seed = 1;
  let dt = 1 / 60;
  let json = false;
  let write: string | undefined;
  let gapThreshold = 4;
  let engagement = false;
  let heatmap = false;
  let all = false;

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
    else if (arg === '--heatmap') heatmap = true;
    else if (arg === '--all') all = true;
    else if (arg === '-h' || arg === '--help') printHelpAndExit();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!level && !all) throw new Error('Missing --level <id> or --all');
  if (!Number.isFinite(seed)) throw new Error('--seed must be a number');
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('--dt must be positive');
  if (!Number.isFinite(gapThreshold) || gapThreshold < 0) throw new Error('--gap-threshold must be non-negative');

  const resolvedPolicy = policy || (all ? 'perfect' : 'suite');

  const policies = resolvedPolicy === 'suite'
    ? ['none', 'perfect', 'imperfect'] as SimPolicy[]
    : resolvedPolicy.split(',').map((item) => item.trim()).filter(Boolean) as SimPolicy[];
  for (const item of policies) if (!['none', 'perfect', 'imperfect', 'reject'].includes(item)) throw new Error(`Unknown policy: ${item}`);
  return { level, policies, seed, dt, json, write, suite: resolvedPolicy === 'suite', gapThreshold, engagement, heatmap, all };
}

export function formatEngineDefaultsReport(report: EngineDefaultsReport) {
  const lines: string[] = [];
  lines.push('Engine defaults:');
  if (report.shotRhythm.inheritedProfile) {
    lines.push(`  shot rhythm: [default] ${formatShotProfile(report.shotRhythm.profile)}`);
  } else {
    lines.push('  shot rhythm:');
    for (const key of SHOT_DELAY_FIELDS) {
      const isDefault = report.shotRhythm.fields[key] === 'engine default';
      lines.push(`    ${key}=${report.shotRhythm.profile[key]}${isDefault ? ' [default]' : ''}`);
    }
  }
  lines.push(`  action SFX snap: ${formatActionSfxSnap(report.actionSfxSnap)}`);
  lines.push(`  lock radius: ${formatLockRadius(report.lockRadius)}`);
  lines.push(`  identity hooks declared: ${report.identityHooks.declared.join(', ') || 'none'}`);
  lines.push(`  identity hooks [default]: ${report.identityHooks.inherited.join(', ') || 'none'}`);
  return lines.join('\n');
}

function formatShotProfile(profile: ShotDelaySettings) {
  return SHOT_DELAY_FIELDS.map((key) => `${key}=${profile[key]}`).join(', ');
}

function formatActionSfxSnap(snap: EngineDefaultsReport['actionSfxSnap']) {
  if (snap.status === 'disabled-by-level') return 'disabled by level';
  const grid = snap.gridThirtyseconds === 1 ? '32nd grid' : `${snap.gridThirtyseconds}×32nd grid`;
  if (snap.status === 'overridden-grid') return `overridden grid (${snap.enabled ? 'enabled' : 'disabled'}, ${grid})`;
  return `[default] (${snap.enabled ? 'enabled' : 'disabled'}, ${grid})`;
}

function formatLockRadius(lockRadius: EngineDefaultsReport['lockRadius']) {
  if (lockRadius.source === 'engine default') return `[default] ${lockRadius.value} NDC`;
  return `${lockRadius.value} NDC (engine default ${lockRadius.engineDefault})`;
}

const SHOT_DELAY_FIELDS = [
  'pattern',
  'gapThirtyseconds',
  'releaseShare',
  'gridRampGapGrowthThirtyseconds',
  'maxGridSeconds',
] as const satisfies Array<keyof ShotDelaySettings>;

function formatSuite(result: SuiteResult, gapThreshold: number, showHeatmap = false) {
  if (result.engagement) return formatEngagementReport(result, showHeatmap);
  const lines: string[] = [];
  lines.push(`${result.level.title} simulation (${result.level.duration.toFixed(1)}s @ ${result.level.bpm} BPM)`);
  lines.push('');
  lines.push(formatEngineDefaultsReport(result.engineDefaults));
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
    if (showHeatmap) {
      lines.push(``);
      lines.push(...formatHeatmap(run));
    }
  }
  lines.push(``);
  lines.push(`Event coverage never fired: ${result.eventCoverage.neverFired.join(', ') || 'none'}`);
  return lines.join('\n');
}

function formatEngagementReport(result: SuiteResult, showHeatmap = false) {
  const report = result.engagement;
  if (!report) return formatSuite(result, 4, showHeatmap);
  const noneRun = result.runs.find((run) => run.policy === 'none');
  const lines: string[] = [];
  lines.push(`${result.level.title} engagement report (${result.level.duration.toFixed(1)}s @ ${result.level.bpm} BPM, policy none)`);
  lines.push('');
  lines.push(formatEngineDefaultsReport(result.engineDefaults));
  lines.push('');
  if (noneRun) {
    const impossible = noneRun.pressure.impossibleMoments.length;
    lines.push(`pressure: peak ${Math.max(0, ...noneRun.pressure.samples.map((sample) => sample.count))}, impossible moments ${impossible}`);
  }
  lines.push(`contracts: ${report.summary.passed}/${report.summary.withContracts} passed, ${report.summary.failed} failed, ${report.summary.measuredOnly} measured-only, tolerance ${report.tolerance.flatSeconds.toFixed(2)}s + ${Math.round(report.tolerance.windowFraction * 100)}% of window`);
  for (const target of report.targets) {
    lines.push(``);
    lines.push(`${result.level.id} ${target.time.toFixed(1)}s ${target.label}`);
    if (target.contract) lines.push(`  contract: lead=${target.contract.leadSeconds.toFixed(2)}s`);
    else lines.push(`  contract: none`);
    const first = target.firstLockableAt === undefined ? 'never' : `${target.firstLockableAt.toFixed(2)}s`;
    const last = target.lastLockableAt === undefined ? 'never' : `${target.lastLockableAt.toFixed(2)}s`;
    lines.push(`  measured lockable: ${target.lockableSeconds.toFixed(2)}s; first ${first}, last ${last}`);
    if (target.contract) {
      const clipped = target.contract.clippedByRailEnd ? ' — lead clipped by rail end; spawn earlier or shorten lead' : '';
      const suffix = target.contract.result === 'FAIL' ? `, short by ${(target.contract.shortBy ?? 0).toFixed(2)}s${clipped}` : '';
      lines.push(`  result: ${target.contract.result}${suffix}`);
    } else {
      lines.push(`  result: measured only`);
    }
  }
  if (showHeatmap) {
    for (const run of result.runs) {
      if (run.heatmapKills && run.heatmapKills.length > 0) {
        lines.push(``);
        lines.push(`Heatmap for policy ${run.policy}:`);
        lines.push(...formatHeatmap(run));
      }
    }
  }
  return lines.join('\n');
}

function formatHeatmapGrid(kills: KillPosition[]): string[] {
  const W = 25;
  const H = 13;
  const grid = Array.from({ length: H }, () => Array(W).fill(0));
  let onScreenCount = 0;
  let offScreenCount = 0;

  for (const kill of kills) {
    const { x, y, z } = kill.ndc;
    const onScreen = z >= -1 && z <= 1 && Math.abs(x) <= 1.0 && Math.abs(y) <= 1.0;
    if (onScreen) {
      onScreenCount++;
      const c = Math.min(W - 1, Math.max(0, Math.floor((x + 1) / 2 * W)));
      const r = Math.min(H - 1, Math.max(0, Math.floor((1 - y) / 2 * H)));
      grid[r][c]++;
    } else {
      offScreenCount++;
    }
  }

  const maxInCell = Math.max(...grid.flat());
  const SCALE = ['.', ':', 'o', 'x', 'X', '#', '@'];
  
  const lines: string[] = [];
  lines.push(`  Enemy Destruction Heatmap (${kills.length} kills):`);
  if (kills.length === 0) {
    lines.push(`    No kills recorded.`);
    return lines;
  }

  if (maxInCell > 0) {
    const legendParts: string[] = [];
    for (let i = 0; i < SCALE.length; i++) {
      legendParts.push(`${SCALE[i]}`);
    }
    lines.push(`    Legend: ${legendParts.join(' ')} (max in cell = ${maxInCell})`);
  }

  lines.push(`    +${'-'.repeat(W)}+  Y=1.0 (Top)`);
  for (let r = 0; r < H; r++) {
    let rowStr = '';
    for (let c = 0; c < W; c++) {
      const count = grid[r][c];
      if (count > 0) {
        const intensity = Math.min(SCALE.length - 1, Math.floor(((count - 1) / (maxInCell - 1 || 1)) * (SCALE.length - 1)));
        rowStr += SCALE[intensity];
      } else {
        if (r === 6 && c === 12) {
          rowStr += '+';
        } else if (r === 6) {
          rowStr += '-';
        } else if (c === 12) {
          rowStr += '|';
        } else {
          rowStr += ' ';
        }
      }
    }
    lines.push(`    |${rowStr}|`);
  }
  lines.push(`    +${'-'.repeat(W)}+  Y=-1.0 (Bottom)`);
  lines.push(`     X=-1.0${' '.repeat(Math.max(0, W - 11))}X=1.0`);
  lines.push(`     (Left)${' '.repeat(Math.max(0, W - 13))}(Right)`);
  lines.push(``);
  const offPercent = kills.length > 0 ? (offScreenCount / kills.length * 100).toFixed(1) : '0.0';
  lines.push(`    Kills off-screen: ${offScreenCount} (${offPercent}%)`);
  return lines;
}

function formatHeatmap(run: RunResult): string[] {
  const kills = run.heatmapKills ?? [];
  const lines: string[] = [];

  lines.push(...formatHeatmapGrid(kills));

  if (kills.length > 0) {
    const distances = kills.map(k => k.distance);
    const minD = Math.min(...distances);
    const maxD = Math.max(...distances);
    const avgD = distances.reduce((sum, d) => sum + d, 0) / distances.length;

    lines.push(`    Distance from camera at destruction:`);
    lines.push(`      min: ${minD.toFixed(1)}m, max: ${maxD.toFixed(1)}m, avg: ${avgD.toFixed(1)}m`);
    lines.push(`      Distribution:`);

    const buckets = [
      { label: '  < 20m: ', min: 0, max: 20 },
      { label: ' 20–50m: ', min: 20, max: 50 },
      { label: '50–100m: ', min: 50, max: 100 },
      { label: '100–150m:', min: 100, max: 150 },
      { label: '150–200m:', min: 150, max: 200 },
      { label: ' ≥ 200m: ', min: 200, max: Infinity },
    ];

    const bucketCounts = buckets.map(() => 0);
    for (const kill of kills) {
      const d = kill.distance;
      for (let i = 0; i < buckets.length; i++) {
        if (d >= buckets[i].min && d < buckets[i].max) {
          bucketCounts[i]++;
          break;
        }
      }
    }

    const maxBucketCount = Math.max(...bucketCounts);
    const maxBarWidth = 40;
    for (let i = 0; i < buckets.length; i++) {
      const count = bucketCounts[i];
      const barLen = maxBucketCount > 0 ? Math.round((count / maxBucketCount) * maxBarWidth) : 0;
      const barStr = '|'.repeat(barLen);
      lines.push(`        ${buckets[i].label} [${String(count).padStart(3)}] ${barStr}`);
    }
  }

  return lines;
}

async function getAllLevels(rootDir: string): Promise<LevelTarget[]> {
  const registryPath = path.resolve(rootDir, 'src/levels/index.ts');
  const registrySource = await fs.readFile(registryPath, 'utf8');

  const caseRegex = /['"]([^'"]+)['"]:\s*async\s*\(\)\s*=>\s*\(await\s*import\(['"]([^'"]+)['"]\)\)\.([A-Za-z0-9_]+),/g;
  const cases = new Map<string, string>();
  let match: RegExpExecArray | null;
  while ((match = caseRegex.exec(registrySource))) {
    const canonicalId = match[1];
    const importPath = match[2];
    const folder = importPath.replace(/^\.\//, '');
    cases.set(canonicalId, folder);
  }

  const arrayMatch = registrySource.match(/export const levelMetadatas: LevelMetadata\[] = \[([\s\S]*?)\n\];/);
  if (!arrayMatch) throw new Error('Could not find levelMetadatas array in src/levels/index.ts');
  
  const entryRegex = /\{\s*id:\s*['"]([^'"]+)['"]\s*,\s*title:\s*['"]([^'"]+)['"]/g;
  const list: LevelTarget[] = [];
  while ((match = entryRegex.exec(arrayMatch[1]))) {
    const entryId = match[1];
    const entryTitle = match[2];
    const folder = cases.get(entryId);
    if (folder) {
      list.push({ canonical: entryId, folder, sourceRoot: 'levels', title: entryTitle });
    }
  }
  return list;
}

export function computeCenterMetrics(run: RunResult) {
  const kills = run.heatmapKills ?? [];
  if (kills.length === 0) {
    return {
      kills: 0,
      avgOffset: 0,
      centerPercent: 0,
      avgDistance: 0,
      offScreenPercent: 0
    };
  }

  let onScreenCount = 0;
  let offScreenCount = 0;
  let totalOffset = 0;
  let centerCount = 0;
  let totalDistance = 0;

  for (const kill of kills) {
    const { x, y, z } = kill.ndc;
    const onScreen = z >= -1 && z <= 1 && Math.abs(x) <= 1.0 && Math.abs(y) <= 1.0;
    totalDistance += kill.distance;
    
    if (onScreen) {
      onScreenCount++;
      const radialOffset = Math.hypot(x, y);
      totalOffset += radialOffset;
      if (radialOffset < 0.25) {
        centerCount++;
      }
    } else {
      offScreenCount++;
    }
  }

  return {
    kills: kills.length,
    avgOffset: onScreenCount > 0 ? totalOffset / onScreenCount : 0,
    centerPercent: onScreenCount > 0 ? (centerCount / onScreenCount) * 100 : 0,
    avgDistance: totalDistance / kills.length,
    offScreenPercent: (offScreenCount / kills.length) * 100
  };
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
  console.log(`Usage: npm run simulate -- [--level <id> | --all] [--policy suite|none|perfect|imperfect|reject] [--engagement] [--heatmap] [--seed n] [--json] [--write path]`);
  process.exit(0);
}
