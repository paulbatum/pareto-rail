#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage:
  npm run benchmark:claude -- \\
    --worktree <entrant-worktree> \\
    --prompt <private-rendered-prompt> \\
    --out <private-stage-directory> \\
    --model <model-alias-or-full-name> \\
    --effort <low|medium|high|xhigh|max> \\
    [--timeout-seconds <positive-integer>] \\
    [--claude-bin <path-or-command>]`);
    return;
  }
  if (rest.length > 0) fail(`Unexpected argument: ${rest.join(' ')}.`);
  assertOnlyOptions(options, new Set(['help', 'worktree', 'prompt', 'out', 'model', 'effort', 'timeout-seconds', 'claude-bin']));

  const worktree = path.resolve(requireOption(options, 'worktree'));
  const promptPath = path.resolve(requireOption(options, 'prompt'));
  const model = requireOption(options, 'model');
  const effort = requireOption(options, 'effort');
  if (!EFFORTS.has(effort)) fail(`Unsupported --effort: ${effort}.`);
  const timeoutSeconds = parseTimeout(options['timeout-seconds']);
  const claudeBin = options['claude-bin'] ?? 'claude';
  const repositoryRoot = await primaryRepository(worktree);
  const outputDirectory = assertPrivateOrExternalPath(requireOption(options, 'out'), repositoryRoot);
  if (pathInside(outputDirectory, worktree)) fail('Claude stage output must be outside the entrant worktree.');
  await assertDirectory(worktree, 'worktree');
  const prompt = await readFile(promptPath, 'prompt');
  await assertAbsent(outputDirectory, 'stage output directory');
  await fs.mkdir(outputDirectory, { recursive: true });

  const cliVersion = await runCommand(claudeBin, ['--version'], { cwd: worktree });

  const sessionId = randomUUID();
  const finalMessage = path.join(outputDirectory, 'final-message.md');
  const eventLog = path.join(outputDirectory, 'events.jsonl');
  const stderrLog = path.join(outputDirectory, 'stderr.log');
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
    '--effort', effort,
    '--permission-mode', 'bypassPermissions',
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--session-id', sessionId,
  ];
  const startedAt = new Date().toISOString();
  const result = await runCommand(claudeBin, args, { cwd: worktree, input: prompt, timeoutSeconds, allowFailure: true });
  const finishedAt = new Date().toISOString();
  await fs.writeFile(eventLog, result.stdout, 'utf8');
  await fs.writeFile(stderrLog, result.stderr, 'utf8');
  await writeJson(path.join(outputDirectory, 'command.json'), {
    executable: claudeBin,
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

  const usage = extractUsage(result.stdout, sessionId);
  await fs.writeFile(finalMessage, usage.finalMessage, 'utf8');
  await writeJson(path.join(outputDirectory, 'raw-usage.json'), usage);
  await writeJson(path.join(outputDirectory, 'selected-model.json'), {
    requestedModel: model,
    initResolvedModel: usage.initResolvedModel,
    modelUsageKeys: Object.keys(usage.raw.modelUsage ?? {}),
    selectedReasoningEffort: effort,
  });
  const rollout = await captureRollout(sessionId, worktree, outputDirectory);
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

// The terminal `result` event is the analog of Codex's `turn.completed`: it carries the
// session id, the aggregate usage object, and (via `modelUsage`) proof of the resolved
// model actually billed. `system.init.model` is a second, earlier proof point captured
// before any output, since `--model` accepts aliases that resolve to a dated snapshot.
function extractUsage(eventLog, expectedSessionId) {
  const events = eventLog.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      fail(`Claude JSONL event ${index + 1} was not valid JSON: ${error.message}`);
    }
  });
  const init = events.find((event) => event.type === 'system' && event.subtype === 'init');
  const completion = [...events].reverse().find((event) => event.type === 'result');
  if (!completion) fail('Claude JSONL did not report a terminal result event.');
  if (!completion.session_id) fail('Claude result event did not report a session id.');
  if (completion.session_id !== expectedSessionId) {
    fail(`Claude reported session id ${completion.session_id}, expected the pre-assigned ${expectedSessionId}.`);
  }
  const raw = completion.usage ?? {};
  const inputTokens = raw.input_tokens;
  const outputTokens = raw.output_tokens;
  if (!Number.isInteger(inputTokens) || inputTokens < 0 || !Number.isInteger(outputTokens) || outputTokens < 0) {
    fail('Claude result usage did not include non-negative integer input_tokens and output_tokens.');
  }
  return {
    sessionId: completion.session_id,
    initResolvedModel: init?.model ?? null,
    finalMessage: typeof completion.result === 'string' ? completion.result : '',
    eventType: completion.type,
    raw: completion,
    normalized: {
      inputTokens,
      outputTokens,
      ...(Number.isInteger(raw.cache_read_input_tokens) ? { cacheReadInputTokens: raw.cache_read_input_tokens } : {}),
      ...(Number.isInteger(raw.cache_creation_input_tokens) ? { cacheWriteInputTokens: raw.cache_creation_input_tokens } : {}),
      vendorFields: {
        totalCostUsd: completion.total_cost_usd,
        durationMs: completion.duration_ms,
        durationApiMs: completion.duration_api_ms,
        numTurns: completion.num_turns,
        stopReason: completion.stop_reason,
        subtype: completion.subtype,
        modelUsage: completion.modelUsage ?? {},
      },
    },
  };
}

// Unlike Codex, Claude Code lets the caller pre-assign the session id (`--session-id`),
// so the rollout path is deterministic rather than discovered after the fact. The
// transcript lives under `$CLAUDE_CONFIG_DIR/projects/<sanitized-worktree-path>/<sessionId>.jsonl`
// (default `~/.claude`); sanitization replaces every path separator with `-`.
async function captureRollout(sessionId, worktree, outputDirectory) {
  const claudeHome = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
  const sanitizedWorktree = path.resolve(worktree).replace(/[\\/]/g, '-');
  const sourcePath = path.join(claudeHome, 'projects', sanitizedWorktree, `${sessionId}.jsonl`);
  try {
    const content = await readRolloutWithRetry(sourcePath);
    await fs.writeFile(path.join(outputDirectory, 'rollout.jsonl'), content, 'utf8');
    return { captured: true, sourcePath, sha256: sha256(content) };
  } catch (error) {
    return { captured: false, reason: `Could not capture Claude Code rollout at ${sourcePath}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function readRolloutWithRetry(sourcePath) {
  try {
    return await fs.readFile(sourcePath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return await fs.readFile(sourcePath, 'utf8');
  }
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
