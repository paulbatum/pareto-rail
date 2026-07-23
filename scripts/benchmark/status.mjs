#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertOnlyOptions, fail, parseArgs } from './common.mjs';
import { loadRunResult, renderTable } from './results.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PRIVATE_DIR = path.join(ROOT, 'benchmark/private');
const RUNS_DIR = path.join(PRIVATE_DIR, 'runs');
const ARCHIVE_DIR = path.join(PRIVATE_DIR, 'archive/runs');
const FORMATS = new Set(['table', 'json']);

async function loadPlannedRuns() {
  const planned = new Map();
  for (const planFile of await planFiles()) {
    const plan = await optionalJson(planFile);
    if (!Array.isArray(plan?.runs)) continue;
    for (const run of plan.runs) {
      if (planned.has(run.runId)) continue;
      planned.set(run.runId, {
        runId: run.runId,
        slotId: run.slotId ?? null,
        levelId: run.levelId ?? null,
        themeId: run.themeId ?? null,
        configurationId: run.configurationId ?? null,
        kind: run.kind ?? 'benchmark',
        benchmarkVersion: plan.benchmarkVersion ?? null,
      });
    }
  }
  for (const scheduleFile of await scheduleFiles()) {
    const schedule = await optionalJson(scheduleFile);
    for (const assignment of schedule?.assignments ?? []) {
      if (planned.has(assignment.runId)) continue;
      planned.set(assignment.runId, {
        runId: assignment.runId,
        slotId: assignment.slotId ?? null,
        levelId: assignment.levelId ?? null,
        themeId: assignment.theme?.id ?? null,
        configurationId: assignment.configurationId ?? null,
        kind: 'benchmark',
        benchmarkVersion: schedule.benchmarkVersion ?? null,
      });
    }
  }
  return planned;
}

async function scheduleFiles() {
  const entries = await fs.readdir(PRIVATE_DIR);
  return entries
    .filter((name) => /^run-schedule.*\.json$/.test(name))
    .sort()
    .map((name) => path.join(PRIVATE_DIR, name));
}

// Every plan file in benchmark/private participates, so a new series (or a side
// plan like fun-ideas) is visible without re-wiring status. A plan is any
// *plan*.json whose top level carries a runs array.
async function planFiles() {
  const entries = await fs.readdir(PRIVATE_DIR);
  return entries
    .filter((name) => name.includes('plan') && name.endsWith('.json'))
    .sort()
    .map((name) => path.join(PRIVATE_DIR, name));
}

async function loadLiveRuns(unblind) {
  const runs = new Map();
  for (const name of await directoryNames(RUNS_DIR)) {
    const result = await loadRunResult(path.join(RUNS_DIR, name), name, { unblind });
    if (result) runs.set(result.runId, result);
  }
  return runs;
}

// Archived directories carry a timestamp suffix and may hold several snapshots per run; recover the
// runId from archive.json.originalPath and keep the newest snapshot, since the directory name is not
// a safe key to split on.
async function loadArchivedRuns(unblind) {
  const newest = new Map();
  for (const name of await directoryNames(ARCHIVE_DIR)) {
    const directory = path.join(ARCHIVE_DIR, name);
    const archive = await optionalJson(path.join(directory, 'archive.json'));
    if (!archive?.originalPath) continue;
    const runId = path.basename(archive.originalPath);
    const previous = newest.get(runId);
    if (previous && previous.archivedAt >= archive.archivedAt) continue;
    const result = await loadRunResult(directory, runId, { unblind });
    if (result) newest.set(runId, { archivedAt: archive.archivedAt ?? '', result });
  }
  return new Map([...newest].map(([runId, entry]) => [runId, entry.result]));
}

function mergeRecords({ planned, live, archived, unblind }) {
  const runIds = new Set([...planned.keys(), ...live.keys(), ...archived.keys()]);
  const records = [];
  for (const runId of runIds) {
    const plan = planned.get(runId) ?? null;
    const liveResult = live.get(runId) ?? null;
    const archivedResult = archived.get(runId) ?? null;
    const result = liveResult ?? archivedResult;
    const fromArchive = !liveResult && Boolean(archivedResult);
    const kind = plan?.kind ?? inferKind(runId);
    records.push({
      runId,
      planned: Boolean(plan),
      kind,
      benchmarkVersion: plan?.benchmarkVersion ?? result?.benchmarkVersion ?? null,
      slotId: plan?.slotId ?? result?.slotId ?? null,
      levelId: plan?.levelId ?? result?.levelId ?? null,
      themeId: plan?.themeId ?? result?.themeId ?? null,
      hasLive: Boolean(liveResult),
      hasArchive: Boolean(archivedResult),
      archived: fromArchive,
      state: result?.state ?? 'not-started',
      gates: result?.gates ?? '—',
      promotionStatus: result?.promotionStatus ?? null,
      costUsd: result?.costUsd ?? null,
      incident: Boolean(result?.incident),
      ...(unblind ? { configuration: plan?.configurationId ?? result?.configuration ?? null, models: result?.models ?? [] } : {}),
      bucket: null,
    });
  }
  for (const record of records) record.bucket = bucketFor(record);
  records.sort((left, right) => left.runId.localeCompare(right.runId));
  return records;
}

function inferKind(runId) {
  if (runId.startsWith('rehearsal')) return 'rehearsal';
  if (runId.startsWith('smoke')) return 'smoke';
  return 'unplanned';
}

// Pending is planned work that has not reached a terminal-success (completed) outcome and is not a
// decided disqualification: either nothing has been launched, or a live directory is still short of
// completion. A run that exists only in the archive has been retired, so it reports under Ran.
function bucketFor(record) {
  if (record.planned && record.state === 'not-started') return 'pending';
  if (record.planned && record.hasLive && record.state !== 'completed' && record.state !== 'disqualified') return 'pending';
  if (record.state === 'completed' && (record.promotionStatus === 'pending' || record.promotionStatus === 'failed')) return 'needs-promotion';
  return 'ran';
}

async function directoryNames(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
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

function identityColumns(unblind) {
  return unblind ? ['CONFIGURATION', 'MODEL(S)'] : [];
}

function identityCells(record, unblind) {
  if (!unblind) return [];
  return [record.configuration ?? '—', record.models?.join(',') || '—'];
}

function cost(record) {
  return record.costUsd === null ? '—' : `$${record.costUsd.toFixed(2)}`;
}

function formatPending(records, unblind) {
  const headers = ['RUN', 'SLOT', 'VERSION', 'LEVEL', 'KIND', 'STATE', ...identityColumns(unblind)];
  const rows = records.map((record) => [
    record.runId,
    record.slotId ?? '—',
    record.benchmarkVersion ?? '—',
    record.levelId ?? '—',
    record.kind,
    record.state,
    ...identityCells(record, unblind),
  ]);
  return renderTable(headers, rows);
}

function formatNeedsPromotion(records, unblind) {
  const headers = ['RUN', 'SLOT', 'VERSION', 'LEVEL', 'STATE', 'GATES', 'PROMOTION', 'COST', ...identityColumns(unblind)];
  const rows = records.map((record) => [
    record.runId,
    record.slotId ?? '—',
    record.benchmarkVersion ?? '—',
    record.levelId ?? '—',
    record.state,
    record.gates,
    record.promotionStatus ?? '—',
    cost(record),
    ...identityCells(record, unblind),
  ]);
  return renderTable(headers, rows);
}

function formatRan(records, unblind) {
  const headers = ['RUN', 'SLOT', 'VERSION', 'LEVEL', 'KIND', 'STATE', 'GATES', 'PROMOTION', 'ARCHIVED', 'COST', ...identityColumns(unblind)];
  const rows = records.map((record) => [
    record.runId,
    record.slotId ?? '—',
    record.benchmarkVersion ?? '—',
    record.levelId ?? '—',
    record.planned ? record.kind : `${record.kind}*`,
    record.state,
    record.gates,
    record.promotionStatus ?? '—',
    record.archived ? 'archived' : '—',
    cost(record),
    ...identityCells(record, unblind),
  ]);
  return renderTable(headers, rows);
}

function formatStatus(records, unblind) {
  const pending = records.filter((record) => record.bucket === 'pending');
  const needsPromotion = records.filter((record) => record.bucket === 'needs-promotion');
  const ran = records.filter((record) => record.bucket === 'ran');
  const sections = [];
  sections.push(`Pending (${pending.length})`);
  sections.push(pending.length ? formatPending(pending, unblind) : 'Nothing pending.');
  sections.push('');
  sections.push(`Needs promotion (${needsPromotion.length})`);
  sections.push(needsPromotion.length ? formatNeedsPromotion(needsPromotion, unblind) : 'Nothing awaiting promotion.');
  sections.push('');
  sections.push(`Ran (${ran.length})`);
  sections.push(ran.length ? formatRan(ran, unblind) : 'No runs recorded.');
  if (ran.some((record) => !record.planned)) sections.push('\n* unplanned execution (no plan or schedule row)');
  return sections.join('\n');
}

export async function collectStatus({ unblind = false } = {}) {
  const [planned, live, archived] = await Promise.all([
    loadPlannedRuns(),
    loadLiveRuns(unblind),
    loadArchivedRuns(unblind),
  ]);
  return mergeRecords({ planned, live, archived, unblind });
}

async function main() {
  const { options } = parseArgs(process.argv.slice(2), { booleans: ['unblind'] });
  assertOnlyOptions(options, new Set(['help', 'format', 'unblind']));
  if (options.help) {
    console.log(`Usage: npm run benchmark:status -- [options]\n\nOptions:\n  --format <format>   table or json (default: table)\n  --unblind           Reveal configuration and model identities (default: blind)\n\nMerges planned runs (every private plan file and any run schedule) with executed run\nartifacts (live and archived) into one pending / needs-promotion / ran view.\nBlind by default: run ids and dispositions only. Pass --unblind after voting.`);
    return;
  }
  const format = options.format ?? 'table';
  const unblind = options.unblind === true;
  if (!FORMATS.has(format)) fail('--format must be table or json.');
  const records = await collectStatus({ unblind });
  if (format === 'json') console.log(JSON.stringify(records, null, 2));
  else console.log(formatStatus(records, unblind));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
