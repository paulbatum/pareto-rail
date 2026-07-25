# Recipe: agy-gemini-3-6-flash-smoke

Status: permanently ineligible controller smoke recipe.

This configuration exercises the Antigravity CLI (`agy`) boundary against Gemini 3.6 Flash on the operator's Google subscription, through the complete benchmark controller lifecycle, on the bounded Prism Bloom palette-swap theme. It must never be registered in an eligible schedule, promoted as an entrant, or included in benchmark analysis.

It exists to answer two questions the OpenRouter sibling (`pi-openrouter-gemini-3-6-flash-smoke`) could not: whether the subscription serving path completes a stage without the mid-run truncation that ended that run, and what a first-class agy adapter would and would not be able to record.

## Identity

- Configuration id: `agy-gemini-3-6-flash-smoke`
- Stage: one unattended solo stage
- Harness: Antigravity CLI (`agy`) `1.1.2`
- Model: `gemini-3.6-flash`, selected as the id `gemini-3.6-flash-high`
- Thinking level: `high`. agy bakes the reasoning tier into the model id rather than taking a separate flag, and publishes only `low`, `medium`, and `high` for this model; the adapter composes the id from the benchmark's `--effort` value and fails the stage if the composed id is absent from `agy models` for this account, so the tier is audited rather than assumed. Note that `agy models` prints display labels (`Gemini 3.6 Flash (High)`) to a terminal but canonical ids when piped, which is how the adapter reads it.
- Billing: Google Antigravity subscription. No API key is involved.
- Stage timeout: 1800 seconds
- Task budget: none
- Continuations: none

## Inputs and execution

`scripts/benchmark/run.mjs` always renders the real `benchmark/prompts/level-assignment.md` template, so this recipe runs the genuine standing-brief assignment against the plan row's theme, `benchmark/examples/prism-warm-palette.md`. The 1800-second stage timeout bounds the cost in wall-clock rather than task scope; a run that hits it is expected to be an incomplete stage, not a clean submission. The controller adds no feedback, repair prompt, or continuation.

The harness invocation is equivalent to:

```sh
npm run benchmark:agy -- \
  --worktree /tmp/pareto-rail-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/agy \
  --model gemini-3.6-flash \
  --effort high \
  --sandbox false \
  --timeout-seconds 1800
```

Two deviations from the other adapters are material and deliberate.

**The prompt is delivered as an argument, not on stdin.** agy takes its non-interactive prompt as the value of `--print`; it offers no stdin path. The rendered assignment is passed as one argument byte-for-byte, and `command.json` records its SHA-256 in place of a second copy, so the delivered bytes stay auditable.

**agy's own print timeout is raised to the stage timeout.** `--print-timeout` defaults to five minutes and truncates the response silently at that point. The adapter passes the stage timeout through, leaving its own kill timer as the authoritative bound.

A third detail is not a deviation but a hazard worth recording: the working directory alone does not make the worktree agy's workspace. Without `--add-dir <worktree>` the entrant writes into a scratch directory inside agy's own home and the sealed worktree comes back empty, even though agy keys its conversation pointer by that same working directory. The adapter always passes `--add-dir`; this was found by probe, not by documentation.

## Runtime policy

- Operator interaction after launch: none.
- Network access: unrestricted.
- **No entrant sandbox.** This adapter implements none. agy has no usable sandbox of its own, and neither of the two existing mechanisms transfers to it: Claude uses its built-in bubblewrap sandbox, and pi is confined by a controller-owned extension wrapping its tools. A row that sets `stage.sandbox: true` is rejected at launch rather than run without the isolation it asked for. This condition is acceptable only because the run is rehearsal-only; an eligible agy configuration would need the boundary built first.
- Harness isolation: the controller redirects `HOME` to the run's harness home and copies the operator's `~/.gemini/antigravity-cli/antigravity-oauth-token` into it. agy rebuilds the rest of its state there, so conversations do not mix between runs or with the operator's own. Verified before the adapter was written: agy authenticates and completes a print-mode request from a home containing nothing but that token.
- Failure behavior: a nonzero exit, a timeout, a missing conversation pointer, or a model label absent from the account's published list stops the run for controller-failure classification.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree as unmeasured deterministic setup.
- Commit behavior: the agent may use the normal repository workflow; the controller seals permitted changes afterward and derives the payload.

## Usage and cost: unavailable by construction

**This configuration records no cost, and that is a property of the harness, not an omission.**

agy exposes no machine-readable output: `--print` emits the final assistant text and nothing else, with no JSON or streaming format. Its only persisted transcript is a per-conversation SQLite database under the harness home, in which every payload column (`step_payload`, `gen_metadata.data`, and the rest) is an opaque protobuf blob. ccusage, which prices every other configuration in this benchmark, has no agy view; its `gemini` view covers the Gemini CLI, a different tool that individual subscriptions can no longer authenticate against at all.

Recovering token counts would therefore mean reverse-engineering an undocumented protobuf schema and then choosing a rate table by hand for a subscription that bills no per-token price. None of that was undertaken, so the manifest states the gap rather than estimating around it: `cost.status` is `unavailable` with a reason, no `totalUsd` key is written, and each stage carries `usage: { available: false }` and `pricing: { status: 'unavailable' }`. The manifest schema was extended to express this, so an absent count can never be read as a zero.

The consequence is that **this configuration cannot be placed on the benchmark's quality-versus-cost curve.** Wall time is the only measured quantity. Any eligible agy configuration would need a real usage path first.

## What is captured

- `final-message.md` — agy's printed final response.
- `rollout.db` — the conversation database, copied verbatim. It is recorded as `format: sqlite, replayable: false` and is deliberately *not* named `rollout.jsonl`, so the controller's rollout hashing correctly finds no replayable transcript and the manifest claims none.
- `events.jsonl` — a synthesized single-record log standing in for the event stream the controller requires. It carries the session id, resolved model, exit status, wall time, and the final message hash. It is not a transcript.
- `command.json`, `selected-model.json`, `model-catalog.txt`, `credential-source.json`, `result.json` — the same launch and identity provenance the other adapters record.

## Contamination audit

`npm run benchmark:contamination` cannot audit this run. Its per-adapter parsers read recorded tool calls from a harness transcript, and agy publishes none in any readable form. A run on this harness therefore has no tool-call evidence to review, which is a second blocker on promotion independent of the cost gap.

## Completion

After the stage exits, the normal controller seals the evaluated worktree, runs typecheck, build, directory-only scope, and floor gates, derives a payload for a passing run, and writes the private manifest. The output remains rehearsal-only and is not integrated into the application.
