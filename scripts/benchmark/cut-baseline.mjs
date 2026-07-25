#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assertOnlyOptions, parseArgs, requireOption } from './common.mjs';
import { assertScrubbedBaseline, parseBuiltInLevelIds } from './baseline-policy.mjs';
import {
  BENCHMARK_SOURCE_ROOT,
  BUILT_IN_LEVEL_REGISTRY_PATH,
  LEVEL_CONTENT_ROOT,
  LEVEL_GALLERY_PATH,
  SCRUBBED_BENCHMARK_SCAFFOLD_PATHS,
  SCRUBBED_REMOVED_PATHS,
} from './protocol.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RANK_CATALOG_PATH = 'src/benchmark/rank-catalog.json';

/** Create and verify a scrubbed baseline branch without changing the operator's checkout. */
export async function cutBaseline({ repo = ROOT, source, branch }) {
  const repository = await repositoryRoot(repo);
  const sourceCommit = await git(repository, ['rev-parse', '--verify', `${source}^{commit}`]);
  await assertBranchAvailable(repository, branch);

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pareto-rail-cut-baseline-'));
  const worktree = path.join(temporaryRoot, 'worktree');
  let worktreeAdded = false;
  let branchCreated = false;
  let succeeded = false;
  try {
    await git(repository, ['worktree', 'add', '-b', branch, worktree, sourceCommit]);
    worktreeAdded = true;
    branchCreated = true;

    const registrySource = await git(repository, ['show', `${sourceCommit}:${BUILT_IN_LEVEL_REGISTRY_PATH}`]);
    const builtInIds = parseBuiltInLevelIds(registrySource);
    await scrubWorktree(worktree, builtInIds);

    await git(worktree, ['add', '--all']);
    await runProcess('git', ['commit', '-m', scrubCommitMessage(sourceCommit)], worktree);
    const scrubbedCommit = await git(worktree, ['rev-parse', 'HEAD']);
    await assertScrubbedBaseline({ repo: repository, baseline: scrubbedCommit });

    // The checkout is intentionally provisioned independently. A cut is not
    // accepted merely because the controller's node_modules happens to work.
    await runProcess('npm', ['ci'], worktree, { env: { PUPPETEER_SKIP_DOWNLOAD: 'true' } });
    await runProcess('npm', ['run', 'typecheck'], worktree);
    await runProcess('npm', ['run', 'build'], worktree);
    const status = await git(worktree, ['status', '--porcelain']);
    if (status) throw new Error(`Verification changed the scrubbed worktree:\n${status}`);

    succeeded = true;
    return { branch, sourceCommit, scrubbedCommit };
  } finally {
    if (worktreeAdded) await git(repository, ['worktree', 'remove', '--force', worktree], { allowFailure: true });
    if (branchCreated && !succeeded) await git(repository, ['branch', '-D', branch], { allowFailure: true });
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function scrubWorktree(worktree, builtInIds) {
  const benchmarkRoot = path.join(worktree, BENCHMARK_SOURCE_ROOT);
  const scaffold = new Set(SCRUBBED_BENCHMARK_SCAFFOLD_PATHS.map((name) => path.relative(BENCHMARK_SOURCE_ROOT, name)));
  for (const entry of await readDirectory(benchmarkRoot)) {
    if (!scaffold.has(entry.name)) await fs.rm(path.join(benchmarkRoot, entry.name), { recursive: true, force: true });
  }
  await fs.rm(path.join(worktree, 'benchmark'), { recursive: true, force: true });

  const contentRoot = path.join(worktree, LEVEL_CONTENT_ROOT);
  for (const entry of await readDirectory(contentRoot)) {
    if (!builtInIds.has(entry.name)) await fs.rm(path.join(contentRoot, entry.name), { recursive: true, force: true });
  }

  for (const removed of SCRUBBED_REMOVED_PATHS) {
    await fs.rm(path.join(worktree, removed), { recursive: true, force: true });
  }
  await pruneDanglingScripts(worktree);
  await pruneDanglingDocReferences(worktree);

  // The gallery is built-in only by construction; regenerating it here writes
  // the cards in this commit's registry order.
  await runProcess('npm', ['run', 'gallery'], worktree);
  await reduceRankCatalog(worktree);
}

// A scrubbed checkout must not advertise commands it can no longer run. Every
// package.json script naming a local path that the scrub removed is dropped,
// which is what the entrant sees when it reads the manifest for its workflow.
async function pruneDanglingScripts(worktree) {
  const manifestPath = path.join(worktree, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const kept = {};
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    const missing = [...command.matchAll(/(?:^|[\s'"=])((?:\.\/)?(?:scripts|src)\/[\w./-]+\.(?:mjs|js|ts|tsx))/g)]
      .map((match) => match[1].replace(/^\.\//, ''))
      .filter((candidate, index, all) => all.indexOf(candidate) === index)
      .filter((candidate) => !existsSyncish(path.join(worktree, candidate)));
    if (missing.length === 0) kept[name] = command;
  }
  manifest.scripts = kept;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

// AGENTS.md is the first file most entrants read, so a bullet pointing at a
// removed path costs real exploration effort — run-v3r4wjp8ce followed the
// benchmark/README.md pointer, hit a missing file, and lost the rest of a
// batched command to the non-zero exit.
async function pruneDanglingDocReferences(worktree) {
  for (const relative of ['AGENTS.md', 'CLAUDE.md']) {
    const docPath = path.join(worktree, relative);
    if (!await pathExists(docPath)) continue;
    const original = await fs.readFile(docPath, 'utf8');
    const kept = original.split('\n').filter((line) => !isRemovedPathListItem(line, worktree));
    if (kept.length !== original.split('\n').length) await fs.writeFile(docPath, kept.join('\n'), 'utf8');
  }
}

function isRemovedPathListItem(line, worktree) {
  if (!/^\s*[-*]\s/.test(line)) return false;
  // Only a slashed reference can dangle; a bare filename in prose names a convention.
  const referenced = [...line.matchAll(/`([\w./-]+\.(?:md|mjs|js|ts|tsx|json))`/g)]
    .map((match) => match[1])
    .filter((candidate) => candidate.includes('/'));
  return referenced.length > 0 && referenced.some((candidate) => !existsSyncish(path.join(worktree, candidate)));
}

function existsSyncish(target) {
  try { fsSync.lstatSync(target); return true; }
  catch { return false; }
}

async function reduceRankCatalog(worktree) {
  const catalogPath = path.join(worktree, RANK_CATALOG_PATH);
  if (!await pathExists(catalogPath)) return;
  await fs.writeFile(catalogPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    configurations: [],
    themes: [],
    entrants: [],
  }, null, 2)}\n`, 'utf8');
}

function scrubCommitMessage(sourceCommit) {
  return `Cut scrubbed entrant baseline from ${sourceCommit}\n\nScrubbed promoted benchmark levels, tracked benchmark records, non-built-in level content, benchmark rank catalog entries, the controller harness under scripts/benchmark, and the corpus-enumerating domain suite; dropped package.json scripts and doc list items left pointing at removed paths; regenerated the built-in-only gallery and retained only the minimum benchmark catalog scaffold required by the application build.`;
}

async function assertBranchAvailable(repo, branch) {
  const result = await gitResult(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (result.code === 0) throw new Error(`Branch already exists: ${branch}`);
}

async function repositoryRoot(candidate) {
  return git(candidate, ['rev-parse', '--show-toplevel']);
}

async function readDirectory(directory) {
  try { return await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
}

async function pathExists(filePath) {
  try { await fs.lstat(filePath); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function git(cwd, args, options = {}) {
  const result = await gitResult(cwd, args, options);
  if (result.code !== 0 && !options.allowFailure) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function gitResult(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' })
    .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
    .catch((error) => ({ code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message ?? String(error) }));
}

function runProcess(executable, args, cwd, { env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} ${args.join(' ')} failed with exit code ${code ?? 1}.`));
    });
  });
}

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run benchmark:cut-baseline -- --source <commit-ish> --branch <branch-name>');
    return;
  }
  if (rest.length) throw new Error(`Unexpected argument: ${rest.join(' ')}`);
  assertOnlyOptions(options, new Set(['help', 'source', 'branch']));
  const result = await cutBaseline({ source: requireOption(options, 'source'), branch: requireOption(options, 'branch') });
  console.log(`Scrubbed baseline commit: ${result.scrubbedCommit}`);
  console.log(`Branch: ${result.branch}`);
  console.log(`Source commit: ${result.sourceCommit}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
