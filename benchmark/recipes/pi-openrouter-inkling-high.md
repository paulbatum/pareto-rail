# Recipe: pi-openrouter-inkling-high

Status: draft; pending rehearsal. This is the first eligible-track pi/OpenRouter configuration — every pi recipe committed so far (`pi-luna-low-smoke`, `pi-openrouter-deepseek-smoke`) is permanently ineligible. Do not treat any field below as frozen until a rehearsal run has confirmed pi's actual event shape, session mechanics, and effort mapping for this model; open items are called out explicitly rather than guessed past.

This configuration is one unattended solo stage, not a controller-agent conversation. The deterministic controller starts a fresh pi CLI process against an OpenRouter-hosted `thinkingmachines/inkling`, in the opaque entrant worktree, captures its JSON event stream, then runs the normal administrative seal and gates.

## Identity

- Configuration id: `pi-openrouter-inkling-high`
- Stages: `solo`
- Provider: `openrouter`
- Model: `thinkingmachines/inkling`
- Thinking level: **open item.** Inkling expresses its thinking budget as a number, not pi's `low`/`medium`/`high`/`xhigh`/`minimal`/`off` vocabulary. Whether OpenRouter's request layer accepts pi's named effort and translates it into Inkling's numeric parameter, or whether the adapter must pass a numeric value directly, is unconfirmed. This recipe's intent is the effort tier equivalent to `high` on the other solo configurations; the concrete request value must be captured and pinned at rehearsal before this configuration is eligible.
- pi CLI: version to be pinned at rehearsal (the existing smoke recipes pin `0.80.6`; carry that forward unless a newer version is required for OpenRouter reasoning-effort support).
- Stage timeout: 43,200 seconds, matching the other solo configurations.
- Task budget: none (see `pi-openrouter-inkling-high-b20` for the budgeted variant).
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
- Model provider: OpenRouter (`thinkingmachines/inkling`), metered API billing — not a subscription.
- Exact model selection: `thinkingmachines/inkling` at the effort described under Identity above.
- Harness and version: pi CLI, version pinned at rehearsal (see Identity).
- Session: fresh process; the adapter's normal isolated `PI_CODING_AGENT_DIR` and native session capture apply, matching `pi-luna-low-smoke.md` and `pi-openrouter-deepseek-smoke.md`.
- Working tree access: no OS sandbox (see Runtime policy above).
- Input artifacts from earlier stages: none.
- Required output artifact: code changes in the entrant worktree plus `final-message.md` and the captured event stream in private controller storage. The controller also copies the CLI's native session transcript when available.
- Stage timeout: 43,200 seconds.
- Completion condition: pi exits zero, reports one session id, and its final assistant message reports usage. The exact field names are to be confirmed at rehearsal against a live pi event stream; the other pi recipes have not yet exercised a non-smoke assignment.

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
  --model thinkingmachines/inkling \
  --provider openrouter \
  --effort high \
  --timeout-seconds 43200
```

The adapter's isolation, capture, and failure handling otherwise match `pi-openrouter-deepseek-smoke.md`, including the same `--offline --no-extensions` stage settings.

### Credential

The `openrouter` provider reads `OPENROUTER_API_KEY`. The adapter resolves it from the process environment first, then from the repository's ignored `.env`, and passes the resolved key to pi for this invocation only; the resolved source is recorded in the stage's `credential-source.json` and the key itself never reaches a run artifact. With no key on either path the adapter falls back to pi's own stored credential, which changes which account is billed — so a run whose `credential-source.json` reports `pi-stored-credential` for this configuration did not use the project key and its cost is attributed elsewhere.

Cost for this configuration is real metered API spend rather than subscription usage, so its measured figures are directly comparable to a published price list.

### Usage and timing capture

- Usage source: pi's JSON event stream. Per `benchmark/README.md`'s Cost section, each `message_end` event carries only that one API call's usage; the adapter sums assistant messages within the invocation. `message_update` events are dropped as they stream (each is superseded by the `message_end` that closes the same message) and the dropped count is recorded alongside the retained log — see the parent README for why (an unbounded pi session can otherwise emit event volume quadratic in message length).
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
- **Open items to resolve before this configuration is eligible:** the exact request-level encoding of "high" effort for Inkling's numeric thinking parameter; the pinned pi CLI version; and the exact usage/session JSON field names, none of which have been exercised by a real (non-smoke) pi assignment yet.
