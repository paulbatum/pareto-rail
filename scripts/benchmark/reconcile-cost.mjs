#!/usr/bin/env node
// Restates the recorded cost of runs measured before the runner cross-checked its cost source.
//
// This never re-measures: it reads each manifest's existing ccusage figures and the harness counter
// already captured in the stage's raw usage, applies the same reconciliation the runner now applies
// at manifest time, and writes the result back. Runs recorded after that change carry a
// `cost.reconciliation` block already and are left alone, so this is safe to re-run.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnessCounters, reconcileCost, reconciliationWarnings } from './ccusage-cost.mjs';
import { assertOnlyOptions, parseArgs, writeJson } from './common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNS = path.join(ROOT, 'benchmark/private/runs');
const STAGE_DIRS = ['stages/solo/claude', 'stages/solo/codex'];

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage:
  npm run benchmark:reconcile-cost -- [--write true] [--run <run-id>]

Reports what reconciling each run's recorded cost against its harness counter would change.
Nothing is modified unless --write true is passed.`);
    return;
  }
  if (rest.length > 0) fail(`Unexpected argument: ${rest.join(' ')}.`);
  assertOnlyOptions(options, new Set(['help', 'write', 'run']));
  const write = options.write === 'true';
  if (options.write !== undefined && !write) fail('--write only accepts true.');

  const runIds = (await fs.readdir(RUNS, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && (!options.run || entry.name === options.run))
    .map((entry) => entry.name)
    .sort();
  if (runIds.length === 0) fail(options.run ? `No such run: ${options.run}` : 'No runs found.');

  let changed = 0;
  let totalDelta = 0;
  for (const runId of runIds) {
    const outcome = await reconcileRun(runId, write);
    if (!outcome) continue;
    console.log(`${runId} — ${outcome.summary}`);
    for (const warning of outcome.warnings) console.log(`  ${warning}`);
    if (outcome.costDelta) {
      changed += 1;
      totalDelta += outcome.costDelta;
    }
  }
  console.log(`\n${changed} run${changed === 1 ? '' : 's'} restated${changed > 0 ? `, total cost +$${totalDelta.toFixed(4)}` : ''}.${write || changed === 0 ? '' : ' Re-run with --write true to apply.'}`);
}

async function reconcileRun(runId, write) {
  const manifestPath = path.join(RUNS, runId, 'manifest.json');
  const manifest = await optionalJson(manifestPath);
  if (!manifest?.cost || !Array.isArray(manifest.cost.models) || typeof manifest.cost.totalUsd !== 'number') return null;
  if (manifest.cost.reconciliation) return { summary: `already reconciled (${manifest.cost.reconciliation.status})`, warnings: [], costDelta: 0 };

  const stageDir = await stageDirectoryFor(runId);
  if (!stageDir) return { summary: 'no stage directory retained; left as measured', warnings: [], costDelta: 0 };
  const usage = await finalRoundUsage(path.join(RUNS, runId, stageDir));
  const before = manifest.cost.totalUsd;
  const reconciled = reconcileCost({ totalUsd: before, models: manifest.cost.models }, harnessCounters(usage));
  const costDelta = reconciled.totalUsd - before;

  manifest.cost.models = reconciled.models;
  manifest.cost.totalUsd = reconciled.totalUsd;
  manifest.cost.reconciliation = reconciled.reconciliation;
  for (const stage of manifest.stages ?? []) {
    const model = reconciled.models.find((candidate) => candidate.modelName === stage.id);
    if (!model || model.usageSource !== 'harness-counter') continue;
    stage.usage = { ...stage.usage, outputTokens: model.outputTokens };
    stage.pricing = { ...stage.pricing, costUsd: model.costUsd, source: 'harness-counter' };
  }
  if (write) await writeJson(manifestPath, manifest);

  const status = reconciled.reconciliation.status;
  const money = costDelta ? ` (${costDelta > 0 ? '+' : ''}$${costDelta.toFixed(4)}, $${before.toFixed(4)} → $${reconciled.totalUsd.toFixed(4)})` : '';
  return { summary: `${status}${money}${write ? '' : ' [dry run]'}`, warnings: reconciliationWarnings(reconciled.reconciliation), costDelta };
}

async function stageDirectoryFor(runId) {
  for (const stageDir of STAGE_DIRS) {
    if (await exists(path.join(RUNS, runId, stageDir))) return stageDir;
  }
  return null;
}

// Mirrors the runner: the counter restates the whole session each round, so the last round wins.
async function finalRoundUsage(stagePath) {
  const budget = await optionalJson(path.join(stagePath, 'budget.json'));
  for (let round = budget?.resumes?.length ?? 0; round > 0; round -= 1) {
    const resumed = await optionalJson(path.join(stagePath, `raw-usage-resume-${round}.json`));
    if (resumed) return resumed;
  }
  return await optionalJson(path.join(stagePath, 'raw-usage.json'));
}

async function optionalJson(target) {
  try {
    return JSON.parse(await fs.readFile(target, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function exists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
