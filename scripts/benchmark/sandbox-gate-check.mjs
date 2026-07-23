#!/usr/bin/env node
// In-sandbox gate check (gate 2 of the entrant-sandbox verification). It runs the entrant self-check
// commands — typecheck, build, and the floor check (Vite + headless Chrome on loopback) — inside the
// same sandbox-runtime policy the pi extension applies, against a pre-provisioned checkout. It proves
// the gates pass under the filesystem and network boundary and the seccomp AF_UNIX block, with Chrome
// steered to chrome-headless-shell. Dependencies must already be installed in the checkout (the
// controller runs `npm ci` unsandboxed before the stage; egress is denied inside the sandbox).
//
//   node scripts/benchmark/sandbox-gate-check.mjs --worktree <checkout> [--gates typecheck,build,check:floor]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { assertOnlyOptions, fail, parseArgs, requireOption } from './common.mjs';
import { assertSandboxDependencies, findHeadlessShell, piSandboxConfig } from './entrant-sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_GATES = ['typecheck', 'build', 'check:floor'];

async function main() {
  const { options, rest } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/benchmark/sandbox-gate-check.mjs --worktree <checkout> [--gates typecheck,build,check:floor] [--repo <primary-repo>]');
    return;
  }
  if (rest.length) fail(`Unexpected argument: ${rest.join(' ')}.`);
  assertOnlyOptions(options, new Set(['help', 'worktree', 'gates', 'repo', 'level']));
  const worktree = path.resolve(requireOption(options, 'worktree'));
  const repositoryRoot = path.resolve(options.repo ?? ROOT);
  const level = options.level ?? 'crystal-corridor';
  const gates = options.gates ? options.gates.split(',').map((gate) => gate.trim()).filter(Boolean) : DEFAULT_GATES;

  assertSandboxDependencies();
  const headlessShell = await findHeadlessShell();
  const config = await piSandboxConfig({ worktree, repositoryRoot });
  await SandboxManager.initialize(config);

  const results = [];
  for (const gate of gates) {
    // Inside the sandbox /tmp is a fresh writable tmpfs, so point TMPDIR at it (an inherited TMPDIR
    // under the now-hidden host /tmp would not exist); unset DISPLAY so Chrome's GPU probe does not
    // hang on the WSLg X socket; and steer Puppeteer to the headless shell (full Chrome cannot start
    // under the seccomp AF_UNIX block). The floor check takes a level id.
    const suffix = gate === 'check:floor' ? ` -- --level ${quote(level)}` : '';
    const command = `export TMPDIR=/tmp; unset DISPLAY; export PUPPETEER_EXECUTABLE_PATH=${quote(headlessShell)}; npm run ${gate}${suffix}`;
    const wrapped = await SandboxManager.wrapWithSandbox(command);
    process.stdout.write(`\n=== ${gate} (sandboxed) ===\n`);
    const outcome = await run('bash', ['-c', wrapped], worktree);
    results.push({ gate, code: outcome.code });
    process.stdout.write(`--- ${gate}: exit ${outcome.code} ---\n`);
  }
  await SandboxManager.reset();

  let failed = 0;
  console.log('\nSummary:');
  for (const result of results) {
    if (result.code !== 0) failed += 1;
    console.log(`  [${result.code === 0 ? 'ok  ' : 'FAIL'}] ${result.gate} (exit ${result.code})`);
  }
  if (failed) process.exitCode = 1;
}

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function run(executable, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('close', (code) => resolve({ code: code ?? 1 }));
    child.on('error', () => resolve({ code: 1 }));
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
