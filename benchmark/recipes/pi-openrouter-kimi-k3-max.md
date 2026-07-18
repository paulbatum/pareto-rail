# Recipe: pi-openrouter-kimi-k3-max

Status: draft; pending rehearsal. Every pi recipe committed so far (`pi-luna-low-smoke`, `pi-openrouter-deepseek-smoke`) is permanently ineligible; this and `pi-openrouter-inkling-high` are the first eligible-track pi/OpenRouter configurations. Do not treat any field below as frozen until a rehearsal run has confirmed pi's actual event shape and session mechanics for this model.

Availability note: this model has been reported flaky on OpenRouter. A manual check of 5 back-to-back trivial calls at `--thinking max` all succeeded in 4-6 seconds each with no errors, but that is a weak signal — a single-turn, no-tools prompt doesn't exercise the sustained tool-calling load a real level-generation stage produces. Treat the smoke rehearsal as the real test of how often this model fails or stalls under realistic load, and record the failure rate observed.

This configuration is one unattended solo stage, not a controller-agent conversation. The deterministic controller starts a fresh pi CLI process against an OpenRouter-hosted `moonshotai/kimi-k3`, in the opaque entrant worktree, captures its JSON event stream, then runs the normal administrative seal and gates.

## Identity

- Configuration id: `pi-openrouter-kimi-k3-max`
- Stages: `solo`
- Provider: `openrouter`
- Model: `moonshotai/kimi-k3`
- Thinking level: `max`. Kimi K3 exposes a single reasoning tier upstream rather than pi's `low`/`medium`/`high`/`xhigh` ladder; `max` is the only supported value and is used here in place of the `high` tier the other solo configurations use, not as an intensified variant of it. `max` is a plain member of pi's own effort vocabulary (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`, confirmed in `scripts/benchmark/pi-cli.mjs`'s `THINKING` set), so `--effort max` is accepted directly with no adapter special-casing; manually confirmed against a live call to produce nonzero reasoning tokens.
- pi CLI: `0.80.10` or later. `moonshotai/kimi-k3` is absent from pi's bundled catalog at `0.80.6` (the version the earlier smoke recipes pin) and first appears at `0.80.10`, the version this recipe was manually verified against. The adapter's model-catalog check is audit-only and does not gate on catalog presence regardless, but pin the newer version anyway since it's confirmed to include this model.
- Stage timeout: 43,200 seconds, matching the other solo configurations.
- Task budget: none (see `pi-openrouter-kimi-k3-max-b20` for the budgeted variant).
- Continuations: none.

## Shared inputs

- Entrant baseline: the run's declared baseline commit
- Shared assignment template: `benchmark/prompts/level-assignment.md`
- Rendered assignment: private controller artifact; supplied to the CLI as stdin byte-for-byte
- Standing brief: `docs/level-brief.md`
- Assigned theme: the frozen theme inserted into the rendered assignment
- Other supplied files: none
- Entrant checkout: the whole opaque worktree. The agent may read ordinary tracked repository material required by the standing brief. It must not receive `benchmark/private/`, other entrant worktrees, or any controller record.

## Runtime policy

- Operator interaction after launch: none.
- Network access: unrestricted. Like Claude Code CLI and unlike Codex, pi has no OS-level sandbox; unattended operation relies on `--approve` trusting the entrant worktree rather than an enforced filesystem or network boundary, the same material harness difference documented in `pi-luna-low-smoke.md`.
- Harness continuation behavior: none for this variant. The controller starts one fresh local pi process per stage and issues no resume.
- Failure behavior: a nonzero exit, timeout, missing session id, missing usage on the final assistant message, or unsupported model/effort stops the run for controller-failure classification. At an eligible freeze, the controller must additionally compare the captured CLI version and OpenRouter model-catalog entry to their frozen identities before classifying the run.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree and records its command, version, exit code, timing, and complete log as unmeasured deterministic setup. This is not a model stage.
- Commit behavior: the agent may use the normal repository workflow. After it exits, the controller seals permitted changes, then derives the payload.
- Controller usage treatment: deterministic/no model usage. The controller is a process runner, not a pi agent.

## Stage: solo

- Role: `solo`
- Model provider: OpenRouter (`moonshotai/kimi-k3`), metered API billing — not a subscription.
- Exact model selection: `moonshotai/kimi-k3` at `max` reasoning effort (see Identity above).
- Harness and version: pi CLI `0.80.10` or later (see Identity).
- Session: fresh process; the adapter's normal isolated `PI_CODING_AGENT_DIR` and native session capture apply, matching `pi-luna-low-smoke.md` and `pi-openrouter-deepseek-smoke.md`.
- Working tree access: no OS sandbox (see Runtime policy above).
- Input artifacts from earlier stages: none.
- Required output artifact: code changes in the entrant worktree plus `final-message.md` and the captured event stream in private controller storage. The controller also copies the CLI's native session transcript when available.
- Stage timeout: 43,200 seconds.
- Completion condition: pi exits zero, reports one session id, and its final assistant message reports usage. The exact field names are to be confirmed at rehearsal against a live pi event stream.

### Verbatim prompt

```text
The controller supplies the rendered benchmark assignment as the complete stdin prompt, byte-for-byte. No controller preface, progress note, or extra handoff text is added.
```

### Harness invocation

```sh
npm run benchmark:pi -- \
  --worktree /tmp/pareto-rail-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/pi \
  --model moonshotai/kimi-k3 \
  --provider openrouter \
  --effort max \
  --timeout-seconds 43200
```

The adapter's isolation, capture, and failure handling otherwise match `pi-openrouter-deepseek-smoke.md`, including the same `--offline --no-extensions` stage settings. Whether `--effort max` is accepted as-is by the pinned pi CLI, versus requiring an adapter-side special case for this model, is an open item for rehearsal.

### Credential

The `openrouter` provider reads `OPENROUTER_API_KEY`. The adapter resolves it from the process environment first, then from the repository's ignored `.env`, and passes the resolved key to pi for this invocation only; the resolved source is recorded in the stage's `credential-source.json` and the key itself never reaches a run artifact. With no key on either path the adapter falls back to pi's own stored credential, which changes which account is billed — so a run whose `credential-source.json` reports `pi-stored-credential` for this configuration did not use the project key and its cost is attributed elsewhere.

Cost for this configuration is real metered API spend rather than subscription usage, so its measured figures are directly comparable to a published price list.

### Usage and timing capture

- Usage source: pi's JSON event stream. Per `benchmark/README.md`'s Cost section, each `message_end` event carries only that one API call's usage; the adapter sums assistant messages within the invocation. `message_update` events are dropped as they stream (each is superseded by the `message_end` that closes the same message) and the dropped count is recorded alongside the retained log. A manual `--mode json` call confirmed the shape: `message_end.message.usage` carries `input`, `output`, `cacheRead`, `cacheWrite`, `reasoning`, and `totalTokens`, plus a `cost` object with `input`/`output`/`cacheRead`/`cacheWrite`/`total` in USD.
- Session identifier source: pi's own session id, as captured by the adapter's existing smoke-recipe mechanism. Exact field name to be confirmed at rehearsal.
- Wall-time boundaries: immediately before process spawn and after process exit, stored in `command.json`.
- Raw record path: `benchmark/private/runs/<opaque-run-id>/stages/solo/pi/`, matching the layout established by the smoke recipes plus `rollout.jsonl`/session-file capture when available.

## Review and revision limits

This is a solo configuration. There are no plan, review, revision, continuation, retry, or operator-feedback stages.

## Mechanical gates

The controller runs only the four standard gates specified in `benchmark/controller/README.md` after sealing. No additional eligibility gate is declared by this recipe.

## Cost

Cost is measured by [ccusage](https://github.com/ccusage/ccusage), pinned in the repository's `package.json` (`20.0.17`) and invoked with the repository's own Node, using its pi view (`--pi-path` scoped to this run's isolated sessions directory) as described in `benchmark/README.md`. The manifest records ccusage's computed USD as `cost.totalUsd` and the tool/version provenance in `cost.costSource`. Because this configuration reaches its model through OpenRouter with an API key, its billing path is real metered spend, not subscription usage — `cost.orchestrationTreatment` and the subscription caveat therefore differ from the Claude and Codex solo configurations, as described in the parent README's Cost section.

## Known harness defaults

- pi has no OS-level sandbox; unattended operation relies on `--approve` trusting the entrant worktree, not an enforced boundary.
- The stage runs `--offline --no-extensions` so startup version checks and operator-installed extensions cannot vary between runs.
- **Rehearsed:** `pi-openrouter-kimi-k3-smoke` ran this exact model/effort/harness combination through the real controller pipeline (`scripts/benchmark/run.mjs`) against the genuine `benchmark/prompts/level-assignment.md` template. It ran the full 900-second smoke window (38 assistant turns, ~115 tool calls) with zero errors or retries in the event log, hit the smoke timeout mid-task (expected — it's a 15-minute window against a real assignment), and was accepted and sealed via `--accept-stage-output true`; `typecheck`/`build`/`scope` gates passed (`floor` failed, expected for an interrupted stage). Measured cost was $1.56. This is the strongest evidence so far against the reported OpenRouter flakiness for this model: a real 15-minute sustained coding-agent session with no failures, well beyond the 5 trivial single-turn calls checked earlier. **Still open before freeze:** one 15-minute rehearsal is not proof of reliability over the real 43,200-second timeout; run more rehearsals (or accept the risk explicitly) before treating this configuration's availability as settled.
