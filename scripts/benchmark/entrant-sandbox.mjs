// Shared entrant-sandbox policy for the claude-cli and pi-cli stages. Codex has its own built-in
// permission profile (scripts/benchmark/codex-cli.mjs); this module gives the other two harnesses the
// same by-construction isolation: the entrant worktree is the only writable tree, the primary
// repository and sibling run checkouts are unreadable, and tool execution has no external egress while
// loopback keeps working for the floor and snapshot self-checks. The mechanism is Anthropic's
// sandbox-runtime (bubblewrap + seccomp + host-side proxies) for pi and Claude Code's built-in
// bubblewrap sandbox for Claude; both are unprivileged, matching the Codex approach.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Deep import: sandbox-runtime does not re-export these from its entry point, and the benchmark needs
// the exact set it shields rather than a copy that can drift. A version bump that moves them fails the
// stage at launch, which is the outcome we want — a silent stale list would quietly reintroduce the
// untracked-file noise that writeSandboxGitExclude() exists to remove.
import { DANGEROUS_FILES, getDangerousDirectories } from '@anthropic-ai/sandbox-runtime/dist/sandbox/sandbox-utils.js';
import { fail } from './common.mjs';

// The controller's primary repository — the tree that must be unreadable inside the entrant sandbox
// (its .git, the tracked benchmark/ tree, every promoted level, and the run records under
// benchmark/private, including each run's harness home and copied operator credential). This module
// lives at scripts/benchmark/, so the repo root is two directories up. It is NOT derived from the
// entrant worktree: the worktree is a standalone checkout whose own git-common-dir is itself, so
// deriving from it would deny the worktree rather than the real repository.
export const PRIMARY_REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Harnesses that receive the entrant sandbox. Codex is isolated by its own adapter and is excluded.
export const SANDBOXED_ADAPTERS = new Set(['claude-cli', 'pi-cli']);

// Harnesses that cannot be isolated at all. Neither existing mechanism reaches agy: Claude uses its
// own built-in bubblewrap sandbox, and pi is confined by a controller-owned extension wrapping its
// tools, which agy has no equivalent of. Confining it would mean wrapping the whole process with a
// host-side egress allowlist — real work nobody has done.
//
// Prime Agent is there for a different reason. It shares pi's extension API, but wrapping tools buys
// nothing: it executes through a persistent IPython kernel and spawns delegated subagents as separate
// processes, both outside the harness process a `tool_call` hook sees. The boundary would have to sit
// around the whole process tree, which also carries the model API traffic the run depends on, so an
// egress-allowlisted namespace is the only shape that works — again, real work nobody has done.
//
// From v3 this is a warning rather than a bar. A row on such a harness runs unisolated, the runner
// says so at launch, and the manifest records it, with the contamination audit as the control — the
// same footing open-policy rows have always run on. The distinction the record has to preserve is
// between an entrant that was not isolated by policy and one that could not be.
export const UNSANDBOXABLE_ADAPTERS = new Set(['agy-cli', 'prime-agent-cli']);

export function sandboxUnavailable(definition) {
  return UNSANDBOXABLE_ADAPTERS.has(definition?.stage?.adapter);
}

// The launch-time notice for a row that will run unisolated on a harness that cannot be isolated.
// Returns null when the row is either isolated or unisolated by ordinary policy.
export function sandboxWarning(definition) {
  if (!sandboxUnavailable(definition)) return null;
  const requested = definition?.stage?.sandbox === true;
  const byPolicy = definition?.baselinePolicy === 'scrubbed';
  const because = requested
    ? 'the row sets stage.sandbox true, which this harness cannot honor'
    : byPolicy
      ? 'a scrubbed plan would otherwise isolate it'
      : 'its plan does not ask for isolation';
  return `Entrant sandbox unavailable for ${definition.stage.adapter}: ${because}. The entrant runs with full filesystem and network access; the contamination audit is the only control on this run. Recorded in the manifest as sandboxUnavailable.`;
}

// The sandbox activates for scrubbed plans, mirroring codexNetworkAccess() in run.mjs. A row may set
// stage.sandbox=false as an explicit rehearsal-only escape hatch (analogous to stage.networkAccess).
// Open-policy rows keep their historical unsandboxed behavior, with the contamination audit as control.
export function entrantSandboxEnabled(definition) {
  if (!SANDBOXED_ADAPTERS.has(definition?.stage?.adapter)) return false;
  if (typeof definition?.stage?.sandbox === 'boolean') return definition.stage.sandbox;
  return definition?.baselinePolicy === 'scrubbed';
}

// Launch guard: a scrubbed claude/pi row cannot stage without the sandbox tools present. Fail fast
// with the install command rather than launching an expensive, unisolated run.
export function assertSandboxDependencies() {
  const missing = ['bwrap', 'socat'].filter((binary) => !hasExecutable(binary));
  if (missing.length) {
    fail(`The entrant sandbox needs ${missing.join(' and ')} on PATH but ${missing.length === 1 ? 'it is' : 'they are'} missing. Install with: sudo apt-get install bubblewrap socat`);
  }
}

function hasExecutable(binary) {
  try {
    execFileSync('sh', ['-c', `command -v ${binary}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Root of the node installation the entrant needs read access to. Under nvm that is the whole `.nvm`
// tree (node, npm, and npx all resolve inside it); elsewhere the prefix two levels above `bin/node`.
// Kept identical to the Codex adapter's copy so the three harnesses grant the same toolchain root.
export function nodeToolchainRoot() {
  const segments = process.execPath.split(path.sep);
  const nvmIndex = segments.indexOf('.nvm');
  if (nvmIndex !== -1) return segments.slice(0, nvmIndex + 1).join(path.sep);
  return path.dirname(path.dirname(process.execPath));
}

// The one-time host install of chrome-headless-shell used by sandboxed runs. The sandbox seccomp
// filter denies AF_UNIX socket creation, which full Chrome needs at startup for its profile-singleton
// lock; the stripped headless shell never performs it. Installed outside the repository so no entrant
// checkout reaches anything else through the read grant.
export function headlessShellRoot() {
  return path.join(os.homedir(), '.cache', 'pareto-rail', 'chrome-headless-shell');
}

export async function findHeadlessShell({ required = true } = {}) {
  const root = headlessShellRoot();
  const versions = await fs.readdir(root).catch(() => []);
  for (const version of versions.sort().reverse()) {
    const candidate = path.join(root, version, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (await fs.access(candidate).then(() => true, () => false)) return candidate;
  }
  if (!required) return undefined;
  fail(`The entrant sandbox requires chrome-headless-shell (full Chrome cannot start under the sandbox seccomp filter). Install it with: npx @puppeteer/browsers install chrome-headless-shell@stable --path ${root}`);
}

// The read boundary the pi extension and the escape probe share. Reads are allow-by-default in
// sandbox-runtime, so the boundary is the deny list: the primary repository (its .git, the tracked
// benchmark/ tree, every promoted level, and — since the run output lives under benchmark/private —
// this run's own harness home and its copied operator credential) plus the host /tmp. Denying /tmp
// hides every sibling run checkout at once — present and future, with no enumeration — and, since the
// worktree lives under /tmp and is carved back in below, leaves the entrant a fresh writable tmpfs
// /tmp for scratch files. run.mjs names every worktree /tmp/pareto-rail-<runId>, so the worktree is
// always under /tmp.
export function piDenyReadRoots({ repositoryRoot = PRIMARY_REPOSITORY_ROOT } = {}) {
  return [path.resolve(repositoryRoot), '/tmp'];
}

// sandbox-runtime shields a fixed set of dotfiles and tool directories relative to the working
// directory, which for an entrant stage is the worktree. Any of them that does not already exist is
// mounted from /dev/null (or an empty directory), so inside the sandbox they are real, empty, and
// untracked — and the entrant's own `npm run check:scope` self-check reports them as out-of-scope
// noise it cannot clear. They exist only inside the namespace and vanish with it, so the controller's
// authoritative scope gate never sees them; only the entrant does.
export function sandboxShieldedEntries() {
  return [...DANGEROUS_FILES, ...getDangerousDirectories()];
}

// Record the shielded names in the worktree's own git exclude file so every git-based self-check the
// entrant runs ignores them. This cannot hide entrant work: the same mounts make those paths
// read-only inside the sandbox, so the entrant cannot write them in the first place.
export async function writeSandboxGitExclude(worktree) {
  const gitDir = path.resolve(worktree, gitDirectory(worktree));
  const excludePath = path.join(gitDir, 'info', 'exclude');
  const existing = await fs.readFile(excludePath, 'utf8').catch(() => '');
  const block = ['# Entrant sandbox mount points (see scripts/benchmark/entrant-sandbox.mjs).', ...sandboxShieldedEntries().map((entry) => `/${entry}`)].join('\n');
  if (existing.includes(block)) return excludePath;
  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  await fs.writeFile(excludePath, `${existing}${existing.endsWith('\n') || existing === '' ? '' : '\n'}${block}\n`, 'utf8');
  return excludePath;
}

function gitDirectory(worktree) {
  try {
    return execFileSync('git', ['rev-parse', '--git-dir'], { cwd: worktree, encoding: 'utf8' }).trim();
  } catch (error) {
    fail(`Could not resolve the git directory of the entrant worktree ${worktree}: ${error.message}`);
  }
}

// The sandbox-runtime package directory. sandbox-runtime enforces its AF_UNIX block by exec'ing its
// vendored `apply-seccomp` binary from inside the bwrap namespace; that binary lives under this
// package, which sits inside the primary repo's node_modules and is therefore hidden by the denyRead
// of the repo. The path must be carved back in with allowRead or the wrapped command cannot start.
export function sandboxRuntimePackageDir() {
  const require = createRequire(import.meta.url);
  return path.dirname(path.dirname(require.resolve('@anthropic-ai/sandbox-runtime')));
}

// The WSLg X11 socket, when present. sandbox-runtime tmpfs's the denied /tmp, which hides
// /tmp/.X11-unix; Chrome's GPU process hangs forever probing an unreachable X socket when DISPLAY is
// set, so the socket directory is carved back in (matching the Codex profile). The entrant stage also
// runs with DISPLAY unset as a second guard.
function existingX11Socket() {
  return fsSync.existsSync('/tmp/.X11-unix') ? ['/tmp/.X11-unix'] : [];
}

// Full sandbox-runtime config for a pi entrant stage: the worktree is the only writable tree, the
// deny-read roots are hidden (with the worktree, the sandbox-runtime package, and the X11 socket
// carved back in), and network egress is empty (deny-all) while loopback stays reachable because
// sandbox-runtime isolates the network namespace rather than blocking loopback binds. allowRead
// carve-outs are restored on top of the deny tmpfs by sandbox-runtime, so the worktree survives the
// /tmp deny.
export async function piSandboxConfig({ worktree, repositoryRoot = PRIMARY_REPOSITORY_ROOT }) {
  return {
    filesystem: {
      denyRead: piDenyReadRoots({ repositoryRoot }),
      allowRead: [path.resolve(worktree), sandboxRuntimePackageDir(), ...existingX11Socket()],
      allowWrite: [path.resolve(worktree)],
      denyWrite: [],
    },
    network: {
      allowedDomains: [],
      deniedDomains: [],
    },
  };
}
