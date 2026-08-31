# Mechanism: Codex CLI

The Codex harness. One unattended `codex exec` process per stage, launched by the deterministic controller in the opaque entrant worktree, with its JSONL event stream captured. The controller is a process runner, not a Codex agent, so it contributes no model usage of its own.

The adapter is `scripts/benchmark/codex-cli.mjs`. It is pinned by the plan's materials commit, so the exact behavior any run had is recoverable from that commit rather than from this description.

## Knobs

Set per configuration in the plan row's `stage` block, not here:

`model`, `effort`, `timeoutSeconds`, `budget.usd`, `networkAccess`, `enable-multi-agent`.

## Model and effort

The CLI exposes no dated model snapshots — the selectable values are alias-like catalog slugs, and must never be described as weight-pinned. What stands as evidence is captured per run: `codex --version`, the complete `codex debug models --bundled` output, and the selected catalog entry, written to `model-catalog.json` and `selected-model.json`.

Which reasoning efforts exist is a property of the bundled catalog, not of this document or of any configuration. The adapter reads `supported_reasoning_levels` for the requested slug and refuses to launch if the requested effort is absent, so an effort that a model does not offer fails before the run rather than silently downgrading. Codex is currently the only harness whose catalog reaches above `max`.

## Invocation

```sh
npm run benchmark:codex -- \
  --worktree <entrant-worktree> \
  --prompt <private-rendered-assignment> \
  --out <private-stage-directory> \
  --model <catalog-slug> \
  --effort <catalog-effort> \
  --network-access <true|false> \
  --timeout-seconds <seconds>
```

The rendered assignment is supplied as the complete stdin prompt, byte-for-byte. The controller adds no preface, progress note, or handoff text.

The effective `codex exec` arguments — the permission profile, `approval_policy`, `features.network_proxy`, `--ignore-user-config`, `--ignore-rules`, `--strict-config` — are constructed by the adapter and recorded verbatim in the stage's `command.json`. Read that file, not this section, to learn what a given run actually ran.

`--ignore-user-config` keeps the operator's own model, effort, MCP servers, and hooks from becoming an undeclared intervention; authentication still resolves. `--ignore-rules` excludes user and project exec-policy rules. Tracked repository instructions, including `AGENTS.md`, remain normal context — the controller injects no additional system prompt. Web search is never enabled.

## Isolation

The entrant sandbox is owned by `benchmark/controller/README.md`, "Entrant sandbox", which describes activation, the Codex permission profile, the loopback-only network mode, and the browser steering that follows from it. Do not restate the boundary here; a configuration that needs to say something about isolation says it by setting `networkAccess` in its plan row.

## Session rollout capture

The adapter omits `--ephemeral`, so Codex persists its native transcript — full reasoning and message payloads, not just the curated `--json` stream — under the run's isolated `CODEX_HOME`. After the stage exits the adapter locates that file by the reported `thread.started` session id and copies it in as `rollout.jsonl`. Capture is best-effort: a lookup or copy failure is recorded in `result.json` and does not fail an otherwise-complete stage. The controller never issues `codex exec resume` against a copy.

Under the budget protocol, resume turns append to this one rollout and capture runs once after the final turn, so the captured file covers the whole thread.

## Usage and timing

- Usage source: the `--json` stdout, preserved exactly as `events.jsonl`; stderr preserved separately.
- Tokens: `turn.completed.usage.input_tokens` and `output_tokens`; `cached_input_tokens` when present. No cache-write field is available.
- Reasoning tokens: `turn.completed.usage.reasoning_output_tokens` recorded as a vendor field, never added to output tokens.
- Session id: `thread.started.thread_id`.
- Wall time: recorded around process spawn and exit in `command.json`.
- Stage artifacts live under `benchmark/private/runs/<run-id>/stages/<stage>/codex/`.

Note that `codex exec --json` stdout usage reflects the root thread only and omits spawned subagent threads. The complete picture is in the persisted rollouts, which is what ccusage reads.

## Completion and failure

A stage completes when `codex exec` exits zero, reports one session id, and reports non-negative integer input and output tokens in its final `turn.completed` event. A nonzero exit, a timeout, a missing session id, missing usage, or an unsupported model or effort stops the run for controller-failure classification.

## Cost

Measured after the run by ccusage against the run's isolated `CODEX_HOME`, per `benchmark/README.md`, "Cost". Codex is the harness for which ccusage attributes per-model tokens but not per-model cost, so `cost.models` carries token detail without a per-model `costUsd` and the run total stands.

No usage counter is captured for this harness in practice: every Codex run on record writes `cost.reconciliation.status: "unavailable"`, where Claude runs write `agreed`. So a Codex cost figure rests on transcript replay with no second source to catch a replay that lost a message — the gap the cross-check exists to find. Treat the number as single-sourced. Where a resumed round does report a counter, it restates the whole session rather than that round's share, so the final round's counter would be the run's counter and rounds are never summed.
