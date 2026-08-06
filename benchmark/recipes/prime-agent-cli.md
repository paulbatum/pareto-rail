# Mechanism: Prime Agent CLI

Prime Intellect's Prime Agent, built on pi. One unattended `prime-agent` process per stage, launched by the deterministic controller in the opaque entrant worktree with its JSON event stream captured. The adapter is `scripts/benchmark/prime-agent-cli.mjs`, pinned by the plan's materials commit.

What differs from every other harness here is the tool surface. Prime Agent gives the model one tool — a persistent IPython kernel — and everything else is a Python call inside it: shell commands, file edits, skills, and delegation. `await rlm(...)` spawns a full agent session of its own, with its own kernel, model, and transcript, addressed afterwards by message rather than by return value. Two consequences run through the rest of this document: a run's record is a tree of transcripts rather than one, and the boundary a per-tool wrapper could enforce no longer contains the run.

## Knobs

Set per configuration in the plan row's `stage` block: `model`, `provider`, `effort`, `timeoutSeconds`, `budget.usd`, `autonomous`, `autonomousGate`.

## Model and effort

Prime Agent shares pi's provider selection and thinking levels, so a configuration pins `provider` alongside `model` and the provider decides the billing path. The reasoning vocabulary includes `minimal` and `off` and excludes Codex's `ultra`.

## Invocation

```sh
npm run benchmark:prime-agent -- \
  --worktree <entrant-worktree> \
  --prompt <private-rendered-assignment> \
  --out <private-stage-directory> \
  --model <model> \
  --provider <provider> \
  --effort <effort> \
  --sandbox false \
  --timeout-seconds <seconds>
```

The rendered assignment is the complete stdin prompt, byte-for-byte, with no controller preface. The stage runs `--print --mode json --offline --no-extensions`, so startup network calls and operator-installed extensions cannot vary between runs; skills discovery stays on, since the bundled skills are part of the harness being measured. Effective arguments are recorded verbatim in `command.json`.

The isolated per-run home starts empty, and building an IPython environment inside it would download packages on every stage, so `PRIME_AGENT_KERNEL_VENV` points at the operator's managed kernel virtualenv. It is harness infrastructure, shared deliberately; everything a run is measured and audited by still lives in its own home.

## Stopping, and why autonomous mode is off

A stage ends when the entrant's turn ends, as it does on every other harness.

Prime Agent also ships `--autonomous`, an in-process continuation loop that re-prompts the agent whenever a turn produces no further output. It is off by default here because it is an intervention rather than wiring: no other harness in this benchmark continues an entrant that has stopped, and the only continuation the controller performs is the budget protocol's, driven by measured spend. Comparing a configuration that has it against configurations that cannot would not measure the model.

A row may still set `stage.autonomous: true`, and should pair it with `stage.autonomousGate`, the shell command the harness must see pass. Without a gate there is no terminal evidence to find, so the loop re-prompts a finished agent until it hits a limit — a measured stage spent $4.40 and eight minutes telling a finished agent to keep going 200 times. With `autonomous` enabled the adapter reports a limit stop as a completed stage and records the notice in `result.json`; the entrant's work is sealed and gated normally.

One cost of stopping with the entrant: delegated subagents are stopped when the parent session ends. An entrant that wants delegated work must wait for its children inside its own turn, which the harness's Python interface supports.

## Isolation

**There is no entrant sandbox.** The pi mechanism does not transfer: it wraps the harness's own tools, and Prime Agent executes through an IPython kernel process and spawns subagents as further processes, both outside the harness process a tool hook sees. A real boundary would have to enclose the whole process tree — which also carries the model API traffic the run depends on — so it would need an egress-allowlisted namespace rather than a tool wrapper. `prime-agent-cli` is named in `UNSANDBOXABLE_ADAPTERS` in `scripts/benchmark/entrant-sandbox.mjs`: the runner warns at launch, the manifest records `sandboxUnavailable: true`, and the contamination audit is the only control on the run. From v3 this is a warning rather than a bar — see `benchmark/controller/README.md`, "Entrant sandbox".

Harness isolation still applies: `PRIME_AGENT_CODING_AGENT_DIR` points at the run's harness home and the operator's stored `auth.json` is copied in, so sessions and cost never mix between runs or with the operator's own.

## What is captured

- `rollout.jsonl` — the parent session transcript, copied from the harness home. Session files are named by their own identifier rather than by the session id the event stream reports, so the adapter resolves one by reading each candidate's header.
- `subagent-rollouts/` — one transcript per delegated subagent, plus `rlm-subagents.jsonl`, the parent's registry of spawns with each child's prompt, model, and status. Subagent sessions live under `session-artifacts/<parent-session-id>/` in the harness home rather than beside the parent, so they are collected explicitly.
- `events.jsonl` — the retained event stream. As with pi, `message_update` events repeat the whole message built so far and are dropped as they stream; the dropped count is recorded. The complete transcript is `rollout.jsonl`.
- `final-message.md`, `command.json`, `selected-model.json`, `credential-source.json`, `result.json` — the same launch and identity provenance the other adapters record.

The contamination audit reads these natively: the session format is pi's, and the audit treats the `ipython` tool's `code` argument as shell activity, so `%%bash` commands and Python file reads are both evidence. It audits every subagent transcript alongside the parent — on a delegating entrant most tool calls are in the children.

## Cost

Measured after the run by ccusage's pi view, which reads Prime Agent's sessions unchanged. One thing has to be arranged first: the view only reads a `sessions/` directory, and a delegated subagent's transcript is not in one, so the cost module collects every transcript in the run's home into a single view directory of hard links and points ccusage at that. A run that delegates is priced on parent and children together; a solo run is unaffected.

The harness's own counter is the parent session's, so it cannot cross-check a total that includes subagents. `cost.reconciliation.status` is therefore `unavailable` for this harness, with that reason recorded, rather than a replay-versus-counter gap that would read as a discrepancy on every delegating run.

Whether the resulting figure is metered spend or rate-priced subscription usage depends on the configuration's provider, and the two must never be silently compared as the same kind of number.

## Completion and failure

A stage completes when the harness exits zero, reports one session id, and its final assistant message reports usage — or, under autonomous mode, when it stops at a limit. A nonzero exit, a timeout, a missing session id, missing usage, an unsupported effort, or a final assistant message carrying `stopReason: "error"` stops the run for controller-failure classification.

**A headless session ends at its first threshold compaction** ([prime-agent#674](https://github.com/PrimeIntellect-ai/prime-agent/issues/674)). The harness counts as idle while compaction runs, tears the connection down, and exits zero with the entrant's work half finished — so the stage looks complete and is not. The session shows one of two endings: a compaction after the agent loop's last end, or a post-compaction turn aborted with zero tokens.

The adapter detects both and resumes the same session itself, which puts the entrant back where it was with its compacted context and its untouched worktree. Each continuation warns on the console, writes the usual round-suffixed artifacts, and is recorded in `result.json` under `compactionContinuations`. The loop stops when a resumed round does no tool work — an entrant with nothing left to do — and the stage is then a normal completion carrying `compactionSettled`. Wall clock bounds it as it bounds everything else, with a defensive round cap behind that; a stage that exhausts the cap is failed as `truncated`, and the session is still intact:

```sh
npm run benchmark:run -- --resume benchmark/private/runs/<runId> --continue-stage true
```

**This is a workaround and should be deleted once the upstream issue is fixed.** It repairs a stop the harness should not have made, and nothing else: an entrant that chooses to stop is never continued, which is what separates it from autonomous mode and from the budget protocol. Budget rows are continued by the budget protocol as usual, and a budget round cut short by a compaction is repaired before its spend is measured.
