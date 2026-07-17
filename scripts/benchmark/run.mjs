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
  pathInside,
  readJson,
  requireOption,
  sha256,
} from './common.mjs';
import { renderAssignment, renderDelegation } from './render-assignment.mjs';
import { ccusageVersion, harnessCountersForRounds, measureRunCost, reconcileCost, reconciliationWarnings } from './ccusage-cost.mjs';
import { assertBaselineLevelAllowlist, levelIdsFromRegistry, validateBaselineLevelAllowlist } from './entrant-baseline.mjs';
import { manifestErrors } from './results.mjs';
import { createRecoverySnapshot, restoreRecoverySnapshot } from './recovery-snapshot.mjs';
import { promoteRun } from './promote.mjs';
import { assertBenchmarkBaseline } from '../check-benchmark-baseline.mjs';
import { protocolForVersion } from './protocol.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADMIN = path.join(ROOT, 'scripts/benchmark/admin.mjs');

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
  npm run benchmark:run -- --definition <definition.json> --out <run-directory>
  npm run benchmark:run -- --resume <run-directory> [--accept-stage-output true]`);
    return;
  }
  if (rest.length) fail(`Unexpected argument: ${rest.join(' ')}.`);
  assertOnlyOptions(options, new Set(['help', 'definition', 'out', 'resume', 'accept-stage-output']));
  const resuming = Boolean(options.resume);
  if (resuming && (options.definition || options.out)) fail('--resume cannot be combined with --definition or --out.');
  const outputDirectory = assertPrivateOrExternalPath(resuming ? options.resume : requireOption(options, 'out'), ROOT);
  const definitionPath = resuming
    ? path.join(outputDirectory, 'run-definition.json')
    : assertPrivateOrExternalPath(requireOption(options, 'definition'), ROOT);
  if (!resuming) await assertAbsent(outputDirectory, 'run output directory');
  const definition = await readJson(definitionPath);
  const errors = validateDefinition(definition);
  if (errors.length) fail(`Invalid run definition:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  if (path.basename(outputDirectory) !== definition.assignment.runId) fail('Run directory must end with the assignment runId.');
  if (!resuming) {
    await assertCleanRepository();
    await fs.mkdir(outputDirectory, { recursive: true });
    await writeJson(path.join(outputDirectory, 'run-definition.json'), definition);
  }

  const statePath = path.join(outputDirectory, 'controller-state.json');
  const state = await loadControllerState(statePath, definition.assignment.runId, outputDirectory);
  let worktree;
  try {
    const materialsCommit = await gitCommit(definition.baseline.materialsCommit);
    const entrantBaseline = await gitCommit(definition.baseline.entrantBaseline);
    const configurationCommit = await gitCommit(definition.baseline.configurationCommit ?? materialsCommit);
    const eligibleControls = definition.mode === 'eligible'
      ? await validateEligibleControls(definition, materialsCommit, configurationCommit, entrantBaseline)
      : undefined;

    const inputs = await checkpoint(state, statePath, 'inputs', async () => {
      const existing = await optionalJson(path.join(outputDirectory, 'rendered-assignment.json'));
      const renderedPath = path.join(outputDirectory, 'rendered-assignment.md');
      if (existing) {
        const rendered = await fs.readFile(renderedPath, 'utf8');
        if (sha256(rendered) !== existing.rendering?.sha256) fail('Recorded rendered assignment hash does not match its file.');
        return { renderedPath };
      }
      return prepareInputs(definition, materialsCommit, configurationCommit, outputDirectory);
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
      const result = await command(process.execPath, [ADMIN, 'worktree', '--baseline', entrantBaseline, '--run-id', definition.assignment.runId, '--path', definition.worktree.path], ROOT);
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
      const launch = await optionalJson(path.join(outputDirectory, 'stage-launch.json'));
      if (launch) {
        if (launch.exitCode === 0) return { exitCode: 0 };
        const recovery = await optionalJson(path.join(outputDirectory, 'recovery.json'));
        if (recovery?.policy === 'completed entrant work accepted; normal sealing and gates resumed') return { exitCode: launch.exitCode, acceptedCompletedWorktree: true };
        if (options['accept-stage-output'] === 'true') {
          await recordRecovery(outputDirectory, definition, worktree, launch);
          return { exitCode: launch.exitCode, acceptedCompletedWorktree: true };
        }
        fail(`The recorded stage failed. Resume with --accept-stage-output true only after verifying that the entrant completed its worktree.`);
      }
      await prepareHarnessHome(adapter, outputDirectory);
      const stageDirectory = path.join(outputDirectory, adapter.stageDir);
      const stageArgs = [adapter.scriptPath, '--worktree', worktree.worktree, '--prompt', inputs.renderedPath, '--out', stageDirectory, '--model', definition.stage.model, '--effort', definition.stage.effort, '--timeout-seconds', String(definition.stage.timeoutSeconds)];
      if (definition.stage.budget) stageArgs.push('--budget-usd', String(definition.stage.budget.usd));
      if (definition.stage[adapter.binField]) stageArgs.push(adapter.binFlag, definition.stage[adapter.binField]);
      if (definition.delegation && adapter.delegationArgs) stageArgs.push(...adapter.delegationArgs);
      if (adapter.stageArgs) stageArgs.push(...adapter.stageArgs(definition));
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
      const sealed = await command(process.execPath, [ADMIN, 'seal', '--repo', ROOT, '--worktree', worktree.worktree, '--baseline', entrantBaseline, '--level-id', definition.assignment.levelId, '--version', definition.benchmarkVersion, '--level-title', definition.assignment.levelTitle], ROOT);
      const value = JSON.parse(sealed.stdout);
      await writeJson(path.join(outputDirectory, 'evaluated.json'), value);
      return value;
    });

    const gateRecord = await checkpoint(state, statePath, 'gates', async () => {
      const existing = await reusableGateRecord(outputDirectory, evaluated.evaluatedCommit);
      if (existing) return existing;
      const gateDirectory = path.join(outputDirectory, 'gates');
      await command(process.execPath, [ADMIN, 'gates', '--worktree', worktree.worktree, '--baseline', entrantBaseline, '--level-id', definition.assignment.levelId, '--out', gateDirectory, '--version', definition.benchmarkVersion], ROOT);
      return readJson(path.join(gateDirectory, 'gates.json'));
    });
    const passing = gateRecord.gates.every(({ status }) => status === 'passed');

    const payload = await checkpoint(state, statePath, 'payload', async () => {
      if (!passing) return null;
      const existing = await optionalJson(path.join(outputDirectory, 'payload.json'));
      if (existing) {
        await validatePayload(existing, materialsCommit, definition.assignment.levelId, definition.benchmarkVersion);
        return existing;
      }
      const result = await command(process.execPath, [ADMIN, 'payload', '--repo', ROOT, '--materials', materialsCommit, '--evaluated', evaluated.evaluatedCommit, '--level-id', definition.assignment.levelId, '--level-title', definition.assignment.levelTitle, '--path', definition.payload.path, '--branch', definition.payload.branch, '--version', definition.benchmarkVersion], ROOT);
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
      const value = await createManifest({ definition, materialsCommit, configurationCommit, entrantBaseline, eligibleControls, outputDirectory, harnessHome, gateRecord, evaluated, payload, worktree, startedAt: state.startedAt });
      await writeJson(path.join(outputDirectory, 'manifest.json'), value);
      return value;
    });
    let promotionStatus = 'not-applicable';
    if (manifest.disposition.status === 'playable' && protocolForVersion(definition.benchmarkVersion).promotionRequired) {
      try {
        promotionStatus = (await promoteRun({ root: ROOT, runDirectory: outputDirectory })).status;
      } catch (promotionError) {
        promotionStatus = 'failed';
        console.error(`Automatic promotion failed; the playable run is unchanged. Resume with: npm run benchmark:promote -- --run ${definition.assignment.runId}`);
      }
    } else if (manifest.disposition.status === 'playable') {
      promotionStatus = 'not-required';
    }
    console.log(JSON.stringify({ runId: definition.assignment.runId, status: manifest.disposition.status, evaluatedCommit: evaluated.evaluatedCommit, payloadCommit: payload?.payloadCommit ?? null, promotionStatus, resumed: resuming }));
    if (!passing) process.exitCode = 2;
  } catch (error) {
    let snapshotError;
    try {
      await createRecoverySnapshot({
        repo: ROOT,
        runDirectory: outputDirectory,
        runId: definition.assignment.runId,
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

async function validatePayload(payload, materialsCommit, levelId, benchmarkVersion = 'v1') {
  const payloadCommit = await gitCommit(payload?.payloadCommit);
  const levelDirectory = `${protocolForVersion(benchmarkVersion).sourceRoot}/${levelId}/`;
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

export function dispositionFor({ mode, passing, payload }) {
  if (mode === 'rehearsal') return { status: 'rehearsal' };
  if (!passing) return { status: 'dnf', reasonCode: 'required-gate-failed' };
  if (payload) return { status: 'playable' };
  return { status: 'dnf', reasonCode: 'payload-pending' };
}

function validateManifest(manifest, definition, evaluated, payload, gateRecord) {
  const errors = manifestErrors(manifest);
  if (errors.length) fail(`Recorded manifest is invalid: ${errors.join('; ')}`);
  if (manifest.runId !== definition.assignment.runId || manifest.output?.levelId !== definition.assignment.levelId) fail('Recorded manifest identity does not match the run definition.');
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
    entrantBaseline: definition.baseline.entrantBaseline,
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

export function validateDefinition(value) {
  const errors = [];
  if (!isPlainObject(value)) return ['definition must be an object.'];
  const keys = new Set(['schemaVersion', 'benchmarkVersion', 'mode', 'assignment', 'baseline', 'release', 'schedule', 'runner', 'executor', 'template', 'failureTaxonomy', 'stage', 'worktree', 'payload', 'delegation']);
  for (const key of Object.keys(value)) if (!keys.has(key)) errors.push(`definition has unknown field ${key}.`);
  if (value.schemaVersion !== 1) errors.push('definition.schemaVersion must equal 1.');
  if (typeof value.benchmarkVersion !== 'string' || !value.benchmarkVersion) errors.push('definition.benchmarkVersion is required.');
  else {
    try { protocolForVersion(value.benchmarkVersion); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  if (!['rehearsal', 'eligible'].includes(value.mode)) errors.push('definition.mode must be rehearsal or eligible.');
  validateAssignment(value.assignment, errors);
  validateCommit(value.baseline?.materialsCommit, 'definition.baseline.materialsCommit', errors);
  validateCommit(value.baseline?.entrantBaseline, 'definition.baseline.entrantBaseline', errors);
  if (value.baseline?.configurationCommit !== undefined) validateCommit(value.baseline.configurationCommit, 'definition.baseline.configurationCommit', errors);
  validateArtifact(value.template, 'definition.template', errors);
  validateArtifact(value.failureTaxonomy, 'definition.failureTaxonomy', errors);
  if (value.runner !== undefined) validateArtifact(value.runner, 'definition.runner', errors);
  if (value.executor !== undefined) validateArtifact(value.executor, 'definition.executor', errors);
  if (!isPlainObject(value.stage)) errors.push('definition.stage must be an object.');
  else {
    const stageKeys = new Set(['adapter', 'model', 'effort', 'timeoutSeconds', 'budget', 'codexBin', 'claudeBin', 'piBin', 'provider']);
    for (const key of Object.keys(value.stage)) if (!stageKeys.has(key)) errors.push(`definition.stage has unknown field ${key}.`);
    if (!Object.hasOwn(ADAPTERS, value.stage.adapter)) errors.push(`definition.stage.adapter must be one of: ${Object.keys(ADAPTERS).join(', ')}.`);
    if (typeof value.stage.model !== 'string' || !value.stage.model) errors.push('definition.stage.model is required.');
    if (value.stage.provider !== undefined && (typeof value.stage.provider !== 'string' || !value.stage.provider)) errors.push('definition.stage.provider must be a non-empty string.');
    // The union of every harness's reasoning vocabulary; each adapter rejects the levels its own CLI
    // does not offer (`ultra` is Codex-only, `minimal`/`off` are pi-only).
    if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value.stage.effort)) errors.push('definition.stage.effort is invalid.');
    if (!Number.isInteger(value.stage.timeoutSeconds) || value.stage.timeoutSeconds < 1) errors.push('definition.stage.timeoutSeconds must be a positive integer.');
    if (value.stage.budget !== undefined) {
      if (!isPlainObject(value.stage.budget)) errors.push('definition.stage.budget must be an object.');
      else {
        for (const key of Object.keys(value.stage.budget)) if (key !== 'usd') errors.push(`definition.stage.budget has unknown field ${key}.`);
        if (!(typeof value.stage.budget.usd === 'number' && Number.isFinite(value.stage.budget.usd) && value.stage.budget.usd > 0)) errors.push('definition.stage.budget.usd must be a positive finite number.');
      }
    }
  }
  for (const [key, item] of [['worktree', value.worktree], ['payload', value.payload]]) {
    if (!isPlainObject(item) || typeof item.path !== 'string' || !item.path) errors.push(`definition.${key}.path is required.`);
    if (key === 'payload' && (!isPlainObject(item) || typeof item.branch !== 'string' || !item.branch)) errors.push('definition.payload.branch is required.');
  }
  if (value.delegation !== undefined) validateDelegation(value.delegation, errors);
  if (value.mode === 'eligible') {
    validateArtifact(value.release, 'definition.release', errors);
    validateArtifact(value.schedule, 'definition.schedule', errors);
    if (value.baseline?.configurationCommit === undefined) errors.push('definition.baseline.configurationCommit is required for an eligible run.');
    if (!/^v[1-9][0-9]*$/.test(value.benchmarkVersion ?? '')) errors.push('An eligible definition benchmarkVersion must be v<number>.');
  }
  return errors;
}

async function prepareInputs(definition, materialsCommit, configurationCommit, outputDirectory) {
  const template = await artifactFromCommit(materialsCommit, definition.template);
  const theme = await artifactFromCommit(materialsCommit, definition.assignment.theme);
  await artifactFromCommit(configurationCommit, definition.assignment.recipe);
  await artifactFromCommit(materialsCommit, definition.failureTaxonomy);
  const inputDirectory = path.join(outputDirectory, 'inputs');
  await fs.mkdir(inputDirectory, { recursive: true });
  const templatePath = path.join(inputDirectory, 'assignment-template.md');
  const themePath = path.join(inputDirectory, 'theme.md');
  const renderedPath = path.join(outputDirectory, 'rendered-assignment.md');
  const baseRendering = renderAssignment(template, {
    levelId: definition.assignment.levelId,
    levelTitle: definition.assignment.levelTitle,
    theme,
    budget: Boolean(definition.stage.budget),
  });

  // Delegation configurations append the rendered flexible-delegation addendum after the shared
  // assignment body; the bytes sent to the primary agent as stdin are base + addendum. Solo
  // configurations send the base rendering unchanged.
  let rendered = baseRendering;
  let delegationMeta;
  if (definition.delegation) {
    const delegationTemplate = await artifactFromCommit(materialsCommit, definition.delegation.prompt);
    const addendum = renderDelegation(delegationTemplate, { delegateModel: definition.delegation.delegateModel, delegateEffort: definition.delegation.delegateEffort });
    rendered = `${baseRendering}\n\n${addendum}`;
    delegationMeta = { path: definition.delegation.prompt.path, delegateModel: definition.delegation.delegateModel, delegateEffort: definition.delegation.delegateEffort, sha256: sha256(addendum) };
  }

  await Promise.all([fs.writeFile(templatePath, template), fs.writeFile(themePath, theme), fs.writeFile(renderedPath, rendered)]);
  await writeJson(path.join(outputDirectory, 'rendered-assignment.json'), {
    template: { path: definition.template.path, sha256: sha256(template) },
    theme: { path: definition.assignment.theme.path, sha256: sha256(theme) },
    rendering: { path: renderedPath, sha256: sha256(rendered) },
    ...(delegationMeta ? { delegation: delegationMeta } : {}),
  });
  return { renderedPath };
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

async function createManifest({ definition, materialsCommit, configurationCommit, entrantBaseline, eligibleControls, outputDirectory, harnessHome, gateRecord, evaluated, payload, worktree, startedAt }) {
  const adapter = ADAPTERS[definition.stage.adapter];
  const [usage, commandRecord, stageLaunch, recipe, theme, renderedMeta, eventLog, budget] = await Promise.all([
    loadStageUsage(outputDirectory, adapter, definition),
    readJson(path.join(outputDirectory, adapter.stageDir, 'command.json')),
    readJson(path.join(outputDirectory, 'stage-launch.json')),
    artifactFromCommit(configurationCommit, definition.assignment.recipe),
    artifactFromCommit(materialsCommit, definition.assignment.theme),
    readJson(path.join(outputDirectory, 'rendered-assignment.json')),
    fs.readFile(path.join(outputDirectory, adapter.stageDir, 'events.jsonl'), 'utf8'),
    optionalJson(path.join(outputDirectory, adapter.stageDir, 'budget.json')),
  ]);
  if (Boolean(definition.stage.budget) !== Boolean(budget)) fail('Stage budget summary presence does not match the run definition.');
  // Cost starts from ccusage reading this run's isolated home: it parses the persisted rollouts
  // (parent + any delegated subagent threads) and prices with its own maintained rate DB. Replay
  // can under-report output, so it is cross-checked against the harness's own counter.
  const cost = reconcileCost(
    await measureRunCost({ adapter: definition.stage.adapter, home: harnessHome }),
    harnessCountersForRounds(definition.stage.adapter, await loadRoundUsages(outputDirectory, adapter, budget)),
  );
  for (const warning of reconciliationWarnings(cost.reconciliation)) console.warn(warning);
  const ccusage = await ccusageVersion();
  const finishedAt = new Date().toISOString();
  const rolloutArtifactSha256 = await hashIfPresent(path.join(outputDirectory, adapter.stageDir, 'rollout.jsonl'));
  const stageResult = stageLaunch.exitCode === 0 ? 'completed' : (commandRecord.timedOut ? 'timed-out' : 'failed');
  const stages = buildStages({ definition, adapter, cost, commandRecord, usage, renderedMeta, rolloutArtifactSha256, outputArtifactSha256: sha256(eventLog), stageResult, budget });
  return {
    schemaVersion: 2,
    benchmarkVersion: definition.benchmarkVersion,
    runId: definition.assignment.runId,
    slotId: definition.assignment.slotId,
    configuration: { id: definition.assignment.configurationId },
    theme: { id: definition.assignment.theme.id, path: definition.assignment.theme.path, sha256: sha256(theme) },
    baseline: {
      materialsCommit,
      configurationCommit,
      ...(eligibleControls ? { releaseRecord: definition.release } : {}),
      entrantBaseline: { kind: 'git-commit', identifier: entrantBaseline },
    },
    ...(eligibleControls ? { schedule: definition.schedule } : {}),
    recipe: definition.assignment.recipe,
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
    output: { sourceRoot: protocolForVersion(definition.benchmarkVersion).sourceRoot, levelId: definition.assignment.levelId, title: definition.assignment.levelTitle, evaluated: { commit: evaluated.evaluatedCommit, branch: worktree.branch }, ...(payload ? { payload: { commit: payload.payloadCommit, branch: payload.branch } } : {}) },
    disposition: dispositionFor({ mode: definition.mode, passing: gateRecord.gates.every(({ status }) => status === 'passed'), payload }),
  };
}

// One harness invocation produces the manifest's stages. When ccusage attributes cost per model
// (Claude), a delegation run splits into one stage per model — parent (the model that answered the
// init event) as `orchestrate`, the rest as `implement`. When per-model cost is unavailable (Codex),
// the run collapses to a single stage carrying the run total. All stages share the one invocation's
// session id, harness version, and wall-clock boundaries; the prompt hashes attach to the parent.
function buildStages({ definition, adapter, cost, commandRecord, usage, renderedMeta, rolloutArtifactSha256, outputArtifactSha256, stageResult = 'completed', budget = null }) {
  const harness = { name: adapter.harnessName, version: commandRecord.cliVersion };
  const lastResume = budget?.resumes?.at(-1);
  const finishedAt = lastResume?.finishedAt ?? commandRecord.finishedAt;
  const timing = {
    startedAt: commandRecord.startedAt,
    finishedAt,
    wallTimeSeconds: lastResume ? (Date.parse(finishedAt) - Date.parse(commandRecord.startedAt)) / 1_000 : commandRecord.wallTimeSeconds,
  };
  const promptSha256 = renderedMeta.rendering.sha256;
  const delegationPromptSha256 = renderedMeta.delegation?.sha256;
  const shared = { harness, sessionId: usage.sessionId, ...(rolloutArtifactSha256 ? { rolloutArtifactSha256 } : {}), outputArtifactSha256, ...timing, result: stageResult, ...(budget ? { budget } : {}) };
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
// Claude/Codex and sums pi's invocation-local counters across the appended session.
async function loadRoundUsages(outputDirectory, adapter, budget) {
  const usages = [await optionalJson(path.join(outputDirectory, adapter.stageDir, 'raw-usage.json'))];
  for (let round = 1; round <= (budget?.resumes?.length ?? 0); round += 1) {
    usages.push(await optionalJson(path.join(outputDirectory, adapter.stageDir, `raw-usage-resume-${round}.json`)));
  }
  return usages;
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

async function artifactFromCommit(commit, artifact, root = ROOT) {
  const source = await gitShow(commit, artifact.path, root);
  if (sha256(source) !== artifact.sha256) fail(`Artifact hash mismatch for ${artifact.path} at declared commit.`);
  return source;
}

export async function validateEligibleControls(definition, materialsCommit, configurationCommit, entrantBaseline, { root = ROOT } = {}) {
  const releasePath = definition.release.path;
  const releaseSource = await gitShow(`benchmark-${definition.benchmarkVersion}`, releasePath, root);
  if (sha256(releaseSource) !== definition.release.sha256) fail('Eligible release record does not match its benchmark tag.');
  let release;
  try { release = JSON.parse(releaseSource); } catch (error) { fail(`Release record is not valid JSON: ${error.message}`); }
  if (release.benchmarkVersion !== definition.benchmarkVersion) fail('Eligible release benchmarkVersion does not match the run definition.');
  if (release.materialsCommit !== materialsCommit) fail('Eligible materialsCommit does not match the tagged release.');
  if (release.entrantBaseline?.identifier !== entrantBaseline) fail('Eligible entrantBaseline does not match the tagged release.');
  const protocol = protocolForVersion(definition.benchmarkVersion);
  if (protocol.directoryOnly) {
    if (release.entrantBaseline?.outputRoot !== protocol.sourceRoot) fail(`Eligible release must declare outputRoot ${protocol.sourceRoot} for ${definition.benchmarkVersion}.`);
    const expectedBuiltInLevelIds = release.entrantBaseline?.expectedBuiltInLevelIds;
    if (!Array.isArray(expectedBuiltInLevelIds) || !release.entrantBaseline?.builtInTreeSha256) fail('Directory-only release must declare expectedBuiltInLevelIds and builtInTreeSha256 for the entrant baseline.');
    const baselineResult = await assertBenchmarkBaseline({
      root,
      ref: entrantBaseline,
      benchmarkVersion: definition.benchmarkVersion,
      expectedBuiltInLevelIds,
      expectedBuiltInTreeSha256: release.entrantBaseline?.builtInTreeSha256,
    });
    if (!baselineResult) fail('Could not validate the directory-only entrant baseline.');
  } else {
    const allowlistErrors = validateBaselineLevelAllowlist(release.entrantBaseline?.allowedLevelIds);
    if (allowlistErrors.length) fail(`Eligible release record has an invalid entrant baseline allowlist:\n${allowlistErrors.map((error) => `- ${error}`).join('\n')}`);
    const baselineRegistry = await gitShow(entrantBaseline, 'src/levels/index.ts', root);
    assertBaselineLevelAllowlist({
      actualLevelIds: levelIdsFromRegistry(baselineRegistry),
      allowedLevelIds: release.entrantBaseline.allowedLevelIds,
    });
  }
  if (!Array.isArray(release.artifacts)) fail('Eligible release record has no artifact list.');
  for (const artifact of [definition.template, definition.assignment.theme, definition.failureTaxonomy]) {
    if (!release.artifacts.some((entry) => entry.path === artifact.path && entry.sha256 === artifact.sha256)) fail(`Eligible artifact ${artifact.path} is not frozen by the release.`);
  }
  const schedulePath = assertPrivateOrExternalPath(definition.schedule.path, root);
  const scheduleSource = await fs.readFile(schedulePath, 'utf8');
  if (sha256(scheduleSource) !== definition.schedule.sha256) fail('Private schedule hash does not match the run definition.');
  let schedule;
  try { schedule = JSON.parse(scheduleSource); } catch (error) { fail(`Private schedule is not valid JSON: ${error.message}`); }
  const scheduleError = validateRuntimeSchedule(schedule, definition.benchmarkVersion);
  if (scheduleError) fail(`Private schedule is invalid: ${scheduleError}`);
  const assignment = schedule.assignments.find((candidate) => candidate.runId === definition.assignment.runId);
  if (!assignment || !sameAssignment(assignment, definition.assignment)) fail('Eligible assignment is absent from or differs from the private schedule.');
  if (assignment.configurationCommit !== configurationCommit) fail('Eligible configurationCommit differs from the private schedule.');
  if (!sameStage(assignment.stage, definition.stage)) fail('Eligible stage settings differ from the private schedule.');
  return { release, schedule };
}

function sameAssignment(left, right) {
  return left.runId === right.runId
    && left.slotId === right.slotId
    && left.configurationId === right.configurationId
    && left.levelId === right.levelId
    && left.levelTitle === right.levelTitle
    && sameArtifact(left.recipe, right.recipe)
    && left.theme?.id === right.theme?.id
    && sameArtifact(left.theme, right.theme);
}


function sameArtifact(left, right) {
  return left?.path === right?.path && left?.sha256 === right?.sha256;
}

function sameStage(left, right) {
  return left?.adapter === right?.adapter
    && left?.model === right?.model
    && left?.effort === right?.effort
    && left?.timeoutSeconds === right?.timeoutSeconds
    && left?.budget?.usd === right?.budget?.usd;
}

export function validateRuntimeSchedule(schedule, benchmarkVersion) {
  if (!isPlainObject(schedule) || schedule.schemaVersion !== 1 || schedule.benchmarkVersion !== benchmarkVersion || !Array.isArray(schedule.assignments)) return 'header or assignments do not match the eligible protocol.';
  const runIds = new Set(); const slotIds = new Set(); const levelIds = new Set(); const cells = new Set(); const indices = new Set();
  for (const assignment of schedule.assignments) {
    if (!isPlainObject(assignment) || !Number.isInteger(assignment.scheduleIndex) || assignment.scheduleIndex < 1) return 'an assignment has an invalid scheduleIndex.';
    if (!/^[a-z0-9][a-z0-9-]{3,63}$/.test(assignment.runId ?? '') || !/^[a-z0-9]{4}$/.test(assignment.slotId ?? '') || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assignment.configurationId ?? '') || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assignment.theme?.id ?? '')) return 'an assignment has an invalid opaque or semantic id.';
    if (runIds.has(assignment.runId) || slotIds.has(assignment.slotId) || levelIds.has(assignment.levelId)) return 'run, slot, and level ids must be unique.';
    runIds.add(assignment.runId); slotIds.add(assignment.slotId); levelIds.add(assignment.levelId); indices.add(assignment.scheduleIndex);
    if (assignment.levelId !== `${assignment.theme?.id}-${assignment.slotId}`) return 'an assignment has an invalid level id.';
    const cell = `${assignment.configurationId}\u0000${assignment.theme?.id}`;
    if (cells.has(cell)) return 'a configuration/theme cell is duplicated.';
    cells.add(cell);
    if (!/^[a-f0-9]{40,64}$/.test(assignment.configurationCommit ?? '') || !validArtifact(assignment.recipe) || !isPlainObject(assignment.stage)) return 'an assignment has incomplete configuration inputs.';
    if (assignment.runner !== undefined && !validArtifact(assignment.runner)) return 'an assignment has an invalid legacy runner artifact.';
    if (assignment.executor !== undefined && !validArtifact(assignment.executor)) return 'an assignment has an invalid legacy executor artifact.';
  }
  for (let index = 1; index <= schedule.assignments.length; index += 1) if (!indices.has(index)) return `scheduleIndex ${index} is missing.`;
  return undefined;
}

function validArtifact(value) {
  return isPlainObject(value) && typeof value.path === 'string' && value.path.length > 0 && /^[a-f0-9]{64}$/.test(value.sha256 ?? '');
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

function validateAssignment(value, errors) {
  if (!isPlainObject(value)) { errors.push('definition.assignment must be an object.'); return; }
  for (const key of ['runId', 'slotId', 'configurationId', 'levelId', 'levelTitle']) if (typeof value[key] !== 'string' || !value[key]) errors.push(`definition.assignment.${key} is required.`);
  validateArtifact(value.recipe, 'definition.assignment.recipe', errors);
  if (!isPlainObject(value.theme) || typeof value.theme.id !== 'string') errors.push('definition.assignment.theme.id is required.');
  validateArtifact(value.theme, 'definition.assignment.theme', errors);
}
function validateArtifact(value, label, errors) {
  if (!isPlainObject(value) || typeof value.path !== 'string' || !value.path || !/^[a-f0-9]{64}$/.test(value.sha256 ?? '')) errors.push(`${label} must contain a path and SHA-256.`);
}
function validateDelegation(value, errors) {
  if (!isPlainObject(value)) { errors.push('definition.delegation must be an object.'); return; }
  const keys = new Set(['prompt', 'delegateModel', 'delegateEffort']);
  for (const key of Object.keys(value)) if (!keys.has(key)) errors.push(`definition.delegation has unknown field ${key}.`);
  validateArtifact(value.prompt, 'definition.delegation.prompt', errors);
  if (typeof value.delegateModel !== 'string' || !value.delegateModel) errors.push('definition.delegation.delegateModel is required.');
  if (!['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value.delegateEffort)) errors.push('definition.delegation.delegateEffort is invalid.');
}
function validateCommit(value, label, errors) { if (typeof value !== 'string' || !/^[a-f0-9]{40,64}$/.test(value)) errors.push(`${label} must be a Git commit id.`); }
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
