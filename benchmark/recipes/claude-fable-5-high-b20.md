# Recipe: claude-fable-5-high-b20

Status: draft; rehearsal-only until the failure taxonomy and remaining release controls are frozen.

This is the first Claude Code configuration trial. It is one unattended solo stage, not a controller-agent conversation. The deterministic controller starts a fresh `claude --print` process in the opaque entrant worktree, applies the declared budget protocol and any resulting continuation turns, captures every `stream-json` event log, then runs the normal administrative seal and gates.

## Identity

- Configuration id: `claude-fable-5-high-b20`
- Stages: `solo`
- Stage budget: `budget.usd: 20`

## Shared inputs

- Entrant baseline: the rehearsal's declared baseline commit
- Shared assignment template: `benchmark/prompts/level-assignment.md`
- Rendered assignment: private controller artifact; supplied to the CLI as stdin byte-for-byte
- Standing brief: `docs/level-brief.md`
- Assigned theme: the frozen theme inserted into the rendered assignment
- Other supplied files: none
- Entrant checkout: the whole opaque worktree. The agent may read ordinary tracked repository material required by the standing brief. It must not receive `benchmark/private/`, other entrant worktrees, or any controller record.

## Runtime policy

- Overall timeout: 43,200 seconds, measured from process launch to exit.
- Operator interaction after launch: none.
- Network access: unrestricted, matching the operator's own network access. Claude Code CLI has no OS-level sandbox equivalent to Codex's `workspace-write`, so there is no network toggle to declare.
- Working tree access: **weaker isolation than the Codex configuration.** Unattended operation requires `--permission-mode bypassPermissions`, which skips every permission prompt, including ones for filesystem writes or shell commands outside the worktree. Codex's `workspace-write` sandbox enforces filesystem confinement at the OS level; Claude Code CLI has no equivalent enforcement mechanism at any permission mode. Confinement to the worktree here is a non-adversarial convention identical in kind to the general worktree-access policy in `benchmark/controller/runbook.md`, not a technically enforced boundary, and it must not be described as one.
- Harness continuation behavior: task-budget protocol. The first turn is a fresh local `claude --print` process. A `PostToolUse` command hook is supplied in an extra settings file through `--settings <private-stage-dir>/budget/hook-settings.json`, composed with `--setting-sources project`; the hook injects relative task-budget notices without modifying the entrant worktree. The controller polls ccusage every 30 seconds and publishes spend state atomically. Notices occur at every 25% multiple with no upper bound; a poll that crosses several multiples announces only the highest and marks all lower thresholds covered. Below 100% the exact notice is `Task budget status: approximately {pct}% of the task budget has been used.` At 100% it is `Task budget status: approximately 100% of the task budget has been used. The budget is a guide rather than a hard cap, but you should now be working toward finalizing your submission.` Above 100% it is `Task budget status: approximately {pct}% of the task budget has been used. You are over budget — bring the work to a close and finalize your submission.` After a successful turn, the controller resumes when measured spend is below 75%, fewer than three resume rounds have been used, and at least 10 minutes remain before the stage deadline. The exact follow-up is `Budget check: you have used approximately {pct}% of the task budget, so meaningful budget remains. This is an opportunity to keep improving your level: raise the polish, depth, and quality wherever it falls short of your own standards. Continue working now; you will keep receiving task budget updates as you go.`
- Failure behavior: a nonzero exit, timeout, missing terminal `result` event, a `result.session_id` that does not match the pre-assigned `--session-id`, or missing/malformed `usage.input_tokens`/`usage.output_tokens` stops the run for controller-failure classification. At an eligible freeze, the controller must additionally compare the captured CLI version to its frozen identity before classifying the run. Entrant and infrastructure classifications remain subject to the frozen taxonomy.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree and records its command, version, exit code, timing, and complete log as unmeasured deterministic setup. This is not a model stage.
- Commit behavior: the agent may use the normal repository workflow. After it exits, the controller seals permitted changes, then derives the payload.
- Controller usage treatment: deterministic/no model usage. The controller is a process runner, not a Claude agent.

## Stage: solo

- Role: `solo`
- Model provider: Anthropic Claude Code subscription
- Exact model selection: `claude-fable-5` with `--effort high`. The CLI does not expose a model-catalog dump command (unlike Codex's `debug models --bundled`); capture `claude --version` and the resolved model reported in the JSONL `system`/`init` event's `model` field (available before any output) plus the terminal `result` event's `modelUsage` keys (the model actually billed). Do not describe `claude-fable-5` as a weight-pinned dated snapshot — the resolved id captured at runtime is the evidence of record.
- Harness and version: Claude Code CLI `2.1.207` is pinned for this configuration. The adapter records the installed version at launch; a version other than the pinned one is a controller failure under the frozen taxonomy rather than a silent substitution.
- Session: one pre-assigned session id across the fresh turn and any budget continuation turns. The first turn uses `--session-id`; each continuation uses `--resume <original-session-id>` without `--session-id`. Every terminal result must report the original id, and the one native transcript is appended across turns.
- Working tree access: no OS sandbox (see Runtime policy above). `--setting-sources project` excludes the operator's personal `~/.claude/settings.json`; `--strict-mcp-config` with no `--mcp-config` loads zero MCP servers. This repository has no tracked `.claude/` directory, so no repository-declared hooks or MCP servers apply either.
- Input artifacts from earlier stages: none.
- Required output artifact: code changes in the entrant worktree plus private controller artifacts. First-turn files keep their established names. Resume rounds use `events-resume-<n>.jsonl`, `stderr-resume-<n>.log`, `command-resume-<n>.json`, `raw-usage-resume-<n>.json`, and `final-message-resume-<n>.md`. `final-message.md` is replaced with the last turn's answer. `budget/` holds hook state and settings; `budget.json` records constants, notices, resume rounds, and final measured spend. The controller copies the one appended native transcript after the final turn when available.
- Stage timeout: 43,200 seconds.
- Completion condition: every executed turn exits zero, its JSONL output contains a terminal `type: "result"` event whose `session_id` equals the original pre-assigned id, and that event reports non-negative integer `usage.input_tokens` and `usage.output_tokens`. A nonzero exit or timeout stops continuation.

### Verbatim prompt

```text
The controller supplies the rendered benchmark assignment as the complete stdin prompt, byte-for-byte. No controller preface, progress note, or extra handoff text is added.
```

### Harness invocation

```sh
npm run benchmark:claude -- \
  --worktree /tmp/raild-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/claude \
  --model claude-fable-5 \
  --effort high \
  --budget-usd 20 \
  --timeout-seconds 43200
```

The adapter uses the following effective Claude Code arguments:

```text
claude --print --output-format stream-json --verbose \
  --model claude-fable-5 --effort high \
  --permission-mode bypassPermissions \
  --setting-sources project --strict-mcp-config \
  --settings <private-stage-dir>/budget/hook-settings.json \
  --session-id <pre-assigned-uuid> \
  -
```

The settings file contains `{"hooks":{"PostToolUse":[{"matcher":"","hooks":[{"type":"command","command":"node <absolute-budget-hook> <absolute-budget-dir>"}]}]}}`. Hook stdout uses `{"hookSpecificOutput":{"additionalContext":"<notice text>","hookEventName":"PostToolUse"}}`; `hookEventName` is required.

A continuation uses:

```text
claude --print --output-format stream-json --verbose \
  --resume <original-session-id> \
  --model claude-fable-5 --effort high \
  --permission-mode bypassPermissions \
  --setting-sources project --strict-mcp-config \
  --settings <private-stage-dir>/budget/hook-settings.json
```

The follow-up message is supplied on stdin. The whole-stage deadline is shared by all turns; no continuation gets a fresh timeout.

`--setting-sources project` prevents the operator's personal model/effort/hook defaults from becoming an undeclared intervention; the repository's tracked `CLAUDE.md`/`AGENTS.md` remain normal repository context, matching how Codex's `--ignore-rules` leaves tracked `AGENTS.md` untouched. Omitting `--mcp-config` together with `--strict-mcp-config` loads zero MCP servers. `--session-id` is generated by the deterministic controller (a random identifier for bookkeeping, not a model output) so the adapter knows exactly where to find the native transcript afterward instead of searching for it.

### Session rollout capture

The adapter omits `--no-session-persistence`, so Claude Code persists its native session transcript — full tool-call and message payloads, not just the curated `stream-json` event log — to `$CLAUDE_CONFIG_DIR/projects/<sanitized-worktree-path>/<sessionId>.jsonl` (default `~/.claude`; sanitization replaces every path separator with `-`). Because the adapter pre-assigns the session id, it looks up this path directly rather than searching for it. Resume turns append this original rollout. Capture runs once after the final turn and therefore includes the complete session. Capture is best-effort: a missing file is recorded in `result.json` and does not fail an otherwise-complete stage.

### Usage and timing capture

- Usage source: Claude `--output-format stream-json` stdout. Preserve it exactly as `events.jsonl`; preserve stderr separately.
- Input-token field: the terminal `result` event's `usage.input_tokens`. Unlike Codex, this is already the uncached remainder, not a total that includes cache hits — the adapter adds `usage.cache_read_input_tokens` back in before recording `inputTokens`, so the normalized field matches the total-including-cached shape used across adapters. These normalized counts are recorded for audit; run cost is measured by ccusage (see Cost below), not derived from them.
- Output-token field: the terminal `result` event's `usage.output_tokens`.
- Cache-read field: `usage.cache_read_input_tokens`.
- Cache-write field: `usage.cache_creation_input_tokens`. Unlike Codex, Claude Code reports this directly.
- Reasoning-token treatment: Claude Code does not report a separate thinking/reasoning token field — thinking tokens are folded into `usage.output_tokens` with no distinct field. Record `modelUsage` (a per-model breakdown reported alongside `usage`) and `total_cost_usd` as vendor fields for audit only.
- Session identifier source: the terminal `result` event's `session_id`, cross-checked by the adapter against the pre-assigned `--session-id`.
- Multi-model sessions: this solo configuration expects a single resolved model, so the terminal `result` event's `modelUsage` should contain one key. If a run nonetheless records more than one model, the ccusage cost method already attributes cost per model and the manifest emits one stage per model — no per-token pricing rule is involved. Deliberate delegation is a separate configuration (see `claude-fable-5-opus-delegation.md`).
- Wall-time boundaries: immediately before process spawn and after process exit, stored in `command.json`.
- Raw record path: `benchmark/private/runs/<opaque-run-id>/stages/solo/claude/` containing the first-turn artifacts under their established names, suffixed resume siblings when used, `budget/`, `budget.json`, and `rollout.jsonl` when the session transcript was captured.

## Review and revision limits

This is a solo configuration. There are no separate plan, review, or operator-feedback stages. Up to three same-session continuation turns may occur only through the declared under-budget gate; they are part of the one solo stage, not retries.

## Mechanical gates

The controller runs only the four standard gates specified in `benchmark/controller/runbook.md` after sealing. No additional eligibility gate is declared by this recipe.

## Cost

Cost is measured by [ccusage](https://github.com/ccusage/ccusage), pinned in the repository's `package.json` (`20.0.17`) and invoked with the repository's own Node. During and after the stage, the controller runs `ccusage claude session --json` scoped to this run's isolated `CLAUDE_CONFIG_DIR` home. ccusage parses the persisted rollouts and prices them with its own maintained rate database; the manifest records ccusage's computed USD as `cost.totalUsd`, the per-model detail from `modelBreakdowns` in `cost.models` (Claude reports per-model cost), and the tool/version provenance in `cost.costSource`. We do not compute prices ourselves, so no frozen pricing artifact can rot when rates change. The controller records the exact ccusage version in the manifest.

ccusage measures the whole isolated home, so every initial and resumed turn, delegated transcript if one unexpectedly appears, and model usage caused by the protocol itself are included in the run cost. The final manifest and `budget.json` use the same whole-home measurement basis.

The actual run remains a subscription run; record subscription expenditure separately and do not allocate the monthly fee across entrants. ccusage misses the small Claude background auxiliary-model usage that has no transcript (measured ~0.2%); that gap is accepted and not reconciled.

## Known harness defaults

- Claude Code CLI is run non-interactively with `--print`; no TUI, session picker, or interactive resume is involved. Budget continuation uses only the predeclared headless `--resume` command.
- The CLI's resolved model id is captured at every run (via the `system`/`init` event and `modelUsage`) because `claude-fable-5` is not itself a dated model snapshot, the same caveat Codex's alias-like catalog slugs carry. There is no bundled catalog dump command to cross-check against, unlike Codex.
- Claude Code receives the tracked repository instructions, including `CLAUDE.md`/`AGENTS.md`; the controller does not inject an additional system prompt.
- There is no OS-level sandbox. `--permission-mode bypassPermissions` disables every permission prompt so the process can run unattended; this is a materially weaker isolation guarantee than Codex's `workspace-write` sandbox and must be represented as such in any published comparison. Personal user configuration is excluded via `--setting-sources project`; no MCP servers are loaded.
- Available effort levels are `low`/`medium`/`high`/`xhigh`/`max` — there is no Claude Code equivalent of Codex's `ultra` effort tier.
