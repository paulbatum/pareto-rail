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
  RUN_ID_PATTERN,
  sha256,
  writeJson,
} from './common.mjs';

async function main() {
  const { rest, options } = parseArgs(process.argv.slice(2), { positional: true });
  if (options.help || rest.length === 0) {
    console.log(`Usage:
  npm run benchmark:admin -- worktree --baseline <commit> --run-id <opaque-id> --path <path> [--branch <opaque-branch>] [--repo <path>]
  npm run benchmark:admin -- seal --worktree <path> --baseline <commit> --level-id <id> [--message <message>]
  npm run benchmark:admin -- gates --worktree <path> --baseline <commit> --level-id <id> --out <private-or-external-path>
  npm run benchmark:admin -- payload --repo <path> --materials <commit> --evaluated <commit> --level-id <id> --path <path> --branch <opaque-branch>`);
    return;
  }
  assertOnlyOptions(options, new Set(['help', 'repo', 'baseline', 'run-id', 'path', 'branch', 'worktree', 'level-id', 'message', 'out', 'materials', 'evaluated']));
  if (rest.length !== 1) fail(`Unknown controller command: ${rest.join(' ')}.`);
  const command = rest[0];
  if (command === 'worktree') return createWorktree(options);
  if (command === 'seal') return sealEvaluatedCommit(options);
  if (command === 'gates') return runGates(options);
  if (command === 'payload') return derivePayload(options);
  fail(`Unknown controller command: ${command}.`);
}

async function createWorktree(options) {
  const repo = path.resolve(options.repo ?? process.cwd());
  const baseline = requireOption(options, 'baseline');
  const runId = requireOption(options, 'run-id');
  if (!RUN_ID_PATTERN.test(runId)) fail('--run-id must be an opaque lowercase identifier of 4–64 characters.');
  const worktreePath = path.resolve(requireOption(options, 'path'));
  const branch = options.branch ?? `benchmark-run-${runId}`;
  if (pathInside(worktreePath, repo)) fail('A controller worktree must be outside the primary repository working tree.');
  await assertAbsent(worktreePath, 'worktree path');
  const baselineCommit = (await git(repo, ['rev-parse', '--verify', `${baseline}^{commit}`])).output.trim();
  await git(repo, ['worktree', 'add', '-b', branch, worktreePath, baselineCommit]);
  const actualCommit = (await git(worktreePath, ['rev-parse', 'HEAD'])).output.trim();
  if (actualCommit !== baselineCommit) fail('Created worktree does not match the requested baseline commit.');
  console.log(JSON.stringify({ worktree: worktreePath, branch, baselineCommit }));
}

async function sealEvaluatedCommit(options) {
  const worktree = path.resolve(requireOption(options, 'worktree'));
  const baseline = requireOption(options, 'baseline');
  const levelId = requireOption(options, 'level-id');
  await assertGitWorktree(worktree);
  await git(worktree, ['rev-parse', '--verify', `${baseline}^{commit}`]);
  await runCommand(worktree, 'npm', ['run', 'check:scope', '--', levelId, baseline]);

  const statusBefore = (await git(worktree, ['status', '--porcelain'])).output;
  if (statusBefore.trim()) {
    await git(worktree, ['add', '--all']);
    await git(worktree, ['commit', '-m', options.message ?? `Seal benchmark entrant ${levelId}`]);
  }
  const statusAfter = (await git(worktree, ['status', '--porcelain'])).output;
  if (statusAfter.trim()) fail('Evaluated worktree is not clean after sealing.');
  const commit = (await git(worktree, ['rev-parse', 'HEAD'])).output.trim();
  console.log(JSON.stringify({ evaluatedCommit: commit }));
}

async function runGates(options) {
  const worktree = path.resolve(requireOption(options, 'worktree'));
  const baseline = requireOption(options, 'baseline');
  const levelId = requireOption(options, 'level-id');
  const requestedOutputDirectory = requireOption(options, 'out');
  await assertGitWorktree(worktree);
  const commonGitDirectory = (await git(worktree, ['rev-parse', '--git-common-dir'])).output.trim();
  const primaryRepository = path.dirname(path.resolve(worktree, commonGitDirectory));
  const outputDirectory = assertPrivateOrExternalPath(requestedOutputDirectory, primaryRepository);
  if (pathInside(outputDirectory, worktree)) fail('Gate logs must be outside the entrant worktree.');
  await git(worktree, ['rev-parse', '--verify', `${baseline}^{commit}`]);
  const cleanBefore = (await git(worktree, ['status', '--porcelain'])).output;
  if (cleanBefore.trim()) fail('Refusing to run gates against an unsealed worktree.');
  await fs.mkdir(outputDirectory, { recursive: true });

  const commands = [
    ['typecheck', 'npm', ['run', 'typecheck']],
    ['build', 'npm', ['run', 'build']],
    ['scope', 'npm', ['run', 'check:scope', '--', levelId, baseline]],
    ['floor', 'npm', ['run', 'check:floor', '--', '--level', levelId]],
  ];
  const gates = [];
  for (const [id, executable, args] of commands) {
    const result = await runCommand(worktree, executable, args, { allowFailure: true });
    const logPath = path.join(outputDirectory, `${id}.log`);
    await fs.writeFile(logPath, result.output, 'utf8');
    gates.push({
      id,
      command: [executable, ...args].join(' '),
      status: result.code === 0 ? 'passed' : 'failed',
      exitCode: result.code,
      wallTimeSeconds: result.wallTimeSeconds,
      logPath,
      outputSha256: sha256(result.output),
    });
  }
  const dirtyAfter = (await git(worktree, ['status', '--porcelain'])).output;
  if (dirtyAfter.trim()) fail('A mechanical gate changed the sealed evaluated worktree; classify this as a controller failure.');
  const record = { evaluatedCommit: (await git(worktree, ['rev-parse', 'HEAD'])).output.trim(), gates };
  await writeJson(path.join(outputDirectory, 'gates.json'), record);
  console.log(JSON.stringify({ evaluatedCommit: record.evaluatedCommit, gates: gates.map(({ id, status }) => ({ id, status })) }));
}

async function derivePayload(options) {
  const repo = path.resolve(requireOption(options, 'repo'));
  const materials = requireOption(options, 'materials');
  const evaluated = requireOption(options, 'evaluated');
  const levelId = requireOption(options, 'level-id');
  const payloadPath = path.resolve(requireOption(options, 'path'));
  const branch = requireOption(options, 'branch');
  if (pathInside(payloadPath, repo)) fail('Payload worktree must be outside the primary repository working tree.');
  await assertAbsent(payloadPath, 'payload worktree path');
  const levelDirectory = `src/levels/${levelId}`;
  const materialsCommit = (await git(repo, ['rev-parse', '--verify', `${materials}^{commit}`])).output.trim();
  const evaluatedCommit = (await git(repo, ['rev-parse', '--verify', `${evaluated}^{commit}`])).output.trim();
  const materialTree = await git(repo, ['cat-file', '-e', `${materialsCommit}:${levelDirectory}`], { allowFailure: true });
  if (materialTree.code === 0) fail(`Payload directory already exists at the materials commit: ${levelDirectory}.`);
  await git(repo, ['cat-file', '-e', `${evaluatedCommit}:${levelDirectory}`]);
  await git(repo, ['worktree', 'add', '-b', branch, payloadPath, materialsCommit]);
  try {
    await git(payloadPath, ['checkout', evaluatedCommit, '--', levelDirectory]);
    await git(payloadPath, ['add', '--', levelDirectory]);
    await git(payloadPath, ['commit', '-m', `Extract benchmark payload ${levelId}`]);
    const payloadCommit = (await git(payloadPath, ['rev-parse', 'HEAD'])).output.trim();
    await verifyPayload(repo, materialsCommit, payloadCommit, levelDirectory);
    console.log(JSON.stringify({ payloadCommit, branch, worktree: payloadPath }));
  } catch (error) {
    throw error;
  }
}

async function verifyPayload(repo, materialsCommit, payloadCommit, levelDirectory) {
  const names = (await git(repo, ['diff', '--name-only', `${materialsCommit}..${payloadCommit}`])).output.trim().split('\n').filter(Boolean);
  if (names.length === 0) fail('Payload diff is empty.');
  if (names.some((name) => !name.startsWith(`${levelDirectory}/`))) fail('Payload diff contains a path outside the assigned level directory.');
  const statuses = (await git(repo, ['diff', '--name-status', `${materialsCommit}..${payloadCommit}`])).output.trim().split('\n').filter(Boolean);
  if (statuses.some((line) => /^(D|R)/.test(line))) fail('Payload diff deletes or renames a path.');
}

async function assertGitWorktree(directory) {
  await git(directory, ['rev-parse', '--is-inside-work-tree']);
}

async function assertAbsent(targetPath, label) {
  try {
    await fs.lstat(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  fail(`${label} already exists: ${targetPath}`);
}

function git(cwd, args, options) {
  return runCommand(cwd, 'git', args, options);
}

function runCommand(cwd, executable, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      const result = { code: code ?? 1, output, wallTimeSeconds: (performance.now() - startedAt) / 1000 };
      if (result.code !== 0 && !allowFailure) reject(new Error(`${[executable, ...args].join(' ')} failed:\n${output}`));
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
