# Recipe: pi-luna-low-smoke

Status: permanently ineligible controller smoke recipe.

This configuration exercises the real pi CLI boundary and the complete benchmark controller lifecycle with a bounded Prism Bloom adaptation. It must never be registered in an eligible schedule, promoted as an entrant, or included in benchmark analysis.

## Identity

- Configuration id: `pi-luna-low-smoke`
- Stage: one unattended solo stage
- Provider: `openai-codex`
- Model: `gpt-5.6-luna`
- Thinking level: `low`
- pi CLI: `0.80.6`
- Stage timeout: 600 seconds
- Task budget: none
- Continuations: none

## Inputs and execution

The controller supplies `benchmark/examples/controller-smoke-assignment.md`, rendered with the assigned identity and `benchmark/examples/prism-warm-palette.md`, as the complete stdin prompt. The entrant receives the normal isolated worktree and repository instructions. The controller adds no feedback, repair prompt, or continuation.

The harness invocation is equivalent to:

```sh
npm run benchmark:pi -- \
  --worktree /tmp/pareto-rail-run-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/pi \
  --model gpt-5.6-luna \
  --provider openai-codex \
  --effort low \
  --timeout-seconds 600
```

The adapter uses its normal isolated `PI_CODING_AGENT_DIR`, credential copy, model-catalog validation, JSON event capture, native session capture, and ccusage cost measurement. A nonzero exit, timeout, malformed usage, or harness setup failure follows the normal rehearsal failure taxonomy.

This recipe documents a material harness difference, of a kind with the Claude recipes: pi has no OS-level sandbox, so unattended operation relies on `--approve` trusting the entrant worktree rather than on an enforced filesystem or network boundary. Codex's `workspace-write` sandbox has no pi equivalent. The stage also runs `--offline --no-extensions` so startup version checks and operator-installed extensions cannot vary between runs; neither affects the model's own API calls.

Because this provider authenticates with pi's stored credential rather than an API key, the run bills the operator's existing subscription and the adapter records its credential source as `pi-stored-credential`.

## Completion

After the real model stage exits, the normal controller seals the evaluated worktree, runs typecheck, build, directory-only scope, and floor gates, derives a payload for a passing run, and writes the private manifest. The output remains rehearsal-only and is not integrated into the application.
