import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The pinned ccusage CLI entry, invoked with the repository's own (Linux) Node. Never shell out
// to the PATH `bunx`/`ccusage`: on this box that resolves to a Windows `bun` that reads
// `C:\Users\...\.claude` and silently ignores the Linux per-run home and its env vars.
export const CCUSAGE_CLI = path.join(ROOT, 'node_modules/ccusage/src/cli.js');

// ccusage reports the same run under different field names per harness. Claude exposes a per-model
// cost breakdown (`modelBreakdowns[].cost`); Codex exposes only per-model token counts (`models`
// keyed object, no cost) plus a single run cost. `homeEnvVar` is the variable that scopes ccusage
// to this run's isolated rollout home.
const HARNESS = {
  'claude-cli': { view: 'claude', homeEnvVar: 'CLAUDE_CONFIG_DIR', totalsCostKey: 'totalCost' },
  'codex-cli': { view: 'codex', homeEnvVar: 'CODEX_HOME', totalsCostKey: 'costUSD' },
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
  const accumulate = (name, { inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0, reasoningTokens = 0, costUsd = null }) => {
    const current = models.get(name) ?? { modelName: name, costUsd: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
    current.inputTokens += inputTokens;
    current.outputTokens += outputTokens;
    current.cacheReadTokens += cacheReadTokens;
    current.cacheWriteTokens += cacheWriteTokens;
    current.reasoningTokens += reasoningTokens;
    if (costUsd !== null) current.costUsd = (current.costUsd ?? 0) + costUsd;
    models.set(name, current);
  };

  if (harness.view === 'claude') {
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
    perModelCostAvailable: harness.view === 'claude',
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
    const { stdout } = await run(node, [CCUSAGE_CLI, harness.view, 'session', '--json'], {
      env: { ...process.env, [harness.homeEnvVar]: home },
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
