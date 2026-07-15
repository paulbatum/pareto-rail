# Recipe: pi-openrouter-deepseek-smoke

Status: permanently ineligible controller smoke recipe.

This configuration exercises the real pi CLI boundary against an OpenRouter-hosted model and the complete benchmark controller lifecycle with a bounded Prism Bloom adaptation. It must never be registered in an eligible schedule, promoted as an entrant, or included in benchmark analysis.

It is the metered-billing counterpart to `pi-luna-low-smoke`: same assignment and same lifecycle, but the provider authenticates with an API key and bills per token rather than against a subscription.

## Identity

- Configuration id: `pi-openrouter-deepseek-smoke`
- Stage: one unattended solo stage
- Provider: `openrouter`
- Model: `deepseek/deepseek-v4-flash`
- Thinking level: `low`
- pi CLI: `0.80.6`
- Stage timeout: 900 seconds
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
  --model deepseek/deepseek-v4-flash \
  --provider openrouter \
  --effort low \
  --timeout-seconds 900
```

## Credential

The `openrouter` provider reads `OPENROUTER_API_KEY`. The adapter resolves it from the process environment first, then from the repository's ignored `.env`, and passes the resolved key to pi for this invocation only; the resolved source is recorded in the stage's `credential-source.json` and the key itself never reaches a run artifact. With no key on either path the adapter falls back to pi's own stored credential, which changes which account is billed — so a run whose `credential-source.json` reports `pi-stored-credential` for this configuration did not use the project key and its cost is attributed elsewhere.

Cost for this configuration is real metered API spend rather than subscription usage, so its measured figures are directly comparable to a published price list.

## Completion

After the real model stage exits, the normal controller seals the evaluated worktree, runs typecheck, build, directory-only scope, and floor gates, derives a payload for a passing run, and writes the private manifest. The output remains rehearsal-only and is not integrated into the application.
