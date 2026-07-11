#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs, fail } from './common.mjs';
import { loadResults } from './results.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNS_DIR = path.join(ROOT, 'benchmark/private/runs');
const ARCHIVE_DIR = path.join(ROOT, 'benchmark/private/archive/runs');

async function main() {
  const { rest, options } = parseArgs(process.argv.slice(2), { positional: true });
  if (options.help || rest.length === 0) {
    console.log(`Usage:
  npm run benchmark:manage -- status
  npm run benchmark:manage -- archive-dnf [--dry-run]`);
    return;
  }

  const command = rest[0];
  if (command === 'status') {
    return showStatus();
  } else if (command === 'archive-dnf') {
    return archiveDnf(options);
  } else {
    fail(`Unknown command: ${command}`);
  }
}

async function showStatus() {
  const results = await loadResults(RUNS_DIR, { identity: 'blind' });
  const successful = results.filter((r) => r.state === 'completed' || r.state === 'recovered');
  const failed = results.filter((r) => ['gate-failed', 'dnf', 'controller-failure', 'incomplete'].includes(r.state));

  console.log('=== Benchmark Run Status ===');
  console.log(`Successful/Completed: ${successful.length}`);
  for (const r of successful) {
    console.log(`  - ${r.runId} (${r.levelId}) [${r.state}]`);
  }
  console.log(`Failed/DNF/Incomplete: ${failed.length}`);
  for (const r of failed) {
    console.log(`  - ${r.runId} (${r.levelId}) [${r.state}]`);
  }
}

async function archiveDnf(options) {
  const dryRun = options['dry-run'] !== undefined && options['dry-run'] !== 'false';
  const results = await loadResults(RUNS_DIR, { identity: 'blind' });
  const failed = results.filter((r) => ['gate-failed', 'dnf', 'controller-failure', 'incomplete'].includes(r.state));

  if (failed.length === 0) {
    console.log('No failed or DNF runs to archive.');
    return;
  }

  console.log(`Found ${failed.length} failed/DNF run(s) to archive.`);
  if (dryRun) {
    console.log('*** DRY RUN MODE — No changes will be made ***');
  }

  await fs.mkdir(ARCHIVE_DIR, { recursive: true });

  for (const result of failed) {
    const runId = result.runId;
    const runPath = path.join(RUNS_DIR, runId);
    console.log(`\nProcessing run: ${runId} (${result.levelId ?? 'unknown level'})`);

    // 1. Clean up worktrees
    const worktreeJsonPath = path.join(runPath, 'worktree.json');
    let worktreeInfo = null;
    try {
      worktreeInfo = JSON.parse(await fs.readFile(worktreeJsonPath, 'utf8'));
    } catch {
      // Might not exist or be unreadable if failed early
    }

    const definitionJsonPath = path.join(runPath, 'run-definition.json');
    let definitionInfo = null;
    try {
      definitionInfo = JSON.parse(await fs.readFile(definitionJsonPath, 'utf8'));
    } catch {
      // Might not exist
    }

    // Extract paths and branches
    const worktreePath = worktreeInfo?.worktree ?? definitionInfo?.worktree?.path ?? `/tmp/raild-run-${runId}`;
    const worktreeBranch = worktreeInfo?.branch ?? definitionInfo?.worktree?.branch ?? `benchmark-run-${runId}`;
    const payloadPath = definitionInfo?.payload?.path ?? `/tmp/raild-payload-${runId}`;
    const payloadBranch = definitionInfo?.payload?.branch ?? `benchmark-payload-${runId}`;

    // Helper to remove a worktree and branch
    const cleanWorktree = async (wPath, wBranch) => {
      try {
        const stats = await fs.lstat(wPath);
        if (stats.isDirectory() || stats.isSymbolicLink()) {
          console.log(`  Cleaning up worktree at: ${wPath}`);
          if (!dryRun) {
            await git(ROOT, ['worktree', 'remove', '--force', wPath]);
          }
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          console.log(`  Warning: Failed to remove worktree directory ${wPath}: ${error.message}`);
        }
      }

      // Try deleting the branch
      try {
        if (!dryRun) {
          await git(ROOT, ['branch', '-D', wBranch], { allowFailure: true });
        } else {
          console.log(`  Deleting branch: ${wBranch}`);
        }
      } catch {
        // Safe to ignore if branch doesn't exist
      }
    };

    await cleanWorktree(worktreePath, worktreeBranch);
    await cleanWorktree(payloadPath, payloadBranch);

    // 2. Clean up untracked/dirty level directory in primary repo
    if (result.levelId) {
      const levelDir = path.join(ROOT, `src/levels/${result.levelId}`);
      try {
        await fs.lstat(levelDir);
        console.log(`  Removing local level folder from primary repo: src/levels/${result.levelId}`);
        if (!dryRun) {
          await fs.rm(levelDir, { recursive: true, force: true });
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          console.log(`  Warning: Failed to remove level directory ${levelDir}: ${error.message}`);
        }
      }
    }

    // 3. Move the run directory to the archive
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(ARCHIVE_DIR, `${runId}-${timestamp}`);
    console.log(`  Archiving run directory to: benchmark/private/archive/runs/${runId}-${timestamp}`);
    if (!dryRun) {
      await fs.rename(runPath, archivePath);
    }
  }

  // 4. Clean up registry changes (src/levels/index.ts) in the main repo
  console.log('\nRestoring level registry (src/levels/index.ts) to clean baseline state...');
  if (!dryRun) {
    await git(ROOT, ['checkout', '--', 'src/levels/index.ts'], { allowFailure: true });
  }

  console.log('\nCleanup and archiving completed successfully.');
}

function git(cwd, args, options) {
  return runCommand(cwd, 'git', args, options);
}

function runCommand(cwd, executable, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      const result = { code: code ?? 1, output };
      if (result.code !== 0 && !allowFailure) {
        reject(new Error(`${[executable, ...args].join(' ')} failed:\n${output}`));
      } else {
        resolve(result);
      }
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
