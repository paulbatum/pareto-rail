#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeBudgetDirectory, POLL_INTERVAL_MS, resumeMessage, shouldResume } from './budget.mjs';
import { copyLastMessage, parseBudgetUsd, shellQuote, startBudgetPoller, writeBudgetSummary } from './budget-runtime.mjs';
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
    [--budget-usd <positive-number>] \\
    [--codex-bin <path-or-command>] \\
    [--enable-multi-agent true] \\
    [--network-access <true|false>]`);
    return;
  }
  if (rest.length > 0) fail(`Unexpected argument: ${rest.join(' ')}.`);
  assertOnlyOptions(options, new Set(['help', 'worktree', 'prompt', 'out', 'model', 'effort', 'timeout-seconds', 'budget-usd', 'codex-bin', 'enable-multi-agent', 'network-access']));

  const worktree = path.resolve(requireOption(options, 'worktree'));
  const promptPath = path.resolve(requireOption(options, 'prompt'));
  const model = requireOption(options, 'model');
  const effort = requireOption(options, 'effort');
  if (!EFFORTS.has(effort)) fail(`Unsupported --effort: ${effort}.`);
  const timeoutSeconds = parseTimeout(options['timeout-seconds']);
  const budgetUsd = parseBudgetUsd(options['budget-usd']);
  const codexBin = options['codex-bin'] ?? 'codex';
  const enableMultiAgent = options['enable-multi-agent'] === 'true';
  const networkAccess = options['network-access'] === undefined ? true : parseBoolean(options['network-access'], '--network-access');
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
  const configOverrides = [
    '-m', model,
    '-c', `model_reasoning_effort=${JSON.stringify(effort)}`,
    '-c', 'approval_policy="never"',
    '-c', `sandbox_workspace_write.network_access=${networkAccess}`,
    // Delegation configurations enable the multi_agent_v2 feature so a spawned subagent can run a
    // different model than its parent. `--ignore-user-config` drops the operator's config.toml
    // (which normally carries this), so it is re-declared here as an explicit `-c` override. Without
    // it, the older spawn path silently inherits the parent model. These lines are a workaround for
    // https://github.com/openai/codex/issues/31814 and can be removed once that is fixed.
    ...(enableMultiAgent ? ['-c', 'features.multi_agent_v2.hide_spawn_agent_metadata=false', '-c', 'features.multi_agent_v2.tool_namespace="agents"'] : []),
  ];

  let budgetDirectory;
  let poller;
  let deadline = Infinity;
  let trustBypassArgs = [];
  const codexHome = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), '.codex');
  if (budgetUsd !== undefined) {
    budgetDirectory = path.join(outputDirectory, 'budget');
    await initializeBudgetDirectory(budgetDirectory, budgetUsd);
    await fs.mkdir(codexHome, { recursive: true });
    const hookPath = fileURLToPath(new URL('./budget-hook.mjs', import.meta.url));
    await writeJson(path.join(codexHome, 'hooks.json'), {
      hooks: {
        PostToolUse: [{ hooks: [{ type: 'command', command: `node ${shellQuote(hookPath)} ${shellQuote(budgetDirectory)}` }] }],
      },
    });
    trustBypassArgs = ['--dangerously-bypass-hook-trust'];
    poller = startBudgetPoller({ adapter: 'codex-cli', home: codexHome, budgetDirectory, budgetUsd, intervalMs: POLL_INTERVAL_MS });
  }

  const firstArgs = [
    'exec',
    '--json',
    '--color', 'never',
    '--ignore-user-config',
    '--ignore-rules',
    '--strict-config',
    ...configOverrides,
    ...trustBypassArgs,
    '-s', 'workspace-write',
    '-C', worktree,
    '--output-last-message', finalMessage,
    '-',
  ];
  if (timeoutSeconds !== undefined) deadline = Date.now() + timeoutSeconds * 1_000;
  let turn = await runTurn({
    executable: codexBin,
    args: firstArgs,
    cwd: worktree,
    input: prompt,
    timeoutSeconds,
    outputDirectory,
    cliVersion,
    expectedSessionId: undefined,
    round: 0,
  });
  const sessionId = turn.usage.sessionId;

  const resumes = [];
  let finalSpend;
  if (budgetUsd !== undefined && turn.result.code === 0) {
    finalSpend = await poller.refresh();
    while (shouldResume({ finalFraction: finalSpend.fraction, roundsUsed: resumes.length, remainingMs: remainingTime(deadline) })) {
      const round = resumes.length + 1;
      const resumeFinalMessage = path.join(outputDirectory, `final-message-resume-${round}.md`);
      const resumeArgs = [
        // In the pinned CLI `--color` belongs to `exec`, not the `resume` subcommand parser. Keeping
        // it before `resume` preserves color-free JSONL; placing it after the thread id exits 2.
        'exec', '--color', 'never', 'resume', sessionId,
        '--json',
        '--ignore-user-config',
        '--ignore-rules',
        '--strict-config',
        '-m', model,
        '-c', `model_reasoning_effort=${JSON.stringify(effort)}`,
        '-c', 'approval_policy="never"',
        '-c', 'sandbox_mode="workspace-write"',
        '-c', `sandbox_workspace_write.network_access=${networkAccess}`,
        ...(enableMultiAgent ? ['-c', 'features.multi_agent_v2.hide_spawn_agent_metadata=false', '-c', 'features.multi_agent_v2.tool_namespace="agents"'] : []),
        ...trustBypassArgs,
        '--output-last-message', resumeFinalMessage,
        '-',
      ];
      const resumeStartedAt = new Date().toISOString();
      turn = await runTurn({
        executable: codexBin,
        args: resumeArgs,
        cwd: worktree,
        input: resumeMessage(finalSpend.fraction),
        timeoutSeconds: remainingTimeoutSeconds(deadline),
        outputDirectory,
        cliVersion,
        expectedSessionId: sessionId,
        round,
      });
      await copyLastMessage(resumeFinalMessage, finalMessage);
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
    rollout,
    ...(budgetSummary ? { budget: { path: 'budget.json' } } : {}),
  });

  if (turn.result.code !== 0) process.exitCode = turn.result.code || 1;
  else console.log(JSON.stringify({ sessionId: turn.usage.sessionId, usage: turn.usage.normalized, wallTimeSeconds: turn.result.wallTimeSeconds }));
}

async function runTurn({ executable, args, cwd, input, timeoutSeconds, outputDirectory, cliVersion, expectedSessionId, round }) {
  const suffix = round === 0 ? '' : `-resume-${round}`;
  const startedAt = new Date().toISOString();
  const result = await runCommand(executable, args, { cwd, input, timeoutSeconds, allowFailure: true });
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
  const usage = extractUsage(result.stdout, expectedSessionId);
  await writeJson(path.join(outputDirectory, `raw-usage${suffix}.json`), usage);
  return { result, usage, startedAt, finishedAt };
}

function remainingTime(deadline) {
  return deadline === Infinity ? Infinity : Math.max(0, deadline - Date.now());
}

function remainingTimeoutSeconds(deadline) {
  if (deadline === Infinity) return undefined;
  return Math.max(1, Math.floor(remainingTime(deadline) / 1_000));
}

function parseTimeout(value) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) === 0) fail('--timeout-seconds must be a positive integer.');
  return Number(value);
}

function parseBoolean(value, label) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail(`${label} must be true or false.`);
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

function extractUsage(eventLog, expectedSessionId) {
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
  if (expectedSessionId !== undefined && thread.thread_id !== expectedSessionId) {
    fail(`Codex reported thread id ${thread.thread_id}, expected the original ${expectedSessionId}.`);
  }
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

// Without --ephemeral, Codex CLI persists its richer native session transcript
// under $CODEX_HOME. Copy it into private controller storage when available.
// The native session remains subject to the operator's normal Codex retention.
async function captureRollout(sessionId, outputDirectory) {
  const codexHome = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), '.codex');
  const sessionsDirectory = path.join(codexHome, 'sessions');
  try {
    let sourcePath = await findRolloutFile(sessionsDirectory, sessionId);
    if (!sourcePath) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      sourcePath = await findRolloutFile(sessionsDirectory, sessionId);
    }
    if (!sourcePath) return { captured: false, reason: `No rollout file found under ${sessionsDirectory} for session ${sessionId}.` };
    const content = await fs.readFile(sourcePath, 'utf8');
    await fs.writeFile(path.join(outputDirectory, 'rollout.jsonl'), content, 'utf8');
    return { captured: true, sourcePath, sha256: sha256(content) };
  } catch (error) {
    return { captured: false, reason: `Could not capture Codex rollout: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function findRolloutFile(directory, sessionId) {
  const suffix = `-${sessionId}.jsonl`;
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
      const found = await findRolloutFile(fullPath, sessionId);
      if (found) return found;
    } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith(suffix)) {
      return fullPath;
    }
  }
  return null;
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
