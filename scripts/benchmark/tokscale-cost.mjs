// Cost measurement for the Antigravity CLI, which ccusage cannot see.
//
// ccusage prices every other configuration in this benchmark, but it has no Antigravity source: its
// `gemini` view covers the Gemini CLI, a different tool. Support has been proposed upstream several
// times and implemented twice (ccusage PR #1487 is complete and tested), but every one of those
// threads was auto-closed by the repository's new-contributor filter without review, so no published
// ccusage release reads Antigravity data.
//
// tokscale does. It decodes the same local SQLite conversation databases the agy adapter captures,
// offline, and its `--home` flag re-roots the whole scan — which is how a run stays scoped to its own
// isolated harness home, the same guarantee ccusage's per-harness env vars and `--pi-path` give.
//
// The two tools were cross-checked on one run both can read (the pi/OpenRouter Gemini smoke). Their
// token counts agree exactly: 131,124 input, 7,142 output, 195,025 cache-read. Their costs do not —
// ccusage $0.1843 against tokscale $0.2795 — because they price on different bases. ccusage passes
// through the per-call charge the provider reported; tokscale computes from a rate card. That gap is
// a property of the basis, not an error in either tool, so the manifest records which basis produced
// a figure rather than presenting the two as interchangeable. For a subscription there is no metered
// charge to pass through, so a rate card is the only available basis — the same one ccusage applies
// to the Claude and Codex subscription configurations.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from './common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The pinned tokscale binary, resolved inside the repository rather than from PATH so a run measures
// with the version package.json declares. The same reasoning as CCUSAGE_CLI in ccusage-cost.mjs.
export const TOKSCALE_CLI = path.join(ROOT, 'node_modules/.bin/tokscale');

// tokscale reports Antigravity under two client ids: `antigravity-cli` is the terminal agent's local
// SQLite conversations, which is what a benchmark stage produces. `antigravity` is the IDE, whose
// usage arrives through a sync cache and can never appear in a run's isolated home.
const AGY_CLIENT = 'antigravity-cli';

export async function measureAgyRunCost({ home }) {
  const report = await runTokscale(['models', '--home', home, '--json']);
  return summarizeAgyCost(report);
}

// Pure summary over an already-parsed `tokscale models --json` report, side-effect free so tests can
// feed a fixture without a binary or a home directory.
export function summarizeAgyCost(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.entries)) {
    fail('tokscale report is missing its entries array.');
  }
  const entries = report.entries.filter((entry) => entry.client === AGY_CLIENT);
  // A stage that produced no generations is a controller failure, not a free run: the adapter only
  // reaches cost measurement after agy exited, so an empty report means the home was not the run's.
  if (entries.length === 0) {
    fail(`tokscale found no ${AGY_CLIENT} usage in this run's harness home. The run cannot be priced; investigate before recording it.`);
  }

  const models = entries.map((entry) => ({
    modelName: entry.model,
    costUsd: numberOr(entry.cost, 0),
    inputTokens: numberOr(entry.input, 0),
    outputTokens: numberOr(entry.output, 0),
    cacheReadTokens: numberOr(entry.cacheRead, 0),
    cacheWriteTokens: numberOr(entry.cacheWrite, 0),
    reasoningTokens: numberOr(entry.reasoning, 0),
  })).sort((left, right) => left.modelName.localeCompare(right.modelName));

  const totals = models.reduce((accumulated, model) => ({
    inputTokens: accumulated.inputTokens + model.inputTokens,
    outputTokens: accumulated.outputTokens + model.outputTokens,
    cacheReadTokens: accumulated.cacheReadTokens + model.cacheReadTokens,
    cacheWriteTokens: accumulated.cacheWriteTokens + model.cacheWriteTokens,
    reasoningTokens: accumulated.reasoningTokens + model.reasoningTokens,
  }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 });

  return {
    view: AGY_CLIENT,
    totalUsd: models.reduce((total, model) => total + model.costUsd, 0),
    sessionCount: entries.reduce((total, entry) => total + numberOr(entry.messageCount, 0), 0),
    totalTokens: totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens,
    perModelCostAvailable: true,
    totals,
    models,
  };
}

export async function tokscaleVersion() {
  const result = await execute(TOKSCALE_CLI, ['--version']);
  return result.stdout.trim().replace(/^tokscale\s+/, '');
}

async function runTokscale(args) {
  const result = await execute(TOKSCALE_CLI, args);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`tokscale did not emit valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function execute(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => reject(new Error(`Could not run ${executable}: ${error.message}. Is the pinned tokscale dependency installed?`)));
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${[executable, ...args].join(' ')} exited ${code}:\n${stderr || stdout}`));
      else resolve({ stdout, stderr });
    });
  });
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
