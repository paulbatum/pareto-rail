#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertOnlyOptions,
  assertPrivateOrExternalPath,
  fail,
  isPlainObject,
  parseArgs,
  readJson,
  requireOption,
  sha256,
} from './common.mjs';
import { renderAssignment, renderDelegation } from './render-assignment.mjs';
import { ccusageVersion, harnessCountersForRounds, measureRunCost, reconcileCost, reconciliationWarnings } from './ccusage-cost.mjs';
import { manifestErrors } from './results.mjs';
import { createRecoverySnapshot, restoreRecoverySnapshot } from './recovery-snapshot.mjs';
import { assertScrubbedBaseline, scrubbedBaselineViolations } from './baseline-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADMIN = path.join(ROOT, 'scripts/benchmark/admin.mjs');
const RUNS_DIRECTORY = path.join(ROOT, 'benchmark/private/runs');
const SOURCE_ROOT = 'src/benchmark-levels';
const ASSIGNMENT_TEMPLATE_PATH = 'benchmark/prompts/level-assignment.md';
const EFFORTS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

// One entry per supported `definition.stage.adapter`. Adds a harness without touching
// the Codex path: same stage shape (model, effort, timeoutSeconds), different process runner.
const ADAPTERS = {
  'codex-cli': {
    scriptPath: path.join(ROOT, 'scripts/benchmark/codex-cli.mjs'),
    stageDir: 'stages/solo/codex',
    binField: 'codexBin',
    binFlag: '--codex-bin',
    harnessName: 'Codex CLI',
    modelProvider: () => 'OpenAI Codex subscription',
    // Env var scoping the harness (and ccusage) to this run's isolated rollout home, plus the
    // operator credential copied into that home so login works. `sourceRelative` is under the
    // operator home dir; `dest` is under the per-run home.
    homeEnvVar: 'CODEX_HOME',
    credential: { sourceRelative: '.codex/auth.json', dest: 'auth.json' },
    // Extra adapter args applied only when the run definition carries a `delegation` block. Codex
    // needs the multi_agent_v2 feature enabled for a subagent to run a different model than its
    // parent; the isolated per-run home does not inherit the operator's config.toml, so the adapter
    // re-declares it (workaround for https://github.com/openai/codex/issues/31814). Claude's Agent
    // tool needs no equivalent, so claude-cli has no delegation args.
    delegationArgs: ['--enable-multi-agent', 'true'],
    stageArgs: (definition) => ['--network-access', String(codexNetworkAccess(definition))],
  },
  'claude-cli': {
    scriptPath: path.join(ROOT, 'scripts/benchmark/claude-cli.mjs'),
    stageDir: 'stages/solo/claude',
    binField: 'claudeBin',
    binFlag: '--claude-bin',
    harnessName: 'Claude Code CLI',
    modelProvider: () => 'Anthropic Claude Code subscription',
    homeEnvVar: 'CLAUDE_CONFIG_DIR',
    credential: { sourceRelative: '.claude/.credentials.json', dest: '.credentials.json' },
  },
  'pi-cli': {
    scriptPath: path.join(ROOT, 'scripts/benchmark/pi-cli.mjs'),
    stageDir: 'stages/solo/pi',
    binField: 'piBin',
    binFlag: '--pi-bin',
    harnessName: 'pi',
    // pi reaches a model through a selectable provider, so the billing account is a property of the
    // run rather than of the harness. The stage's provider names it in the manifest.
    modelProvider: (definition) => `pi provider ${definition.stage.provider ?? 'default'}`,
    homeEnvVar: 'PI_CODING_AGENT_DIR',
    credential: { sourceRelative: '.pi/agent/auth.json', dest: 'auth.json' },
    // pi takes the provider per invocation rather than from the home's config, and a benchmark stage
    // must pin it rather than inherit whatever the operator last selected.
    stageArgs: (definition) => (definition.stage.provider ? ['--provider', definition.stage.provider] : []),
  },
};

const CHECKPOINTS = ['inputs', 'worktree', 'setup', 'stage', 'seal', 'gates', 'payload', 'manifest'];

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage:
  npm run benchmark:run -- --plan <plan.json> --run <runId>
  npm run benchmark:run -- --resume <run-directory> [--accept-stage-output true] [--continue-stage true]`);
    return;
  }
  if (rest.length) fail(`Unexpected argument: ${rest.join(' ')}.`);
  assertOnlyOptions(options, new Set(['help', 'plan', 'run', 'resume', 'accept-stage-output', 'continue-stage']));
  const resuming = Boolean(options.resume);
  const continueStage = options['continue-stage'] !== undefined;
  if (continueStage && options['continue-stage'] !== 'true') fail('--continue-stage only accepts true.');
  if (continueStage && !resuming) fail('--continue-stage is only valid with --resume.');
  if (continueStage && options['accept-stage-output'] !== undefined) fail('--continue-stage cannot be combined with --accept-stage-output.');
  if (resuming && (options.plan || options.run)) fail('--resume cannot be combined with --plan or --run.');
  if (!resuming && (!options.plan || !options.run)) fail('A new run requires --plan and --run.');

  let definition;
  let outputDirectory;
  if (resuming) {
    outputDirectory = assertPrivateOrExternalPath(options.resume, ROOT);
    definition = await readJson(path.join(outputDirectory, 'run-definition.json'));
    const errors = validateRunDefinition(definition);
    if (errors.length) fail(`Invalid run definition:\n${errors.map((error) => `- ${error}`).join('\n')}`);
    if (continueStage && definition.stage.adapter !== 'pi-cli') fail('--continue-stage is only valid for pi-cli stages.');
    if (continueStage && definition.stage.budget) fail('--continue-stage cannot be used with a budgeted stage; the budget protocol owns its continuations.');
  } else {
    const planPath = path.resolve(options.plan);
    const plan = await readJson(planPath);
    const planErrors = validatePlan(plan);
    if (planErrors.length) fail(`Invalid plan:\n${planErrors.map((error) => `- ${error}`).join('\n')}`);
    const row = plan.runs.find((candidate) => candidate.runId === options.run);
    if (!row) fail(`Plan has no run with runId ${options.run}.`);
    if (options.run !== path.basename(options.run)) fail('runId must not contain path separators.');
    outputDirectory = assertPrivateOrExternalPath(path.join(RUNS_DIRECTORY, options.run), ROOT);
    await assertAbsent(outputDirectory, 'run output directory');
    await assertCleanRepository();
    const materialsCommit = await gitCommit(plan.materialsCommit);
    const entrantBaseline = await gitCommit(row.entrantBaseline ?? plan.entrantBaseline);
    definition = await synthesizeDefinition(plan, row, materialsCommit, entrantBaseline);
    const errors = validateRunDefinition(definition);
    if (errors.length) fail(`Invalid run definition:\n${errors.map((error) => `- ${error}`).join('\n')}`);
    await fs.mkdir(outputDirectory, { recursive: true });
    await writeJson(path.join(outputDirectory, 'run-definition.json'), definition);
  }

  if (path.basename(outputDirectory) !== definition.runId) fail('Run directory must end with the runId.');
  const paths = conventionalRunPaths(definition.runId);
  const statePath = path.join(outputDirectory, 'controller-state.json');
  const state = await loadControllerState(statePath, definition.runId, outputDirectory);
  let worktree;
  try {
    const materialsCommit = await gitCommit(definition.materialsCommit);
    const entrantBaseline = await gitCommit(definition.entrantBaseline);
    const baselineGuard = await validateEntrantBaseline({ baselinePolicy: definition.baselinePolicy, entrantBaseline, repo: ROOT });
    reportBaselineGuard(baselineGuard);

    const inputs = await checkpoint(state, statePath, 'inputs', async () => {
      const existing = await optionalJson(path.join(outputDirectory, 'rendered-assignment.json'));
      const renderedPath = path.join(outputDirectory, 'rendered-assignment.md');
      if (existing) {
        const rendered = await fs.readFile(renderedPath, 'utf8');
        if (sha256(rendered) !== existing.rendering?.sha256) fail('Recorded rendered assignment hash does not match its file.');
        return { renderedPath };
      }
      return prepareInputs(definition, materialsCommit, outputDirectory);
    });

    worktree = await checkpoint(state, statePath, 'worktree', async () => {
      const existing = await optionalJson(path.join(outputDirectory, 'worktree.json'));
      if (existing) {
        if (!await pathExists(existing.worktree)) {
          const restored = await restoreRecoverySnapshot({ repo: ROOT, runDirectory: outputDirectory, worktreeRecord: existing });
          if (!restored) fail(`Recorded entrant worktree is unavailable and no durable recovery snapshot exists: ${existing.worktree}`);
        }
        await validateWorktree(existing, entrantBaseline);
        return existing;
      }
      const result = await command(process.execPath, [ADMIN, 'worktree', '--baseline', entrantBaseline, '--run-id', definition.runId, '--path', paths.worktree], ROOT);
      const created = JSON.parse(result.stdout);
      await writeJson(path.join(outputDirectory, 'worktree.json'), created);
      return created;
    });

    await checkpoint(state, statePath, 'setup', async () => {
      const existing = await optionalJson(path.join(outputDirectory, 'setup.json'));
      if (existing?.exitCode === 0 && await pathExists(path.join(worktree.worktree, 'node_modules'))) return existing;
      const setup = await command('npm', ['ci'], worktree.worktree, { allowFailure: true, env: { PUPPETEER_SKIP_DOWNLOAD: 'true' } });
      const setupPath = existing ? path.join(outputDirectory, 'setup-resume.json') : path.join(outputDirectory, 'setup.json');
      await writeCommandRecord(setupPath, ['npm', 'ci'], setup);
      if (setup.code !== 0) fail(`Dependency provisioning failed; see ${setupPath}.`);
      return { exitCode: setup.code };
    });

    const adapter = ADAPTERS[definition.stage.adapter];
    const harnessHome = path.join(outputDirectory, 'harness-home');
    await checkpoint(state, statePath, 'stage', async () => {
      const stageDirectory = path.join(outputDirectory, adapter.stageDir);
      const launch = await optionalJson(path.join(outputDirectory, 'stage-launch.json'));
      if (launch) {
        if (launch.exitCode === 0) return { exitCode: 0 };
        const recovery = await optionalJson(path.join(outputDirectory, 'recovery.json'));
        if (recovery?.policy === 'completed entrant work accepted; normal sealing and gates resumed') return { exitCode: launch.exitCode, acceptedCompletedWorktree: true };
        if (continueStage) {
          const round = await nextContinuationRound(stageDirectory);
          const originalLaunchPath = path.join(outputDirectory, 'stage-launch-round-0.json');
          if (!await pathExists(originalLaunchPath)) await writeJson(originalLaunchPath, launch);
          const roundLaunchPath = path.join(outputDirectory, `stage-launch-round-${round}.json`);
          await assertAbsent(roundLaunchPath, `stage launch round ${round} record`);
          await prepareHarnessHome(adapter, outputDirectory);
          const stageArgs = buildStageArgs({ adapter, definition, worktree, inputs, stageDirectory, resumeRound: round });
          const stage = await command(process.execPath, stageArgs, ROOT, { allowFailure: true, env: { [adapter.homeEnvVar]: harnessHome } });
          await writeCommandRecord(roundLaunchPath, [process.execPath, ...stageArgs], stage);
          await writeCommandRecord(path.join(outputDirectory, 'stage-launch.json'), [process.execPath, ...stageArgs], stage);
          if (stage.code !== 0) fail(`${adapter.harnessName} continuation stage failed; its worktree and artifacts were preserved for the next resumption.`);
          return { exitCode: 0 };
        }
        if (options['accept-stage-output'] === 'true') {
          await recordRecovery(outputDirectory, definition, worktree, launch);
          return { exitCode: launch.exitCode, acceptedCompletedWorktree: true };
        }
        fail('The recorded stage failed. Resume with --accept-stage-output true only after verifying that the entrant completed its worktree.');
      }
      if (continueStage) fail('--continue-stage requires a previously recorded stage launch.');
      await prepareHarnessHome(adapter, outputDirectory);
      const stageArgs = buildStageArgs({ adapter, definition, worktree, inputs, stageDirectory });
      const stage = await command(process.execPath, stageArgs, ROOT, { allowFailure: true, env: { [adapter.homeEnvVar]: harnessHome } });
      await writeCommandRecord(path.join(outputDirectory, 'stage-launch.json'), [process.execPath, ...stageArgs], stage);
      if (stage.code !== 0) fail(`${adapter.harnessName} stage failed; its worktree and artifacts were preserved for resumption.`);
      return { exitCode: 0 };
    });

    const evaluated = await checkpoint(state, statePath, 'seal', async () => {
      const existing = await optionalJson(path.join(outputDirectory, 'evaluated.json'));
      if (existing) {
        await validateEvaluated(existing, worktree);
        return existing;
      }
      const sealed = await command(process.execPath, [ADMIN, 'seal', '--repo', ROOT, '--worktree', worktree.worktree, '--baseline', entrantBaseline, '--level-id', definition.levelId, '--level-title', definition.levelTitle], ROOT);
      const value = JSON.parse(sealed.stdout);
      await writeJson(path.join(outputDirectory, 'evaluated.json'), value);
      return value;
    });

    const gateRecord = await checkpoint(state, statePath, 'gates', async () => {
      const existing = await reusableGateRecord(outputDirectory, evaluated.evaluatedCommit);
      if (existing) return existing;
      const gateDirectory = path.join(outputDirectory, 'gates');
      await command(process.execPath, [ADMIN, 'gates', '--worktree', worktree.worktree, '--baseline', entrantBaseline, '--level-id', definition.levelId, '--out', gateDirectory], ROOT);
      return readJson(path.join(gateDirectory, 'gates.json'));
    });
    const passing = gateRecord.gates.every(({ status }) => status === 'passed');

    const payload = await checkpoint(state, statePath, 'payload', async () => {
      if (!passing) return null;
      const existing = await optionalJson(path.join(outputDirectory, 'payload.json'));
      if (existing) {
        await validatePayload(existing, materialsCommit, definition.levelId);
        return existing;
      }
      const result = await command(process.execPath, [ADMIN, 'payload', '--repo', ROOT, '--materials', materialsCommit, '--evaluated', evaluated.evaluatedCommit, '--level-id', definition.levelId, '--level-title', definition.levelTitle, '--path', paths.payload, '--branch', paths.payloadBranch], ROOT);
      const value = JSON.parse(result.stdout);
      await writeJson(path.join(outputDirectory, 'payload.json'), value);
      return value;
    });

    const manifest = await checkpoint(state, statePath, 'manifest', async () => {
      const existing = await optionalJson(path.join(outputDirectory, 'manifest.json'));
      if (existing && !manifestNeedsRefresh(existing, evaluated, payload, gateRecord)) {
        validateManifest(existing, definition, evaluated, payload, gateRecord);
        return existing;
      }
      const value = await createManifest({ definition, materialsCommit, entrantBaseline, baselineGuard, outputDirectory, harnessHome, gateRecord, evaluated, payload, worktree, startedAt: state.startedAt });
      await writeJson(path.join(outputDirectory, 'manifest.json'), value);
      return value;
    });
    console.log(JSON.stringify({ runId: definition.runId, status: manifest.disposition.status, evaluatedCommit: evaluated.evaluatedCommit, payloadCommit: payload?.payloadCommit ?? null, resumed: resuming }));
    if (!passing) process.exitCode = 2;
  } catch (error) {
    let snapshotError;
    try {
      await createRecoverySnapshot({
        repo: ROOT,
        runDirectory: outputDirectory,
        runId: definition.runId,
        worktree: worktree?.worktree,
        checkpoint: state.currentCheckpoint,
        reason: error instanceof Error ? error.message : String(error),
      });
    } catch (snapshotFailure) {
      snapshotError = snapshotFailure instanceof Error ? snapshotFailure.message : String(snapshotFailure);
    }
    await appendControllerFailure(outputDirectory, error, worktree, state.currentCheckpoint, snapshotError);
    throw error;
  }
}

async function loadControllerState(statePath, runId, outputDirectory) {
  const existing = await optionalJson(statePath);
  if (existing) return existing;
  const setup = await optionalJson(path.join(outputDirectory, 'setup.json'));
  const state = {
    schemaVersion: 1,
    runId,
    startedAt: setup?.startedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentCheckpoint: null,
    checkpoints: {},
  };
  await writeJson(statePath, state);
  return state;
}

async function checkpoint(state, statePath, id, action) {
  if (!CHECKPOINTS.includes(id)) fail(`Unknown checkpoint: ${id}`);
  state.currentCheckpoint = id;
  state.updatedAt = new Date().toISOString();
  state.checkpoints[id] = { status: 'running', startedAt: new Date().toISOString() };
  await writeJson(statePath, state);
  try {
    const value = await action();
    state.checkpoints[id] = { ...state.checkpoints[id], status: 'completed', finishedAt: new Date().toISOString() };
    state.currentCheckpoint = null;
    state.updatedAt = new Date().toISOString();
    await writeJson(statePath, state);
    return value;
  } catch (error) {
    state.checkpoints[id] = { ...state.checkpoints[id], status: 'failed', finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
    state.updatedAt = new Date().toISOString();
    await writeJson(statePath, state);
    throw error;
  }
}

async function optionalJson(filePath) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function pathExists(filePath) {
  try { await fs.lstat(filePath); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function validateWorktree(worktree, baseline) {
  if (!worktree?.worktree) fail('worktree.json has no worktree path.');
  const inside = (await command('git', ['rev-parse', '--is-inside-work-tree'], worktree.worktree)).stdout.trim();
  if (inside !== 'true') fail(`Recorded entrant worktree is unavailable: ${worktree.worktree}`);
  await gitCommit(baseline);
  const ancestry = await command('git', ['merge-base', '--is-ancestor', baseline, 'HEAD'], worktree.worktree, { allowFailure: true });
  if (ancestry.code !== 0) fail('Recorded entrant worktree is not based on the declared entrant baseline.');
}

async function validateEvaluated(evaluated, worktree) {
  const commit = await gitCommit(evaluated?.evaluatedCommit);
  const head = (await command('git', ['rev-parse', 'HEAD'], worktree.worktree)).stdout.trim();
  if (head !== commit) fail('Recorded evaluated commit does not match the entrant worktree HEAD.');
  const status = (await command('git', ['status', '--porcelain'], worktree.worktree)).stdout.trim();
  if (status) fail('Recorded evaluated worktree is not clean.');
}

async function validatePayload(payload, materialsCommit, levelId) {
  const payloadCommit = await gitCommit(payload?.payloadCommit);
  const levelDirectory = `${SOURCE_ROOT}/${levelId}/`;
  const names = (await command('git', ['diff', '--name-only', `${materialsCommit}..${payloadCommit}`], ROOT)).stdout.trim().split('\n').filter(Boolean);
  if (!names.length || names.some((name) => !name.startsWith(levelDirectory))) fail('Recorded payload does not contain exactly the assigned level directory.');
}

export async function reusableGateRecord(outputDirectory, evaluatedCommit) {
  const existing = await optionalJson(path.join(outputDirectory, 'gates', 'gates.json'));
  return existing?.evaluatedCommit === evaluatedCommit && Array.isArray(existing.gates) && existing.gates.length === 4 ? existing : null;
}

export function manifestNeedsRefresh(manifest, evaluated, payload, gateRecord) {
  if (manifest.output?.evaluated?.commit !== evaluated.evaluatedCommit) return true;
  if ((manifest.output?.payload?.commit ?? null) !== (payload?.payloadCommit ?? null)) return true;
  const recordedGates = new Map((manifest.gates ?? []).map((gate) => [gate.id, gate.status]));
  return gateRecord.gates.some((gate) => recordedGates.get(gate.id) !== gate.status);
}

export function dispositionFor({ kind = 'benchmark', passing, payload }) {
  if (kind === 'rehearsal') return { status: 'rehearsal' };
  if (!passing) return { status: 'dnf', reasonCode: 'required-gate-failed' };
  if (payload) return { status: 'playable' };
  return { status: 'dnf', reasonCode: 'payload-pending' };
}

function validateManifest(manifest, definition, evaluated, payload, gateRecord) {
  const errors = manifestErrors(manifest);
  if (errors.length) fail(`Recorded manifest is invalid: ${errors.join('; ')}`);
  if (manifest.runId !== definition.runId || manifest.output?.levelId !== definition.levelId) fail('Recorded manifest identity does not match the run definition.');
  if (manifest.output?.evaluated?.commit !== evaluated.evaluatedCommit) fail('Recorded manifest evaluated commit does not match evaluated.json.');
  if (payload && manifest.output?.payload?.commit !== payload.payloadCommit) fail('Recorded manifest payload commit does not match payload.json.');
  const gates = new Map(gateRecord.gates.map((gate) => [gate.id, gate.status]));
  for (const gate of manifest.gates) if (gates.get(gate.id) !== gate.status) fail(`Recorded manifest gate ${gate.id} does not match gates.json.`);
  if (manifest.disposition?.status === 'playable' && (!payload || [...gates.values()].some((status) => status !== 'passed'))) fail('Playable manifest requires a payload and all gates passing.');
}

async function recordRecovery(outputDirectory, definition, worktree, launch) {
  const existing = await optionalJson(path.join(outputDirectory, 'recovery.json'));
  if (existing) return existing;
  const status = (await command('git', ['status', '--porcelain'], worktree.worktree)).stdout;
  const record = {
    schemaVersion: 1,
    recoveredAt: new Date().toISOString(),
    reason: 'infrastructure-timeout-after-completed-worktree',
    policy: 'completed entrant work accepted; normal sealing and gates resumed',
    originalStageExitCode: launch.exitCode,
    entrantBaseline: definition.entrantBaseline,
    worktree: worktree.worktree,
    reconstructedTreeStatusSha256: sha256(status),
  };
  await writeJson(path.join(outputDirectory, 'recovery.json'), record);
  return record;
}

async function appendControllerFailure(outputDirectory, error, worktree, checkpointId, snapshotError) {
  const failure = {
    failedAt: new Date().toISOString(),
    checkpoint: checkpointId ?? null,
    message: error instanceof Error ? error.message : String(error),
    worktree,
    ...(snapshotError ? { recoverySnapshotError: snapshotError } : {}),
  };
  const historyPath = path.join(outputDirectory, 'controller-failures.json');
  const history = await optionalJson(historyPath) ?? { schemaVersion: 1, failures: [] };
  history.failures.push(failure);
  await writeJson(historyPath, history);
  await writeJson(path.join(outputDirectory, 'controller-failure.json'), failure);
}

export function validatePlan(value) {
  const errors = [];
  if (!isPlainObject(value)) return ['plan must be an object.'];
  validateString(value.benchmarkVersion, 'plan.benchmarkVersion', errors);
  if (value.benchmarkVersion !== undefined && value.benchmarkVersion !== 'v2') errors.push('plan.benchmarkVersion must equal v2.');
  validateString(value.materialsCommit, 'plan.materialsCommit', errors);
  validateGitCommitString(value.entrantBaseline, 'plan.entrantBaseline', errors);
  if (!Object.hasOwn(value, 'baselinePolicy')) errors.push('plan.baselinePolicy is required; choose "scrubbed" for a new series or "open" only for the historical v2 record.');
  else if (!['open', 'scrubbed'].includes(value.baselinePolicy)) errors.push('plan.baselinePolicy must be "open" or "scrubbed"; choose a policy explicitly.');
  if (!Array.isArray(value.runs) || value.runs.length === 0) {
    errors.push('plan.runs must be a non-empty array.');
    return errors;
  }

  const runIds = new Set();
  const slotIds = new Set();
  const levelIds = new Set();
  for (const [index, row] of value.runs.entries()) {
    const label = `plan.runs[${index}]`;
    validateRunRow(row, label, errors, { requireTitle: false });
    if (!isPlainObject(row)) continue;
    for (const [field, set] of [['runId', runIds], ['slotId', slotIds], ['levelId', levelIds]]) {
      if (typeof row[field] !== 'string' || !row[field]) continue;
      if (set.has(row[field])) errors.push(`${label}.${field} duplicates ${row[field]}.`);
      set.add(row[field]);
    }
  }
  return errors;
}

export function validateRunDefinition(value) {
  const errors = [];
  if (!isPlainObject(value)) return ['run definition must be an object.'];
  validateString(value.benchmarkVersion, 'run definition.benchmarkVersion', errors);
  if (value.benchmarkVersion !== undefined && value.benchmarkVersion !== 'v2') errors.push('run definition.benchmarkVersion must equal v2.');
  validateString(value.materialsCommit, 'run definition.materialsCommit', errors);
  validateGitCommitString(value.entrantBaseline, 'run definition.entrantBaseline', errors);
  if (value.baselinePolicy !== undefined && !['open', 'scrubbed'].includes(value.baselinePolicy)) errors.push('run definition.baselinePolicy must be "open" or "scrubbed".');
  validateRunRow(value, 'run definition', errors, { requireTitle: true });
  return errors;
}

function validateRunRow(row, label, errors, { requireTitle }) {
  if (!isPlainObject(row)) { errors.push(`${label} must be an object.`); return; }
  for (const field of ['runId', 'slotId', 'levelId', 'themeId', 'themePath', 'configurationId', 'recipePath']) validateString(row[field], `${label}.${field}`, errors);
  if (requireTitle) validateString(row.levelTitle, `${label}.levelTitle`, errors);
  if (row.kind !== undefined && !['rehearsal', 'benchmark'].includes(row.kind)) errors.push(`${label}.kind must be rehearsal or benchmark.`);
  if (row.entrantBaseline !== undefined) validateGitCommitString(row.entrantBaseline, `${label}.entrantBaseline`, errors);
  if (row.levelId && row.themeId && row.slotId && row.levelId !== `${row.themeId}-${row.slotId}`) errors.push(`${label}.levelId must equal ${row.themeId}-${row.slotId}.`);
  validateStage(row.stage, `${label}.stage`, errors);
  if (row.delegation !== undefined) validateDelegation(row.delegation, `${label}.delegation`, errors);
}

function validateStage(value, label, errors) {
  if (!isPlainObject(value)) { errors.push(`${label} must be an object.`); return; }
  if (!Object.hasOwn(ADAPTERS, value.adapter)) errors.push(`${label}.adapter must be one of: ${Object.keys(ADAPTERS).join(', ')}.`);
  validateString(value.model, `${label}.model`, errors);
  if (!EFFORTS.has(value.effort)) errors.push(`${label}.effort is invalid.`);
  if (!Number.isInteger(value.timeoutSeconds) || value.timeoutSeconds < 1) errors.push(`${label}.timeoutSeconds must be a positive integer.`);
  if (value.provider !== undefined) validateString(value.provider, `${label}.provider`, errors);
  if (value.networkAccess !== undefined && typeof value.networkAccess !== 'boolean') errors.push(`${label}.networkAccess must be a boolean.`);
  if (value.budget !== undefined) {
    if (!isPlainObject(value.budget)) errors.push(`${label}.budget must be an object.`);
    else if (!(typeof value.budget.usd === 'number' && Number.isFinite(value.budget.usd) && value.budget.usd > 0)) errors.push(`${label}.budget.usd must be a positive finite number.`);
  }
}

function validateDelegation(value, label, errors) {
  if (!isPlainObject(value)) { errors.push(`${label} must be an object.`); return; }
  validateString(value.promptPath, `${label}.promptPath`, errors);
  validateString(value.delegateModel, `${label}.delegateModel`, errors);
  if (!['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value.delegateEffort)) errors.push(`${label}.delegateEffort is invalid.`);
}

function validateString(value, label, errors) {
  if (typeof value !== 'string' || !value) errors.push(`${label} is required.`);
}

function validateGitCommitString(value, label, errors) {
  if (typeof value !== 'string' || !value) {
    errors.push(`${label} is required.`);
  } else if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) {
    errors.push(`${label} must be a 40- or 64-character hexadecimal Git commit hash.`);
  }
}

export function firstLevelOneHeading(source) {
  return source.match(/^#\s+(.+?)\s*$/m)?.[1] ?? undefined;
}

export async function synthesizeDefinition(plan, row, materialsCommit, resolvedEntrantBaseline) {
  const entrantBaseline = resolvedEntrantBaseline ?? row.entrantBaseline ?? plan.entrantBaseline;
  const theme = await gitShow(materialsCommit, row.themePath);
  const levelTitle = firstLevelOneHeading(theme);
  if (!levelTitle) fail(`Theme ${row.themePath} must contain a level-one heading.`);
  await gitShow(materialsCommit, ASSIGNMENT_TEMPLATE_PATH);
  await gitShow(materialsCommit, row.recipePath);
  if (row.delegation) await gitShow(materialsCommit, row.delegation.promptPath);
  return {
    ...structuredClone(row),
    benchmarkVersion: plan.benchmarkVersion,
    baselinePolicy: plan.baselinePolicy,
    materialsCommit,
    entrantBaseline,
    kind: row.kind ?? 'benchmark',
    levelTitle,
  };
}

async function prepareInputs(definition, materialsCommit, outputDirectory) {
  const template = await gitShow(materialsCommit, ASSIGNMENT_TEMPLATE_PATH);
  const theme = await gitShow(materialsCommit, definition.themePath);
  const recipe = await gitShow(materialsCommit, definition.recipePath);
  const inputDirectory = path.join(outputDirectory, 'inputs');
  await fs.mkdir(inputDirectory, { recursive: true });
  const templatePath = path.join(inputDirectory, 'assignment-template.md');
  const themePath = path.join(inputDirectory, 'theme.md');
  const renderedPath = path.join(outputDirectory, 'rendered-assignment.md');
  const baseRendering = renderAssignment(template, {
    levelId: definition.levelId,
    levelTitle: definition.levelTitle,
    theme,
    budget: Boolean(definition.stage.budget),
  });

  let rendered = baseRendering;
  let delegationMeta;
  if (definition.delegation) {
    const delegationTemplate = await gitShow(materialsCommit, definition.delegation.promptPath);
    const addendum = renderDelegation(delegationTemplate, { delegateModel: definition.delegation.delegateModel, delegateEffort: definition.delegation.delegateEffort });
    rendered = `${baseRendering}\n\n${addendum}`;
    delegationMeta = { path: definition.delegation.promptPath, delegateModel: definition.delegation.delegateModel, delegateEffort: definition.delegation.delegateEffort, sha256: sha256(addendum), promptSha256: sha256(delegationTemplate) };
  }

  await Promise.all([fs.writeFile(templatePath, template), fs.writeFile(themePath, theme), fs.writeFile(renderedPath, rendered)]);
  const templateSha256 = sha256(template);
  const themeSha256 = sha256(theme);
  await writeJson(path.join(outputDirectory, 'rendered-assignment.json'), {
    template: { path: ASSIGNMENT_TEMPLATE_PATH, sha256: templateSha256 },
    theme: { path: definition.themePath, sha256: themeSha256 },
    recipe: { path: definition.recipePath, sha256: sha256(recipe) },
    rendering: { path: renderedPath, sha256: sha256(rendered) },
    baseRendering: { sha256: sha256(baseRendering) },
    ...(delegationMeta ? { delegation: delegationMeta } : {}),
  });
  await assertSiblingSharedInputs(definition, outputDirectory, { templateSha256, themeSha256 });
  return { renderedPath };
}

function buildStageArgs({ adapter, definition, worktree, inputs, stageDirectory, resumeRound }) {
  const stageArgs = [adapter.scriptPath, '--worktree', worktree.worktree, '--prompt', inputs.renderedPath, '--out', stageDirectory, '--model', definition.stage.model, '--effort', definition.stage.effort, '--timeout-seconds', String(definition.stage.timeoutSeconds)];
  if (definition.stage.budget) stageArgs.push('--budget-usd', String(definition.stage.budget.usd));
  if (definition.stage[adapter.binField]) stageArgs.push(adapter.binFlag, definition.stage[adapter.binField]);
  if (definition.delegation && adapter.delegationArgs) stageArgs.push(...adapter.delegationArgs);
  if (adapter.stageArgs) stageArgs.push(...adapter.stageArgs(definition));
  if (resumeRound !== undefined) stageArgs.push('--resume-round', String(resumeRound));
  return stageArgs;
}

// Open-policy rows retain v2's historical network behavior. Scrubbed series
// default to isolation, while a recipe can explicitly opt its Codex stage in.
export function codexNetworkAccess(definition) {
  if (typeof definition?.stage?.networkAccess === 'boolean') return definition.stage.networkAccess;
  return definition?.baselinePolicy !== 'scrubbed';
}

// The guard is evaluated for every policy; only the consequence differs. A scrubbed row aborts on any
// violation, while an open row launches and carries the findings into its manifest, so the record shows
// what the entrant could reach rather than leaving it to be reconstructed from transcripts later.
export async function validateEntrantBaseline({ baselinePolicy, entrantBaseline, repo = ROOT }) {
  const policy = baselinePolicy === 'scrubbed' ? 'scrubbed' : 'open';
  if (policy === 'scrubbed') return { policy, ...await assertScrubbedBaseline({ repo, baseline: entrantBaseline }) };
  return { policy, commit: entrantBaseline, violations: await scrubbedBaselineViolations({ repo, baseline: entrantBaseline }) };
}

export function reportBaselineGuard({ policy, commit, violations }) {
  if (violations.length === 0) return;
  console.warn(`Entrant baseline ${commit} carries ${violations.length} exposure${violations.length === 1 ? '' : 's'} under baselinePolicy "${policy}":`);
  for (const { path: pathName, reason } of violations) console.warn(`- ${pathName}: ${reason}`);
  console.warn('Launching anyway; an open policy records these in the run manifest rather than blocking.');
}

export async function nextContinuationRound(stageDirectory) {
  let entries;
  try {
    entries = await fs.readdir(stageDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`Missing stage directory: ${stageDirectory}`);
    throw error;
  }
  const completedRounds = entries.filter((entry) => entry.isFile() && /^events-resume-\d+\.jsonl$/.test(entry.name));
  return completedRounds.length + 1;
}

function conventionalRunPaths(runId) {
  return {
    worktree: path.join('/tmp', `pareto-rail-${runId}`),
    payload: path.join('/tmp', `pareto-rail-payload-${runId}`),
    payloadBranch: `benchmark-payload-${runId}`,
  };
}

// Cheap pre-launch waste-guard: entrants on one theme must share the same theme text and assignment
// template, so a misrendered prompt (wrong path, stale materialsCommit) is caught before an expensive
// stage launches. Only the genuinely-shared inputs are compared — the per-run level id and the budget
// flag legitimately differ between siblings (unique opaque id; -high vs -b20 interventions), so folding
// them into the check would falsely block the roster it is meant to protect.
export async function assertSiblingSharedInputs(definition, outputDirectory, { templateSha256, themeSha256 }) {
  let entries;
  try { entries = await fs.readdir(path.dirname(outputDirectory), { withFileTypes: true }); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === path.basename(outputDirectory)) continue;
    const siblingDirectory = path.join(path.dirname(outputDirectory), entry.name);
    const sibling = await optionalJson(path.join(siblingDirectory, 'run-definition.json'));
    if (sibling?.benchmarkVersion !== definition.benchmarkVersion || sibling?.themeId !== definition.themeId) continue;
    if (!await pathExists(path.join(siblingDirectory, 'rendered-assignment.md'))) continue;
    const metadata = await optionalJson(path.join(siblingDirectory, 'rendered-assignment.json'));
    if (!metadata?.theme?.sha256 || !metadata?.template?.sha256) continue;
    if (metadata.theme.sha256 !== themeSha256) fail(`Theme text differs from sibling run ${sibling.runId ?? entry.name} on the same theme; entrants on one theme must share identical theme inputs.`);
    if (metadata.template.sha256 !== templateSha256) fail(`Assignment template differs from sibling run ${sibling.runId ?? entry.name} on the same theme; entrants on one theme must share the same template.`);
  }
}

// Each run gets an isolated harness home under its private output dir, with the operator credential
// copied in so login works. Isolation gives clean cost attribution: everything ccusage sees in this
// home belongs to this run (parent + any delegated subagents). The home is retained as the run's
// rollout audit artifact. The credential copy is a declared operator convenience, of a kind with the
// worktree-access convention in the runbook — not a security boundary.
async function prepareHarnessHome(adapter, outputDirectory) {
  const home = path.join(outputDirectory, 'harness-home');
  const credentialSource = path.join(os.homedir(), adapter.credential.sourceRelative);
  const credentialDest = path.join(home, adapter.credential.dest);
  await fs.mkdir(path.dirname(credentialDest), { recursive: true });
  try {
    await fs.copyFile(credentialSource, credentialDest);
  } catch (error) {
    fail(`Could not copy the operator credential ${credentialSource} into the per-run home: ${error instanceof Error ? error.message : String(error)}`);
  }
  await fs.chmod(credentialDest, 0o600);
  return home;
}

async function createManifest({ definition, materialsCommit, entrantBaseline, baselineGuard, outputDirectory, harnessHome, gateRecord, evaluated, payload, worktree, startedAt }) {
  const adapter = ADAPTERS[definition.stage.adapter];
  const [usage, commandRecords, stageLaunch, recipe, theme, renderedMeta, eventLog, budget] = await Promise.all([
    loadStageUsage(outputDirectory, adapter, definition),
    loadRoundCommands(outputDirectory, adapter),
    readJson(path.join(outputDirectory, 'stage-launch.json')),
    gitShow(materialsCommit, definition.recipePath),
    gitShow(materialsCommit, definition.themePath),
    readJson(path.join(outputDirectory, 'rendered-assignment.json')),
    fs.readFile(path.join(outputDirectory, adapter.stageDir, 'events.jsonl'), 'utf8'),
    optionalJson(path.join(outputDirectory, adapter.stageDir, 'budget.json')),
  ]);
  if (Boolean(definition.stage.budget) !== Boolean(budget)) fail('Stage budget summary presence does not match the run definition.');
  // Cost starts from ccusage reading this run's isolated home: it parses the persisted rollouts
  // (parent + any delegated subagent threads) and prices with its own maintained rate DB. Replay
  // can under-report output, so it is cross-checked against the harness's own counter.
  const commandRecord = commandRecords[0];
  const cost = reconcileCost(
    await measureRunCost({ adapter: definition.stage.adapter, home: harnessHome }),
    harnessCountersForRounds(definition.stage.adapter, await loadRoundUsages(outputDirectory, adapter)),
  );
  for (const warning of reconciliationWarnings(cost.reconciliation)) console.warn(warning);
  const ccusage = await ccusageVersion();
  const finishedAt = new Date().toISOString();
  const rolloutArtifactSha256 = await hashIfPresent(path.join(outputDirectory, adapter.stageDir, 'rollout.jsonl'));
  const stageResult = stageLaunch.exitCode === 0 ? 'completed' : (commandRecord.timedOut ? 'timed-out' : 'failed');
  const stages = buildStages({ definition, adapter, cost, commandRecords, usage, renderedMeta, rolloutArtifactSha256, outputArtifactSha256: sha256(eventLog), stageResult, budget });
  return {
    schemaVersion: 2,
    benchmarkVersion: definition.benchmarkVersion,
    runId: definition.runId,
    slotId: definition.slotId,
    configuration: { id: definition.configurationId },
    theme: { id: definition.themeId, path: definition.themePath, sha256: sha256(theme) },
    baseline: {
      materialsCommit,
      entrantBaseline: { kind: 'git-commit', identifier: entrantBaseline },
      guard: {
        policy: baselineGuard.policy,
        violations: baselineGuard.violations.map(({ path: pathName, reason }) => ({ path: pathName, reason })),
      },
    },
    recipe: { path: definition.recipePath, sha256: sha256(recipe) },
    controller: { commit: await gitCommit('HEAD') },
    timing: { startedAt, finishedAt, wallTimeSeconds: (Date.parse(finishedAt) - Date.parse(startedAt)) / 1_000 },
    stages,
    cost: {
      currency: 'USD',
      status: 'measured',
      totalUsd: cost.totalUsd,
      orchestrationTreatment: definition.delegation ? 'included' : 'none',
      costSource: { tool: 'ccusage', version: ccusage, view: cost.view, command: `ccusage ${cost.view} session --json` },
      reconciliation: cost.reconciliation,
      models: cost.models.map((model) => ({
        modelName: model.modelName,
        ...(model.usageSource ? { usageSource: model.usageSource } : {}),
        ...(model.costUsd !== null ? { costUsd: model.costUsd } : {}),
        inputTokens: model.inputTokens,
        outputTokens: model.outputTokens,
        cacheReadTokens: model.cacheReadTokens,
        cacheWriteTokens: model.cacheWriteTokens,
        ...(model.reasoningTokens ? { reasoningTokens: model.reasoningTokens } : {}),
      })),
    },
    gates: gateRecord.gates.map(({ id, command: gateCommand, status, exitCode, wallTimeSeconds, outputSha256, reason }) => ({ id, command: gateCommand, status, exitCode, wallTimeSeconds, outputSha256, reason })),
    output: { sourceRoot: SOURCE_ROOT, levelId: definition.levelId, title: definition.levelTitle, evaluated: { commit: evaluated.evaluatedCommit, branch: worktree.branch }, ...(payload ? { payload: { commit: payload.payloadCommit, branch: payload.branch } } : {}) },
    disposition: dispositionFor({ kind: definition.kind, passing: gateRecord.gates.every(({ status }) => status === 'passed'), payload }),
  };
}

// When ccusage attributes cost per model (Claude), a delegation run splits into one stage per
// model — parent (the model that answered the init event) as `orchestrate`, the rest as `implement`.
// When per-model cost is unavailable (Codex), the run collapses to a single stage carrying the run
// total. All stage entries share the one session id and sum the active wall time of every invocation;
// the prompt hashes attach to the parent.
function buildStages({ definition, adapter, cost, commandRecords, usage, renderedMeta, rolloutArtifactSha256, outputArtifactSha256, stageResult = 'completed', budget = null }) {
  const commandRecord = commandRecords[0];
  const lastCommand = commandRecords.at(-1);
  const continuationRounds = commandRecords.length - 1;
  const harness = { name: adapter.harnessName, version: commandRecord.cliVersion };
  const timing = {
    startedAt: commandRecord.startedAt,
    finishedAt: lastCommand.finishedAt,
    wallTimeSeconds: commandRecords.reduce((total, record) => total + record.wallTimeSeconds, 0),
  };
  const promptSha256 = renderedMeta.rendering.sha256;
  const delegationPromptSha256 = renderedMeta.delegation?.sha256;
  const shared = { harness, sessionId: usage.sessionId, ...(rolloutArtifactSha256 ? { rolloutArtifactSha256 } : {}), outputArtifactSha256, ...timing, result: stageResult, ...(continuationRounds > 0 ? { continuationRounds } : {}), ...(budget ? { budget } : {}) };
  const delegated = Boolean(definition.delegation) && cost.models.length > 1;

  if (cost.perModelCostAvailable && cost.models.length >= 1) {
    const parentModel = usage.initResolvedModel ?? definition.stage.model;
    const hasParent = cost.models.some((model) => model.modelName === parentModel);
    return cost.models.map((model, index) => {
      const isParent = hasParent ? model.modelName === parentModel : index === 0;
      return {
        id: model.modelName,
        role: delegated ? (isParent ? 'orchestrate' : 'implement') : 'solo',
        model: { provider: adapter.modelProvider(definition), snapshotId: model.modelName },
        ...(isParent ? { promptSha256, ...(delegationPromptSha256 ? { delegationPromptSha256 } : {}) } : {}),
        ...shared,
        usage: stageUsage(model),
        pricing: { status: 'measured', costUsd: model.costUsd ?? 0, source: model.usageSource === 'harness-counter' ? 'harness-counter' : 'ccusage' },
      };
    });
  }

  return [{
    id: 'solo',
    role: definition.delegation ? 'orchestrate' : 'solo',
    model: { provider: adapter.modelProvider(definition), snapshotId: definition.stage.model },
    promptSha256,
    ...(delegationPromptSha256 ? { delegationPromptSha256 } : {}),
    ...shared,
    usage: stageUsage(cost.totals),
    pricing: { status: 'measured', costUsd: cost.totalUsd, source: 'ccusage' },
  }];
}

function stageUsage({ inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0, reasoningTokens = 0 }) {
  return {
    inputTokens,
    outputTokens,
    ...(cacheReadTokens ? { cacheReadInputTokens: cacheReadTokens } : {}),
    ...(cacheWriteTokens ? { cacheWriteInputTokens: cacheWriteTokens } : {}),
    ...(reasoningTokens ? { reasoningTokens } : {}),
  };
}

// Load every completed invocation. The cost module selects only the final cumulative counter for
// Claude/Codex and sums pi's invocation-local counters across the appended session. File presence,
// rather than the budget record, also covers manual continuation rounds.
export async function loadRoundUsages(outputDirectory, adapter) {
  const usages = [await optionalJson(path.join(outputDirectory, adapter.stageDir, 'raw-usage.json'))];
  if (!usages[0]) return usages;
  for (let round = 1; ; round += 1) {
    const usage = await optionalJson(path.join(outputDirectory, adapter.stageDir, `raw-usage-resume-${round}.json`));
    if (!usage) break;
    usages.push(usage);
  }
  return usages;
}

async function loadRoundCommands(outputDirectory, adapter) {
  const commands = [await readJson(path.join(outputDirectory, adapter.stageDir, 'command.json'))];
  for (let round = 1; ; round += 1) {
    const commandRecord = await optionalJson(path.join(outputDirectory, adapter.stageDir, `command-resume-${round}.json`));
    if (!commandRecord) break;
    commands.push(commandRecord);
  }
  return commands;
}

async function loadStageUsage(outputDirectory, adapter, definition) {
  const recorded = await optionalJson(path.join(outputDirectory, adapter.stageDir, 'raw-usage.json'));
  if (recorded) return recorded;
  const eventSource = await fs.readFile(path.join(outputDirectory, adapter.stageDir, 'events.jsonl'), 'utf8');
  for (const line of eventSource.split('\n')) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.type === 'system' && event.subtype === 'init') {
      return { sessionId: event.session_id, initResolvedModel: event.model ?? definition.stage.model };
    }
    if (event.type === 'thread.started') return { sessionId: event.thread_id, initResolvedModel: definition.stage.model };
  }
  fail('Could not recover the stage session identity from its event log.');
}

async function hashIfPresent(filePath) {
  try { return sha256(await fs.readFile(filePath, 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return undefined; throw error; }
}
async function gitShow(commit, relativePath, root = ROOT) {
  if (path.isAbsolute(relativePath) || relativePath.split('/').includes('..')) fail(`Artifact path must be repository-relative: ${relativePath}`);
  return (await command('git', ['show', `${commit}:${relativePath}`], root)).stdout;
}
async function gitCommit(ref) { return (await command('git', ['rev-parse', '--verify', `${ref}^{commit}`], ROOT)).stdout.trim(); }
async function assertCleanRepository() {
  const status = (await command('git', ['status', '--porcelain'], ROOT)).stdout;
  if (status.trim()) fail('The controller repository must be clean before a run; commit the frozen materials first.');
}

async function assertAbsent(target, label) { try { await fs.lstat(target); } catch (error) { if (error?.code === 'ENOENT') return; throw error; } fail(`${label} already exists: ${target}`); }
async function writeCommandRecord(target, args, result) { await writeJson(target, { command: args, exitCode: result.code, startedAt: result.startedAt, finishedAt: result.finishedAt, wallTimeSeconds: result.wallTimeSeconds, stdoutSha256: sha256(result.stdout), stderrSha256: sha256(result.stderr), stdout: result.stdout, stderr: result.stderr }); }
function command(executable, args, cwd, { allowFailure = false, env } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString(); const started = performance.now();
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : process.env }); let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; }); child.on('error', reject);
    child.on('close', (code) => { const result = { code: code ?? 1, stdout, stderr, startedAt, finishedAt: new Date().toISOString(), wallTimeSeconds: (performance.now() - started) / 1_000 }; if (result.code && !allowFailure) reject(new Error(`${[executable, ...args].join(' ')} failed:\n${stderr || stdout}`)); else resolve(result); });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
