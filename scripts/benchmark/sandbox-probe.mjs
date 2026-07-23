#!/usr/bin/env node
// Escape probes for the pi entrant sandbox (gate 1 of the entrant-sandbox verification). It builds the
// same sandbox-runtime policy the pi extension applies and runs a fixed set of commands through
// SandboxManager.wrapWithSandbox against a scratch worktree, asserting that the primary repository and
// a fake sibling checkout are unreadable, external egress is denied, writes outside the worktree fail,
// and loopback plus in-worktree writes still work. No model and no pi process are involved, so it is
// cheap to run before the expensive in-sandbox gates. Requires bubblewrap and socat on PATH.
//
//   node scripts/benchmark/sandbox-probe.mjs [--keep]
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { assertSandboxDependencies, piSandboxConfig } from './entrant-sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function main() {
  const keep = process.argv.includes('--keep');
  assertSandboxDependencies();

  // A scratch worktree and a fake sibling checkout, both directly under /tmp like real run checkouts
  // (run.mjs names every worktree /tmp/pareto-rail-<runId>). The sandbox denies /tmp wholesale, so the
  // sibling is hidden by that tmpfs and the worktree is carved back in.
  const stamp = `${process.pid}-${Date.now()}`;
  const worktree = path.join('/tmp', `pareto-rail-probe-${stamp}`);
  const sibling = path.join('/tmp', `pareto-rail-probeother-${stamp}`);
  await fs.mkdir(worktree, { recursive: true });
  await fs.mkdir(sibling, { recursive: true });
  await fs.writeFile(path.join(worktree, 'mine.txt'), 'worktree-owned\n');
  await fs.writeFile(path.join(sibling, 'secret.txt'), 'sibling-secret\n');

  const config = await piSandboxConfig({ worktree, repositoryRoot: ROOT });
  await SandboxManager.initialize(config);

  const repoSentinel = path.join(ROOT, 'package.json');
  const siblingSecret = path.join(sibling, 'secret.txt');
  // A path the operator can write to when unsandboxed but that lies outside every grant, so a
  // successful write there would be a real read-only-bind escape. (Denied directories are tmpfs-backed
  // and thus writable-but-ephemeral inside the namespace, so they are not a valid write-escape target.)
  const outsideWrite = path.join(os.homedir(), `.pareto-rail-sandbox-escape-${stamp}`);
  const probes = [
    { name: 'read primary repository is denied', expect: 'fail', command: `cat ${quote(repoSentinel)}` },
    { name: 'read sibling checkout is denied', expect: 'fail', command: `cat ${quote(siblingSecret)}` },
    { name: 'external egress is denied', expect: 'fail', command: 'curl --silent --show-error --max-time 10 https://example.com' },
    { name: 'external DNS is denied', expect: 'fail', command: 'getent hosts example.com || nslookup example.com' },
    { name: 'loopback round-trip succeeds', expect: 'pass', command: loopbackCommand() },
    { name: 'write outside the worktree is denied', expect: 'fail', command: `printf x > ${quote(outsideWrite)}` },
    { name: 'write inside the worktree succeeds', expect: 'pass', command: `printf ok > ${quote(path.join(worktree, 'written.txt'))}` },
    { name: 'read inside the worktree succeeds', expect: 'pass', command: `cat ${quote(path.join(worktree, 'mine.txt'))}` },
  ];

  const results = [];
  for (const probe of probes) {
    const wrapped = await SandboxManager.wrapWithSandbox(probe.command);
    const outcome = await run('bash', ['-c', wrapped], worktree);
    const succeeded = outcome.code === 0;
    const ok = probe.expect === 'pass' ? succeeded : !succeeded;
    results.push({ ...probe, code: outcome.code, ok, detail: (outcome.stderr || outcome.stdout).trim().split('\n').slice(-2).join(' ') });
  }

  await SandboxManager.reset();

  // Confirm no probe leaked to the host: the outside-write target must not exist, and the sibling
  // secret must be byte-for-byte unchanged (the denied-directory write went to an ephemeral tmpfs).
  const leaked = await fs.access(outsideWrite).then(() => true, () => false);
  const siblingUnchanged = (await fs.readFile(siblingSecret, 'utf8').catch(() => '')) === 'sibling-secret\n';
  results.push({ name: 'no write escaped to the host filesystem', expect: 'pass', code: leaked ? 1 : 0, ok: !leaked, detail: leaked ? `leaked to ${outsideWrite}` : '' });
  results.push({ name: 'sibling checkout content is unmodified', expect: 'pass', code: siblingUnchanged ? 0 : 1, ok: siblingUnchanged, detail: siblingUnchanged ? '' : 'sibling secret changed' });

  if (!keep) await Promise.all([rm(worktree), rm(sibling), rm(outsideWrite)]);

  let failed = 0;
  for (const result of results) {
    const status = result.ok ? 'ok  ' : 'FAIL';
    if (!result.ok) failed += 1;
    console.log(`[${status}] ${result.name} (expect ${result.expect}, exit ${result.code})${result.ok ? '' : ` -- ${result.detail}`}`);
  }
  console.log(`\n${results.length - failed}/${results.length} probes passed.`);
  if (failed) process.exitCode = 1;
}

function loopbackCommand() {
  // Bind an ephemeral HTTP server on loopback and fetch it in the same sandboxed process, mirroring
  // how the floor check runs Vite and the browser inside one command.
  const script = [
    'const http=require("http");',
    'const s=http.createServer((q,r)=>r.end("ok"));',
    's.listen(0,"127.0.0.1",()=>{const p=s.address().port;',
    'const c=http.get({host:"127.0.0.1",port:p},res=>{let d="";res.on("data",x=>d+=x);res.on("end",()=>{process.stdout.write(d);process.exit(d==="ok"?0:1)})});',
    'c.on("error",e=>{process.stderr.write(String(e));process.exit(1)})});',
  ].join('');
  return `node -e ${quote(script)}`;
}

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function run(executable, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: String(error) }));
  });
}

async function rm(target) {
  await fs.rm(target, { recursive: true, force: true }).catch(() => {});
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
