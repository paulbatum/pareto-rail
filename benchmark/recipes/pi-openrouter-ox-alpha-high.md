# Recipe: pi-openrouter-ox-alpha-high

This configuration is one unattended solo stage, not a controller-agent conversation. The deterministic controller starts a fresh pi CLI process against an OpenRouter-hosted `stealth/ox-alpha`, in the opaque entrant worktree, captures its JSON event stream, then runs the normal administrative seal and gates.

## Identity

- Configuration id: `pi-openrouter-ox-alpha-high`
- Stages: `solo`
- Provider: `openrouter`
- Model: `stealth/ox-alpha`, a cloaked model published for evaluation. pi has no catalog entry for the id, so it is passed through as a custom model and the adapter's model-catalog check records the absence; the stage prints `Warning: Model "stealth/ox-alpha" not found for provider "openrouter". Using custom model id.` on stderr. The check is audit-only and does not gate the run.
- Thinking level: `high`. The cloak documents no reasoning tier, so `high` stands in to match the other solo configurations rather than to select a documented ladder position.
- Stage timeout: 43,200 seconds, matching the other solo configurations.
- Task budget: none.
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
- Network access: unrestricted under this plan's open baseline policy. pi has no native sandbox, so the contamination audit is the control on what the entrant reached.
- Harness continuation behavior: none. The controller starts one fresh local pi process per stage and issues no resume.
- Failure behavior: a nonzero exit, timeout, missing session id, or missing usage on the final assistant message stops the run for controller-failure classification. A final assistant message carrying `stopReason: "error"` is treated as a dead stage rather than a completion.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree and records its command, version, exit code, timing, and complete log as unmeasured deterministic setup. This is not a model stage.
- Commit behavior: the agent may use the normal repository workflow. After it exits, the controller seals permitted changes, then derives the payload.
- Controller usage treatment: deterministic/no model usage. The controller is a process runner, not a pi agent.

## Stage: solo

- Role: `solo`
- Model provider: OpenRouter (`stealth/ox-alpha`)
- Exact model selection: `stealth/ox-alpha` at `high` reasoning effort (see Identity above).
- Session: fresh process; the adapter's normal isolated `PI_CODING_AGENT_DIR` and native session capture apply.
- Working tree access: no OS sandbox (see Runtime policy above).
- Input artifacts from earlier stages: none.
- Required output artifact: code changes in the entrant worktree plus `final-message.md` and the captured event stream in private controller storage. The controller also copies the CLI's native session transcript.
- Stage timeout: 43,200 seconds.
- Completion condition: pi exits zero, reports one session id, and its final assistant message reports usage.

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
  --model stealth/ox-alpha \
  --provider openrouter \
  --effort high \
  --timeout-seconds 43200
```

### Credential

The `openrouter` provider reads `OPENROUTER_API_KEY`. The adapter resolves it from the process environment first, then from the repository's ignored `.env`, and passes the resolved key to pi for this invocation only; the resolved source is recorded in the stage's `credential-source.json` and the key itself never reaches a run artifact. With no key on either path the adapter falls back to pi's own stored credential, which changes which account is billed — so a run whose `credential-source.json` reports `pi-stored-credential` for this configuration did not use the project key.

### Usage and timing capture

- Usage source: pi's JSON event stream. Each `message_end` event carries one API call's usage, so the adapter sums assistant messages within the invocation. `message_update` events are dropped as they stream, each superseded by the `message_end` that closes the same message, and the dropped count is recorded alongside the retained log.
- Session identifier source: pi's own session id, as captured by the adapter.
- Wall-time boundaries: immediately before process spawn and after process exit, stored in `command.json`.
- Raw record path: `benchmark/private/runs/<opaque-run-id>/stages/solo/pi/`.

## Review and revision limits

This is a solo configuration. There are no plan, review, revision, continuation, retry, or operator-feedback stages.

## Mechanical gates

The controller runs only the four standard gates specified in `benchmark/controller/README.md` after sealing. No additional eligibility gate is declared by this recipe.

## Cost

This configuration cannot be priced. OpenRouter publishes the model at a zero price and bills nothing for it, and pi has no catalog entry for the id, so pi's session figure comes from a fallback rate card and describes no charge anyone incurred. The model id is listed in `UNPRICED_MODELS` in `scripts/benchmark/run.mjs`, so a run records `cost.status: "unavailable"` with that reason, keeps its token counts, and carries no dollar figure at any level. The rank catalog publishes such an entrant with no `generationCost`, which keeps it out of the scheduling pool while it stays playable in the gallery. Pricing the model later restores both the cost and the votes already cast; the procedure is "Pricing a model that could not be priced" in `benchmark/README.md`.

## Known harness defaults

- pi has no OS-level sandbox; under an open baseline policy, unattended operation relies on `--approve` trusting the entrant worktree, not an enforced boundary.
- The stage runs `--offline --no-extensions` so startup version checks and operator-installed extensions cannot vary between runs.
