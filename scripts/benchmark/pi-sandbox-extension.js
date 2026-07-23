// Controller-owned pi entrant sandbox. Adapted from the sandbox example shipped with
// @earendil-works/pi-coding-agent (examples/extensions/sandbox): it overrides the built-in `bash` tool
// to run every command under @anthropic-ai/sandbox-runtime, so filesystem and network restrictions are
// enforced at the OS level (bubblewrap + seccomp). Two things differ from the example, both required by
// the benchmark's threat model:
//
//   1. The policy is not read from a user/project config file. The adapter (scripts/benchmark/pi-cli.mjs)
//      writes the resolved per-run policy and the extension reads it from PARETO_RAIL_SANDBOX_CONFIG, so
//      the entrant cannot influence its own isolation.
//   2. pi's native read/write/edit/ls/grep/find tools run inside the harness process, outside the bash
//      sandbox, so a `tool_call` hook enforces the same boundary on them: reads of a denied root and
//      writes outside the worktree are blocked before the tool runs.
//
// The extension fails closed. If sandbox-runtime cannot initialize, every tool is blocked rather than
// silently running unsandboxed.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { createBashTool } from '@earendil-works/pi-coding-agent';

const configPath = process.env.PARETO_RAIL_SANDBOX_CONFIG;
delete process.env.PARETO_RAIL_SANDBOX_CONFIG;

// Tools that read a path; blocked when the target resolves inside a denied root.
const READ_TOOLS = new Set(['read', 'ls', 'grep', 'find']);
// Tools that write a path; blocked when the target resolves outside the worktree.
const WRITE_TOOLS = new Set(['write', 'edit']);

function loadPolicy() {
  if (!configPath) throw new Error('PARETO_RAIL_SANDBOX_CONFIG is not set; the pi sandbox extension has no policy to enforce.');
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!parsed?.runtime?.filesystem || !parsed?.worktree) throw new Error(`Sandbox config at ${configPath} is missing worktree or runtime.filesystem.`);
  return {
    worktree: path.resolve(parsed.worktree),
    denyReadRoots: (parsed.denyReadRoots ?? parsed.runtime.filesystem.denyRead ?? []).map((entry) => path.resolve(entry)),
    runtime: parsed.runtime,
  };
}

// Resolve a tool's target to a real absolute path. Symlinks are resolved on the deepest existing
// ancestor so a symlink planted inside the worktree cannot point a native file tool at a denied root.
function realResolve(worktree, target) {
  const absolute = path.resolve(worktree, target ?? '.');
  let existing = absolute;
  const trailing = [];
  while (!fs.existsSync(existing)) {
    trailing.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) return absolute;
    existing = parent;
  }
  try {
    return path.join(fs.realpathSync(existing), ...trailing);
  } catch {
    return absolute;
  }
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function sandboxedBashOperations() {
  return {
    async exec(command, cwd, { onData, signal, timeout }) {
      if (!fs.existsSync(cwd)) throw new Error(`Working directory does not exist: ${cwd}`);
      const wrapped = await SandboxManager.wrapWithSandbox(command);
      return new Promise((resolve, reject) => {
        const child = spawn('bash', ['-c', wrapped], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let timedOut = false;
        let timer;
        if (timeout !== undefined && timeout > 0) {
          timer = setTimeout(() => {
            timedOut = true;
            killGroup(child);
          }, timeout * 1000);
        }
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', (error) => { if (timer) clearTimeout(timer); reject(error); });
        const onAbort = () => killGroup(child);
        signal?.addEventListener('abort', onAbort, { once: true });
        child.on('close', (code) => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          if (signal?.aborted) reject(new Error('aborted'));
          else if (timedOut) reject(new Error(`timeout:${timeout}`));
          else resolve({ exitCode: code });
        });
      });
    },
  };
}

function killGroup(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

export default function sandbox(pi) {
  let policy;
  let ready = false;
  let initError;

  pi.on('session_start', async (_event, ctx) => {
    try {
      policy = loadPolicy();
      if (process.platform !== 'linux') throw new Error(`The entrant sandbox supports Linux only, not ${process.platform}.`);
      await SandboxManager.initialize(policy.runtime);
      ready = true;
      ctx?.ui?.notify?.('Entrant sandbox initialized', 'info');
    } catch (error) {
      initError = error instanceof Error ? error.message : String(error);
      ready = false;
      // Loud, and fail-closed below. The adapter treats a stage that never produced work as a failure.
      process.stderr.write(`[pareto-rail sandbox] initialization failed, blocking all tools: ${initError}\n`);
      ctx?.ui?.notify?.(`Entrant sandbox failed to initialize: ${initError}`, 'error');
    }
  });

  // Enforce the filesystem boundary on pi's native file tools, which run in the harness process rather
  // than through sandboxed bash. Blocking here mirrors the bash sandbox: reads of a denied root and
  // writes outside the worktree are refused before the tool executes.
  pi.on('tool_call', (event) => {
    if (!ready) return { block: true, reason: `Entrant sandbox unavailable${initError ? `: ${initError}` : ''}.` };
    const { toolName, input } = event;
    if (!READ_TOOLS.has(toolName) && !WRITE_TOOLS.has(toolName)) return undefined;
    const rawPath = input?.path;
    if (typeof rawPath !== 'string' || rawPath.length === 0) return undefined;
    const target = realResolve(policy.worktree, rawPath);
    if (WRITE_TOOLS.has(toolName)) {
      if (!isInside(target, policy.worktree)) return { block: true, reason: `Sandbox: writes are confined to the entrant worktree; ${target} is outside it.` };
      return undefined;
    }
    if (policy.denyReadRoots.some((root) => isInside(target, root)) && !isInside(target, policy.worktree)) {
      return { block: true, reason: `Sandbox: ${target} is outside the entrant worktree and cannot be read.` };
    }
    return undefined;
  });

  // Replace bash with a sandboxed bash. Falls back to blocking when the sandbox is unavailable.
  const localBash = createBashTool(process.cwd());
  pi.registerTool({
    ...localBash,
    label: 'bash (sandboxed)',
    async execute(id, params, signal, onUpdate, ctx) {
      if (!ready) throw new Error(`Entrant sandbox unavailable${initError ? `: ${initError}` : ''}; refusing to run bash unsandboxed.`);
      const sandboxedBash = createBashTool(process.cwd(), { operations: sandboxedBashOperations() });
      return sandboxedBash.execute(id, params, signal, onUpdate, ctx);
    },
  });

  pi.on('user_bash', () => {
    if (!ready) return undefined;
    return { operations: sandboxedBashOperations() };
  });

  pi.on('session_shutdown', async () => {
    if (ready) {
      try {
        await SandboxManager.reset();
      } catch {
        // Ignore cleanup errors.
      }
    }
  });
}
