# Recipe: pi-openrouter-inkling-smoke

Status: permanently ineligible controller smoke recipe.

This configuration exercises the real pi CLI boundary against `thinkingmachines/inkling` on OpenRouter and the complete benchmark controller lifecycle with a bounded Prism Bloom adaptation. It must never be registered in an eligible schedule, promoted as an entrant, or included in benchmark analysis.

It exists to rehearse `pi-openrouter-inkling-high` before that recipe is frozen: confirming the controller-driven (not ad hoc) request shape, session capture, and usage/cost measurement for this model, at the same `high` effort tier the eligible recipe intends.

## Identity

- Configuration id: `pi-openrouter-inkling-smoke`
- Stage: one unattended solo stage
- Provider: `openrouter`
- Model: `thinkingmachines/inkling`
- Thinking level: `high`
- pi CLI: `0.80.10`
- Stage timeout: 900 seconds
- Task budget: none
- Continuations: none

## Inputs and execution

Correction from the pattern documented in `pi-openrouter-deepseek-smoke.md`: `scripts/benchmark/run.mjs` always renders the real `benchmark/prompts/level-assignment.md` template (it has no branch for an alternate smoke template), so this recipe runs the genuine standing-brief assignment against whichever theme the plan row assigns — not a bounded Prism Bloom adaptation. What keeps this cheap is the 900-second stage timeout, which simply cuts the process off; a run that hits it is expected to be an incomplete/interrupted stage, not a clean submission, and its cost is bounded by wall-clock rather than by task scope. The entrant receives the normal isolated worktree and repository instructions. The controller adds no feedback, repair prompt, or continuation.

The harness invocation is equivalent to:

```sh
npm run benchmark:pi -- \
  --worktree /tmp/pareto-rail-run-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/pi \
  --model thinkingmachines/inkling \
  --provider openrouter \
  --effort high \
  --timeout-seconds 900
```

The adapter's isolation, capture, and failure handling match `pi-luna-low-smoke.md`, including the same absence of an OS-level sandbox and the same `--offline --no-extensions` stage settings. `thinkingmachines/inkling` is not present in pi's bundled `--list-models` catalog even at `0.80.10`; the adapter's model-catalog check (`scripts/benchmark/pi-cli.mjs`) captures the catalog dump for audit but does not gate the stage on catalog presence, so this does not block the run.

## Credential

The `openrouter` provider reads `OPENROUTER_API_KEY`. The adapter resolves it from the process environment first, then from the repository's ignored `.env`, and passes the resolved key to pi for this invocation only; the resolved source is recorded in the stage's `credential-source.json` and the key itself never reaches a run artifact. With no key on either path the adapter falls back to pi's own stored credential, which changes which account is billed — so a run whose `credential-source.json` reports `pi-stored-credential` for this configuration did not use the project key and its cost is attributed elsewhere.

Cost for this configuration is real metered API spend rather than subscription usage, so its measured figures are directly comparable to a published price list.

## Completion

After the real model stage exits, the normal controller seals the evaluated worktree, runs typecheck, build, directory-only scope, and floor gates, derives a payload for a passing run, and writes the private manifest. The output remains rehearsal-only and is not integrated into the application.
