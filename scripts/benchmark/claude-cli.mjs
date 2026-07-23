#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeBudgetDirectory, POLL_INTERVAL_MS, resumeMessage, shouldResume } from './budget.mjs';
import { parseBudgetUsd, shellQuote, startBudgetPoller, writeBudgetSummary } from './budget-runtime.mjs';
import { assertSandboxDependencies, findHeadlessShell, PRIMARY_REPOSITORY_ROOT } from './entrant-sandbox.mjs';
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
  // Disable 600s wait ceiling for background subagent tasks.
  process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = '0';
  // Enable watchdog for resilient API request retries.
  process.env.CLAUDE_CODE_RETRY_WATCHDOG = '1';

  const { options, rest } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage:
  npm run benchmark:claude -- \\
    --worktree <entrant-worktree> \\
    --prompt <private-rendered-prompt> \\
    --out <private-stage-directory> \\
    --model <model-alias-or-full-name> \\
    --effort <low|medium|high|xhigh|max> \\
    [--sandbox <true|false>] \\
    [--timeout-seconds <positive-integer>] \\
    [--budget-usd <positive-number>] \\
    [--claude-bin <path-or-command>]`);
    return;
  }
  if (rest.length > 0) fail(`Unexpected argument: ${rest.join(' ')}.`);
  assertOnlyOptions(options, new Set(['help', 'worktree', 'prompt', 'out', 'model', 'effort', 'sandbox', 'timeout-seconds', 'budget-usd', 'claude-bin']));

  const worktree = path.resolve(requireOption(options, 'worktree'));
  const promptPath = path.resolve(requireOption(options, 'prompt'));
  const model = requireOption(options, 'model');
  const effort = requireOption(options, 'effort');
  if (!EFFORTS.has(effort)) fail(`Unsupported --effort: ${effort}.`);
  const sandbox = options.sandbox === undefined ? false : parseBoolean(options.sandbox, '--sandbox');
  const timeoutSeconds = parseTimeout(options['timeout-seconds']);
  const budgetUsd = parseBudgetUsd(options['budget-usd']);
  const claudeBin = options['claude-bin'] ?? 'claude';
  const repositoryRoot = await primaryRepository(worktree);
  const outputDirectory = assertPrivateOrExternalPath(requireOption(options, 'out'), repositoryRoot);
  if (pathInside(outputDirectory, worktree)) fail('Claude stage output must be outside the entrant worktree.');
  await assertDirectory(worktree, 'worktree');
  const prompt = await readFile(promptPath, 'prompt');
  await assertAbsent(outputDirectory, 'stage output directory');
  await fs.mkdir(outputDirectory, { recursive: true });

  // Entrant sandbox: Claude Code's built-in bubblewrap sandbox enforces the filesystem and network
  // boundary under --print/bypassPermissions. full Chrome cannot start under its seccomp filter, so the
  // self-check floor and snapshot tooling are steered to chrome-headless-shell, and statsig/Sentry
  // chatter is silenced since the deny-all domain list would block it noisily.
  if (sandbox) {
    assertSandboxDependencies();
    await assertNoEntrantSettingsOverride(worktree);
    process.env.PUPPETEER_EXECUTABLE_PATH = await findHeadlessShell();
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  }

  const cliVersion = await runCommand(claudeBin, ['--version'], { cwd: worktree });

  const sessionId = randomUUID();
  const finalMessage = path.join(outputDirectory, 'final-message.md');
  const printArgs = ['--print', '--output-format', 'stream-json', '--verbose'];
  const sharedArgs = [
    '--model', model,
    '--effort', effort,
    '--permission-mode', 'bypassPermissions',
    '--setting-sources', 'project',
    '--strict-mcp-config',
    // WebFetch and WebSearch run in the harness process, outside the bash sandbox — the one egress path
    // the OS network boundary cannot see — so a sandboxed run disables them at the tool level.
    ...(sandbox ? ['--disallowedTools', 'WebFetch,WebSearch'] : []),
  ];

  let budgetDirectory;
  let poller;
  let deadline = Infinity;
  // Claude Code merges one --settings file over its other sources. The budget hooks and the sandbox
  // policy both live here so a single file carries both when a run is budgeted and sandboxed.
  const settings = {};
  if (budgetUsd !== undefined) {
    budgetDirectory = path.join(outputDirectory, 'budget');
    await initializeBudgetDirectory(budgetDirectory, budgetUsd);
    const hookPath = fileURLToPath(new URL('./budget-hook.mjs', import.meta.url));
    settings.hooks = {
      PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: `node ${shellQuote(hookPath)} ${shellQuote(budgetDirectory)}` }] }],
    };
    const claudeHome = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
    poller = startBudgetPoller({ adapter: 'claude-cli', home: claudeHome, budgetDirectory, budgetUsd, intervalMs: POLL_INTERVAL_MS });
  }
  if (sandbox) {
    // Deny the controller's primary repository, not the git-derived parent of the standalone worktree
    // (which resolves to the worktree itself).
    settings.sandbox = buildSandboxSettings({ repositoryRoot: PRIMARY_REPOSITORY_ROOT, worktree, budgetDirectory });
  }
  if (Object.keys(settings).length > 0) {
    // Keep the historical budget-only path (budget/hook-settings.json) so open-policy recipes stay
    // verbatim; a sandbox-only run gets its own settings file under the stage output directory.
    const settingsPath = budgetDirectory
      ? path.join(budgetDirectory, 'hook-settings.json')
      : path.join(outputDirectory, 'sandbox-settings.json');
    await writeJson(settingsPath, settings);
    sharedArgs.push('--settings', settingsPath);
  }

  const firstArgs = [...printArgs, ...sharedArgs, '--session-id', sessionId];
  if (timeoutSeconds !== undefined) deadline = Date.now() + timeoutSeconds * 1_000;
  let turn = await runTurn({
    executable: claudeBin,
    args: firstArgs,
    cwd: worktree,
    input: prompt,
    timeoutSeconds,
    outputDirectory,
    cliVersion,
    expectedSessionId: sessionId,
    round: 0,
  });
  await fs.writeFile(finalMessage, turn.usage.finalMessage, 'utf8');
  await writeJson(path.join(outputDirectory, 'selected-model.json'), {
    requestedModel: model,
    initResolvedModel: turn.usage.initResolvedModel,
    modelUsageKeys: Object.keys(turn.usage.raw.modelUsage ?? {}),
    selectedReasoningEffort: effort,
  });

  const resumes = [];
  let finalSpend;
  if (budgetUsd !== undefined && turn.result.code === 0) {
    finalSpend = await poller.refresh();
    while (shouldResume({ finalFraction: finalSpend.fraction, roundsUsed: resumes.length, remainingMs: remainingTime(deadline) })) {
      const round = resumes.length + 1;
      const resumeStartedAt = new Date().toISOString();
      const resumeArgs = [...printArgs, '--resume', sessionId, ...sharedArgs];
      turn = await runTurn({
        executable: claudeBin,
        args: resumeArgs,
        cwd: worktree,
        input: resumeMessage(finalSpend.fraction),
        timeoutSeconds: remainingTimeoutSeconds(deadline),
        outputDirectory,
        cliVersion,
        expectedSessionId: sessionId,
        round,
      });
      await fs.writeFile(finalMessage, turn.usage.finalMessage, 'utf8');
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
  const rollout = await captureRollout(sessionId, worktree, outputDirectory);
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

// Claude Code's built-in sandbox policy. Reads are allow-by-default minus denyRead; the primary
// repository (its .git, the tracked benchmark tree, every promoted level, and — since the run output
// lives under benchmark/private — this run's harness home and its copied operator credential) and the
// host /tmp are denied, then the worktree is carved back in (it lives under /tmp). Writes are
// deny-by-default: only the worktree is writable. Network egress is empty. When the run is budgeted the
// budget directory is granted read and write too, so the PostToolUse hook can claim notices whether or
// not Claude runs hook subprocesses inside the sandbox; that directory holds only this run's own spend
// state (never the sibling harness home), so the grant does not widen what the entrant can reach.
//
// Claude merges sandbox settings from the entrant-controlled project source (the worktree's
// .claude/settings.json) regardless of --setting-sources, and allowRead/allowedDomains union across
// sources — so a planted settings file could widen the boundary or flip allowUnsandboxedCommands. The
// scrubbed baseline ships no such file (asserted before launch), and denyWrite on those two paths
// keeps the entrant from creating one mid-run or across a budget resume, so no project settings file
// ever exists to weaken the policy.
function buildSandboxSettings({ repositoryRoot, worktree, budgetDirectory }) {
  const resolvedWorktree = path.resolve(worktree);
  const worktreeGrants = [resolvedWorktree, ...(budgetDirectory ? [path.resolve(budgetDirectory)] : [])];
  return {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    filesystem: {
      denyRead: [path.resolve(repositoryRoot), '/tmp'],
      allowRead: worktreeGrants,
      allowWrite: worktreeGrants,
      denyWrite: ENTRANT_SETTINGS_FILES.map((name) => path.join(resolvedWorktree, name)),
    },
    network: { allowedDomains: [] },
  };
}

// The project settings files Claude would read from the worktree. A sandboxed run refuses to launch if
// one is present at startup and denies writing them during the run.
const ENTRANT_SETTINGS_FILES = ['.claude/settings.json', '.claude/settings.local.json'];

async function assertNoEntrantSettingsOverride(worktree) {
  for (const name of ENTRANT_SETTINGS_FILES) {
    const target = path.join(path.resolve(worktree), name);
    const present = await fs.lstat(target).then(() => true, () => false);
    if (present) fail(`Refusing to launch a sandboxed run: the entrant worktree already contains ${name}, which could widen or disable the sandbox. Investigate the baseline before running.`);
  }
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
      // Claude's terminal `usage.input_tokens` is already the uncached remainder, unlike
      // Codex's `input_tokens` (a total that includes cache hits). Add the cache-read count back
      // in so this normalized field matches the total-including-cached shape used across adapters.
      // These normalized counts are recorded for audit; run cost is measured separately by ccusage.
      inputTokens: inputTokens + (Number.isInteger(raw.cache_read_input_tokens) ? raw.cache_read_input_tokens : 0),
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
