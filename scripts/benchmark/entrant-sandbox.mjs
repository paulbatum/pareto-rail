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
