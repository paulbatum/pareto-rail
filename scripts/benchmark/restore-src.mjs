#!/usr/bin/env node
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertOnlyOptions, fail, parseArgs, readJson, sha256, writeJson } from './common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2), { positional: true });
  if (options.help || rest.length === 0) {
    console.log(`Usage:
  npm run benchmark:restore-src -- <run-directory> --out <directory>
  npm run benchmark:restore-src -- <run-directory> --worktree <path> [--branch <branch>]`);
    return;
  }
  assertOnlyOptions(options, new Set(['help', 'out', 'worktree', 'branch']));
  if (rest.length !== 1) fail('Expected exactly one run directory.');
  if (Boolean(options.out) === Boolean(options.worktree)) fail('Specify exactly one of --out or --worktree.');

  const runDirectory = path.resolve(rest[0]);
  const definition = await readJson(path.join(runDirectory, 'run-definition.json'));
  const baseline = definition.baseline.entrantBaseline;
  const rolloutPath = await findRolloutJsonl(runDirectory);
  const rolloutSource = await fs.readFile(rolloutPath, 'utf8');
  const rows = rolloutSource.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const target = path.resolve(options.worktree ?? options.out);

  let createdWorktree = false;
  if (options.worktree) {
    if (!existsSync(target)) {
      const branch = options.branch ?? `benchmark-run-${definition.assignment.runId}`;
      await run('git', ['worktree', 'add', '-b', branch, target, baseline], ROOT);
      createdWorktree = true;
    }
    const actualBaseline = (await run('git', ['merge-base', '--is-ancestor', baseline, 'HEAD'], target, { allowFailure: true })).code;
    if (actualBaseline !== 0) fail(`Recovery worktree is not based on ${baseline}.`);
  } else {
    await fs.mkdir(target, { recursive: true });
  }

  const successfulToolIds = new Set();
  const resultSnapshots = new Map();
  for (const row of rows) {
    const message = row.message;
    for (const content of Array.isArray(message?.content) ? message.content : []) {
      if (content.type !== 'tool_result' || content.is_error) continue;
      if (typeof content.content === 'string' && content.content.startsWith('<tool_use_error>')) continue;
      successfulToolIds.add(content.tool_use_id);
      if (row.toolUseResult) resultSnapshots.set(content.tool_use_id, row.toolUseResult);
    }
  }

  const contents = new Map();
  const touched = new Set();
  async function current(relativePath, snapshot) {
    if (contents.has(relativePath)) return contents.get(relativePath);
    if (typeof snapshot?.originalFile === 'string') {
      contents.set(relativePath, snapshot.originalFile);
      return snapshot.originalFile;
    }
    try {
      const source = options.worktree
        ? await fs.readFile(path.join(target, relativePath), 'utf8')
        : (await run('git', ['show', `${baseline}:${relativePath}`], ROOT)).stdout;
      contents.set(relativePath, source);
      return source;
    } catch {
      contents.set(relativePath, '');
      return '';
    }
  }

  for (const row of rows) {
    const message = row.message;
    for (const content of Array.isArray(message?.content) ? message.content : []) {
      if (content.type !== 'tool_use' || !successfulToolIds.has(content.id)) continue;
      if (!['Write', 'Edit'].includes(content.name)) continue;
      const input = content.input ?? {};
      const relativePath = entrantRelativePath(input.file_path, definition.worktree.path);
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) continue;
      const snapshot = resultSnapshots.get(content.id);
      if (content.name === 'Write') {
        contents.set(relativePath, input.content);
      } else {
        let source = await current(relativePath, snapshot);
        const oldString = input.old_string;
        if (input.replace_all) {
          if (!source.includes(oldString)) fail(`Successful edit could not be replayed for ${relativePath}.`);
          source = source.split(oldString).join(input.new_string);
        } else {
          const matches = source.split(oldString).length - 1;
          if (matches !== 1) fail(`Successful edit expected one match in ${relativePath}, found ${matches}.`);
          source = source.replace(oldString, input.new_string);
        }
        contents.set(relativePath, source);
      }
      touched.add(relativePath);
    }
  }

  for (const relativePath of [...touched].sort()) {
    const destination = path.join(target, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents.get(relativePath), 'utf8');
    console.log(`Restored ${relativePath}`);
  }

  const record = {
    schemaVersion: 1,
    recoveredAt: new Date().toISOString(),
    runId: definition.assignment.runId,
    entrantBaseline: baseline,
    rolloutPath: path.relative(runDirectory, rolloutPath),
    rolloutSha256: sha256(rolloutSource),
    target,
    createdWorktree,
    restoredPaths: [...touched].sort(),
  };
  await writeJson(path.join(runDirectory, 'source-recovery.json'), record);
  console.log(JSON.stringify({ restored: touched.size, target, createdWorktree }));
}

function entrantRelativePath(filePath, worktreePath) {
  if (typeof filePath !== 'string') return null;
  if (worktreePath && (filePath === worktreePath || filePath.startsWith(`${worktreePath}/`))) return path.relative(worktreePath, filePath);
  const match = filePath.match(/\/tmp\/(?:raild|pareto-rail)-run-[^/]+\/(.+)$/);
  return match?.[1] ?? null;
}

async function findRolloutJsonl(runDirectory) {
  const projectsDirectory = path.join(runDirectory, 'harness-home', 'projects');
  const projectEntries = await fs.readdir(projectsDirectory, { withFileTypes: true });
  const candidates = [];
  for (const project of projectEntries) {
    if (!project.isDirectory()) continue;
    for (const name of await fs.readdir(path.join(projectsDirectory, project.name))) {
      if (name.endsWith('.jsonl')) candidates.push(path.join(projectsDirectory, project.name, name));
    }
  }
  if (candidates.length !== 1) fail(`Expected one rollout JSONL under ${projectsDirectory}, found ${candidates.length}.`);
  return candidates[0];
}

function run(executable, args, cwd, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code !== 0 && !allowFailure) reject(new Error(`${executable} ${args.join(' ')} failed:\n${stderr || stdout}`));
      else resolve(result);
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
