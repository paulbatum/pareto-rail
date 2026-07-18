# Recipe: pi-openrouter-inkling-high-b20

Status: draft; pending rehearsal. This is the soft-budget variant of `pi-openrouter-inkling-high`, matching the $20 task-budget protocol used by `claude-fable-5-high-b20` and `codex-sol-high-b20`. It carries the same open item as the solo recipe (confirming the effort mapping and session/usage field names under a real assignment) plus the pi-specific budget mechanics below, none of which have been exercised by a real pi assignment yet. Do not treat any field as frozen until rehearsed.

`thinkingmachines/inkling` is not listed in pi's bundled `--list-models` catalog (checked at pi `0.80.10`), but pi resolves it directly as a "custom model id" with only a warning. The adapter's model-catalog check no longer gates on catalog presence, so this does not block the run — see `pi-openrouter-inkling-high.md` for detail.

This configuration is one unattended solo stage, not a controller-agent conversation. The deterministic controller starts a fresh pi CLI process against an OpenRouter-hosted `thinkingmachines/inkling`, applies the declared budget protocol and any resulting continuation turns, captures every event stream, then runs the normal administrative seal and gates.

## Identity

- Configuration id: `pi-openrouter-inkling-high-b20`
- Stages: `solo`
- Stage budget: `budget.usd: 20`
- Provider: `openrouter`
- Model: `thinkingmachines/inkling`
- Thinking level: `high`, passed as pi's ordinary named tier — manually confirmed to produce nonzero reasoning tokens against a live call (see `pi-openrouter-inkling-high.md`); still needs confirmation under a real assignment's sustained tool use.
- pi CLI: `0.80.10` or later, matching the solo recipe's pin.
- Stage timeout: 43,200 seconds.

## Shared inputs

Identical to `pi-openrouter-inkling-high`: the rendered assignment on stdin, the standing brief, the assigned theme, and the whole opaque entrant checkout with the same exclusions (`benchmark/private/`, other entrant worktrees, other controller records).

## Runtime policy

- Operator interaction after launch: none.
- Network access: unrestricted; no OS-level sandbox (see `pi-openrouter-inkling-high.md`).
- Harness continuation behavior: task-budget protocol. Per `benchmark/README.md`'s Cost section, pi's budget mechanism differs from Claude's and Codex's hook-based notices: "pi loads only a controller-owned extension that steers the same notice after a tool finishes." The first turn is a fresh local pi process. The controller polls ccusage every 30 seconds and publishes spend state atomically, using the same notice thresholds, wording, and resume gate as the other budgeted configurations: notices at every 25% multiple, the 100%-and-above wording switching from advisory to close-out, and same-session continuation whenever measured spend is below 75% and at least 10 minutes remain before the stage deadline, bounded by a defensive 20-round backstop. The exact extension-delivered notice text should match the Claude/Codex wording verbatim unless pi's extension mechanism requires a different delivery shape — confirm and record at rehearsal.
- Failure behavior: a nonzero exit, timeout, missing session id, or missing usage on any turn's final assistant message stops the run for controller-failure classification. A nonzero exit or timeout stops continuation.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree and records its command, version, exit code, timing, and complete log as unmeasured deterministic setup.
- Commit behavior: the agent may use the normal repository workflow. After it exits, the controller seals permitted changes, then derives the payload.
- Controller usage treatment: deterministic/no model usage.

## Stage: solo

- Role: `solo`
- Model provider: OpenRouter (`thinkingmachines/inkling`), metered API billing.
- Exact model selection: `thinkingmachines/inkling` at the effort described under Identity above.
- Harness and version: pi CLI `0.80.10` or later.
- Session: one pi session across the fresh turn and any budget continuation turns, mirroring the Claude/Codex same-session continuation discipline. Exact resume mechanism (session id flag, if any) to be confirmed at rehearsal.
- Working tree access: no OS sandbox.
- Input artifacts from earlier stages: none.
- Required output artifact: code changes in the entrant worktree plus private controller artifacts for every turn, `budget/` extension state, and `budget.json` recording constants, notices, resume rounds, and final measured spend.
- Stage timeout: 43,200 seconds, shared across all turns.
- Completion condition: every executed turn exits zero, reports the original session id, and its final assistant message reports usage. A nonzero exit or timeout stops continuation.

### Verbatim prompt

```text
The controller supplies the rendered benchmark assignment as the complete stdin prompt, byte-for-byte on the first turn. Continuation turns use the same budget-check wording as the other budgeted configurations. No other controller preface or handoff text is added.
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
  --budget-usd 20 \
  --timeout-seconds 43200
```

### Credential

Identical to `pi-openrouter-inkling-high.md`: `OPENROUTER_API_KEY` resolved from the environment, then the repository's ignored `.env`, then pi's own stored credential as a last resort, with the resolved source recorded in `credential-source.json`.

### Usage and timing capture

- Usage source: pi's JSON event stream, summed per invocation from `message_end` events across every turn, matching the parent README's Cost section treatment of pi's budget-continuation rounds ("its adapter sums assistant messages within an invocation... before applying the same ccusage cross-check").
- Session identifier source: pi's own session id, held constant across turns. Mechanism to be confirmed at rehearsal.
- Wall-time boundaries: immediately before process spawn and after final process exit, stored in `command.json`.
- Raw record path: `benchmark/private/runs/<opaque-run-id>/stages/solo/pi/`, with resume-turn artifacts suffixed to match the Claude/Codex b20 convention (`events-resume-<n>.jsonl`, etc.), plus `budget/` and `budget.json`.

## Review and revision limits

This is a solo configuration. There are no separate plan, review, or operator-feedback stages. Same-session continuation turns occur only through the declared under-budget gate; they are part of the one solo stage, not retries.

## Mechanical gates

The controller runs only the four standard gates specified in `benchmark/controller/README.md` after sealing. No additional eligibility gate is declared by this recipe.

## Cost

Cost is measured by [ccusage](https://github.com/ccusage/ccusage), pinned in the repository's `package.json` (`20.0.17`), using its pi view (`--pi-path` scoped to this run's isolated sessions directory) across all turns. The manifest records ccusage's computed USD as `cost.totalUsd` and the tool/version provenance in `cost.costSource`. This configuration bills real metered OpenRouter spend, not subscription usage.

## Known harness defaults

Same as `pi-openrouter-inkling-high.md`. The budget-extension mechanism itself (not this specific model) was rehearsed via `pi-luna-b20-smoke`, which ran the real controller pipeline with a deliberately small $2 budget against `gpt-5.6-luna` on pi's stored subscription credential — no OpenRouter cost involved. It confirmed: notice wording and thresholds match the Claude/Codex budgeted recipes verbatim (`Task budget status: approximately {pct}%...` and `Budget check: you have used approximately {pct}%...`), same-session resume correctly stops once measured spend crosses 75% (14 resume rounds observed, final fraction 76.5%), and `budget.json` records the expected `noticeHistory`/`resumes`/`finalSpendUsd` shape. **Still open:** that rehearsal used Luna/subscription billing, not this model over OpenRouter — the same mechanism should apply unchanged, but hasn't been confirmed against this configuration specifically.
