# Recipe: codex-luna-low-smoke

Status: permanently ineligible controller smoke recipe.

This configuration exercises the real Codex CLI boundary and the complete benchmark controller lifecycle with a bounded Prism Bloom adaptation. It must never be registered in an eligible schedule, promoted as an entrant, or included in benchmark analysis.

## Identity

- Configuration id: `codex-luna-low-smoke`
- Stage: one unattended solo stage
- Model: `gpt-5.6-luna`
- Reasoning effort: `low`
- Codex CLI: `0.144.1`
- Stage timeout: 600 seconds
- Task budget: none
- Continuations: none

## Inputs and execution

The controller supplies `benchmark/examples/controller-smoke-assignment.md`, rendered with the assigned identity and `benchmark/examples/prism-warm-palette.md`, as the complete stdin prompt. The entrant receives the normal isolated worktree and repository instructions. The controller adds no feedback, repair prompt, or continuation.

The harness invocation is equivalent to:

```sh
npm run benchmark:codex -- \
  --worktree /tmp/pareto-rail-run-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/codex \
  --model gpt-5.6-luna \
  --effort low \
  --timeout-seconds 600
```

The adapter uses its normal isolated `CODEX_HOME`, credential copy, model-catalog validation, workspace-write sandbox, JSONL usage capture, native rollout capture, and ccusage cost measurement. A nonzero exit, timeout, malformed usage, or harness setup failure follows the normal rehearsal failure taxonomy.

## Completion

After the real model stage exits, the normal controller seals the evaluated worktree, runs typecheck, build, directory-only scope, and floor gates, derives a payload for a passing run, and writes the private manifest. The output remains rehearsal-only and is not integrated into the application.
