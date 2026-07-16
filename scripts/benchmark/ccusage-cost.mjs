import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The pinned ccusage CLI entry, invoked with the repository's own (Linux) Node. Never shell out
// to the PATH `bunx`/`ccusage`: on this box that resolves to a Windows `bun` that reads
// `C:\Users\...\.claude` and silently ignores the Linux per-run home and its env vars.
export const CCUSAGE_CLI = path.join(ROOT, 'node_modules/ccusage/src/cli.js');

// ccusage reports the same run under different field names per harness. `shape` selects how per-model
// usage is carried: `model-breakdowns` is an array with a per-model `cost` (Claude, pi), while
// `models-map` is an object keyed by model name with token counts but no cost (Codex), leaving the
// run cost only in the total. `scope` is how ccusage is pointed at this run's isolated rollout home:
// Claude and Codex read an env var, while the pi view takes an explicit sessions path instead.
const HARNESS = {
  'claude-cli': { view: 'claude', totalsCostKey: 'totalCost', shape: 'model-breakdowns', scope: { kind: 'env', homeEnvVar: 'CLAUDE_CONFIG_DIR' } },
  'codex-cli': { view: 'codex', totalsCostKey: 'costUSD', shape: 'models-map', scope: { kind: 'env', homeEnvVar: 'CODEX_HOME' } },
  // ccusage labels every pi model `[pi] <id>` for display. That prefix is a ccusage artifact, not
  // part of the model's identity, so it is stripped here rather than recorded in a run manifest.
  'pi-cli': { view: 'pi', totalsCostKey: 'totalCost', shape: 'model-breakdowns', modelNamePrefix: '[pi] ', scope: { kind: 'path-flag', flag: '--pi-path', homeRelative: 'sessions' } },
};

export function harnessForAdapter(adapter) {
  const harness = HARNESS[adapter];
  if (!harness) fail(`No ccusage harness mapping for adapter ${adapter}.`);
  return harness;
}

// Pure summary over an already-parsed `ccusage <view> session --json` report. Kept side-effect free
// so unit tests can feed mock ccusage output without touching the network or a real home.
export function summarizeCost(adapter, report) {
  const harness = harnessForAdapter(adapter);
  if (!report || typeof report !== 'object' || !Array.isArray(report.sessions) || typeof report.totals !== 'object') {
    fail('ccusage report is missing its sessions array or totals object.');
  }
  const totals = report.totals;
  const totalUsd = totals[harness.totalsCostKey];
  if (typeof totalUsd !== 'number' || Number.isNaN(totalUsd)) fail(`ccusage totals.${harness.totalsCostKey} was not a number.`);
  const totalTokens = numberOr(totals.totalTokens, 0);

  const models = new Map();
  const accumulate = (rawName, { inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0, reasoningTokens = 0, costUsd = null }) => {
    const name = harness.modelNamePrefix && rawName.startsWith(harness.modelNamePrefix) ? rawName.slice(harness.modelNamePrefix.length) : rawName;
    const current = models.get(name) ?? { modelName: name, costUsd: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
    current.inputTokens += inputTokens;
    current.outputTokens += outputTokens;
    current.cacheReadTokens += cacheReadTokens;
    current.cacheWriteTokens += cacheWriteTokens;
    current.reasoningTokens += reasoningTokens;
    if (costUsd !== null) current.costUsd = (current.costUsd ?? 0) + costUsd;
    models.set(name, current);
  };

  if (harness.shape === 'model-breakdowns') {
    for (const session of report.sessions) {
      for (const breakdown of session.modelBreakdowns ?? []) {
        accumulate(breakdown.modelName, {
          costUsd: numberOr(breakdown.cost, 0),
          inputTokens: numberOr(breakdown.inputTokens, 0),
          outputTokens: numberOr(breakdown.outputTokens, 0),
          cacheReadTokens: numberOr(breakdown.cacheReadTokens, 0),
          cacheWriteTokens: numberOr(breakdown.cacheCreationTokens, 0),
        });
      }
    }
  } else {
    // Codex: `session.models` is an object keyed by model name; ccusage attributes tokens per model
    // but not cost, so per-model costUsd stays null and the run cost lives only in the total.
    for (const session of report.sessions) {
      for (const [modelName, usage] of Object.entries(session.models ?? {})) {
        accumulate(modelName, {
          inputTokens: numberOr(usage.inputTokens, 0),
          outputTokens: numberOr(usage.outputTokens, 0),
          cacheReadTokens: numberOr(usage.cacheReadTokens, 0),
          cacheWriteTokens: numberOr(usage.cacheCreationTokens, 0),
          reasoningTokens: numberOr(usage.reasoningOutputTokens, 0),
        });
      }
    }
  }

  const modelList = [...models.values()].sort((left, right) => left.modelName.localeCompare(right.modelName));
  return {
    view: harness.view,
    totalUsd,
    sessionCount: report.sessions.length,
    totalTokens,
    perModelCostAvailable: harness.shape === 'model-breakdowns',
    totals: {
      inputTokens: numberOr(totals.inputTokens, 0),
      outputTokens: numberOr(totals.outputTokens, 0),
      cacheReadTokens: numberOr(totals.cacheReadTokens, 0),
      cacheWriteTokens: numberOr(totals.cacheCreationTokens, 0),
      reasoningTokens: numberOr(totals.reasoningOutputTokens, 0),
    },
    models: modelList,
  };
}

// Claude's terminal result event carries `modelUsage`: the CLI's own per-model tally, counted from
// the API responses as they arrived. ccusage instead replays the persisted transcripts — and an
// assistant message whose usage never finalized on disk keeps the tiny snapshot written at message
// start, so replay can under-report output. Returns null for a harness that reports no such counter
// (Codex), whose token totals come from authoritative running counts in its own event log.
export function harnessCounters(usage) {
  const modelUsage = usage?.normalized?.vendorFields?.modelUsage;
  if (!modelUsage || typeof modelUsage !== 'object') return null;
  const counters = new Map();
  for (const [key, value] of Object.entries(modelUsage)) {
    // `claude-opus-4-8[1m]` and `claude-opus-4-8` are one model billed at two context tiers.
    const modelName = key.replace(/\[[^\]]*\]$/, '');
    const current = counters.get(modelName) ?? { modelName, outputTokens: 0, costUsd: null };
    current.outputTokens += numberOr(value?.outputTokens, 0);
    const costUsd = numberOr(value?.costUSD, null);
    if (costUsd !== null) current.costUsd = (current.costUsd ?? 0) + costUsd;
    counters.set(modelName, current);
  }
  return counters.size > 0 ? counters : null;
}

// Claude and Codex restate whole-session usage on every resumed invocation, so their final round is
// authoritative. pi emits usage only for API calls made by that invocation; sum its round counters
// before comparing them with ccusage's replay of the one appended session transcript.
export function harnessCountersForRounds(adapter, usages) {
  const present = usages.filter(Boolean);
  if (present.length === 0) return null;
  if (adapter !== 'pi-cli') return harnessCounters(present.at(-1));

  const combined = new Map();
  for (const usage of present) {
    const counters = harnessCounters(usage);
    for (const counter of counters?.values() ?? []) {
      const current = combined.get(counter.modelName) ?? { modelName: counter.modelName, outputTokens: 0, costUsd: null };
      current.outputTokens += counter.outputTokens;
      if (counter.costUsd !== null) current.costUsd = (current.costUsd ?? 0) + counter.costUsd;
      combined.set(counter.modelName, current);
    }
  }
  return combined.size > 0 ? combined : null;
}

// Cross-check the replayed transcripts against the harness's own counter and prefer whichever saw
// the billing. The two disagree in opposite directions for opposite reasons, so the direction of the
// gap identifies the faulty source: a counter above replay is replay having lost an unfinalized
// message, while a counter far below replay would mean it covers only part of the session, and the
// replay stands. Counters naming a model the run does not attribute (Claude Code's auxiliary
// summarizer, which leaves no rollout) are ignored here and declared in benchmark/README.md.
export function reconcileCost(summary, counters) {
  if (!counters) return { ...summary, reconciliation: { status: 'unavailable', reason: 'The harness reports no per-model counter to cross-check.' } };
  const adjustments = [];
  let totalUsd = summary.totalUsd;
  const models = summary.models.map((model) => {
    const counter = counters.get(model.modelName);
    if (!counter) return { ...model, usageSource: 'ccusage' };
    const outputDelta = counter.outputTokens - model.outputTokens;
    if (outputDelta === 0) return { ...model, usageSource: 'agreed' };
    const shared = { modelName: model.modelName, replayOutputTokens: model.outputTokens, counterOutputTokens: counter.outputTokens };
    if (outputDelta < 0) {
      adjustments.push({ ...shared, resolution: 'kept-replay' });
      return { ...model, usageSource: 'ccusage' };
    }
    adjustments.push({ ...shared, resolution: 'took-counter', ...(counter.costUsd !== null && model.costUsd !== null ? { replayCostUsd: model.costUsd, counterCostUsd: counter.costUsd } : {}) });
    // Fold only the delta into the total: it may carry residue the per-model rows do not explain.
    if (counter.costUsd !== null && typeof model.costUsd === 'number') totalUsd += counter.costUsd - model.costUsd;
    return { ...model, outputTokens: counter.outputTokens, ...(counter.costUsd !== null ? { costUsd: counter.costUsd } : {}), usageSource: 'harness-counter' };
  });
  const suspect = adjustments.some((entry) => entry.resolution === 'kept-replay');
  const status = suspect ? 'suspect' : adjustments.length > 0 ? 'adjusted' : 'agreed';
  return { ...summary, models, totalUsd, reconciliation: { status, source: 'harness result event modelUsage', ...(adjustments.length > 0 ? { adjustments } : {}) } };
}

// Human-readable lines for whatever the reconciliation found; the runner prints these so a
// discrepancy is visible when it happens rather than only in the manifest.
export function reconciliationWarnings(reconciliation) {
  return (reconciliation?.adjustments ?? []).map((entry) => entry.resolution === 'took-counter'
    ? `Cost reconciliation: ${entry.modelName} replayed ${entry.replayOutputTokens.toLocaleString('en-US')} output tokens but the harness counted ${entry.counterOutputTokens.toLocaleString('en-US')}; took the counter (transcript replay lost an unfinalized message).`
    : `Cost reconciliation: ${entry.modelName} replayed ${entry.replayOutputTokens.toLocaleString('en-US')} output tokens but the harness counted only ${entry.counterOutputTokens.toLocaleString('en-US')}; kept the replay. The counter may not cover the whole session — investigate before trusting either number.`);
}

// The single sanity guard the brief mandates: an empty or costless home means the isolated rollout
// home was misconfigured (wrong env var, wrong Node), which is a controller failure — not a $0 run.
export function assertMeasurable(summary) {
  if (summary.sessionCount < 1) fail('ccusage found no sessions in the per-run home; the isolated home is misconfigured.');
  if (!(summary.totalTokens > 0)) fail('ccusage reported zero tokens for the per-run home; the isolated home is misconfigured.');
  if (!(summary.totalUsd > 0)) fail('ccusage reported zero cost for the per-run home; the isolated home is misconfigured.');
  return summary;
}

export async function ccusageVersion(node = process.execPath) {
  const { stdout } = await run(node, [CCUSAGE_CLI, '--version']);
  return stdout.trim().replace(/^ccusage\s+/i, '');
}

// Run `ccusage <view> session --json` scoped to the per-run home and return the parsed report.
export async function measureRunCost({ adapter, home, node = process.execPath, tolerateEmpty = false }) {
  try {
    const harness = harnessForAdapter(adapter);
    const { stdout } = await run(node, [CCUSAGE_CLI, harness.view, 'session', '--json', ...scopeArgs(harness, home)], {
      env: scopeEnv(harness, home),
    });
    let report;
    try {
      report = JSON.parse(stdout);
    } catch (error) {
      fail(`ccusage ${harness.view} session --json did not return valid JSON: ${error.message}`);
    }
    return assertMeasurable(summarizeCost(adapter, report));
  } catch (error) {
    // Live homes are empty until the harness persists its first rollout. Budget polling is advisory,
    // so its explicitly tolerant path reports no measurement rather than aborting a long-running CLI.
    if (tolerateEmpty) return null;
    throw error;
  }
}

// A path-flag harness is scoped by argument, so it must not also inherit an operator env var that
// would widen the search back out to the shared home.
function scopeArgs(harness, home) {
  if (harness.scope.kind !== 'path-flag') return [];
  return [harness.scope.flag, path.join(home, harness.scope.homeRelative)];
}

function scopeEnv(harness, home) {
  if (harness.scope.kind !== 'env') return process.env;
  return { ...process.env, [harness.scope.homeEnvVar]: home };
}

function numberOr(value, fallback) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

function run(executable, args, { env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${[executable, ...args].join(' ')} failed:\n${stderr || stdout}`));
      else resolve({ stdout, stderr });
    });
  });
}
