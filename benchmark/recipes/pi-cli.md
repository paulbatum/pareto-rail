# Mechanism: pi CLI

The pi harness. One unattended pi process per stage, launched by the deterministic controller in the opaque entrant worktree, with its JSON event stream captured. The controller is a process runner, not a pi agent, so it contributes no model usage of its own.

The adapter is `scripts/benchmark/pi-cli.mjs`. The controller runs it from the controller checkout, and the manifest's `controller.commit` records the source that ran.

pi differs from the other harnesses in one structural way: it reaches a model through a selectable provider, so a configuration pins `provider` alongside `model`, and the provider decides the billing path. A subscription-backed provider bills no metered spend; an OpenRouter-backed one bills real API spend. That difference propagates into `cost.orchestrationTreatment` and the subscription caveat, which is why a pi configuration's billing path is a property of the configuration rather than of this harness.

## Knobs

Set per configuration in the plan row's `stage` block, not here:

`model`, `provider`, `effort`, `timeoutSeconds`, `budget.usd`, `sandbox`.

## Model and effort

The adapter records the installed pi version at launch and captures the model catalog as an audit record. That capture is audit-only and does not gate a run: pi's bundled `--list-models` catalog has repeatedly lagged models that are in fact reachable through a provider, so catalog absence is not evidence that a model will not run. Providers expose no dated snapshots.

pi's reasoning vocabulary includes `minimal` and `off`, which the other harnesses lack, and does not include Codex's `ultra`.

pi reads each model's context window and maximum output from the model store in its home. A per-run home starts without one, and the stage runs `--offline`, so pi never fetches the current limits: it would fall back to a 4096-token output cap for every model it has no entry for. The controller therefore copies the operator's `models-store.json` into the per-run home alongside the credential, and fails before launch when that file is missing. Refresh it by running `pi --list-models` on the operator account. The stage's `model-catalog.txt` records the limits that were in force, so a `max-out` of `4.1K` there means the store did not cover the model.

## Invocation

```sh
npm run benchmark:pi -- \
  --worktree <entrant-worktree> \
  --prompt <private-rendered-assignment> \
  --out <private-stage-directory> \
  --model <model> \
  --provider <provider> \
  --effort <effort> \
  --sandbox <true|false> \
  --timeout-seconds <seconds>
```

The rendered assignment is supplied as the complete stdin prompt, byte-for-byte, with no controller preface. Effective arguments are recorded verbatim in `command.json`.

The stage runs `--offline --no-extensions` plus the controller-owned sandbox extension, so startup version checks and any operator-installed extension cannot vary between runs. Unattended operation runs `--approve` inside the sandbox boundary.

## Isolation

The entrant sandbox is owned by `benchmark/controller/README.md`, "Entrant sandbox". pi has no native sandbox at all, so the entire boundary comes from a controller-owned extension over Anthropic's `sandbox-runtime`, which wraps every bash command and also holds pi's native `read`, `write`, and `edit` tools — which run in the harness process — to the same policy. The policy comes from the controller, never from a file the entrant can write.

One side effect described in that section is pi-specific and visible to the entrant: `sandbox-runtime` shields a fixed set of dotfiles and tool directories by mounting absent ones from `/dev/null`, which appear inside the namespace as real, empty, untracked files and would otherwise show up as unclearable noise in the entrant's own scope check. The adapter records those names in the worktree's `.git/info/exclude` before staging.

Not every provider is built into pi. One registered by an extension package installed in the operator's pi home has to be loaded explicitly with `--extension`, which stays active under `--no-extensions`, through the adapter's per-provider extension map. A missing package fails the stage before launch with an install hint rather than mid-run.

## Credentials

A subscription-backed provider authenticates with pi's stored credential rather than an API key: the controller copies the operator's stored `auth.json` into the isolated per-run home, the same mechanism the Claude and Codex stages use. An OpenRouter-backed provider uses an API key. Either way `credential-source.json` records which path was taken, and a configuration states its expected value.

## Event stream

The retained `events.jsonl` is deliberately not a verbatim copy of stdout. pi's `message_update` events each repeat the whole message built so far rather than the new delta, so keeping them grows the log with the square of a message's length — a five-minute stage once emitted 251MB of them against a 172KB session file. They are dropped as they stream, since each is superseded by the `message_end` that closes its message with final content and usage, and the dropped count is recorded alongside the log. The complete transcript remains the session file, captured as the run's rollout artifact and replayed by ccusage.

## Usage and timing

- Tokens: pi reports per-call usage in each `message_end`. This inverts the other harnesses — each event carries only that one API call's usage rather than restating the session — so the adapter sums assistant messages within an invocation, and the controller sums those invocation counters across budget continuation rounds before the ccusage cross-check.
- Session id: reported by the harness and recorded at launch.
- Wall time: recorded around process spawn and exit in `command.json`.
- Stage artifacts live under `benchmark/private/runs/<run-id>/stages/<stage>/pi/`.

## Completion and failure

A stage completes when pi exits zero, reports one session id, and its final assistant message reports usage. A nonzero exit, a timeout, a missing session id, missing usage, an unsupported effort, or a final assistant message carrying `stopReason: "error"` stops the run for controller-failure classification.

A final assistant message carrying `stopReason: "length"` with no tool call stops the run the same way. The turn spent its whole output allowance without acting, and pi ends the agent loop there, so the stage holds an unfinished worktree behind a zero exit. The adapter does not resume it: a truncated turn means the configuration's output allowance is wrong for the model, and the run record should show that rather than hide it behind a retry. Read the stage's `model-catalog.txt` to see the allowance that applied.

**A headless session ends at its first threshold compaction** ([prime-agent#674](https://github.com/PrimeIntellect-ai/prime-agent/issues/674), filed against Prime Agent and shared by pi, which has the same print-mode idle wait). pi counts as idle while compaction runs, tears the connection down, and exits zero with the entrant's work half finished — so the stage looks complete and is not. The session shows one of two endings: a compaction after the agent loop's last end, or a post-compaction turn aborted with zero tokens. A provider that truncates an assistant message on a length stop reaches the same place when pi compacts behind it.

The adapter detects both and resumes the same session itself, which puts the entrant back where it was with its compacted context and its untouched worktree. Each continuation warns on the console, writes the usual round-suffixed artifacts, and is recorded in `result.json` under `compactionContinuations`. The loop stops when a resumed round does no tool work — an entrant with nothing left to do — and the stage is then a normal completion carrying `compactionSettled`. Wall clock bounds it as it bounds everything else, with a defensive round cap behind that; a stage that exhausts the cap is failed as `truncated`, and the session is still intact:

```sh
npm run benchmark:run -- --resume benchmark/private/runs/<runId> --continue-stage true
```

**This is a workaround and should be deleted once the upstream issue is fixed.** It repairs a stop pi should not have made, and nothing else: an entrant that chooses to stop is never continued, which is what separates it from the budget protocol. Budget rows are continued by the budget protocol as usual, and a budget round cut short by a compaction is repaired before its spend is measured.

**A turn can end on an empty completion.** The provider returns an assistant message with no content blocks, no tool call, and zero usage, at `stopReason: "stop"`. pi reads that as the agent settling and exits zero, so the stage again looks complete with the entrant's work unfinished — 23 seconds into one observed run and 44 minutes into another. The message still carries a `responseId`, and for the observed runs OpenRouter's own logs hold no record of the request behind it while they do hold the request before it, so where the empty message originates is not yet established.

The adapter detects it from the final assistant message and resumes the same session, telling the entrant only that its previous turn was interrupted before it produced anything. Each retry warns on the console, writes the usual round-suffixed artifacts, and is recorded in `result.json` under `emptyCompletionContinuations`, with `emptyCompletionCleared` reporting whether the retries worked. Unlike the compaction loop it does not stop when a round makes no tool call, because an empty turn makes none by definition and stopping there would accept the very stop being repaired. It gives up after `MAX_EMPTY_COMPLETION_CONTINUATIONS` rounds, and the stage is then failed as `empty-completion` with the session left intact for `--continue-stage`.

pi also has an operator-invoked same-session recovery for an interrupted process, `--continue-stage`, described under "Resume and recovery" in the controller README. It writes round-suffixed records and is not something the controller does automatically.

## Cost

Measured after the run by ccusage, per `benchmark/README.md`, "Cost". pi is the harness whose ccusage view takes an explicit `--pi-path` sessions directory instead of scoping by environment variable, so the cost module carries that difference to keep every view measured against one run's rollouts and nothing else. ccusage reports per-model cost for pi.

Whether the resulting figure is metered spend or rate-priced subscription usage depends on the configuration's provider, and the two must never be silently compared as the same kind of number.
