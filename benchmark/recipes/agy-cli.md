# Mechanism: Antigravity CLI (`agy`)

The Antigravity harness, reaching Gemini models on a Google subscription. One unattended `agy` print-mode process per stage. The adapter is `scripts/benchmark/agy-cli.mjs`, pinned by the plan's materials commit.

This harness deviates from the other three in ways that are material rather than cosmetic, and every deviation below was found by probe rather than from documentation.

## Knobs

Set per configuration in the plan row's `stage` block: `model`, `effort`, `timeoutSeconds`.

## Model and effort

agy bakes the reasoning tier into the model id rather than taking a separate flag. The adapter composes the id from the benchmark's `--effort` value and fails the stage if the composed id is absent from `agy models` for the account, so the tier is audited rather than assumed. Which tiers exist is a property of the account's published list, not of this document.

`agy models` prints display labels to a terminal but canonical ids when piped, which is how the adapter reads it.

## Invocation

```sh
npm run benchmark:agy -- \
  --worktree <entrant-worktree> \
  --prompt <private-rendered-assignment> \
  --out <private-stage-directory> \
  --model <model> \
  --effort <effort> \
  --sandbox false \
  --timeout-seconds <seconds>
```

**The prompt is delivered as an argument, not on stdin.** agy takes its non-interactive prompt as the value of `--print` and offers no stdin path. The rendered assignment is passed as one argument byte-for-byte, and `command.json` records its SHA-256 in place of a second copy so the delivered bytes stay auditable.

**agy's own print timeout is raised to the stage timeout.** `--print-timeout` defaults to five minutes and truncates the response silently at that point. The adapter passes the stage timeout through, leaving its own kill timer as the authoritative bound.

**`--add-dir <worktree>` is mandatory.** The working directory alone does not make the worktree agy's workspace. Without it the entrant writes into a scratch directory inside agy's own home and the sealed worktree comes back empty — even though agy keys its conversation pointer by that same working directory. The adapter always passes it.

## Isolation

**There is no entrant sandbox.** agy cannot be confined and this adapter implements no boundary, so the entrant runs with full filesystem and network access and the contamination audit is the only control. `agy-cli` is named in `UNSANDBOXABLE_ADAPTERS` in `scripts/benchmark/entrant-sandbox.mjs`; the runner warns at launch and the manifest records `sandboxUnavailable: true` on the stage, so the record distinguishes a run that was not isolated by policy from one that could not be. From v3 this is a warning rather than a bar — see `benchmark/controller/README.md`, "Entrant sandbox".

Harness isolation still applies: the controller redirects `HOME` to the run's harness home and copies in the operator's Antigravity OAuth token. agy rebuilds the rest of its state there, so conversations do not mix between runs or with the operator's own.

## What is captured

- `rollout.jsonl` — agy's own step transcript, copied verbatim from its `brain` directory. This is the run's transcript and the contamination audit's input: one JSON line per step carrying the planner's thinking, its tool calls, and each result with its exit code.
- `final-message.md` — the printed final response.
- `conversation.db` — agy's conversation store, protobuf inside SQLite, copied verbatim and recorded as `replayable: false`. Nothing reads it.
- `events.jsonl` — a synthesized single-record log standing in for the event stream the controller requires, carrying session id, resolved model, exit status, wall time, and the final message hash. **It is not a transcript.**
- `command.json`, `selected-model.json`, `model-catalog.txt`, `credential-source.json`, `result.json` — the same launch and identity provenance the other adapters record.

agy's stdout carries fragments of its internal task protocol alongside the final response for background tasks that settle near the end of a run. That is incidental output, not a record.

The contamination audit reads agy's transcript natively. Its tool names are its own and its argument keys are capitalized where the other harnesses use lowercase, so the audit's path and command lookup is case-insensitive.

## Completion and failure

A nonzero exit, a timeout, a missing conversation pointer, or a model label absent from the account's published list stops the run for controller-failure classification.

## Cost: measured by tokscale, not ccusage

This is the one harness ccusage does not price. Its `gemini` view covers a different tool, and no published release reads Antigravity data.

The usage is nonetheless fully recoverable offline: each row of the `gen_metadata` table in agy's conversation database is a protobuf carrying one generation's input, output, cache-read, and thinking tokens plus its response model. `tokscale` decodes exactly that, and its `--home` flag re-roots the scan, giving a run the same isolation ccusage's environment variables and `--pi-path` give elsewhere. The controller prices this adapter with tokscale, pinned in `package.json`, and records `cost.costSource.tool` accordingly.

**The two tools do not price on the same basis.** Cross-checked on the one run both can read, their token counts agree exactly while their totals differ by half: ccusage passes through the per-call charge the provider reported, tokscale multiplies token counts by a rate card. Neither is wrong. `cost.costSource.basis` records `metered` or `rate-card` so the two are never silently compared. For a subscription configuration the distinction is largely moot, since a subscription bills no per-token price and a rate card is the only available basis — the same footing the Claude and Codex subscription configurations sit on, and not the footing of metered OpenRouter rows.

One guarantee is weaker here than elsewhere. Every other harness reports its own usage counter that the controller cross-checks against transcript replay. agy publishes none, so `cost.reconciliation.status` is `unavailable` and the decode stands unverified against a second source.
