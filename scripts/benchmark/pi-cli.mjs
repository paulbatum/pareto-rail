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
    [--pi-bin <path-or-command>]`);
    return;
  }
  if (rest.length > 0) fail(`Unexpected argument: ${rest.join(' ')}.`);
  assertOnlyOptions(options, new Set(['help', 'worktree', 'prompt', 'out', 'model', 'effort', 'provider', 'timeout-seconds', 'budget-usd', 'pi-bin']));
  // Task budgets need a per-tool-use spend hook and a resume loop; pi exposes no hook surface the
  // budget poller can attach to, so a budgeted definition must not silently run unbudgeted.
  if (options['budget-usd'] !== undefined) fail('The pi adapter does not implement task budgets; register this configuration without a stage budget.');

  const worktree = path.resolve(requireOption(options, 'worktree'));
  const promptPath = path.resolve(requireOption(options, 'prompt'));
  const model = requireOption(options, 'model');
  const effort = requireOption(options, 'effort');
  if (!THINKING.has(effort)) fail(`Unsupported --effort: ${effort}. pi thinking levels are: ${[...THINKING].join(', ')}.`);
  const provider = options.provider;
  const timeoutSeconds = parseTimeout(options['timeout-seconds']);
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
  assertModelAvailable(catalog.stdout, model, provider);
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

  const args = [
    '--print',
    '--mode', 'json',
    // Trust the entrant worktree's own AGENTS.md/CLAUDE.md without a prompt, matching the Codex
    // adapter's non-interactive approval policy. The repository contracts are part of the task.
    '--approve',
    // Startup network calls (version check, extension discovery) are not part of the measured run
    // and add nondeterminism to a timed stage.
    '--offline',
    '--no-extensions',
    '--thinking', effort,
    '--model', model,
    ...(provider ? ['--provider', provider] : []),
  ];

  const startedAt = new Date().toISOString();
  const result = await runCommand(piBin, args, {
    cwd: worktree,
    input: prompt,
    timeoutSeconds,
    allowFailure: true,
    env: credential.env,
  });
  const finishedAt = new Date().toISOString();

  await fs.writeFile(path.join(outputDirectory, 'events.jsonl'), result.stdout, 'utf8');
  await fs.writeFile(path.join(outputDirectory, 'stderr.log'), result.stderr, 'utf8');
  await writeJson(path.join(outputDirectory, 'command.json'), {
    executable: piBin,
    arguments: args,
    cliVersion: cliVersion.stdout.trim(),
    cliVersionStderr: cliVersion.stderr,
    workingDirectory: worktree,
    startedAt,
    finishedAt,
    wallTimeSeconds: result.wallTimeSeconds,
    timeoutSeconds,
    exitCode: result.code,
    timedOut: result.timedOut,
  });

  const usage = extractUsage(result.stdout, model);
  await writeJson(path.join(outputDirectory, 'raw-usage.json'), usage);
  await fs.writeFile(path.join(outputDirectory, 'final-message.md'), usage.finalMessage, 'utf8');

  const rollout = await captureRollout(usage.sessionId, outputDirectory);
  await writeJson(path.join(outputDirectory, 'result.json'), {
    result: result.code === 0 ? 'completed' : result.timedOut ? 'timed-out' : 'failed',
    exitCode: result.code,
    timedOut: result.timedOut,
    sessionId: usage.sessionId,
    usageSha256: sha256(JSON.stringify(usage)),
    eventLogSha256: sha256(result.stdout),
    stderrSha256: sha256(result.stderr),
    rollout,
  });

  if (result.code !== 0) process.exitCode = result.code || 1;
  else console.log(JSON.stringify({ sessionId: usage.sessionId, usage: usage.normalized, wallTimeSeconds: result.wallTimeSeconds }));
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

// `pi --list-models` prints one whitespace-separated `<provider> <model-id> ...` row per model.
function assertModelAvailable(catalog, model, provider) {
  const rows = catalog.split('\n').map((line) => line.trim().split(/\s+/)).filter((columns) => columns.length >= 2);
  const matches = rows.filter(([, id]) => id === model || id === `~${model}`);
  if (matches.length === 0) fail(`Model ${model} is not present in this pi model catalog.`);
  if (provider && !matches.some(([name]) => name === provider)) {
    fail(`Model ${model} is not offered by provider ${provider}; pi lists it under: ${[...new Set(matches.map(([name]) => name))].join(', ')}.`);
  }
}

// pi streams one JSON event per line. Unlike the Claude and Codex counters, which restate the whole
// session on every turn, each pi `message_end` carries only that one API call's usage — so the run's
// usage is the sum across assistant messages, never the last one.
function extractUsage(eventLog, model) {
  const events = eventLog.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      fail(`pi JSON event ${index + 1} was not valid JSON: ${error.message}`);
    }
  });
  const session = events.find(({ type }) => type === 'session');
  if (!session?.id) fail('pi JSON did not report a session identifier.');

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

function runCommand(executable, args, { cwd, input, timeoutSeconds, allowFailure = false, env } = {}) {
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
    child.stdout.on('data', (chunk) => { stdout += chunk; });
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
      const result = { code: code ?? 1, stdout, stderr, timedOut, wallTimeSeconds: (performance.now() - startedAt) / 1_000 };
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
