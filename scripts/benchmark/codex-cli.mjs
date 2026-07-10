#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
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

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage:
  npm run benchmark:codex -- \\
    --worktree <entrant-worktree> \\
    --prompt <private-rendered-prompt> \\
    --out <private-stage-directory> \\
    --model <catalog-model-slug> \\
    --effort <low|medium|high|xhigh|max|ultra> \\
    [--timeout-seconds <positive-integer>] \\
    [--codex-bin <path-or-command>]`);
    return;
  }
  if (rest.length > 0) fail(`Unexpected argument: ${rest.join(' ')}.`);
  assertOnlyOptions(options, new Set(['help', 'worktree', 'prompt', 'out', 'model', 'effort', 'timeout-seconds', 'codex-bin']));

  const worktree = path.resolve(requireOption(options, 'worktree'));
  const promptPath = path.resolve(requireOption(options, 'prompt'));
  const model = requireOption(options, 'model');
  const effort = requireOption(options, 'effort');
  if (!EFFORTS.has(effort)) fail(`Unsupported --effort: ${effort}.`);
  const timeoutSeconds = parseTimeout(options['timeout-seconds']);
  const codexBin = options['codex-bin'] ?? 'codex';
  const repositoryRoot = await primaryRepository(worktree);
  const outputDirectory = assertPrivateOrExternalPath(requireOption(options, 'out'), repositoryRoot);
  if (pathInside(outputDirectory, worktree)) fail('Codex stage output must be outside the entrant worktree.');
  await assertDirectory(worktree, 'worktree');
  const prompt = await readFile(promptPath, 'prompt');
  await assertAbsent(outputDirectory, 'stage output directory');
  await fs.mkdir(outputDirectory, { recursive: true });

  const cliVersion = await runCommand(codexBin, ['--version'], { cwd: worktree });
  const catalog = await runCommand(codexBin, ['debug', 'models', '--bundled'], { cwd: worktree });
  const modelRecord = findModel(catalog.stdout, model);
  if (!modelRecord.supported_reasoning_levels?.some(({ effort: supported }) => supported === effort)) {
    fail(`Model ${model} does not support reasoning effort ${effort}.`);
  }

  await fs.writeFile(path.join(outputDirectory, 'model-catalog.json'), catalog.stdout, 'utf8');
  await fs.writeFile(path.join(outputDirectory, 'model-catalog.stderr.log'), catalog.stderr, 'utf8');
  await writeJson(path.join(outputDirectory, 'selected-model.json'), {
    slug: modelRecord.slug,
    displayName: modelRecord.display_name,
    supportedReasoningEfforts: modelRecord.supported_reasoning_levels.map(({ effort: supported }) => supported),
    selectedReasoningEffort: effort,
  });

  const finalMessage = path.join(outputDirectory, 'final-message.md');
  const eventLog = path.join(outputDirectory, 'events.jsonl');
  const stderrLog = path.join(outputDirectory, 'stderr.log');
  const args = [
    'exec',
    '--json',
    '--color', 'never',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--strict-config',
    '-m', model,
    '-c', `model_reasoning_effort=${JSON.stringify(effort)}`,
    '-c', 'approval_policy="never"',
    '-s', 'workspace-write',
    '-C', worktree,
    '--output-last-message', finalMessage,
    '-',
  ];
  const startedAt = new Date().toISOString();
  const result = await runCommand(codexBin, args, { cwd: worktree, input: prompt, timeoutSeconds, allowFailure: true });
  const finishedAt = new Date().toISOString();
  await fs.writeFile(eventLog, result.stdout, 'utf8');
  await fs.writeFile(stderrLog, result.stderr, 'utf8');
  await writeJson(path.join(outputDirectory, 'command.json'), {
    executable: codexBin,
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

  const usage = extractUsage(result.stdout);
  await writeJson(path.join(outputDirectory, 'raw-usage.json'), usage);
  await writeJson(path.join(outputDirectory, 'result.json'), {
    result: result.code === 0 ? 'completed' : result.timedOut ? 'timed-out' : 'failed',
    exitCode: result.code,
    timedOut: result.timedOut,
    sessionId: usage.sessionId,
    usageSha256: sha256(JSON.stringify(usage)),
    eventLogSha256: sha256(result.stdout),
    stderrSha256: sha256(result.stderr),
  });

  if (result.code !== 0) process.exitCode = result.code || 1;
  else console.log(JSON.stringify({ sessionId: usage.sessionId, usage: usage.normalized, wallTimeSeconds: result.wallTimeSeconds }));
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

function findModel(source, model) {
  let catalog;
  try {
    catalog = JSON.parse(source);
  } catch (error) {
    fail(`Codex model catalog was not valid JSON: ${error.message}`);
  }
  const record = catalog.models?.find(({ slug }) => slug === model);
  if (!record) fail(`Model ${model} is not present in this Codex CLI model catalog.`);
  return record;
}

function extractUsage(eventLog) {
  const events = eventLog.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      fail(`Codex JSONL event ${index + 1} was not valid JSON: ${error.message}`);
    }
  });
  const thread = events.find(({ type }) => type === 'thread.started');
  const completion = [...events].reverse().find((event) => event.type === 'turn.completed' && isUsage(event.usage));
  if (!thread?.thread_id) fail('Codex JSONL did not report a thread.started session identifier.');
  if (!completion) fail('Codex JSONL did not report usage in a turn.completed event.');
  const raw = completion.usage;
  const inputTokens = raw.input_tokens;
  const outputTokens = raw.output_tokens;
  if (!Number.isInteger(inputTokens) || inputTokens < 0 || !Number.isInteger(outputTokens) || outputTokens < 0) {
    fail('Codex turn.completed usage did not include non-negative integer input_tokens and output_tokens.');
  }
  const vendorFields = Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === 'number'));
  return {
    sessionId: thread.thread_id,
    turnId: completion.turn_id ?? null,
    eventType: completion.type,
    raw: raw,
    normalized: {
      inputTokens,
      outputTokens,
      ...(Number.isInteger(raw.cached_input_tokens) ? { cacheReadInputTokens: raw.cached_input_tokens } : {}),
      ...(Number.isInteger(raw.reasoning_output_tokens) ? { reasoningTokens: raw.reasoning_output_tokens } : {}),
      vendorFields,
    },
  };
}

function isUsage(value) {
  return value && typeof value === 'object';
}

function runCommand(executable, args, { cwd, input, timeoutSeconds, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(executable, args, { cwd, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
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
