#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeBudgetDirectory, POLL_INTERVAL_MS, resumeMessage, shouldResume } from './budget.mjs';
import { parseBudgetUsd, startBudgetPoller, writeBudgetSummary } from './budget-runtime.mjs';
import {
  assertOnlyOptions,
  assertPrivateOrExternalPath,
  fail,
  parseArgs,
  pathInside,
  requireOption,
  sha256,
  writeJson,
} from './common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// pi's own thinking levels. The benchmark's shared `--effort` vocabulary is a superset shared with
// Codex, so `ultra` is rejected here rather than silently downgraded to `max`.
const THINKING = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

// Every `message_update` repeats the whole message built so far rather than just the new delta, so
// the streamed log grows with the square of a message's length: a five-minute stage emitted 251MB of
// them against a 172KB session file. They are superseded by the `message_end` that closes each
// message and carries its final content and usage, so they are dropped as they stream — a real run
// would otherwise buffer gigabytes here and again in the runner that reads this log back.
const STREAMED_DELTA_EVENT = '"type":"message_update"';

// Providers that authenticate with an API key rather than pi's stored OAuth credential, and the env
// var each reads. A project-provisioned key in the repository `.env` takes precedence over whatever
// pi already holds; absent one, the child inherits nothing and pi falls back to its own credential.
const PROVIDER_KEY_ENV = {
  openrouter: 'OPENROUTER_API_KEY',
  openai: 'OPENAI_API_KEY',
};

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage:
  npm run benchmark:pi -- \\
    --worktree <entrant-worktree> \\
    --prompt <private-rendered-prompt> \\
    --out <private-stage-directory> \\
    --model <pi-model-id> \\
    --effort <off|minimal|low|medium|high|xhigh|max> \\
    [--provider <pi-provider>] \\
    [--timeout-seconds <positive-integer>] \\
    [--budget-usd <positive-number>] \\
    [--pi-bin <path-or-command>]`);
    return;
  }
  if (rest.length > 0) fail(`Unexpected argument: ${rest.join(' ')}.`);
  assertOnlyOptions(options, new Set(['help', 'worktree', 'prompt', 'out', 'model', 'effort', 'provider', 'timeout-seconds', 'budget-usd', 'pi-bin']));

  const worktree = path.resolve(requireOption(options, 'worktree'));
  const promptPath = path.resolve(requireOption(options, 'prompt'));
  const model = requireOption(options, 'model');
  const effort = requireOption(options, 'effort');
  if (!THINKING.has(effort)) fail(`Unsupported --effort: ${effort}. pi thinking levels are: ${[...THINKING].join(', ')}.`);
  const provider = options.provider;
  const timeoutSeconds = parseTimeout(options['timeout-seconds']);
  const budgetUsd = parseBudgetUsd(options['budget-usd']);
  const piBin = options['pi-bin'] ?? 'pi';
  const repositoryRoot = await primaryRepository(worktree);
  const outputDirectory = assertPrivateOrExternalPath(requireOption(options, 'out'), repositoryRoot);
  if (pathInside(outputDirectory, worktree)) fail('pi stage output must be outside the entrant worktree.');
  await assertDirectory(worktree, 'worktree');
  const prompt = await readFile(promptPath, 'prompt');
  await assertAbsent(outputDirectory, 'stage output directory');
  await fs.mkdir(outputDirectory, { recursive: true });

  const cliVersion = await runCommand(piBin, ['--version'], { cwd: worktree });
  const catalog = await runCommand(piBin, ['--list-models'], { cwd: worktree });
  await fs.writeFile(path.join(outputDirectory, 'model-catalog.txt'), catalog.stdout, 'utf8');
  await fs.writeFile(path.join(outputDirectory, 'model-catalog.stderr.log'), catalog.stderr, 'utf8');
  await writeJson(path.join(outputDirectory, 'selected-model.json'), {
    model,
    provider: provider ?? null,
    selectedThinkingLevel: effort,
  });

  const credential = await resolveProviderKey(provider);
  await writeJson(path.join(outputDirectory, 'credential-source.json'), {
    provider: provider ?? null,
    envVar: credential.envVar ?? null,
    source: credential.source,
  });

  const sharedArgs = [
    '--print',
    '--mode', 'json',
    // Trust the entrant worktree's own AGENTS.md/CLAUDE.md without a prompt, matching the Codex
    // adapter's non-interactive approval policy. The repository contracts are part of the task.
    '--approve',
    // Startup network calls (version check, extension discovery) are not part of the measured run
    // and add nondeterminism to a timed stage. Explicit `--extension` paths remain active under
    // `--no-extensions`, which lets a budgeted run load only its controller-owned notice extension.
    '--offline',
    '--no-extensions',
    '--thinking', effort,
    '--model', model,
    ...(provider ? ['--provider', provider] : []),
  ];

  let budgetDirectory;
  let poller;
  let deadline = Infinity;
  const childEnv = { ...(credential.env ?? {}) };
  if (budgetUsd !== undefined) {
    budgetDirectory = path.join(outputDirectory, 'budget');
    await initializeBudgetDirectory(budgetDirectory, budgetUsd);
    childEnv.PARETO_RAIL_BUDGET_DIRECTORY = budgetDirectory;
    const extensionPath = fileURLToPath(new URL('./pi-budget-extension.js', import.meta.url));
    sharedArgs.push('--extension', extensionPath);
    poller = startBudgetPoller({ adapter: 'pi-cli', home: piHome(), budgetDirectory, budgetUsd, intervalMs: POLL_INTERVAL_MS });
  }

  if (timeoutSeconds !== undefined) deadline = Date.now() + timeoutSeconds * 1_000;
  let turn = await runTurn({
    executable: piBin,
    args: sharedArgs,
    cwd: worktree,
    input: prompt,
    timeoutSeconds,
    outputDirectory,
    cliVersion,
    model,
    expectedSessionId: undefined,
    round: 0,
    env: childEnv,
  });
  const sessionId = turn.usage.sessionId;
  const finalMessage = path.join(outputDirectory, 'final-message.md');
  await fs.writeFile(finalMessage, turn.usage.finalMessage, 'utf8');
  const eventLogs = [{ path: 'events.jsonl', droppedLines: turn.result.droppedLines }];

  const resumes = [];
  let finalSpend;
  if (budgetUsd !== undefined && turn.result.code === 0) {
    finalSpend = await poller.refresh();
    while (shouldResume({ finalFraction: finalSpend.fraction, roundsUsed: resumes.length, remainingMs: remainingTime(deadline) })) {
      const round = resumes.length + 1;
      const resumeStartedAt = new Date().toISOString();
      turn = await runTurn({
        executable: piBin,
        args: [...sharedArgs, '--session', sessionId],
        cwd: worktree,
        input: resumeMessage(finalSpend.fraction),
        timeoutSeconds: remainingTimeoutSeconds(deadline),
        outputDirectory,
        cliVersion,
        model,
        expectedSessionId: sessionId,
        round,
        env: childEnv,
      });
      await fs.writeFile(finalMessage, turn.usage.finalMessage, 'utf8');
      eventLogs.push({ path: `events-resume-${round}.jsonl`, droppedLines: turn.result.droppedLines });
      resumes.push({
        round,
        spentUsd: finalSpend.spentUsd,
        fraction: finalSpend.fraction,
        startedAt: resumeStartedAt,
        finishedAt: turn.finishedAt,
        exitCode: turn.result.code,
      });
      if (turn.result.code !== 0) break;
      finalSpend = await poller.refresh();
    }
  }

  let budgetSummary;
  if (budgetUsd !== undefined) {
    finalSpend = await poller.refresh();
    poller.stop();
    budgetSummary = await writeBudgetSummary({ outputDirectory, budgetDirectory, budgetUsd, resumes, finalSpend });
  }

  const rollout = await captureRollout(sessionId, outputDirectory);
  await writeJson(path.join(outputDirectory, 'result.json'), {
    result: turn.result.code === 0 ? 'completed' : turn.result.timedOut ? 'timed-out' : 'failed',
    exitCode: turn.result.code,
    timedOut: turn.result.timedOut,
    sessionId: turn.usage.sessionId,
    usageSha256: sha256(JSON.stringify(turn.usage)),
    eventLogSha256: sha256(turn.result.stdout),
    stderrSha256: sha256(turn.result.stderr),
    // These are retained streams, not verbatim stdout. The complete appended transcript stays in
    // `rollout.jsonl`, which pi persists and ccusage replays.
    eventLog: {
      retained: 'all events except message_update',
      droppedLines: eventLogs.reduce((total, event) => total + event.droppedLines, 0),
      files: eventLogs,
    },
    rollout,
    ...(budgetSummary ? { budget: { path: 'budget.json' } } : {}),
  });

  if (turn.result.code !== 0) process.exitCode = turn.result.code || 1;
  else console.log(JSON.stringify({ sessionId: turn.usage.sessionId, usage: turn.usage.normalized, wallTimeSeconds: turn.result.wallTimeSeconds }));
}

async function runTurn({ executable, args, cwd, input, timeoutSeconds, outputDirectory, cliVersion, model, expectedSessionId, round, env }) {
  const suffix = round === 0 ? '' : `-resume-${round}`;
  const startedAt = new Date().toISOString();
  const result = await runCommand(executable, args, {
    cwd,
    input,
    timeoutSeconds,
    allowFailure: true,
    env,
    dropLine: (line) => line.startsWith(`{${STREAMED_DELTA_EVENT}`),
  });
  const finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(outputDirectory, `events${suffix}.jsonl`), result.stdout, 'utf8');
  await fs.writeFile(path.join(outputDirectory, `stderr${suffix}.log`), result.stderr, 'utf8');
  await writeJson(path.join(outputDirectory, `command${suffix}.json`), {
    executable,
    arguments: args,
    cliVersion: cliVersion.stdout.trim(),
    cliVersionStderr: cliVersion.stderr,
    workingDirectory: cwd,
    startedAt,
    finishedAt,
    wallTimeSeconds: result.wallTimeSeconds,
    timeoutSeconds,
    exitCode: result.code,
    timedOut: result.timedOut,
  });
  const usage = extractUsage(result.stdout, model, expectedSessionId);
  await writeJson(path.join(outputDirectory, `raw-usage${suffix}.json`), usage);
  if (round > 0) await fs.writeFile(path.join(outputDirectory, `final-message${suffix}.md`), usage.finalMessage, 'utf8');
  return { result, usage, startedAt, finishedAt };
}

function remainingTime(deadline) {
  return deadline === Infinity ? Infinity : Math.max(0, deadline - Date.now());
}

function remainingTimeoutSeconds(deadline) {
  if (deadline === Infinity) return undefined;
  return Math.max(1, Math.floor(remainingTime(deadline) / 1_000));
}

// A project-provisioned key in the repository `.env` wins over pi's stored credential so a benchmark
// run bills the account the operator provisioned for it. Only the resolved source is recorded; the
// key itself is never written to a run artifact.
async function resolveProviderKey(provider) {
  const envVar = provider ? PROVIDER_KEY_ENV[provider] : undefined;
  if (!envVar) return { env: undefined, source: 'pi-stored-credential' };
  const fromEnv = process.env[envVar];
  if (fromEnv) return { env: { [envVar]: fromEnv }, envVar, source: 'process-env' };
  const fromDotenv = await readDotenv(path.join(ROOT, '.env'), envVar);
  if (fromDotenv) return { env: { [envVar]: fromDotenv }, envVar, source: 'repository-dotenv' };
  return { env: undefined, envVar, source: 'pi-stored-credential' };
}

async function readDotenv(dotenvPath, key) {
  let source;
  try {
    source = await fs.readFile(dotenvPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
  for (const line of source.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || match[1] !== key) continue;
    return match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
}

// pi streams one JSON event per line. Unlike the Claude and Codex counters, which restate the whole
// session on every turn, each pi `message_end` carries only that one API call's usage — so the run's
// usage is the sum across assistant messages, never the last one.
function extractUsage(eventLog, model, expectedSessionId) {
  const events = eventLog.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      fail(`pi JSON event ${index + 1} was not valid JSON: ${error.message}`);
    }
  });
  const session = events.find(({ type }) => type === 'session');
  if (!session?.id) fail('pi JSON did not report a session identifier.');
  if (expectedSessionId !== undefined && session.id !== expectedSessionId) {
    fail(`pi reported session id ${session.id}, expected the original ${expectedSessionId}.`);
  }

  const assistant = events.filter((event) => event.type === 'message_end' && event.message?.role === 'assistant');
  if (assistant.length === 0) fail('pi JSON reported no assistant message_end events to measure.');

  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
  const perModel = new Map();
  for (const [index, event] of assistant.entries()) {
    const usage = event.message.usage;
    if (!usage || typeof usage !== 'object') fail(`pi assistant message ${index + 1} carried no usage object.`);
    const input = requireCount(usage.input, `message ${index + 1} input`);
    const output = requireCount(usage.output, `message ${index + 1} output`);
    totals.inputTokens += input;
    totals.outputTokens += output;
    totals.cacheReadTokens += requireCount(usage.cacheRead ?? 0, `message ${index + 1} cacheRead`);
    totals.cacheWriteTokens += requireCount(usage.cacheWrite ?? 0, `message ${index + 1} cacheWrite`);
    totals.reasoningTokens += requireCount(usage.reasoning ?? 0, `message ${index + 1} reasoning`);

    const name = event.message.model ?? model;
    const current = perModel.get(name) ?? { outputTokens: 0, costUSD: 0 };
    current.outputTokens += output;
    current.costUSD += numberOr(usage.cost?.total, 0);
    perModel.set(name, current);
  }

  const finalMessage = assistant.at(-1).message.content
    ?.filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('\n') ?? '';

  return {
    sessionId: session.id,
    // Matched against the cost summary's per-model rows in the runner's stage split.
    initResolvedModel: assistant.at(-1).message.model ?? model,
    assistantMessageCount: assistant.length,
    finalMessage,
    normalized: {
      ...totals,
      // pi's own tally, shaped like Claude's result-event `modelUsage` so the shared cost
      // reconciliation can cross-check it against ccusage's replay of the persisted session.
      vendorFields: { modelUsage: Object.fromEntries(perModel) },
    },
  };
}

function requireCount(value, label) {
  if (!Number.isInteger(value) || value < 0) fail(`pi usage ${label} was not a non-negative integer.`);
  return value;
}

function numberOr(value, fallback) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

// pi persists its session transcript under the agent home; copy it into private controller storage
// as the run's rollout artifact. This is the same file ccusage replays to price the run.
async function captureRollout(sessionId, outputDirectory) {
  const sessionsDirectory = path.join(piHome(), 'sessions');
  try {
    let sourcePath = await findSessionFile(sessionsDirectory, sessionId);
    if (!sourcePath) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      sourcePath = await findSessionFile(sessionsDirectory, sessionId);
    }
    if (!sourcePath) return { captured: false, reason: `No pi session file found under ${sessionsDirectory} for session ${sessionId}.` };
    const content = await fs.readFile(sourcePath, 'utf8');
    await fs.writeFile(path.join(outputDirectory, 'rollout.jsonl'), content, 'utf8');
    return { captured: true, sourcePath, sha256: sha256(content) };
  } catch (error) {
    return { captured: false, reason: `Could not capture the pi session: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function piHome() {
  return process.env.PI_CODING_AGENT_DIR ? path.resolve(process.env.PI_CODING_AGENT_DIR) : path.join(os.homedir(), '.pi', 'agent');
}

async function findSessionFile(directory, sessionId) {
  const suffix = `_${sessionId}.jsonl`;
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findSessionFile(fullPath, sessionId);
      if (found) return found;
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      return fullPath;
    }
  }
  return null;
}

function parseTimeout(value) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) === 0) fail('--timeout-seconds must be a positive integer.');
  return Number(value);
}

async function primaryRepository(worktree) {
  const result = await runCommand('git', ['rev-parse', '--git-common-dir'], { cwd: worktree });
  return path.dirname(path.resolve(worktree, result.stdout.trim()));
}

async function assertDirectory(target, label) {
  let stat;
  try {
    stat = await fs.stat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`Missing ${label}: ${target}`);
    throw error;
  }
  if (!stat.isDirectory()) fail(`${label} is not a directory: ${target}`);
}

async function readFile(target, label) {
  try {
    return await fs.readFile(target, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`Missing ${label}: ${target}`);
    throw error;
  }
}

async function assertAbsent(target, label) {
  try {
    await fs.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  fail(`${label} already exists: ${target}`);
}

// `dropLine` is applied per line as stdout arrives so a dropped line is never accumulated. The
// returned `stdout` is the retained lines only, and `droppedLines` counts what was discarded.
function runCommand(executable, args, { cwd, input, timeoutSeconds, allowFailure = false, env, dropLine } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(executable, args, {
      cwd,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer;
    let droppedLines = 0;
    let pending = '';
    const keep = (line) => {
      if (dropLine(line)) { droppedLines += 1; return; }
      stdout += `${line}\n`;
    };
    child.stdout.on('data', (chunk) => {
      if (!dropLine) { stdout += chunk; return; }
      pending += chunk;
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        keep(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('spawn', () => {
      if (input !== undefined) child.stdin.end(input);
      if (timeoutSeconds) {
        killTimer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
        }, timeoutSeconds * 1_000);
      }
    });
    child.on('close', (code) => {
      if (killTimer) clearTimeout(killTimer);
      if (dropLine && pending) keep(pending);
      const result = { code: code ?? 1, stdout, stderr, timedOut, droppedLines, wallTimeSeconds: (performance.now() - startedAt) / 1_000 };
      if (result.code !== 0 && !allowFailure) reject(new Error(`${[executable, ...args].join(' ')} failed:\n${stderr || stdout}`));
      else resolve(result);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
