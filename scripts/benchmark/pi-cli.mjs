#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeBudgetDirectory, POLL_INTERVAL_MS, resumeMessage, shouldResume } from './budget.mjs';
import { parseBudgetUsd, startBudgetPoller, writeBudgetSummary } from './budget-runtime.mjs';
import { assertSandboxDependencies, findHeadlessShell, PRIMARY_REPOSITORY_ROOT, piSandboxConfig, sandboxShieldedEntries, writeSandboxGitExclude } from './entrant-sandbox.mjs';
import {
  assertOnlyOptions,
  assertPrivateOrExternalPath,
  COMPACTION_CONTINUATION_MESSAGE,
  EMPTY_COMPLETION_CONTINUATION_MESSAGE,
  MAX_EMPTY_COMPLETION_CONTINUATIONS,
  emptyCompletion,
  compactionTruncation,
  fail,
  MANUAL_RESUME_MESSAGE,
  MAX_COMPACTION_CONTINUATIONS,
  parseArgs,
  parseResumeRound,
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

// Providers registered by an installed pi extension package rather than built into pi. The stage
// runs `--no-extensions`, which skips settings-driven package discovery, so a package-provided
// provider must have its entry loaded explicitly (explicit `--extension` paths stay active under
// that flag). Paths resolve against the operator's real pi home: the isolated per-run home holds
// only the copied credential, never installed packages.
const PROVIDER_EXTENSIONS = {
  'kimi-coding': path.join(os.homedir(), '.pi/agent/npm/node_modules/pi-provider-kimi-code/index.ts'),
};

// pi applies a 4096-token output default to any model its catalog does not cover, so a
// reasoning-heavy turn is truncated mid-run and the session ends with the entrant's work unfinished.
// The stage runs `--offline` and cannot look the model up for itself, so the controller reads the
// published limits here, outside the entrant boundary, and declares them in the per-run home.
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

const PROVIDER_QUOTA_WAIT = new Set(['kimi-coding']);
const DEFAULT_QUOTA_WAIT_MS = 900_000;
const DEFAULT_QUOTA_WAIT_MAX = 50;

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
    [--sandbox <true|false>] \\
    [--timeout-seconds <positive-integer>] \\
    [--budget-usd <positive-number>] \\
    [--resume-round <integer-at-least-1>] \\
    [--pi-bin <path-or-command>]`);
    return;
  }
  if (rest.length > 0) fail(`Unexpected argument: ${rest.join(' ')}.`);
  assertOnlyOptions(options, new Set(['help', 'worktree', 'prompt', 'out', 'model', 'effort', 'provider', 'sandbox', 'timeout-seconds', 'budget-usd', 'resume-round', 'pi-bin']));
  if (options['resume-round'] !== undefined && options['budget-usd'] !== undefined) {
    fail('--resume-round cannot be combined with --budget-usd.');
  }

  const resumeRound = parseResumeRound(options['resume-round']);
  const worktree = path.resolve(requireOption(options, 'worktree'));
  const promptPath = path.resolve(requireOption(options, 'prompt'));
  const model = requireOption(options, 'model');
  const effort = requireOption(options, 'effort');
  if (!THINKING.has(effort)) fail(`Unsupported --effort: ${effort}. pi thinking levels are: ${[...THINKING].join(', ')}.`);
  const provider = options.provider;
  const sandbox = options.sandbox === undefined ? false : parseBoolean(options.sandbox, '--sandbox');
  const timeoutSeconds = parseTimeout(options['timeout-seconds']);
  const budgetUsd = parseBudgetUsd(options['budget-usd']);
  const piBin = options['pi-bin'] ?? 'pi';
  const repositoryRoot = await primaryRepository(worktree);
  const outputDirectory = assertPrivateOrExternalPath(requireOption(options, 'out'), repositoryRoot);
  if (pathInside(outputDirectory, worktree)) fail('pi stage output must be outside the entrant worktree.');
  await assertDirectory(worktree, 'worktree');
  const prompt = await readFile(promptPath, 'prompt');
  if (resumeRound === undefined) {
    await assertAbsent(outputDirectory, 'stage output directory');
    await fs.mkdir(outputDirectory, { recursive: true });
  } else {
    await assertDirectory(outputDirectory, 'existing stage output directory');
    await assertRoundArtifactsAbsent(outputDirectory, resumeRound);
  }

  const resumedSessionId = resumeRound === undefined
    ? undefined
    : await readSessionId(path.join(outputDirectory, 'events.jsonl'));
  const cliVersion = await runCommand(piBin, ['--version'], { cwd: worktree });
  const catalog = await runCommand(piBin, ['--list-models'], { cwd: worktree });
  await fs.writeFile(path.join(outputDirectory, 'model-catalog.txt'), catalog.stdout, 'utf8');
  await fs.writeFile(path.join(outputDirectory, 'model-catalog.stderr.log'), catalog.stderr, 'utf8');
  await writeJson(path.join(outputDirectory, 'selected-model.json'), {
    model,
    provider: provider ?? null,
    selectedThinkingLevel: effort,
  });

  if (provider === 'openrouter' && !catalogListsModel(catalog.stdout, model)) {
    await declareOpenRouterModel({ model, outputDirectory });
  }

  const providerExtension = provider ? PROVIDER_EXTENSIONS[provider] : undefined;
  if (providerExtension) {
    await fs.access(providerExtension).catch(() => fail(`Provider ${provider} needs its pi extension package at ${providerExtension}, which is missing. Install it in the operator pi home (pi install npm:pi-provider-kimi-code).`));
  }

  const quotaWait = provider && PROVIDER_QUOTA_WAIT.has(provider)
    ? {
      directory: path.join(outputDirectory, 'quota-wait'),
      extensionPath: fileURLToPath(new URL('./pi-quota-wait-extension.js', import.meta.url)),
      waitMs: DEFAULT_QUOTA_WAIT_MS,
      maxWaits: DEFAULT_QUOTA_WAIT_MAX,
    }
    : undefined;
  if (quotaWait) {
    await fs.mkdir(quotaWait.directory, { recursive: true });
    await writeJson(path.join(outputDirectory, 'quota-wait.json'), {
      active: true,
      provider,
      stateDirectory: 'quota-wait',
      waitMs: quotaWait.waitMs,
      maxWaits: quotaWait.maxWaits,
      extension: quotaWait.extensionPath,
    });
  }

  const credential = await resolveProviderKey(provider);
  await writeJson(path.join(outputDirectory, 'credential-source.json'), {
    provider: provider ?? null,
    envVar: credential.envVar ?? null,
    source: credential.source,
  });

  // Entrant sandbox: sandbox-runtime wraps every bash command, and the controller-owned extension also
  // enforces the filesystem boundary on pi's native file tools (which run in the harness process,
  // outside the bash sandbox). full Chrome cannot start under the sandbox seccomp filter, so the
  // self-check floor and snapshot tooling are steered to chrome-headless-shell.
  let sandboxExtensionPath;
  let sandboxConfigPath;
  let headlessShellPath;
  if (sandbox) {
    assertSandboxDependencies();
    headlessShellPath = await findHeadlessShell();
    // The deny root is the controller's primary repository, not the git-derived parent of the
    // standalone worktree (which would be the worktree itself).
    const policy = await piSandboxConfig({ worktree, repositoryRoot: PRIMARY_REPOSITORY_ROOT });
    // The sandbox materializes its shielded dotfiles inside the worktree; excluding them keeps the
    // entrant's own git-based self-checks readable.
    const gitExcludePath = await writeSandboxGitExclude(worktree);
    sandboxConfigPath = path.join(outputDirectory, 'sandbox-config.json');
    await writeJson(sandboxConfigPath, {
      mode: 'sandbox-runtime',
      worktree,
      repositoryRoot: PRIMARY_REPOSITORY_ROOT,
      shieldedEntries: sandboxShieldedEntries(),
      gitExcludePath,
      denyReadRoots: policy.filesystem.denyRead,
      allowWrite: policy.filesystem.allowWrite,
      allowRead: policy.filesystem.allowRead,
      network: policy.network,
      chromeHeadlessShell: headlessShellPath,
      runtime: policy,
    });
    sandboxExtensionPath = fileURLToPath(new URL('./pi-sandbox-extension.js', import.meta.url));
  }

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
    ...(providerExtension ? ['--extension', providerExtension] : []),
    ...(quotaWait ? ['--extension', quotaWait.extensionPath] : []),
    ...(sandboxExtensionPath ? ['--extension', sandboxExtensionPath] : []),
  ];

  let budgetDirectory;
  let poller;
  let deadline = Infinity;
  const childEnv = { ...(credential.env ?? {}) };
  if (sandbox) {
    childEnv.PARETO_RAIL_SANDBOX_CONFIG = sandboxConfigPath;
    childEnv.PUPPETEER_EXECUTABLE_PATH = headlessShellPath;
    childEnv.PARETO_RENDER_MODE = 'software';
  }
  if (quotaWait) {
    childEnv.PARETO_RAIL_QUOTA_WAIT_DIRECTORY = quotaWait.directory;
    childEnv.PARETO_RAIL_QUOTA_WAIT_MS = String(quotaWait.waitMs);
    childEnv.PARETO_RAIL_QUOTA_WAIT_MAX = String(quotaWait.maxWaits);
  }
  if (budgetUsd !== undefined) {
    budgetDirectory = path.join(outputDirectory, 'budget');
    await initializeBudgetDirectory(budgetDirectory, budgetUsd);
    childEnv.PARETO_RAIL_BUDGET_DIRECTORY = budgetDirectory;
    const extensionPath = fileURLToPath(new URL('./pi-budget-extension.js', import.meta.url));
    sharedArgs.push('--extension', extensionPath);
    poller = startBudgetPoller({ adapter: 'pi-cli', home: piHome(), budgetDirectory, budgetUsd, intervalMs: POLL_INTERVAL_MS });
  }

  if (timeoutSeconds !== undefined) deadline = Date.now() + timeoutSeconds * 1_000;
  // Round 0 is the launch; every later round is a resume of the same session, whatever prompted it.
  let round = resumeRound ?? 0;
  const eventLogs = Array.from({ length: round }, (_, index) => ({ path: roundEventLog(index), droppedLines: 0 }));
  let turn = await runTurn({
    executable: piBin,
    args: round === 0 ? sharedArgs : [...sharedArgs, '--session', resumedSessionId],
    cwd: worktree,
    input: round === 0 ? prompt : MANUAL_RESUME_MESSAGE,
    timeoutSeconds,
    outputDirectory,
    cliVersion,
    model,
    expectedSessionId: resumedSessionId,
    round,
    env: childEnv,
  });
  eventLogs.push({ path: roundEventLog(round), droppedLines: turn.result.droppedLines });
  const sessionId = turn.usage.sessionId;
  const finalMessage = path.join(outputDirectory, 'final-message.md');
  await fs.writeFile(finalMessage, turn.usage.finalMessage, 'utf8');

  // WORKAROUND for https://github.com/PrimeIntellect-ai/prime-agent/issues/674, which pi shares: a
  // headless session ends at its first threshold compaction with the entrant's work unfinished.
  // Resuming the session puts the entrant back where it was, with its compacted context and its
  // worktree, so the adapter does it rather than leaving a long run to die at its first compaction.
  // This is not the budget protocol's continuation: it only ever repairs a stop pi should not have
  // made. Delete it, and its detector in common.mjs, once the upstream issue is fixed.
  const compactionContinuations = [];
  // A resumed round that does no tool work is an entrant with nothing left to do, so the compaction it
  // stopped at cost the run nothing and further rounds would only repeat "done".
  let compactionSettled = false;
  const continueThroughCompaction = async () => {
    compactionSettled = false;
    while (turn.usage.truncation && compactionContinuations.length < MAX_COMPACTION_CONTINUATIONS && remainingTime(deadline) > 0) {
      const reason = turn.usage.truncation;
      console.warn(`[workaround] pi stopped early: ${reason}. Resuming the same session (round ${round + 1}). This works around https://github.com/PrimeIntellect-ai/prime-agent/issues/674 and should be removed once that is fixed.`);
      const startedAt = new Date().toISOString();
      round += 1;
      turn = await runTurn({
        executable: piBin,
        args: [...sharedArgs, '--session', sessionId],
        cwd: worktree,
        input: COMPACTION_CONTINUATION_MESSAGE,
        timeoutSeconds: remainingTimeoutSeconds(deadline),
        outputDirectory,
        cliVersion,
        model,
        expectedSessionId: sessionId,
        round,
        env: childEnv,
      });
      eventLogs.push({ path: roundEventLog(round), droppedLines: turn.result.droppedLines });
      await fs.writeFile(finalMessage, turn.usage.finalMessage, 'utf8');
      compactionContinuations.push({ round, reason, startedAt, finishedAt: turn.finishedAt, exitCode: turn.result.code, toolCalls: turn.usage.toolCalls });
      if (turn.result.code !== 0) break;
      if (turn.usage.toolCalls === 0) {
        compactionSettled = true;
        break;
      }
    }
  };
  await continueThroughCompaction();

  // A turn that ends on an empty completion left the assignment unfinished, so the adapter resumes the
  // same session rather than handing the controller a stage that looks complete. Unlike the compaction
  // loop it does not stop when a round makes no tool call: an empty turn makes none by definition, and
  // treating that as "nothing left to do" would accept the very stop being repaired. It gives up at
  // MAX_EMPTY_COMPLETION_CONTINUATIONS and leaves the outcome to the gates.
  const emptyCompletionContinuations = [];
  while (turn.usage.emptyCompletion && emptyCompletionContinuations.length < MAX_EMPTY_COMPLETION_CONTINUATIONS && remainingTime(deadline) > 0 && turn.result.code === 0) {
    const { reason, responseId } = turn.usage.emptyCompletion;
    console.warn(`pi ended a turn on an empty completion (${reason}${responseId ? `, responseId ${responseId}` : ''}). Resuming the same session (round ${round + 1}).`);
    const startedAt = new Date().toISOString();
    round += 1;
    turn = await runTurn({
      executable: piBin,
      args: [...sharedArgs, '--session', sessionId],
      cwd: worktree,
      input: EMPTY_COMPLETION_CONTINUATION_MESSAGE,
      timeoutSeconds: remainingTimeoutSeconds(deadline),
      outputDirectory,
      cliVersion,
      model,
      expectedSessionId: sessionId,
      round,
      env: childEnv,
    });
    eventLogs.push({ path: roundEventLog(round), droppedLines: turn.result.droppedLines });
    await fs.writeFile(finalMessage, turn.usage.finalMessage, 'utf8');
    emptyCompletionContinuations.push({ round, reason, responseId, startedAt, finishedAt: turn.finishedAt, exitCode: turn.result.code, toolCalls: turn.usage.toolCalls });
    // A compaction stop can land inside a recovered round, so repair it before testing the next one.
    if (turn.result.code === 0) await continueThroughCompaction();
  }

  const resumes = [];
  let finalSpend;
  if (budgetUsd !== undefined && turn.result.code === 0 && !turn.usage.truncation) {
    finalSpend = await poller.refresh();
    while (shouldResume({ finalFraction: finalSpend.fraction, roundsUsed: resumes.length, remainingMs: remainingTime(deadline) })) {
      const resumeStartedAt = new Date().toISOString();
      round += 1;
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
      eventLogs.push({ path: roundEventLog(round), droppedLines: turn.result.droppedLines });
      resumes.push({
        round,
        spentUsd: finalSpend.spentUsd,
        fraction: finalSpend.fraction,
        startedAt: resumeStartedAt,
        finishedAt: turn.finishedAt,
        exitCode: turn.result.code,
      });
      if (turn.result.code !== 0) break;
      // A budget round can be cut short by the same compaction stop; repair it before measuring spend.
      await continueThroughCompaction();
      if (turn.result.code !== 0 || turn.usage.truncation) break;
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
  const truncation = compactionSettled ? null : turn.usage.truncation ?? null;
  await writeJson(path.join(outputDirectory, 'result.json'), {
    result: truncation ? 'truncated' : turn.usage.emptyCompletion ? 'empty-completion' : turn.result.code === 0 ? 'completed' : turn.result.timedOut ? 'timed-out' : 'failed',
    ...(truncation ? { truncation } : {}),
    ...(compactionContinuations.length > 0 ? { compactionContinuations, compactionSettled, compactionWorkaround: 'https://github.com/PrimeIntellect-ai/prime-agent/issues/674' } : {}),
    ...(emptyCompletionContinuations.length > 0 ? { emptyCompletionContinuations, emptyCompletionCleared: !turn.usage.emptyCompletion } : {}),
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

  if (turn.usage.emptyCompletion) {
    console.error(`pi ended on an empty completion after ${emptyCompletionContinuations.length} resume${emptyCompletionContinuations.length === 1 ? '' : 's'}: ${turn.usage.emptyCompletion.reason}. The session is intact, so resume it with --continue-stage true rather than relaunching.`);
    process.exitCode = 1;
  } else if (truncation) {
    console.error(`pi stopped before the entrant finished: ${truncation}. Automatic continuation did not clear it after ${compactionContinuations.length} round${compactionContinuations.length === 1 ? '' : 's'}; the session is intact, so resume it with --continue-stage true rather than relaunching.`);
    process.exitCode = 1;
  } else if (turn.result.code !== 0) process.exitCode = turn.result.code || 1;
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

function roundEventLog(round) {
  return round === 0 ? 'events.jsonl' : `events-resume-${round}.jsonl`;
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
export function extractUsage(eventLog, model, expectedSessionId) {
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
  const toolCalls = events.filter((event) => event.type === 'tool_execution_start').length;

  const totals ={ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
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

  // pi exits zero even when the provider terminates the session mid-run: the failure surfaces only
  // as a final assistant message with `stopReason: "error"` and zeroed usage. That is a dead stage,
  // not a completion — fail it so the controller stops for infrastructure classification instead of
  // sealing and gating a half-built worktree.
  const lastMessage = assistant.at(-1).message;
  if (lastMessage.stopReason === 'error') {
    fail(`pi ended on a provider error: ${lastMessage.errorMessage ?? 'final assistant message carried stopReason "error" with no errorMessage'}`);
  }

  // A turn that exhausts its output allowance comes back with `stopReason: "length"`, and when that
  // truncation leaves no tool call pi ends the agent loop rather than continuing the turn — so the
  // stage is a half-built worktree wearing a completion, exactly as a provider error is. Fail it for
  // the same reason. This is deliberately not repaired by resuming the session: a truncated turn
  // means the model's output allowance is wrong for the configuration, which is worth surfacing
  // rather than working around. A length stop that pi followed with a compaction is left to the
  // compaction continuation below, which already puts the entrant back to work.
  const compaction = compactionTruncation(events);
  if (!compaction && lastMessage.stopReason === 'length' && !lastMessage.content?.some((block) => block?.type === 'toolCall')) {
    const usage = lastMessage.usage ?? {};
    fail(`pi ended on a truncated turn: the final assistant message hit its output limit at ${usage.output ?? 'an unknown number of'} output tokens (${usage.reasoning ?? 0} reasoning) and made no tool call. Check the model's max output in the stage's model-catalog.txt.`);
  }

  const finalMessage = lastMessage.content
    ?.filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('\n') ?? '';

  return {
    sessionId: session.id,
    ...(compaction ? { truncation: compaction } : {}),
    ...(emptyCompletion(lastMessage) ? { emptyCompletion: emptyCompletion(lastMessage) } : {}),
    toolCalls,
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

// A model pi already knows is left alone: its catalog entry carries a reasoning level map and
// compatibility flags this declaration does not reproduce, and the copied model store already gives
// it the right limits. Only a model pi has never heard of is declared, and only from what OpenRouter
// publishes for it — the fetched record is written beside the stage so the run shows what applied.
export function catalogListsModel(catalog, model) {
  return catalog.split('\n').some((line) => line.trim().split(/\s+/)[1] === model);
}

async function declareOpenRouterModel({ model, outputDirectory }) {
  let listed;
  try {
    const response = await fetch(OPENROUTER_MODELS_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    listed = (await response.json()).data?.find((candidate) => candidate.id === model);
  } catch (error) {
    fail(`pi's model catalog does not cover ${model}, and the OpenRouter model list could not be read to supply its limits: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!listed) fail(`pi's model catalog does not cover ${model}, and OpenRouter does not list it either.`);
  const contextWindow = listed.context_length;
  const maxTokens = listed.top_provider?.max_completion_tokens;
  if (!contextWindow || !maxTokens) {
    fail(`OpenRouter lists ${model} without both a context length and a maximum completion length, so pi would fall back to its 4096-token output default.`);
  }
  const reasoning = (listed.supported_parameters ?? []).some((parameter) => parameter === 'reasoning' || parameter === 'reasoning_effort');
  const declaration = {
    providers: {
      openrouter: {
        api: 'openai-completions',
        baseUrl: 'https://openrouter.ai/api/v1',
        models: [{
          id: model,
          name: listed.name ?? model,
          reasoning,
          // pi's own vocabulary, minus the two levels OpenRouter's reasoning effort has no value for.
          ...(reasoning ? { thinkingLevelMap: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: null } } : {}),
          input: (listed.architecture?.input_modalities ?? ['text']).filter((modality) => modality === 'text' || modality === 'image'),
          contextWindow,
          maxTokens,
          compat: { thinkingFormat: 'openrouter' },
        }],
      },
    },
  };
  await writeJson(path.join(piHome(), 'models.json'), declaration);
  await writeJson(path.join(outputDirectory, 'model-declaration.json'), {
    reason: `pi's model catalog does not cover ${model}`,
    source: OPENROUTER_MODELS_URL,
    fetchedAt: new Date().toISOString(),
    contextWindow,
    maxTokens,
    declaration,
  });
  console.error(`pi's catalog does not cover ${model}; declared it from OpenRouter at ${contextWindow} context and ${maxTokens} max output.`);
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

async function assertRoundArtifactsAbsent(outputDirectory, round) {
  const suffix = `-resume-${round}`;
  for (const name of [`events${suffix}.jsonl`, `stderr${suffix}.log`, `command${suffix}.json`, `raw-usage${suffix}.json`, `final-message${suffix}.md`]) {
    await assertAbsent(path.join(outputDirectory, name), `pi resume round ${round} artifact ${name}`);
  }
}

async function readSessionId(eventPath) {
  const source = await readFile(eventPath, 'existing pi session event log');
  for (const [index, line] of source.split('\n').entries()) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      fail(`pi session event ${index + 1} was not valid JSON: ${error.message}`);
    }
    if (event?.type === 'session' && event.id) return event.id;
  }
  fail(`Existing pi session event log did not report a session identifier: ${eventPath}`);
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
