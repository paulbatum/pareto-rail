# Recipe: pi-luna-low-sandbox-smoke

Status: permanently ineligible controller smoke recipe.

This configuration exercises the sandboxed pi CLI boundary and the complete benchmark controller lifecycle with a bounded Prism Bloom adaptation. It must never be registered in an eligible schedule, promoted as an entrant, or included in benchmark analysis.

## Identity

- Configuration id: `pi-luna-low-sandbox-smoke`
- Stage: one unattended solo stage
- Provider: `openai-codex`
- Model: `gpt-5.6-luna`
- Thinking level: `low`
- Stage timeout: 1800 seconds
- Task budget: none
- Continuations: none

## Inputs and execution

The controller supplies `benchmark/examples/controller-smoke-assignment.md`, rendered with the assigned identity and `benchmark/examples/prism-warm-palette.md`, as the complete stdin prompt. The entrant receives the normal isolated worktree and repository instructions. The controller adds no feedback, repair prompt, or continuation.

The harness invocation is equivalent to:

```sh
npm run benchmark:pi -- \
  --worktree /tmp/pareto-rail-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/pi \
  --model gpt-5.6-luna \
  --provider openai-codex \
  --effort low \
  --sandbox true \
  --timeout-seconds 1800
```

The adapter uses its normal isolated `PI_CODING_AGENT_DIR`, credential copy, model-catalog validation, JSON event capture, native session capture, and ccusage cost measurement. Because this row activates the entrant sandbox, the adapter loads the controller-owned sandbox extension over Anthropic's `sandbox-runtime`: every bash command is wrapped, and pi's native `read`/`write`/`edit` tools are held to the same boundary. The worktree is the only writable tree, the primary repository and host `/tmp` are unreadable, external network egress is denied while loopback stays reachable, and Puppeteer is steered to `chrome-headless-shell`. The sandbox policy comes from the controller, not from any file the entrant can write.

Because this provider authenticates with pi's stored credential rather than an API key, the run bills the operator's existing subscription and the adapter records its credential source as `pi-stored-credential`.

## Completion

After the real model stage exits, the normal controller seals the evaluated worktree, runs typecheck, build, directory-only scope, and floor gates, derives a payload for a passing run, and writes the private manifest. The output remains rehearsal-only and is not integrated into the application.
