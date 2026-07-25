#!/usr/bin/env node
// Antigravity CLI (`agy`) stage runner. agy streams no machine-readable events — `--print` emits the
// final assistant text — but it does write a readable per-conversation transcript under its `brain`
// directory: one JSON line per step with the planner's thinking, its tool calls, and each result.
// That file is this stage's rollout artifact and what the contamination audit reads. What agy still
// publishes nowhere is token usage, so this adapter reports usage as unavailable rather than
// inventing numbers. The manifest carries that gap explicitly; see the recipe for the consequences.
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

// agy selects a reasoning tier by naming it in the model id rather than through a separate flag, and
// publishes only three tiers. The benchmark's shared effort vocabulary is wider, so the two levels
// above `high` have no agy equivalent and are rejected rather than silently downgraded.
//
// `agy models` prints display labels ("Gemini 3.6 Flash (High)") to a terminal but canonical ids
// ("gemini-3.6-flash-high") when its output is piped, which is how the adapter always reads it. The
// id form is what this adapter composes, validates, and passes.
const EFFORT_TIERS = new Set(['low', 'medium', 'high']);

// agy resolves its state directory from the home directory, so the controller isolates a run by
// pointing HOME at the per-run harness home. These are the paths it keeps under that home.
const AGY_STATE = '.gemini/antigravity-cli';
const CONVERSATION_POINTER = `${AGY_STATE}/cache/last_conversations.json`;
const CONVERSATIONS_DIR = `${AGY_STATE}/conversations`;
// agy's readable per-conversation transcript lives here, keyed by the same conversation id.
const BRAIN_DIR = `${AGY_STATE}/brain`;

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage:
  npm run benchmark:agy -- \\
    --worktree <entrant-worktree> \\
    --prompt <private-rendered-prompt> \\
    --out <private-stage-directory> \\
    --model <agy-model-label-without-tier> \\
    --effort <low|medium|high> \\
    [--sandbox false] \\
    [--timeout-seconds <positive-integer>] \\
    [--agy-bin <path-or-command>]`);
    return;
  }
  if (rest.length > 0) fail(`Unexpected argument: ${rest.join(' ')}.`);
  assertOnlyOptions(options, new Set(['help', 'worktree', 'prompt', 'out', 'model', 'effort', 'sandbox', 'timeout-seconds', 'agy-bin']));

  const worktree = path.resolve(requireOption(options, 'worktree'));
  const promptPath = path.resolve(requireOption(options, 'prompt'));
  const model = requireOption(options, 'model');
  const effort = requireOption(options, 'effort');
  if (!EFFORT_TIERS.has(effort)) fail(`Unsupported --effort: ${effort}. agy publishes only: ${[...EFFORT_TIERS].join(', ')}.`);
  // agy has no OS-level sandbox and this adapter implements none. From v3 that is a warning rather
  // than a bar, so a request for isolation is refused out loud and the stage proceeds without it —
  // what must never happen is the run reporting isolation it does not have.
  if (options.sandbox !== undefined && options.sandbox !== 'false') {
    console.warn('!! The agy adapter cannot isolate an entrant, and this stage was asked to. It runs with full filesystem and network access; the contamination audit is the only control.');
  }
  const timeoutSeconds = parseTimeout(options['timeout-seconds']);
  const agyBin = options['agy-bin'] ?? 'agy';
  const repositoryRoot = await primaryRepository(worktree);
  const outputDirectory = assertPrivateOrExternalPath(requireOption(options, 'out'), repositoryRoot);
  if (pathInside(outputDirectory, worktree)) fail('agy stage output must be outside the entrant worktree.');
  await assertDirectory(worktree, 'worktree');
  const prompt = await readFile(promptPath, 'prompt');
  await assertAbsent(outputDirectory, 'stage output directory');
  await fs.mkdir(outputDirectory, { recursive: true });

  const harnessHome = agyHome();
  const cliVersion = await runCommand(agyBin, ['--version'], { cwd: worktree });

  // agy names a model with its reasoning tier baked into the id, so the tier is audited by checking
  // the composed id against the account's own published list rather than assumed.
  const catalog = await runCommand(agyBin, ['models'], { cwd: worktree, allowFailure: true });
  await fs.writeFile(path.join(outputDirectory, 'model-catalog.txt'), catalog.stdout, 'utf8');
  await fs.writeFile(path.join(outputDirectory, 'model-catalog.stderr.log'), catalog.stderr, 'utf8');
  const modelId = `${model}-${effort}`;
  const catalogIds = catalog.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  const modelInCatalog = catalogIds.includes(modelId);
  if (!modelInCatalog) {
    fail(`agy does not publish the model id "${modelId}" for this account. Available: ${catalogIds.join(', ') || '(none reported)'}.`);
  }
  await writeJson(path.join(outputDirectory, 'selected-model.json'), {
    requestedModel: model,
    selectedReasoningEffort: effort,
    resolvedModelId: modelId,
    modelInCatalog,
  });

  // The subscription credential is whatever the controller copied into this run's harness home; the
  // adapter never reads the operator's real home once HOME is redirected. Recording which one was in
  // play keeps a run whose credential went missing distinguishable from one that used the project's.
  const credentialPath = path.join(harnessHome, AGY_STATE, 'antigravity-oauth-token');
  const credentialPresent = await fs.lstat(credentialPath).then(() => true, () => false);
  await writeJson(path.join(outputDirectory, 'credential-source.json'), {
    home: harnessHome,
    isolatedHome: harnessHome !== os.homedir(),
    credentialPath,
    source: credentialPresent ? 'controller-copied-oauth-token' : 'absent-agy-will-fail-or-use-its-own',
  });

  const startedAt = new Date().toISOString();
  // agy's own --print-timeout defaults to five minutes and cuts the response off silently, so it is
  // raised to the stage timeout; the adapter's kill timer remains the authoritative bound.
  const args = [
    '--model', modelId,
    '--dangerously-skip-permissions',
    // Without this the entrant works in a scratch directory inside agy's own home and the sealed
    // worktree comes back empty: the working directory alone does not make the worktree agy's
    // workspace, even though agy keys its conversation pointer by that same path. Verified — the
    // identical prompt writes into `<home>/.gemini/antigravity-cli/scratch/` without `--add-dir` and
    // into the worktree with it.
    '--add-dir', worktree,
    ...(timeoutSeconds === undefined ? [] : ['--print-timeout', `${timeoutSeconds}s`]),
    // agy takes the prompt as a flag value rather than on stdin, so the rendered assignment is passed
    // byte-for-byte as one argument. Its hash is recorded so the delivered bytes stay auditable.
    '--print', prompt,
  ];
  const result = await runCommand(agyBin, args, { cwd: worktree, timeoutSeconds, allowFailure: true });
  const finishedAt = new Date().toISOString();

  await fs.writeFile(path.join(outputDirectory, 'final-message.md'), result.stdout, 'utf8');
  await fs.writeFile(path.join(outputDirectory, 'stderr.log'), result.stderr, 'utf8');
  await writeJson(path.join(outputDirectory, 'command.json'), {
    executable: agyBin,
    // The rendered assignment is one argument and is already captured verbatim as a run input; the
    // record keeps its hash instead of a second copy of the whole prompt.
    arguments: args.map((value) => (value === prompt ? `<rendered-assignment sha256:${sha256(prompt)}>` : value)),
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

  const sessionId = await resolveConversationId(harnessHome, worktree);
  const rollout = await captureRollout(harnessHome, sessionId, outputDirectory);

  // The controller requires an event log per stage. agy streams no events, so this is a synthesized
  // single-record log standing in for one: it carries what the process itself reported, and its hash
  // becomes the stage's output artifact hash. The run's transcript is the captured rollout, not this.
  const eventLog = `${JSON.stringify({
    type: 'agy.print.result',
    sessionId,
    model: modelId,
    exitCode: result.code,
    timedOut: result.timedOut,
    wallTimeSeconds: result.wallTimeSeconds,
    finalMessageSha256: sha256(result.stdout),
    usage: null,
    usageUnavailableReason: 'agy exposes no per-request usage through any documented interface, including its own transcript.',
  })}\n`;
  await fs.writeFile(path.join(outputDirectory, 'events.jsonl'), eventLog, 'utf8');

  // raw-usage.json carries the stage identity the controller needs. Token fields are deliberately
  // absent rather than zero: a zero would read as a measured value.
  await writeJson(path.join(outputDirectory, 'raw-usage.json'), {
    sessionId,
    initResolvedModel: modelId,
    usageAvailable: false,
    usageUnavailableReason: 'agy reports no token usage through any documented interface.',
  });

  await writeJson(path.join(outputDirectory, 'result.json'), {
    result: result.code === 0 ? 'completed' : result.timedOut ? 'timed-out' : 'failed',
    exitCode: result.code,
    timedOut: result.timedOut,
    sessionId,
    eventLogSha256: sha256(eventLog),
    finalMessageSha256: sha256(result.stdout),
    stderrSha256: sha256(result.stderr),
    rollout,
  });

  if (result.code !== 0) process.exitCode = result.code || 1;
  else console.log(JSON.stringify({ sessionId, usage: null, wallTimeSeconds: result.wallTimeSeconds }));
}

// The controller scopes a run by redirecting HOME; falling back to the operator's real home would
// silently share conversation state between runs, so the resolved home is recorded either way.
function agyHome() {
  return process.env.HOME ? path.resolve(process.env.HOME) : os.homedir();
}

// agy records the conversation it opened per workspace directory in a pointer file keyed by absolute
// path. That is the only interface it offers for naming the session it just ran.
async function resolveConversationId(harnessHome, worktree) {
  const pointerPath = path.join(harnessHome, CONVERSATION_POINTER);
  let pointer;
  try {
    pointer = JSON.parse(await fs.readFile(pointerPath, 'utf8'));
  } catch (error) {
    fail(`agy did not write its conversation pointer at ${pointerPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const conversationId = pointer[path.resolve(worktree)];
  if (!conversationId) {
    fail(`agy's conversation pointer names no conversation for ${path.resolve(worktree)}; it recorded: ${Object.keys(pointer).join(', ') || '(nothing)'}.`);
  }
  return conversationId;
}

// agy writes a readable transcript per conversation under its `brain` directory: one JSON line per
// step, carrying the planner's thinking, its tool calls as `{name, args}`, and each result with its
// exit code. That is the run's rollout artifact and what the contamination audit reads. The
// conversation database is captured alongside it as the harness's own record, but it is protobuf in
// SQLite and nothing reads it today.
async function captureRollout(harnessHome, sessionId, outputDirectory) {
  const transcriptPath = path.join(harnessHome, BRAIN_DIR, sessionId, '.system_generated/logs/transcript_full.jsonl');
  const conversationPath = path.join(harnessHome, CONVERSATIONS_DIR, `${sessionId}.db`);
  const captured = {};
  try {
    const transcript = await fs.readFile(transcriptPath, 'utf8');
    await fs.writeFile(path.join(outputDirectory, 'rollout.jsonl'), transcript, 'utf8');
    captured.transcript = { captured: true, format: 'jsonl', sourcePath: transcriptPath, sha256: sha256(transcript), steps: transcript.split('\n').filter(Boolean).length };
  } catch (error) {
    captured.transcript = { captured: false, reason: `Could not capture the agy transcript at ${transcriptPath}: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    const conversation = await fs.readFile(conversationPath);
    await fs.writeFile(path.join(outputDirectory, 'conversation.db'), conversation);
    captured.conversation = { captured: true, format: 'sqlite', sourcePath: conversationPath, sha256: sha256(conversation), replayable: false };
  } catch (error) {
    captured.conversation = { captured: false, reason: `Could not capture the agy conversation database at ${conversationPath}: ${error instanceof Error ? error.message : String(error)}` };
  }
  return captured;
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

function runCommand(executable, args, { cwd, timeoutSeconds, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer;
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('spawn', () => {
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
