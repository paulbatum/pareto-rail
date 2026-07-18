# Recipe: pi-luna-b20-smoke

Status: permanently ineligible controller smoke recipe.

This configuration exercises pi's soft-budget protocol (`--budget-usd`) through the real controller pipeline against `gpt-5.6-luna` on pi's stored OpenAI Codex subscription credential — no OpenRouter, no metered spend. It must never be registered in an eligible schedule, promoted as an entrant, or included in benchmark analysis.

It exists to rehearse the pi budget-extension mechanism itself (spend polling, notice delivery, same-session resume) before any `-b20` pi/OpenRouter configuration (`pi-openrouter-inkling-high-b20`, `pi-openrouter-kimi-k3-max-b20`) depends on it for real, since neither of those has exercised a budgeted row yet.

## Identity

- Configuration id: `pi-luna-b20-smoke`
- Stage: one unattended solo stage
- Stage budget: `budget.usd: 2` — deliberately small so the run crosses 75% quickly and forces at least one resume within a short wall-clock window
- Provider: `openai-codex`
- Model: `gpt-5.6-luna`
- Thinking level: `low`
- pi CLI: `0.80.10`
- Stage timeout: 1800 seconds — longer than the unbudgeted smokes to leave room for a resume round
- Continuations: budget-gated, per the protocol below

## Inputs and execution

Per `scripts/benchmark/run.mjs`, this runs the real `benchmark/prompts/level-assignment.md` assignment (not a bounded Prism Bloom adaptation — see the correction in `pi-openrouter-inkling-smoke.md`). What keeps this cheap is the $2 budget plus the 1800-second cap, not a reduced task.

The harness invocation is equivalent to:

```sh
npm run benchmark:pi -- \
  --worktree /tmp/pareto-rail-run-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/pi \
  --model gpt-5.6-luna \
  --provider openai-codex \
  --effort low \
  --budget-usd 2 \
  --timeout-seconds 1800
```

## Budget protocol

Per `scripts/benchmark/pi-cli.mjs`: when `--budget-usd` is set, the adapter initializes a budget directory, sets `PARETO_RAIL_BUDGET_DIRECTORY` in the child environment, and loads a controller-owned notice extension (`pi-budget-extension.js`) alongside `--no-extensions`, so no operator-installed extension can interfere. A poller (`startBudgetPoller`) reads spend via ccusage on the same interval used by the Claude/Codex hooks (`POLL_INTERVAL_MS`) and publishes state the extension reads after each tool call — this is the "controller-owned extension that steers the same notice after a tool finishes" difference from Claude's/Codex's hook-based delivery, as described in `benchmark/README.md`'s Cost section. After a turn completes, the adapter checks `shouldResume` (same-session continuation while under 75% spend and time remains) and issues the resume message from `resumeMessage`; a `budget.json` summary is written at the end recording resumes and final measured spend.

The exact notice wording and resume-gate thresholds are asserted to match the Claude/Codex budgeted recipes verbatim; this rehearsal exists specifically to confirm that by inspecting `budget.json` and the retained event log rather than assuming it.

## Completion

After the real model stage exits, the normal controller seals the evaluated worktree, runs typecheck, build, directory-only scope, and floor gates, derives a payload for a passing run, and writes the private manifest. The output remains rehearsal-only and is not integrated into the application. Record in the run notes: how many resume rounds occurred, whether notice wording matched the budgeted Claude/Codex recipes, and the final measured spend versus the $2 target.
