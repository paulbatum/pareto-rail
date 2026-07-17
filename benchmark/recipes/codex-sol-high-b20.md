# Recipe: codex-sol-high-b20

Status: draft; not yet rehearsed or eligible until the failure taxonomy and remaining release controls are frozen.

This Codex configuration is one unattended solo stage, not a controller-agent conversation. The deterministic controller starts a fresh `codex exec` process in the opaque entrant worktree, applies the declared budget protocol and any resulting continuation turns, captures every JSONL event stream, then runs the normal administrative seal and gates.

## Identity

- Configuration id: `codex-sol-high-b20`
- Stages: `solo`
- Stage budget: `budget.usd: 20`

## Shared inputs

- Entrant baseline: the run's declared baseline commit
- Shared assignment template: `benchmark/prompts/level-assignment.md`
- Rendered assignment: private controller artifact; supplied to the CLI as stdin byte-for-byte
- Standing brief: `docs/level-brief.md`
- Assigned theme: the frozen theme inserted into the rendered assignment
- Other supplied files: none
- Entrant checkout: the whole opaque worktree. The agent may read ordinary tracked repository material required by the standing brief. It must not receive `benchmark/private/`, other entrant worktrees, or any controller record.

## Runtime policy

- Overall timeout: 43,200 seconds, measured from process launch to exit.
- Operator interaction after launch: none.
- Network access: no `--search`. The `workspace-write` sandbox's own network default blocks outbound connections and loopback `listen()`, which prevents the entrant's own dev-server-backed self-checks (e.g. the browser-backed phase of `npm run check:floor`) from running inside its session. The adapter overrides this with `-c sandbox_workspace_write.network_access=true`, keeping every other sandbox restriction (filesystem confined to the worktree, no elevated approvals) in place. This is a declared harness override, not the CLI's out-of-the-box default.
- Harness continuation behavior: task-budget protocol. The first turn is a fresh local `codex exec` process. A `PostToolUse` command hook is written to the isolated `$CODEX_HOME/hooks.json`; because the adapter also uses `--ignore-user-config`, it explicitly adds `--dangerously-bypass-hook-trust`. The hook injects relative task-budget notices without modifying the entrant worktree. The controller polls ccusage every 30 seconds and publishes spend state atomically. Notices occur at every 25% multiple with no upper bound; a poll that crosses several multiples announces only the highest and marks all lower thresholds covered. Below 100% the exact notice is `Task budget status: approximately {pct}% of the task budget has been used.` At 100% it is `Task budget status: approximately 100% of the task budget has been used. The budget is a guide rather than a hard cap, but you should now be working toward finalizing your submission.` Above 100% it is `Task budget status: approximately {pct}% of the task budget has been used. You are over budget — bring the work to a close and finalize your submission. If the working tree currently fails any required check, revert to the last commit where everything passed before finalizing.` After a successful turn, the controller resumes whenever measured spend is below 75% and at least 10 minutes remain before the stage deadline; resumes are not capped at a small number, and a defensive backstop of 20 rounds guards only against a runaway loop. The exact follow-up is `Budget check: you have used approximately {pct}% of the task budget. The benchmark expects the task budget to be spent on the level's quality, and a submission that leaves most of the budget unused will keep being resumed like this one. Continue now and raise the polish, depth, and quality of your level; you will keep receiving task budget updates as you go.`
- Failure behavior: a nonzero exit, timeout, missing JSONL session id, missing `turn.completed` usage, or unsupported model/effort stops the run for controller-failure classification. At an eligible freeze, the controller must additionally compare the captured CLI/catalog artifacts to their frozen identities before classifying the run. Entrant and infrastructure classifications remain subject to the frozen taxonomy.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree and records its command, version, exit code, timing, and complete log as unmeasured deterministic setup. This is not a model stage.
- Commit behavior: the agent may use the normal repository workflow. After it exits, the controller seals permitted changes, then derives the payload.
- Controller usage treatment: deterministic/no model usage. The controller is a process runner, not a Codex agent.

## Stage: solo

- Role: `solo`
- Model provider: OpenAI Codex subscription
- Exact model selection: `gpt-5.6-sol` with `model_reasoning_effort="high"`. The CLI does not expose a dated Sol snapshot; capture `codex --version`, the complete `codex debug models --bundled` output, and the selected catalog entry. Do not describe this alias-like catalog slug as a weight-pinned snapshot.
- Harness and version: Codex CLI `0.144.1` is pinned for this configuration. The adapter records the installed version at launch; a version other than the pinned one is a controller failure under the frozen taxonomy rather than a silent substitution.
- Session: one Codex thread across the fresh turn and any budget continuation turns. The first turn discovers the `thread.started.thread_id`; every `codex exec resume` event stream must report that original id. Native persistence stays enabled and the same rollout is appended across turns.
- Working tree access: write access only to the entrant worktree through Codex `workspace-write` sandbox. No additional writable directories.
- Input artifacts from earlier stages: none.
- Required output artifact: code changes in the entrant worktree plus private controller artifacts. First-turn files keep their established names. Resume rounds use `events-resume-<n>.jsonl`, `stderr-resume-<n>.log`, `command-resume-<n>.json`, `raw-usage-resume-<n>.json`, and `final-message-resume-<n>.md`. `final-message.md` is replaced with the last turn's answer. `budget/` holds hook state; `budget.json` records constants, notices, resume rounds, and final measured spend. The controller copies the one appended native rollout after the final turn when available.
- Stage timeout: 43,200 seconds.
- Completion condition: every executed turn exits zero, reports the original thread id, and reports non-negative integer `input_tokens` and `output_tokens` in its final `turn.completed` JSONL event. A nonzero exit or timeout stops continuation.

### Verbatim prompt

```text
The controller supplies the rendered benchmark assignment as the complete stdin prompt, byte-for-byte. No controller preface, progress note, or extra handoff text is added.
```

### Harness invocation

```sh
npm run benchmark:codex -- \
  --worktree /tmp/pareto-rail-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/codex \
  --model gpt-5.6-sol \
  --effort high \
  --budget-usd 20 \
  --timeout-seconds 43200
```

The adapter uses the following effective Codex arguments after validating the local bundled model catalog:

```text
codex exec --json --color never --ignore-user-config --ignore-rules --strict-config \
  -m gpt-5.6-sol -c model_reasoning_effort="high" -c approval_policy="never" \
  -c sandbox_workspace_write.network_access=true \
  --dangerously-bypass-hook-trust \
  -s workspace-write -C <worktree> --output-last-message <private-final-message> -
```

`$CODEX_HOME/hooks.json` contains `{"hooks":{"PostToolUse":[{"hooks":[{"type":"command","command":"node <absolute-budget-hook> <absolute-budget-dir>"}]}]}}`. Hook stdout uses `{"hookSpecificOutput":{"additionalContext":"<notice text>","hookEventName":"PostToolUse"}}`; `hookEventName` is required.

A continuation is launched with the entrant worktree as its current directory and uses:

```text
codex exec --color never resume <original-thread-id> --json \
  --ignore-user-config --ignore-rules --strict-config \
  -m gpt-5.6-sol -c model_reasoning_effort="high" \
  -c approval_policy="never" -c sandbox_mode="workspace-write" \
  -c sandbox_workspace_write.network_access=true \
  --dangerously-bypass-hook-trust \
  --output-last-message <turn-specific-file> -
```

`exec resume` has no `-C` or `-s`; the launch current directory and explicit `sandbox_mode`, model, effort, approval, and network overrides restore the declared environment. The follow-up is supplied on stdin. The whole-stage deadline is shared by all turns; no continuation gets a fresh timeout.

`--ignore-user-config` prevents the operator's default model, effort, MCP servers, hooks, and other personal settings from becoming an undeclared intervention; authentication remains available to Codex. `--ignore-rules` excludes user and project exec-policy rules, while tracked `AGENTS.md` and the task prompt remain normal repository context.

### Session rollout capture

The adapter omits `--ephemeral` so Codex persists its native session transcript — full reasoning and message/function-call payloads, not just the curated `--json` event stream — to `$CODEX_HOME/sessions/**/rollout-<timestamp>-<sessionId>.jsonl` (default `~/.codex/sessions`). After the stage exits, the adapter locates that file by the reported `thread.started` session id and copies it into private controller storage as `rollout.jsonl`. The original remains under the operator's normal Codex retention policy. Resume turns append this original rollout. Capture runs once after the final turn and therefore includes the complete thread. Capture is best-effort: lookup or copy failure is recorded in `result.json` and does not fail an otherwise-complete stage.

### Usage and timing capture

- Usage source: Codex `--json` stdout. Preserve it exactly as `events.jsonl`; preserve stderr separately.
- Input-token field: `turn.completed.usage.input_tokens`.
- Output-token field: `turn.completed.usage.output_tokens`.
- Cache-read field: `turn.completed.usage.cached_input_tokens`, when present.
- Cache-write field: unavailable unless a future CLI event provides one.
- Reasoning-token treatment: record `turn.completed.usage.reasoning_output_tokens`, when present, as a vendor field. Do not add it to output tokens unless the captured event contract establishes that it is excluded.
- Session identifier source: `thread.started.thread_id` in JSONL.
- Wall-time boundaries: immediately before process spawn and after process exit, stored in `command.json`.
- Raw record path: `benchmark/private/runs/<opaque-run-id>/stages/solo/codex/` containing the first-turn artifacts under their established names, suffixed resume siblings when used, `budget/`, `budget.json`, and `rollout.jsonl` when the session rollout was captured.

## Review and revision limits

This is a solo configuration. There are no separate plan, review, or operator-feedback stages. Up to three same-thread continuation turns may occur only through the declared under-budget gate; they are part of the one solo stage, not retries.

## Mechanical gates

The controller runs only the four standard gates specified in `benchmark/controller/runbook.md` after sealing. No additional eligibility gate is declared by this recipe.

## Cost

Cost is measured by [ccusage](https://github.com/ccusage/ccusage), pinned in the repository's `package.json` (`20.0.17`) and invoked with the repository's own Node. During and after the stage, the controller runs `ccusage codex session --json` scoped to this run's isolated `CODEX_HOME`. ccusage parses the persisted session rollouts and prices them with its own maintained rate database; the manifest records ccusage's computed USD as `cost.totalUsd` and the tool/version provenance in `cost.costSource`. ccusage attributes per-model **tokens** for Codex but not per-model cost, so `cost.models` carries per-model token detail with no per-model `costUsd`, and the manifest's single stage carries the run total. We do not compute prices ourselves, so no frozen pricing artifact can rot when rates change.

ccusage measures the whole isolated home, so every initial and resumed turn, delegated transcript if one unexpectedly appears, and model usage caused by the protocol itself are included in the run cost. The final manifest and `budget.json` use the same whole-home measurement basis.

The actual run remains a subscription run; record subscription expenditure separately and do not allocate the monthly fee across entrants.

## Known harness defaults

- Codex CLI is run non-interactively with `codex exec`; no TUI, session picker, cloud task, or user approval prompt is involved. Budget continuation uses only the predeclared headless `codex exec resume` command.
- The CLI's bundled model catalog and binary version are captured at every run because the selected Sol slug is not a dated model snapshot.
- Codex receives the tracked repository instructions, including `AGENTS.md`; the controller does not inject an additional system prompt.
- The sandbox is `workspace-write` with `network_access=true`; web search is not enabled; personal user configuration and exec-policy rules are ignored. Network access is confined to the sandboxed process the same way filesystem access is confined to the worktree — it is not an escape from `workspace-write`.
