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
- **No entrant sandbox.** agy cannot be confined and this adapter implements no boundary, so the entrant runs with full filesystem and network access and the contamination audit is the only control on this run. The manifest records `sandboxUnavailable` on the stage. For why an unconfinable harness warns rather than blocks, see `benchmark/controller/README.md`, "Entrant sandbox".
- Harness isolation: the controller redirects `HOME` to the run's harness home and copies the operator's `~/.gemini/antigravity-cli/antigravity-oauth-token` into it. agy rebuilds the rest of its state there, so conversations do not mix between runs or with the operator's own. Verified before the adapter was written: agy authenticates and completes a print-mode request from a home containing nothing but that token.
- Failure behavior: a nonzero exit, a timeout, a missing conversation pointer, or a model label absent from the account's published list stops the run for controller-failure classification.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree as unmeasured deterministic setup.
- Commit behavior: the agent may use the normal repository workflow; the controller seals permitted changes afterward and derives the payload.

## Cost: measured by tokscale, not ccusage

This is the one configuration ccusage does not price. Its `gemini` view covers the Gemini CLI, a different tool that individual subscriptions can no longer authenticate against at all, and no published ccusage release reads Antigravity data. That is a gap in the tool rather than in the data: Antigravity support has been proposed upstream at least eight times and implemented twice — ccusage PR #1487 is complete and tested against a real install — but every one of those threads was auto-closed by the repository's new-contributor filter without a maintainer reply.

The usage itself is fully recoverable offline. Each row of the `gen_metadata` table in agy's conversation database is a protobuf carrying one generation's input, output, cache-read, and thinking tokens plus its response model. `tokscale` decodes exactly that, and its `--home` flag re-roots the entire scan, which gives a run the same isolation ccusage's per-harness environment variables and `--pi-path` give elsewhere. The controller therefore prices this adapter with tokscale (pinned in `package.json`, invoked through the repository's own binary) and records `cost.costSource.tool` accordingly.

**The two tools do not price on the same basis, and the manifest says which was used.** Cross-checked on the one run both can read — the pi/OpenRouter Gemini smoke — their token counts agree exactly (131,124 input, 7,142 output, 195,025 cache-read) while their totals differ by half: ccusage $0.1843 against tokscale $0.2795. ccusage passes through the per-call charge the provider reported; tokscale multiplies token counts by a rate card. Neither is wrong. `cost.costSource.basis` records `metered` or `rate-card` so the two are never silently compared as the same kind of number.

For this configuration the distinction is largely moot: a subscription bills no per-token price, so a rate card is the only available basis — the same one ccusage applies to the Claude and Codex subscription configurations. A future eligible agy entrant would sit on the same footing as those, not on the footing of the metered OpenRouter rows.

One measurement guarantee is weaker here than elsewhere. Every other harness reports its own usage counter, which the controller cross-checks against the transcript replay to catch a replay that lost a message. agy publishes no such counter, so `cost.reconciliation.status` is `unavailable` for this configuration and the decode stands unverified against a second source.

## What is captured

- `final-message.md` — agy's printed final response.
- `rollout.jsonl` — agy's own step transcript, copied verbatim from its `brain` directory. This is the run's transcript and the audit's input.
- `conversation.db` — agy's conversation database, copied verbatim. Recorded as `format: sqlite, replayable: false`; nothing reads it today.
- `events.jsonl` — a synthesized single-record log standing in for the event stream the controller requires. It carries the session id, resolved model, exit status, wall time, and the final message hash. It is not a transcript.
- `command.json`, `selected-model.json`, `model-catalog.txt`, `credential-source.json`, `result.json` — the same launch and identity provenance the other adapters record.

## Contamination audit

`npm run benchmark:contamination` audits this run normally. agy writes a readable transcript per conversation at `<home>/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript_full.jsonl` — one JSON line per step carrying the planner's thinking, its tool calls as `{name, args}`, and each result with its exit code. The adapter captures that file as the stage's `rollout.jsonl`, and the audit has a parser for it.

Two adjustments were needed to read agy's calls rather than to work around them. Its tool names are its own (`view_file`, `list_dir`, `grep_search`, `run_command`), and its argument keys are capitalized (`AbsolutePath`, `DirectoryPath`, `SearchPath`, `CommandLine`) where the other harnesses use lowercase, so path and command field lookup is now case-insensitive.

The rehearsal audited to `listings-only`: 37 tool calls, of which the only cross-level access was one directory listing of `src/benchmark-levels`. A `grep_search` result mentioned other levels' paths, but the entrant opened none of them.

Two records are worth distinguishing from the transcript. The conversation database (`conversation.db`) is agy's own store, protobuf in SQLite, captured for completeness and read by nothing. And agy's stdout carries, alongside the final response, fragments of its internal task protocol (`<call_id>`, `<output_payload>`, `<message_notification>`) for background tasks that settle near the end of the run — incidental output, not a record.

## Completion

After the stage exits, the normal controller seals the evaluated worktree, runs typecheck, build, directory-only scope, and floor gates, derives a payload for a passing run, and writes the private manifest. The output remains rehearsal-only and is not integrated into the application.
