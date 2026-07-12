#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertOnlyOptions, fail, parseArgs } from './common.mjs';

const REQUIRED_MANIFEST_KEYS = ['schemaVersion', 'benchmarkVersion', 'runId', 'slotId', 'configuration', 'theme', 'baseline', 'recipe', 'controller', 'timing', 'stages', 'cost', 'gates', 'output', 'disposition'];
const FORMATS = new Set(['table', 'json', 'csv']);
const IDENTITIES = new Set(['auto', 'blind', 'unblind']);

export function manifestErrors(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['manifest must be an object'];
  for (const key of REQUIRED_MANIFEST_KEYS) if (!Object.hasOwn(manifest, key)) errors.push(`missing ${key}`);
  if (manifest.schemaVersion !== 2) errors.push('schemaVersion must equal 2');
  if (!Array.isArray(manifest.stages)) errors.push('stages must be an array');
  if (!Array.isArray(manifest.gates)) errors.push('gates must be an array');
  const themeIsObject = manifest.theme && typeof manifest.theme === 'object' && !Array.isArray(manifest.theme);
  const outputIsObject = manifest.output && typeof manifest.output === 'object' && !Array.isArray(manifest.output);
  if (themeIsObject && outputIsObject) {
    const hasThemeId = Object.hasOwn(manifest.theme, 'id');
    const hasOutputTitle = Object.hasOwn(manifest.output, 'title');
    if (hasThemeId !== hasOutputTitle) errors.push('theme.id and output.title must be present together');
    if (hasThemeId && (typeof manifest.theme.id !== 'string' || !manifest.theme.id || typeof manifest.output.title !== 'string' || !manifest.output.title)) {
      errors.push('current theme/output metadata is incomplete');
    }
  }
  return errors;
}

export function shouldUnblind(benchmarkVersion, identity = 'auto') {
  if (identity === 'unblind') return true;
  if (identity === 'blind') return false;
  return benchmarkVersion === 'rehearsal';
}

export function resultFromArtifacts({ directoryName, manifest, definition, gates, failure, recovery, promotion }, identity = 'auto') {
  const benchmarkVersion = manifest?.benchmarkVersion ?? definition?.benchmarkVersion ?? null;
  const unblinded = shouldUnblind(benchmarkVersion, identity);
  const gateRecords = manifest?.gates ?? gates?.gates ?? [];
  const failedGates = gateRecords.filter((gate) => gate.status === 'failed').map((gate) => gate.id);
  const notRunGates = gateRecords.filter((gate) => gate.status === 'not-run').map((gate) => gate.id);
  const errors = manifest ? manifestErrors(manifest) : [];
  const stages = manifest?.stages ?? [];
  const stageModels = [...new Set(stages.map((stage) => stage?.model?.snapshotId).filter(Boolean))];
  const definitionModel = definition?.stage?.model;
  const models = stageModels.length ? stageModels : (definitionModel ? [definitionModel] : []);
  const configuration = manifest?.configuration?.id ?? definition?.assignment?.configurationId ?? null;

  let state = 'incomplete';
  if (failedGates.length) state = 'gate-failed';
  else if (manifest?.disposition?.status === 'dnf') state = 'dnf';
  else if (manifest?.disposition?.status === 'controller-failure') state = 'controller-failure';
  else if (manifest) state = 'completed';
  else if (failure) state = 'controller-failure';

  return {
    runId: manifest?.runId ?? definition?.assignment?.runId ?? directoryName,
    slotId: manifest?.slotId ?? definition?.assignment?.slotId ?? null,
    benchmarkVersion,
    themeId: manifest?.theme?.id ?? definition?.assignment?.theme?.id ?? themeIdFromPath(manifest?.theme?.path ?? definition?.assignment?.theme?.path),
    levelId: manifest?.output?.levelId ?? definition?.assignment?.levelId ?? null,
    identity: unblinded ? 'unblinded' : 'blinded',
    configuration: unblinded ? configuration : null,
    models: unblinded ? models : [],
    state,
    gates: gateSummary(gateRecords),
    failedGates,
    notRunGates,
    stageWallTimeSeconds: stageElapsedSeconds(stages),
    controllerWallTimeSeconds: numberOrNull(manifest?.timing?.wallTimeSeconds),
    costUsd: numberOrNull(manifest?.cost?.totalUsd),
    costStatus: manifest?.cost?.status ?? 'unavailable',
    evaluatedCommit: manifest?.output?.evaluated?.commit ?? gates?.evaluatedCommit ?? null,
    payloadCommit: manifest?.output?.payload?.commit ?? null,
    promotionStatus: manifest?.disposition?.status === 'playable' ? (promotion?.status === 'completed' ? 'completed' : promotion?.status === 'failed' ? 'failed' : 'pending') : 'not-applicable',
    promotionCommit: promotion?.promotionCommit ?? null,
    recovered: Boolean(recovery),
    recoveryReason: recovery?.reason ?? null,
    manifestState: !manifest ? 'missing' : (errors.length ? 'invalid' : 'complete'),
    manifestErrors: errors,
  };
}

export async function loadResults(runsDirectory, { version, theme, identity = 'auto' } = {}) {
  let entries;
  try {
    entries = await fs.readdir(runsDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`Runs directory does not exist: ${runsDirectory}`);
    throw error;
  }
  const results = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const runDirectory = path.join(runsDirectory, entry.name);
    const artifacts = {
      directoryName: entry.name,
      manifest: await optionalJson(path.join(runDirectory, 'manifest.json')),
      definition: await optionalJson(path.join(runDirectory, 'run-definition.json')),
      gates: await optionalJson(path.join(runDirectory, 'gates', 'gates.json')),
      failure: await optionalJson(path.join(runDirectory, 'controller-failure.json')),
      recovery: await optionalJson(path.join(runDirectory, 'recovery.json')),
      promotion: await optionalJson(path.join(runDirectory, 'promotion.json')),
    };
    if (!artifacts.manifest && !artifacts.definition) continue;
    const result = resultFromArtifacts(artifacts, identity);
    if (version && result.benchmarkVersion !== version) continue;
    if (theme && result.themeId !== theme) continue;
    results.push(result);
  }
  return results;
}

export function formatTable(results) {
  if (!results.length) return 'No benchmark runs found.';
  const headers = ['RUN', 'SLOT', 'VERSION', 'CONFIGURATION', 'MODEL(S)', 'LEVEL', 'STATE', 'GATES', 'STAGE', 'TOTAL', 'COST', 'MANIFEST'];
  const rows = results.map((result) => [
    result.runId,
    result.slotId ?? '—',
    result.benchmarkVersion ?? '—',
    result.identity === 'blinded' ? '<blind>' : (result.configuration ?? '—'),
    result.identity === 'blinded' ? '<blind>' : (result.models.join(',') || '—'),
    result.levelId ?? '—',
    result.state,
    result.gates,
    formatDuration(result.stageWallTimeSeconds),
    formatDuration(result.controllerWallTimeSeconds),
    result.costUsd === null ? '—' : `$${result.costUsd.toFixed(2)}`,
    result.manifestState,
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => String(row[index]).length)));
  const render = (row) => row.map((cell, index) => String(cell).padEnd(widths[index])).join('  ').trimEnd();
  return [render(headers), render(widths.map((width) => '─'.repeat(width))), ...rows.map(render)].join('\n');
}

export function formatCsv(results) {
  const keys = ['runId', 'slotId', 'benchmarkVersion', 'themeId', 'levelId', 'identity', 'configuration', 'models', 'state', 'gates', 'stageWallTimeSeconds', 'controllerWallTimeSeconds', 'costUsd', 'costStatus', 'evaluatedCommit', 'payloadCommit', 'recovered', 'manifestState'];
  const rows = results.map((result) => keys.map((key) => csvCell(Array.isArray(result[key]) ? result[key].join('|') : result[key])).join(','));
  return [keys.join(','), ...rows].join('\n');
}

function gateSummary(gates) {
  if (!gates.length) return '—';
  const passed = gates.filter((gate) => gate.status === 'passed').length;
  const failed = gates.filter((gate) => gate.status === 'failed').length;
  const notRun = gates.filter((gate) => gate.status === 'not-run').length;
  if (failed) return `${passed}/${gates.length} (${failed} failed)`;
  if (notRun) return `${passed}/${gates.length} (${notRun} not run)`;
  return `${passed}/${gates.length}`;
}

function stageElapsedSeconds(stages) {
  if (!stages.length) return null;
  const uniqueExecutions = new Map();
  for (const stage of stages) {
    const key = [stage.sessionId, stage.startedAt, stage.finishedAt, stage.rolloutArtifactSha256].join('|');
    if (!uniqueExecutions.has(key)) uniqueExecutions.set(key, stage);
  }
  const wallTimes = [...uniqueExecutions.values()].map((stage) => stage.wallTimeSeconds).filter((value) => typeof value === 'number');
  return wallTimes.length ? wallTimes.reduce((total, value) => total + value, 0) : null;
}

function themeIdFromPath(value) {
  return value ? path.basename(value, path.extname(value)) : null;
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatDuration(seconds) {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function optionalJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) fail(`Invalid JSON in ${filePath}: ${error.message}`);
    throw error;
  }
}

async function main() {
  const { options } = parseArgs(process.argv.slice(2));
  assertOnlyOptions(options, new Set(['help', 'runs', 'version', 'theme', 'format', 'identity']));
  if (options.help) {
    console.log(`Usage: npm run benchmark:results -- [options]\n\nOptions:\n  --runs <path>       Run artifact directory (default: benchmark/private/runs)\n  --version <id>      Filter by benchmark version, including rehearsal\n  --theme <id>        Filter by theme id\n  --format <format>   table, json, or csv (default: table)\n  --identity <mode>   auto, blind, or unblind (default: auto)\n\nAuto identity reveals rehearsal configurations and models, but keeps all other benchmark versions blind.`);
    return;
  }
  const format = options.format ?? 'table';
  const identity = options.identity ?? 'auto';
  if (!FORMATS.has(format)) fail('--format must be table, json, or csv.');
  if (!IDENTITIES.has(identity)) fail('--identity must be auto, blind, or unblind.');
  const runsDirectory = path.resolve(options.runs ?? 'benchmark/private/runs');
  const results = await loadResults(runsDirectory, { version: options.version, theme: options.theme, identity });
  if (format === 'json') console.log(JSON.stringify(results, null, 2));
  else if (format === 'csv') console.log(formatCsv(results));
  else console.log(formatTable(results));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
