#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
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
  writeJson,
} from './common.mjs';
import { renderAssignment } from './render-assignment.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ADMIN = path.join(ROOT, 'scripts/benchmark/admin.mjs');
const RUNBOOK = 'benchmark/controller/runbook.md';

// One entry per supported `definition.stage.adapter`. Adds a harness without touching
// the Codex path: same stage shape (model, effort, timeoutSeconds), different process runner.
const ADAPTERS = {
  'codex-cli': {
    scriptPath: path.join(ROOT, 'scripts/benchmark/codex-cli.mjs'),
    stageDir: 'stages/solo/codex',
    binField: 'codexBin',
    binFlag: '--codex-bin',
    harnessName: 'Codex CLI',
    modelProvider: 'OpenAI Codex subscription',
  },
  'claude-cli': {
    scriptPath: path.join(ROOT, 'scripts/benchmark/claude-cli.mjs'),
    stageDir: 'stages/solo/claude',
    binField: 'claudeBin',
    binFlag: '--claude-bin',
    harnessName: 'Claude Code CLI',
    modelProvider: 'Anthropic Claude Code subscription',
  },
};

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run benchmark:run -- --definition <private-run-definition.json> --out <private-run-directory>');
    return;
  }
  if (rest.length) fail(`Unexpected argument: ${rest.join(' ')}.`);
  assertOnlyOptions(options, new Set(['help', 'definition', 'out']));
  const definitionPath = assertPrivateOrExternalPath(requireOption(options, 'definition'), ROOT);
  const outputDirectory = assertPrivateOrExternalPath(requireOption(options, 'out'), ROOT);
  await assertAbsent(outputDirectory, 'run output directory');
  const definition = await readJson(definitionPath);
  const errors = validateDefinition(definition);
  if (errors.length) fail(`Invalid run definition:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  if (path.basename(outputDirectory) !== definition.assignment.runId) fail('--out must end with the assignment runId.');
  await assertCleanRepository();
  await fs.mkdir(outputDirectory, { recursive: true });
  await writeJson(path.join(outputDirectory, 'run-definition.json'), definition);

  const startedAt = new Date().toISOString();
  let worktree;
  try {
    const materialsCommit = await gitCommit(definition.baseline.materialsCommit);
    const entrantBaseline = await gitCommit(definition.baseline.entrantBaseline);
    const inputs = await prepareInputs(definition, materialsCommit, outputDirectory);
    const worktreeResult = await command(process.execPath, [ADMIN, 'worktree', '--baseline', entrantBaseline, '--run-id', definition.assignment.runId, '--path', definition.worktree.path], ROOT);
    worktree = JSON.parse(worktreeResult.stdout);
    await writeJson(path.join(outputDirectory, 'worktree.json'), worktree);

    // Gates never launch a browser; skip puppeteer's Chrome download so npm ci doesn't depend on unzip being installed.
    const setup = await command('npm', ['ci'], worktree.worktree, { allowFailure: true, env: { PUPPETEER_SKIP_DOWNLOAD: 'true' } });
    await writeCommandRecord(path.join(outputDirectory, 'setup.json'), ['npm', 'ci'], setup);
    if (setup.code !== 0) fail(`Dependency provisioning failed; see ${path.join(outputDirectory, 'setup.json')}.`);

    const adapter = ADAPTERS[definition.stage.adapter];
    const stageDirectory = path.join(outputDirectory, adapter.stageDir);
    const stageArgs = [adapter.scriptPath, '--worktree', worktree.worktree, '--prompt', inputs.renderedPath, '--out', stageDirectory, '--model', definition.stage.model, '--effort', definition.stage.effort, '--timeout-seconds', String(definition.stage.timeoutSeconds)];
    if (definition.stage[adapter.binField]) stageArgs.push(adapter.binFlag, definition.stage[adapter.binField]);
    const stage = await command(process.execPath, stageArgs, ROOT, { allowFailure: true });
    await writeCommandRecord(path.join(outputDirectory, 'stage-launch.json'), [process.execPath, ...stageArgs], stage);
    if (stage.code !== 0) fail(`${adapter.harnessName} stage failed; see ${path.join(outputDirectory, 'stage-launch.json')}.`);

    const sealed = await command(process.execPath, [ADMIN, 'seal', '--worktree', worktree.worktree, '--baseline', entrantBaseline, '--level-id', definition.assignment.levelId], ROOT);
    const evaluated = JSON.parse(sealed.stdout);
    await writeJson(path.join(outputDirectory, 'evaluated.json'), evaluated);

    const gateDirectory = path.join(outputDirectory, 'gates');
    await command(process.execPath, [ADMIN, 'gates', '--worktree', worktree.worktree, '--baseline', entrantBaseline, '--level-id', definition.assignment.levelId, '--out', gateDirectory], ROOT);
    const gateRecord = await readJson(path.join(gateDirectory, 'gates.json'));
    const passing = gateRecord.gates.every(({ status }) => status === 'passed');
    let payload;
    if (passing) {
      const payloadResult = await command(process.execPath, [ADMIN, 'payload', '--repo', ROOT, '--materials', materialsCommit, '--evaluated', evaluated.evaluatedCommit, '--level-id', definition.assignment.levelId, '--path', definition.payload.path, '--branch', definition.payload.branch], ROOT);
      payload = JSON.parse(payloadResult.stdout);
      await writeJson(path.join(outputDirectory, 'payload.json'), payload);
    }
    const manifest = await createManifest({ definition, materialsCommit, entrantBaseline, outputDirectory, gateRecord, evaluated, payload, worktree, startedAt });
    await writeJson(path.join(outputDirectory, 'manifest.json'), manifest);
    console.log(JSON.stringify({ runId: definition.assignment.runId, status: manifest.disposition.status, evaluatedCommit: evaluated.evaluatedCommit, payloadCommit: payload?.payloadCommit ?? null }));
    if (!passing) process.exitCode = 2;
  } catch (error) {
    await writeJson(path.join(outputDirectory, 'controller-failure.json'), { failedAt: new Date().toISOString(), message: error instanceof Error ? error.message : String(error), worktree });
    throw error;
  }
}

export function validateDefinition(value) {
  const errors = [];
  if (!isPlainObject(value)) return ['definition must be an object.'];
  const keys = new Set(['schemaVersion', 'benchmarkVersion', 'mode', 'assignment', 'baseline', 'template', 'failureTaxonomy', 'stage', 'worktree', 'payload', 'pricing']);
  for (const key of Object.keys(value)) if (!keys.has(key)) errors.push(`definition has unknown field ${key}.`);
  if (value.schemaVersion !== 1) errors.push('definition.schemaVersion must equal 1.');
  if (typeof value.benchmarkVersion !== 'string' || !value.benchmarkVersion) errors.push('definition.benchmarkVersion is required.');
  if (!['rehearsal', 'eligible'].includes(value.mode)) errors.push('definition.mode must be rehearsal or eligible.');
  validateAssignment(value.assignment, errors);
  validateCommit(value.baseline?.materialsCommit, 'definition.baseline.materialsCommit', errors);
  validateCommit(value.baseline?.entrantBaseline, 'definition.baseline.entrantBaseline', errors);
  validateArtifact(value.template, 'definition.template', errors);
  validateArtifact(value.failureTaxonomy, 'definition.failureTaxonomy', errors);
  if (!isPlainObject(value.stage)) errors.push('definition.stage must be an object.');
  else {
    if (!Object.hasOwn(ADAPTERS, value.stage.adapter)) errors.push(`definition.stage.adapter must be one of: ${Object.keys(ADAPTERS).join(', ')}.`);
    if (typeof value.stage.model !== 'string' || !value.stage.model) errors.push('definition.stage.model is required.');
    if (!['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value.stage.effort)) errors.push('definition.stage.effort is invalid.');
    if (!Number.isInteger(value.stage.timeoutSeconds) || value.stage.timeoutSeconds < 1) errors.push('definition.stage.timeoutSeconds must be a positive integer.');
  }
  for (const [key, item] of [['worktree', value.worktree], ['payload', value.payload]]) {
    if (!isPlainObject(item) || typeof item.path !== 'string' || !item.path) errors.push(`definition.${key}.path is required.`);
    if (key === 'payload' && (!isPlainObject(item) || typeof item.branch !== 'string' || !item.branch)) errors.push('definition.payload.branch is required.');
  }
  validateArtifact(value.pricing, 'definition.pricing', errors);
  return errors;
}

async function prepareInputs(definition, materialsCommit, outputDirectory) {
  const template = await artifactFromCommit(materialsCommit, definition.template);
  const theme = await artifactFromCommit(materialsCommit, definition.assignment.theme);
  await artifactFromCommit(materialsCommit, definition.assignment.recipe);
  await artifactFromCommit(materialsCommit, definition.failureTaxonomy);
  await artifactFromCommit(materialsCommit, definition.pricing);
  const inputDirectory = path.join(outputDirectory, 'inputs');
  await fs.mkdir(inputDirectory, { recursive: true });
  const templatePath = path.join(inputDirectory, 'assignment-template.md');
  const themePath = path.join(inputDirectory, 'theme.md');
  const renderedPath = path.join(outputDirectory, 'rendered-assignment.md');
  const rendered = renderAssignment(template, { levelId: definition.assignment.levelId, levelTitle: definition.assignment.levelTitle, theme });
  await Promise.all([fs.writeFile(templatePath, template), fs.writeFile(themePath, theme), fs.writeFile(renderedPath, rendered)]);
  await writeJson(path.join(outputDirectory, 'rendered-assignment.json'), {
    template: { path: definition.template.path, sha256: sha256(template) },
    theme: { path: definition.assignment.theme.path, sha256: sha256(theme) },
    rendering: { path: renderedPath, sha256: sha256(rendered) },
  });
  return { renderedPath };
}

async function createManifest({ definition, materialsCommit, entrantBaseline, outputDirectory, gateRecord, evaluated, payload, worktree, startedAt }) {
  const adapter = ADAPTERS[definition.stage.adapter];
  const [usage, commandRecord, controller, recipe, theme, pricingSource] = await Promise.all([
    readJson(path.join(outputDirectory, adapter.stageDir, 'raw-usage.json')),
    readJson(path.join(outputDirectory, adapter.stageDir, 'command.json')),
    artifactFromCommit(materialsCommit, { path: RUNBOOK, sha256: await hashFromCommit(materialsCommit, RUNBOOK) }),
    artifactFromCommit(materialsCommit, definition.assignment.recipe),
    artifactFromCommit(materialsCommit, definition.assignment.theme),
    artifactFromCommit(materialsCommit, definition.pricing),
  ]);
  const pricing = calculatePricing(usage.normalized, parsePricing(pricingSource, definition.stage.model));
  const finishedAt = new Date().toISOString();
  const rolloutArtifactSha256 = await hashIfPresent(path.join(outputDirectory, adapter.stageDir, 'rollout.jsonl'));
  return {
    schemaVersion: 2,
    benchmarkVersion: definition.benchmarkVersion,
    runId: definition.assignment.runId,
    slotId: definition.assignment.slotId,
    configuration: { id: definition.assignment.configurationId },
    theme: { path: definition.assignment.theme.path, sha256: sha256(theme) },
    baseline: { materialsCommit, entrantBaseline: { kind: 'git-commit', identifier: entrantBaseline } },
    recipe: definition.assignment.recipe,
    controller: { path: RUNBOOK, sha256: sha256(controller) },
    runner: { path: 'scripts/benchmark/run.mjs', sha256: await hashFromCommit(materialsCommit, 'scripts/benchmark/run.mjs') },
    timing: { startedAt, finishedAt, wallTimeSeconds: (Date.parse(finishedAt) - Date.parse(startedAt)) / 1_000 },
    stages: [{
      id: 'solo', role: 'solo', model: { provider: adapter.modelProvider, snapshotId: definition.stage.model },
      harness: { name: adapter.harnessName, version: commandRecord.cliVersion }, sessionId: usage.sessionId,
      promptSha256: (await readJson(path.join(outputDirectory, 'rendered-assignment.json'))).rendering.sha256,
      outputArtifactSha256: sha256(await fs.readFile(path.join(outputDirectory, adapter.stageDir, 'events.jsonl'), 'utf8')),
      ...(rolloutArtifactSha256 ? { rolloutArtifactSha256 } : {}),
      startedAt: commandRecord.startedAt, finishedAt: commandRecord.finishedAt, wallTimeSeconds: commandRecord.wallTimeSeconds,
      usage: usage.normalized, pricing: { status: 'measured', ...pricing.rates, costUsd: pricing.costUsd }, result: 'completed',
    }],
    cost: { currency: 'USD', status: 'measured', listPriceDate: pricing.priceDate, totalUsd: pricing.costUsd, orchestrationTreatment: 'none' },
    gates: gateRecord.gates.map(({ id, command: gateCommand, status, exitCode, wallTimeSeconds, outputSha256, reason }) => ({ id, command: gateCommand, status, exitCode, wallTimeSeconds, outputSha256, reason })),
    output: { levelId: definition.assignment.levelId, evaluated: { commit: evaluated.evaluatedCommit, branch: worktree.branch }, ...(payload ? { payload: { commit: payload.payloadCommit, branch: payload.branch } } : {}) },
    disposition: { status: definition.mode === 'rehearsal' ? 'rehearsal' : payload ? 'playable' : 'dnf', ...(payload ? {} : { reasonCode: 'required-gate-failed' }) },
  };
}

async function artifactFromCommit(commit, artifact) {
  const source = await gitShow(commit, artifact.path);
  if (sha256(source) !== artifact.sha256) fail(`Artifact hash mismatch for ${artifact.path} at materials commit.`);
  return source;
}

function parsePricing(source, model) {
  let value;
  try { value = JSON.parse(source); } catch (error) { fail(`Pricing input is not valid JSON: ${error.message}`); }
  const numericKeys = ['inputUsdPerMillion', 'cacheReadUsdPerMillion', 'cacheWriteUsdPerMillion', 'outputUsdPerMillion'];
  if (value.schemaVersion !== 1 || value.model !== model || value.currency !== 'USD' || !/^\d{4}-\d{2}-\d{2}$/.test(value.priceDate ?? '') || typeof value.sourceUrl !== 'string') fail('Pricing input has an invalid model, currency, date, or source URL.');
  for (const key of numericKeys) if (typeof value[key] !== 'number' || value[key] < 0) fail(`Pricing input ${key} must be a non-negative number.`);
  return value;
}

function calculatePricing(usage, source) {
  const cached = usage.cacheReadInputTokens ?? 0;
  const cacheWrite = usage.cacheWriteInputTokens ?? 0;
  if (cached > usage.inputTokens) fail('Cached input tokens exceed total input tokens.');
  const costUsd = ((usage.inputTokens - cached) * source.inputUsdPerMillion + cached * source.cacheReadUsdPerMillion + cacheWrite * source.cacheWriteUsdPerMillion + usage.outputTokens * source.outputUsdPerMillion) / 1_000_000;
  return {
    priceDate: source.priceDate,
    costUsd,
    rates: {
      inputUsdPerMillion: source.inputUsdPerMillion,
      cacheReadUsdPerMillion: source.cacheReadUsdPerMillion,
      cacheWriteUsdPerMillion: source.cacheWriteUsdPerMillion,
      outputUsdPerMillion: source.outputUsdPerMillion,
      sourceUrl: source.sourceUrl,
    },
  };
}

async function hashFromCommit(commit, relativePath) { return sha256(await gitShow(commit, relativePath)); }
async function hashIfPresent(filePath) {
  try { return sha256(await fs.readFile(filePath, 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return undefined; throw error; }
}
async function gitShow(commit, relativePath) {
  if (path.isAbsolute(relativePath) || relativePath.split('/').includes('..')) fail(`Artifact path must be repository-relative: ${relativePath}`);
  return (await command('git', ['show', `${commit}:${relativePath}`], ROOT)).stdout;
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
