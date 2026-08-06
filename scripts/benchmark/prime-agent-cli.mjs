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
  MANUAL_RESUME_MESSAGE,
  parseArgs,
  parseResumeRound,
  pathInside,
  requireOption,
  sha256,
  writeJson,
} from './common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Prime Agent is built on pi and shares its thinking levels, so the benchmark's shared `--effort`
// vocabulary maps across unchanged except for Codex's `ultra`, which has no equivalent here.
const THINKING = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

// Inherited from pi: every `message_update` repeats the whole message built so far rather than the
// new delta, so keeping them grows the streamed log with the square of a message's length. They are
// superseded by the `message_end` that closes each message with its final content and usage.
const STREAMED_DELTA_EVENT = '"type":"message_update"';

// Providers that authenticate with an API key rather than the harness's stored OAuth credential, and
// the env var each reads. A project-provisioned key in the repository `.env` takes precedence;
// absent one, the child inherits nothing and the copied credential is used.
const PROVIDER_KEY_ENV = {
  openrouter: 'OPENROUTER_API_KEY',
  openai: 'OPENAI_API_KEY',
};

// Autonomous mode keeps re-prompting the agent after a turn produces no further output, so a stage
// that enables it ends when the harness sees terminal evidence rather than when the entrant stops.
// That is an intervention of its own, not wiring: every other harness in the benchmark stops with the
// agent, and only a budgeted row is continued, by the controller, on measured spend. So it is off
// unless a row asks for it, and a row that asks should give it a gate command to stop on — without
// one there is no terminal evidence to find and it re-prompts a finished agent until a limit. Turn
// and token limits stay out of the way so wall clock bounds the stage, as it does everywhere else.
const AUTONOMOUS_MAX_CONTINUATIONS = 3;
const AUTONOMOUS_MAX_TURNS = 1_000;
const AUTONOMOUS_MAX_TOKENS = 100_000_000;

// Prime Agent stops an autonomous run when a limit is reached before the model produced terminal
// evidence, and reports that by exiting non-zero. That is an entrant that ran out of continuations,
// not a broken stage, so the adapter records it and exits zero so the run seals and gates normally.
const AUTONOMOUS_LIMIT_NOTICE = 'Autonomous run stopped before terminal evidence;';

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage:
  npm run benchmark:prime-agent -- \\
    --worktree <entrant-worktree> \\
    --prompt <private-rendered-prompt> \\
    --out <private-stage-directory> \\
    --model <model-id> \\
    --effort <off|minimal|low|medium|high|xhigh|max> \\
    [--provider <provider>] \\
    [--autonomous <true|false>] \\
    [--autonomous-gate <shell-command the harness must see pass>] \\
    [--sandbox false] \\
    [--timeout-seconds <positive-integer>] \\
    [--budget-usd <positive-number>] \\
    [--resume-round <integer-at-least-1>] \\
    [--prime-agent-bin <path-or-command>]`);
    return;
  }
  if (rest.length > 0) fail(`Unexpected argument: ${rest.join(' ')}.`);
  assertOnlyOptions(options, new Set(['help', 'worktree', 'prompt', 'out', 'model', 'effort', 'provider', 'autonomous', 'autonomous-gate', 'sandbox', 'timeout-seconds', 'budget-usd', 'resume-round', 'prime-agent-bin']));
  if (options['autonomous-gate'] !== undefined && options.autonomous !== 'true') fail('--autonomous-gate requires --autonomous true.');
  if (options['resume-round'] !== undefined && options['budget-usd'] !== undefined) {
    fail('--resume-round cannot be combined with --budget-usd.');
  }

  const resumeRound = parseResumeRound(options['resume-round']);
  const worktree = path.resolve(requireOption(options, 'worktree'));
  const promptPath = path.resolve(requireOption(options, 'prompt'));
  const model = requireOption(options, 'model');
  const effort = requireOption(options, 'effort');
  if (!THINKING.has(effort)) fail(`Unsupported --effort: ${effort}. Prime Agent thinking levels are: ${[...THINKING].join(', ')}.`);
  const provider = options.provider;
  const autonomous = options.autonomous === undefined ? false : parseBoolean(options.autonomous, '--autonomous');
  // This adapter implements no entrant sandbox; see UNSANDBOXABLE_ADAPTERS in entrant-sandbox.mjs.
  if (options.sandbox !== undefined && parseBoolean(options.sandbox, '--sandbox')) {
    fail('--sandbox true is not supported: Prime Agent executes tools in an IPython kernel and delegated subagents outside the harness process, which no per-tool wrapper confines.');
  }
  const timeoutSeconds = parseTimeout(options['timeout-seconds']);
  const budgetUsd = parseBudgetUsd(options['budget-usd']);
  const primeAgentBin = options['prime-agent-bin'] ?? 'prime-agent';
  const repositoryRoot = await primaryRepository(worktree);
  const outputDirectory = assertPrivateOrExternalPath(requireOption(options, 'out'), repositoryRoot);
  if (pathInside(outputDirectory, worktree)) fail('Prime Agent stage output must be outside the entrant worktree.');
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
  const resumedSessionFile = resumedSessionId === undefined ? undefined : await findSessionFile(primeAgentHome(), resumedSessionId);
  if (resumedSessionId !== undefined && !resumedSessionFile) fail(`No Prime Agent session file under ${primeAgentHome()} carries session ${resumedSessionId}.`);
  const cliVersion = await runCommand(primeAgentBin, ['--version'], { cwd: worktree });
  await writeJson(path.join(outputDirectory, 'selected-model.json'), {
    model,
    provider: provider ?? null,
    selectedThinkingLevel: effort,
    autonomous,
    autonomousGate: options['autonomous-gate'] ?? null,
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
    // Startup network calls (version check, extension discovery) are not part of the measured run and
    // add nondeterminism to a timed stage. Explicit `--extension` paths stay active under
    // `--no-extensions`, which lets a budgeted run load only its controller-owned notice extension.
    '--offline',
    '--no-extensions',
    '--thinking', effort,
    '--model', model,
    ...(provider ? ['--provider', provider] : []),
    ...(autonomous ? autonomousArgs(timeoutSeconds, options['autonomous-gate']) : []),
  ];

  let budgetDirectory;
  let poller;
  let deadline = Infinity;
  const childEnv = { ...(credential.env ?? {}) };
  // The per-run home starts empty, and building a kernel virtualenv inside it would download packages
  // on every stage. The operator's kernel venv is harness infrastructure rather than run state, so it
  // is shared; everything the run is measured and audited by still lives in the isolated home.
  childEnv.PRIME_AGENT_KERNEL_VENV = kernelVenv();
  if (budgetUsd !== undefined) {
    budgetDirectory = path.join(outputDirectory, 'budget');
    await initializeBudgetDirectory(budgetDirectory, budgetUsd);
    childEnv.PARETO_RAIL_BUDGET_DIRECTORY = budgetDirectory;
    // Prime Agent inherits pi's extension API, so the notice extension is the shared one.
    const extensionPath = fileURLToPath(new URL('./pi-budget-extension.js', import.meta.url));
    sharedArgs.push('--extension', extensionPath);
    poller = startBudgetPoller({ adapter: 'prime-agent-cli', home: primeAgentHome(), budgetDirectory, budgetUsd, intervalMs: POLL_INTERVAL_MS });
  }

  if (timeoutSeconds !== undefined) deadline = Date.now() + timeoutSeconds * 1_000;
  let turn;
  let eventLogs;
  if (resumeRound === undefined) {
    turn = await runTurn({
      executable: primeAgentBin,
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
    eventLogs = [{ path: 'events.jsonl', droppedLines: turn.result.droppedLines }];
  } else {
    turn = await runTurn({
      executable: primeAgentBin,
      args: [...sharedArgs, '--resume', resumedSessionFile],
      cwd: worktree,
      input: MANUAL_RESUME_MESSAGE,
      timeoutSeconds,
      outputDirectory,
      cliVersion,
      model,
      expectedSessionId: resumedSessionId,
      round: resumeRound,
      env: childEnv,
    });
    eventLogs = [
      { path: 'events.jsonl', droppedLines: 0 },
      ...Array.from({ length: resumeRound }, (_, index) => ({
        path: `events-resume-${index + 1}.jsonl`,
        droppedLines: index + 1 === resumeRound ? turn.result.droppedLines : 0,
      })),
    ];
  }
  const sessionId = turn.usage.sessionId;
  const sessionFile = resumedSessionFile ?? await findSessionFile(primeAgentHome(), sessionId);
  const finalMessage = path.join(outputDirectory, 'final-message.md');
  await fs.writeFile(finalMessage, turn.usage.finalMessage, 'utf8');

  const resumes = [];
  let finalSpend;
  if (budgetUsd !== undefined && succeeded(turn.result) && !turn.usage.truncation) {
    finalSpend = await poller.refresh();
    while (shouldResume({ finalFraction: finalSpend.fraction, roundsUsed: resumes.length, remainingMs: remainingTime(deadline) })) {
      const round = resumes.length + 1;
      const resumeStartedAt = new Date().toISOString();
      turn = await runTurn({
        executable: primeAgentBin,
        args: [...sharedArgs, '--resume', sessionFile],
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
      if (!succeeded(turn.result)) break;
      finalSpend = await poller.refresh();
    }
  }

  let budgetSummary;
  if (budgetUsd !== undefined) {
    finalSpend = await poller.refresh();
    poller.stop();
    budgetSummary = await writeBudgetSummary({ outputDirectory, budgetDirectory, budgetUsd, resumes, finalSpend });
  }

  const rollout = await captureRollout(sessionFile, sessionId, outputDirectory);
  const subagents = await captureSubagentRollouts(sessionId, outputDirectory);
  const truncation = turn.usage.truncation ?? null;
  await writeJson(path.join(outputDirectory, 'result.json'), {
    result: truncation ? 'truncated' : succeeded(turn.result) ? 'completed' : turn.result.timedOut ? 'timed-out' : 'failed',
    ...(truncation ? { truncation } : {}),
    ...(autonomousLimitReached(turn.result) ? { autonomousLimit: lastNotice(turn.result.stderr) } : {}),
    exitCode: turn.result.code,
    timedOut: turn.result.timedOut,
    sessionId: turn.usage.sessionId,
    usageSha256: sha256(JSON.stringify(turn.usage)),
    eventLogSha256: sha256(turn.result.stdout),
    stderrSha256: sha256(turn.result.stderr),
    // These are retained streams, not verbatim stdout. The complete appended transcript stays in
    // `rollout.jsonl`, which the harness persists and ccusage replays.
    eventLog: {
      retained: 'all events except message_update',
      droppedLines: eventLogs.reduce((total, event) => total + event.droppedLines, 0),
      files: eventLogs,
    },
    rollout,
    subagents,
    ...(budgetSummary ? { budget: { path: 'budget.json' } } : {}),
  });

  if (truncation) {
    console.error(`Prime Agent stopped before the entrant finished: ${truncation}. The session is intact — resume it with --continue-stage true rather than relaunching.`);
    process.exitCode = 1;
  } else if (!succeeded(turn.result)) process.exitCode = turn.result.code || 1;
  else console.log(JSON.stringify({ sessionId: turn.usage.sessionId, usage: turn.usage.normalized, wallTimeSeconds: turn.result.wallTimeSeconds }));
}

// An autonomous run that exhausted a limit exits non-zero with a notice on stderr and leaves the
// entrant's work in place, so it is a completed stage for the controller's purposes.
function succeeded(result) {
  return result.code === 0 || autonomousLimitReached(result);
}

// A headless run ends at its first threshold compaction: the harness treats the session as idle while
// compaction runs, tears the connection down, and exits zero with the entrant's task half finished
// (filed upstream). The stage looks complete and is not, so it is detected here and reported as a
// failure — which is also what makes the controller's `--continue-stage` recovery available, and that
// resumes the same session from the compacted context.
//
// Two endings, one cause. The session either shows a compaction after the agent loop's last end, or
// an aborted post-compaction turn carrying no tokens.
export function compactionTruncation(events) {
  const lastAgentEnd = events.findLastIndex((event) => event.type === 'agent_end');
  if (lastAgentEnd !== -1) {
    const trailingCompaction = events.slice(lastAgentEnd).find((event) => event.type === 'compaction_start' || event.type === 'compaction_end');
    if (trailingCompaction) return 'the session ended at a threshold compaction';
  }
  const lastAssistant = events.findLast((event) => event.type === 'message_end' && event.message?.role === 'assistant');
  if (lastAssistant?.message?.stopReason === 'aborted') {
    return `the final turn was aborted: ${lastAssistant.message.errorMessage ?? 'no error message'}`;
  }
  return null;
}

function autonomousLimitReached(result) {
  return !result.timedOut && result.stderr.includes(AUTONOMOUS_LIMIT_NOTICE);
}

function lastNotice(stderr) {
  return stderr.split('\n').filter((line) => line.includes(AUTONOMOUS_LIMIT_NOTICE)).at(-1)?.trim() ?? null;
}

function autonomousArgs(timeoutSeconds, gate) {
  return [
    '--autonomous',
    ...(gate ? ['--autonomous-gate', gate] : []),
    '--autonomous-max-continuations', String(AUTONOMOUS_MAX_CONTINUATIONS),
    '--autonomous-max-turns', String(AUTONOMOUS_MAX_TURNS),
    '--autonomous-max-tokens', String(AUTONOMOUS_MAX_TOKENS),
    ...(timeoutSeconds === undefined ? [] : ['--autonomous-timeout-ms', String(timeoutSeconds * 1_000)]),
  ];
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

// A project-provisioned key in the repository `.env` wins over the stored credential so a benchmark
// run bills the account the operator provisioned for it. Only the resolved source is recorded; the
// key itself is never written to a run artifact.
async function resolveProviderKey(provider) {
  const envVar = provider ? PROVIDER_KEY_ENV[provider] : undefined;
  if (!envVar) return { env: undefined, source: 'stored-credential' };
  const fromEnv = process.env[envVar];
  if (fromEnv) return { env: { [envVar]: fromEnv }, envVar, source: 'process-env' };
  const fromDotenv = await readDotenv(path.join(ROOT, '.env'), envVar);
  if (fromDotenv) return { env: { [envVar]: fromDotenv }, envVar, source: 'repository-dotenv' };
  return { env: undefined, envVar, source: 'stored-credential' };
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

// One JSON event per line, in pi's event shape. Each `message_end` carries only that one API call's
// usage — so the invocation's usage is the sum across assistant messages, never the last one. The
// parent session's counter does not cover delegated subagents; their spend reaches the manifest
// through ccusage's replay of the retained subagent transcripts instead.
export function extractUsage(eventLog, model, expectedSessionId) {
  const events = eventLog.split('\n').filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      fail(`Prime Agent JSON event ${index + 1} was not valid JSON: ${error.message}`);
    }
  });
  const session = events.find(({ type }) => type === 'session');
  if (!session?.id) fail('Prime Agent JSON did not report a session identifier.');
  if (expectedSessionId !== undefined && session.id !== expectedSessionId) {
    fail(`Prime Agent reported session id ${session.id}, expected the original ${expectedSessionId}.`);
  }

  const assistant = events.filter((event) => event.type === 'message_end' && event.message?.role === 'assistant');
  if (assistant.length === 0) fail('Prime Agent JSON reported no assistant message_end events to measure.');

  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
  const perModel = new Map();
  for (const [index, event] of assistant.entries()) {
    const usage = event.message.usage;
    if (!usage || typeof usage !== 'object') fail(`Prime Agent assistant message ${index + 1} carried no usage object.`);
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

  // The harness exits zero even when the provider terminates the session mid-run: the failure
  // surfaces only as a final assistant message with `stopReason: "error"` and zeroed usage. That is a
  // dead stage, not a completion — fail it so the controller stops for infrastructure classification
  // instead of sealing and gating a half-built worktree.
  const lastMessage = assistant.at(-1).message;
  if (lastMessage.stopReason === 'error') {
    fail(`Prime Agent ended on a provider error: ${lastMessage.errorMessage ?? 'final assistant message carried stopReason "error" with no errorMessage'}`);
  }

  const finalMessage = lastMessage.content
    ?.filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('\n') ?? '';

  return {
    sessionId: session.id,
    ...(compactionTruncation(events) ? { truncation: compactionTruncation(events) } : {}),
    // Matched against the cost summary's per-model rows in the runner's stage split.
    initResolvedModel: assistant.at(-1).message.model ?? model,
    assistantMessageCount: assistant.length,
    finalMessage,
    normalized: {
      ...totals,
      // The harness's own tally, shaped like Claude's result-event `modelUsage` so the shared cost
      // reconciliation can cross-check it against ccusage's replay of the persisted session.
      vendorFields: { modelUsage: Object.fromEntries(perModel) },
    },
  };
}

function requireCount(value, label) {
  if (!Number.isInteger(value) || value < 0) fail(`Prime Agent usage ${label} was not a non-negative integer.`);
  return value;
}

function numberOr(value, fallback) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

// The parent transcript, copied into private controller storage as the run's rollout artifact. This
// is the same file ccusage replays to price the parent session.
async function captureRollout(sessionFile, sessionId, outputDirectory) {
  try {
    const sourcePath = sessionFile ?? await findSessionFile(primeAgentHome(), sessionId);
    if (!sourcePath) return { captured: false, reason: `No Prime Agent session file found under ${primeAgentHome()} for session ${sessionId}.` };
    const content = await fs.readFile(sourcePath, 'utf8');
    await fs.writeFile(path.join(outputDirectory, 'rollout.jsonl'), content, 'utf8');
    return { captured: true, sourcePath, sha256: sha256(content) };
  } catch (error) {
    return { captured: false, reason: `Could not capture the Prime Agent session: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// A delegated subagent is a full session of its own, persisted beside the parent under
// `session-artifacts/<parent-session-id>/` rather than in the sessions directory. Each one is
// retained as its own rollout artifact, alongside the registry the parent wrote for them, so a
// delegated run's transcript record is as complete as a solo run's.
async function captureSubagentRollouts(sessionId, outputDirectory) {
  const artifactRoot = path.join(primeAgentHome(), 'session-artifacts', sessionId);
  const registrySource = path.join(artifactRoot, 'rlm-subagents.jsonl');
  const registry = await fs.readFile(registrySource, 'utf8').catch(() => undefined);
  if (registry === undefined) return { count: 0, files: [] };
  const destination = path.join(outputDirectory, 'subagent-rollouts');
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, 'rlm-subagents.jsonl'), registry, 'utf8');
  const files = [];
  for (const source of await sessionFiles(artifactRoot)) {
    const name = `${path.basename(path.dirname(source))}-${path.basename(source)}`;
    const content = await fs.readFile(source, 'utf8');
    await fs.writeFile(path.join(destination, name), content, 'utf8');
    files.push({ path: path.join('subagent-rollouts', name), sourcePath: source, sha256: sha256(content) });
  }
  return { count: files.length, registry: path.join('subagent-rollouts', 'rlm-subagents.jsonl'), files };
}

export function primeAgentHome() {
  return process.env.PRIME_AGENT_CODING_AGENT_DIR
    ? path.resolve(process.env.PRIME_AGENT_CODING_AGENT_DIR)
    : path.join(os.homedir(), '.prime', 'agent');
}

// The managed kernel virtualenv, shared with the operator's home rather than rebuilt per run.
function kernelVenv() {
  return process.env.PRIME_AGENT_KERNEL_VENV
    ? path.resolve(process.env.PRIME_AGENT_KERNEL_VENV)
    : path.join(os.homedir(), '.prime', 'agent', 'kernel-venv');
}

// Session files are named by their own identifier rather than the session id the event stream
// reports, so a lookup reads each candidate's header line instead of matching the file name.
export async function findSessionFile(home, sessionId) {
  for (const candidate of await sessionFiles(path.join(home, 'sessions'))) {
    if (await sessionHeaderId(candidate) === sessionId) return candidate;
  }
  return null;
}

async function sessionHeaderId(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4_096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const [firstLine] = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    const header = JSON.parse(firstLine);
    return header?.type === 'session' ? header.id : undefined;
  } catch {
    return undefined;
  } finally {
    await handle.close();
  }
}

// Every `*.jsonl` under `directory` except the subagent registry, which is a record of spawns rather
// than a transcript.
export async function sessionFiles(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await sessionFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name !== 'rlm-subagents.jsonl') found.push(fullPath);
  }
  return found.sort();
}

async function assertRoundArtifactsAbsent(outputDirectory, round) {
  const suffix = `-resume-${round}`;
  for (const name of [`events${suffix}.jsonl`, `stderr${suffix}.log`, `command${suffix}.json`, `raw-usage${suffix}.json`, `final-message${suffix}.md`]) {
    await assertAbsent(path.join(outputDirectory, name), `Prime Agent resume round ${round} artifact ${name}`);
  }
}

async function readSessionId(eventPath) {
  const source = await readFile(eventPath, 'existing Prime Agent session event log');
  for (const [index, line] of source.split('\n').entries()) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      fail(`Prime Agent session event ${index + 1} was not valid JSON: ${error.message}`);
    }
    if (event?.type === 'session' && event.id) return event.id;
  }
  fail(`Existing Prime Agent session event log did not report a session identifier: ${eventPath}`);
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
