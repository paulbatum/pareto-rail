# Recipe: codex-terra-high

Status: draft; rehearsal-only until the failure taxonomy and remaining release controls are frozen.

This is the first Codex configuration trial. It is one unattended solo stage, not a controller-agent conversation. The deterministic controller starts a fresh `codex exec` process in the opaque entrant worktree, captures its JSONL event stream, then runs the normal administrative seal and gates.

## Identity

- Configuration id: `codex-terra-high`
- Stages: `solo`

## Shared inputs

- Entrant baseline: the rehearsal's declared baseline commit
- Shared assignment template: `benchmark/prompts/level-assignment.md`
- Rendered assignment: private controller artifact; supplied to the CLI as stdin byte-for-byte
- Standing brief: `docs/level-brief.md`
- Assigned theme: the frozen theme inserted into the rendered assignment
- Other supplied files: none
- Entrant checkout: the whole opaque worktree. The agent may read ordinary tracked repository material required by the standing brief. It must not receive `benchmark/private/`, other entrant worktrees, or any controller record.

## Runtime policy

- Overall timeout: 10,800 seconds, measured from process launch to exit.
- Operator interaction after launch: none.
- Network access: no `--search`. The `workspace-write` sandbox's own network default blocks outbound connections and loopback `listen()`, which prevents the entrant's own dev-server-backed self-checks (e.g. the browser-backed phase of `npm run check:floor`) from running inside its session. The adapter overrides this with `-c sandbox_workspace_write.network_access=true`, keeping every other sandbox restriction (filesystem confined to the worktree, no elevated approvals) in place. This is a declared harness override, not the CLI's out-of-the-box default.
- Harness continuation behavior: none. The controller starts one fresh local `codex exec` process per stage and never issues `codex exec resume`, `fork`, or any continuation command.
- Failure behavior: a nonzero exit, timeout, missing JSONL session id, missing `turn.completed` usage, or unsupported model/effort stops the run for controller-failure classification. At an eligible freeze, the controller must additionally compare the captured CLI/catalog artifacts to their frozen identities before classifying the run. Entrant and infrastructure classifications remain subject to the frozen taxonomy.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree and records its command, version, exit code, timing, and complete log as unmeasured deterministic setup. This is not a model stage.
- Commit behavior: the agent may use the normal repository workflow. After it exits, the controller seals permitted changes, then derives the payload.
- Controller usage treatment: deterministic/no model usage. The controller is a process runner, not a Codex agent.

## Stage: solo

- Role: `solo`
- Model provider: OpenAI Codex subscription
- Exact model selection: `gpt-5.6-terra` with `model_reasoning_effort="high"`. The CLI does not expose a dated Terra snapshot; capture `codex --version`, the complete `codex debug models --bundled` output, and the selected catalog entry. Do not describe this alias-like catalog slug as a weight-pinned snapshot.
- Harness and version: Codex CLI `0.144.0` for this rehearsal. The adapter records the installed version at launch; an eligible recipe must pin that exact observed version or intentionally revise and rehearse again.
- Session: fresh process following the continuation policy above. Native session persistence remains enabled for rollout capture.
- Working tree access: write access only to the entrant worktree through Codex `workspace-write` sandbox. No additional writable directories.
- Input artifacts from earlier stages: none.
- Required output artifact: code changes in the entrant worktree plus `final-message.md` and the `--json` event stream in private controller storage. The controller also copies the CLI's native session rollout when available.
- Stage timeout: 10,800 seconds.
- Completion condition: `codex exec` exits zero, reports one session id, and reports non-negative integer `input_tokens` and `output_tokens` in its final `turn.completed` JSONL event.

### Verbatim prompt

```text
The controller supplies the rendered benchmark assignment as the complete stdin prompt, byte-for-byte. No controller preface, progress note, or extra handoff text is added.
```

### Harness invocation

```sh
npm run benchmark:codex -- \
  --worktree /tmp/raild-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/codex \
  --model gpt-5.6-terra \
  --effort high \
  --timeout-seconds 10800
```

The adapter uses the following effective Codex arguments after validating the local bundled model catalog:

```text
codex exec --json --color never --ignore-user-config --ignore-rules --strict-config \
  -m gpt-5.6-terra -c model_reasoning_effort="high" -c approval_policy="never" \
  -c sandbox_workspace_write.network_access=true \
  -s workspace-write -C <worktree> --output-last-message <private-final-message> -
```

`--ignore-user-config` prevents the operator's default model, effort, MCP servers, hooks, and other personal settings from becoming an undeclared intervention; authentication remains available to Codex. `--ignore-rules` excludes user and project exec-policy rules, while tracked `AGENTS.md` and the task prompt remain normal repository context.

### Session rollout capture

The adapter omits `--ephemeral` so Codex persists its native session transcript — full reasoning and message/function-call payloads, not just the curated `--json` event stream — to `$CODEX_HOME/sessions/**/rollout-<timestamp>-<sessionId>.jsonl` (default `~/.codex/sessions`). After the stage exits, the adapter locates that file by the reported `thread.started` session id and copies it into private controller storage as `rollout.jsonl`. The original remains under the operator's normal Codex retention policy. Capture is best-effort: lookup or copy failure is recorded in `result.json` and does not fail an otherwise-complete stage. Record the `rollout` field verbatim; the controller does not issue `codex exec resume` against either copy.

### Usage and timing capture

- Usage source: Codex `--json` stdout. Preserve it exactly as `events.jsonl`; preserve stderr separately.
- Input-token field: `turn.completed.usage.input_tokens`.
- Output-token field: `turn.completed.usage.output_tokens`.
- Cache-read field: `turn.completed.usage.cached_input_tokens`, when present.
- Cache-write field: unavailable unless a future CLI event provides one.
- Reasoning-token treatment: record `turn.completed.usage.reasoning_output_tokens`, when present, as a vendor field. Do not add it to output tokens unless the captured event contract establishes that it is excluded.
- Session identifier source: `thread.started.thread_id` in JSONL.
- Wall-time boundaries: immediately before process spawn and after process exit, stored in `command.json`.
- Raw record path: `benchmark/private/runs/<opaque-run-id>/stages/solo/codex/` containing `command.json`, `events.jsonl`, `stderr.log`, `model-catalog.json`, `selected-model.json`, `raw-usage.json`, `result.json`, `final-message.md`, and `rollout.jsonl` when the session rollout was captured (see "Session rollout capture" above).

## Review and revision limits

This is a solo configuration. There are no plan, review, revision, continuation, retry, or operator-feedback stages.

## Mechanical gates

The controller runs only the four standard gates specified in `benchmark/controller/runbook.md` after sealing. No additional eligibility gate is declared by this recipe.

## Pricing

Use the dated [`benchmark/pricing/gpt-5.6-terra-standard-short.json`](../pricing/gpt-5.6-terra-standard-short.json) artifact for API-list-price-equivalent cost. It records the official standard short-context rates at authoring: $2.50/M uncached input, $0.25/M cached input, $3.125/M cache writes, and $15.00/M output. Calculate one stage as `(input_tokens - cached_input_tokens) × input rate + cached_input_tokens × cache-read rate + cache-write tokens × cache-write rate + output_tokens × output rate`, divided by one million. `reasoning_output_tokens` is not added separately because it is reported as a vendor field alongside `output_tokens`.

The actual run remains a Plus subscription run; record subscription expenditure separately and do not allocate the monthly fee across entrants. A run using another service or context tier must use another frozen pricing artifact rather than reusing the standard short-context input.

## Known harness defaults

- Codex CLI is run non-interactively with `codex exec`; no TUI, session picker, resume, cloud task, or user approval prompt is involved.
- The CLI's bundled model catalog and binary version are captured at every run because the selected slug is not a dated model snapshot.
- Codex receives the tracked repository instructions, including `AGENTS.md`; the controller does not inject an additional system prompt.
- The sandbox is `workspace-write` with `network_access=true`; web search is not enabled; personal user configuration and exec-policy rules are ignored. Network access is confined to the sandboxed process the same way filesystem access is confined to the worktree — it is not an escape from `workspace-write`.
