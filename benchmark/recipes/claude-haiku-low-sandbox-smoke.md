# Recipe: claude-haiku-low-sandbox-smoke

Status: permanently ineligible controller smoke recipe.

This configuration exercises the sandboxed Claude CLI boundary and the complete benchmark controller lifecycle with a bounded Prism Bloom adaptation. It must never be registered in an eligible schedule, promoted as an entrant, or included in benchmark analysis.

## Identity

- Configuration id: `claude-haiku-low-sandbox-smoke`
- Stage: one unattended solo stage
- Model: `claude-haiku-4-5`
- Reasoning effort: `low`
- Stage timeout: 1800 seconds
- Task budget: none
- Continuations: none

## Inputs and execution

The controller supplies `benchmark/examples/controller-smoke-assignment.md`, rendered with the assigned identity and `benchmark/examples/prism-warm-palette.md`, as the complete stdin prompt. The entrant receives the normal isolated worktree and repository instructions. The controller adds no feedback, repair prompt, or continuation.

The harness invocation is equivalent to:

```sh
npm run benchmark:claude -- \
  --worktree /tmp/pareto-rail-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/claude \
  --model claude-haiku-4-5 \
  --effort low \
  --sandbox true \
  --timeout-seconds 1800
```

The adapter uses its normal isolated `CLAUDE_CONFIG_DIR`, credential copy, JSONL usage capture, native rollout capture, and ccusage cost measurement. Because this row activates the entrant sandbox, it also runs Claude Code's built-in bubblewrap sandbox: the worktree is the only writable tree, the primary repository and host `/tmp` are unreadable, external network egress is denied while loopback stays reachable, `WebFetch`/`WebSearch` are disabled, and Puppeteer is steered to `chrome-headless-shell`. A nonzero exit, timeout, malformed usage, or harness setup failure follows the normal rehearsal failure taxonomy.

## Completion

After the real model stage exits, the normal controller seals the evaluated worktree, runs typecheck, build, directory-only scope, and floor gates, derives a payload for a passing run, and writes the private manifest. The output remains rehearsal-only and is not integrated into the application.
