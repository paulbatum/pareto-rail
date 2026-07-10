# Recipe: claude-fable-5-high

Status: draft; rehearsal-only until the failure taxonomy and remaining release controls are frozen.

This is the first Claude Code configuration trial. It is one unattended solo stage, not a controller-agent conversation. The deterministic controller starts a fresh `claude --print` process in the opaque entrant worktree, captures its `stream-json` event log, then runs the normal administrative seal and gates.

## Identity

- Configuration id: `claude-fable-5-high`
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
- Network access: unrestricted, matching the operator's own network access. Claude Code CLI has no OS-level sandbox equivalent to Codex's `workspace-write`, so there is no network toggle to declare.
- Working tree access: **weaker isolation than the Codex configuration.** Unattended operation requires `--permission-mode bypassPermissions`, which skips every permission prompt, including ones for filesystem writes or shell commands outside the worktree. Codex's `workspace-write` sandbox enforces filesystem confinement at the OS level; Claude Code CLI has no equivalent enforcement mechanism at any permission mode. Confinement to the worktree here is a non-adversarial convention identical in kind to the general worktree-access policy in `benchmark/controller/runbook.md`, not a technically enforced boundary, and it must not be described as one.
- Harness continuation behavior: none. The controller starts one fresh local `claude --print` process per stage and never issues `claude --resume`, `--continue`, `--fork-session`, or any other continuation flag.
- Failure behavior: a nonzero exit, timeout, missing terminal `result` event, a `result.session_id` that does not match the pre-assigned `--session-id`, or missing/malformed `usage.input_tokens`/`usage.output_tokens` stops the run for controller-failure classification. At an eligible freeze, the controller must additionally compare the captured CLI version to its frozen identity before classifying the run. Entrant and infrastructure classifications remain subject to the frozen taxonomy.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree and records its command, version, exit code, timing, and complete log as unmeasured deterministic setup. This is not a model stage.
- Commit behavior: the agent may use the normal repository workflow. After it exits, the controller seals permitted changes, then derives the payload.
- Controller usage treatment: deterministic/no model usage. The controller is a process runner, not a Claude agent.

## Stage: solo

- Role: `solo`
- Model provider: Anthropic Claude Code subscription
- Exact model selection: `claude-fable-5` with `--effort high`. The CLI does not expose a model-catalog dump command (unlike Codex's `debug models --bundled`); capture `claude --version` and the resolved model reported in the JSONL `system`/`init` event's `model` field (available before any output) plus the terminal `result` event's `modelUsage` keys (the model actually billed). Do not describe `claude-fable-5` as a weight-pinned dated snapshot — the resolved id captured at runtime is the evidence of record.
- Harness and version: Claude Code CLI `2.1.206` for this rehearsal. The adapter records the installed version at launch; an eligible recipe must pin that exact observed version or intentionally revise and rehearse again.
- Session: fresh process following the continuation policy above. The adapter pre-assigns the session id via `--session-id` (rather than discovering it after the fact) and leaves session persistence enabled so the native transcript can be captured.
- Working tree access: no OS sandbox (see Runtime policy above). `--setting-sources project` excludes the operator's personal `~/.claude/settings.json`; `--strict-mcp-config` with no `--mcp-config` loads zero MCP servers. This repository has no tracked `.claude/` directory, so no repository-declared hooks or MCP servers apply either.
- Input artifacts from earlier stages: none.
- Required output artifact: code changes in the entrant worktree plus `final-message.md` and the `stream-json` event log in private controller storage. The controller also copies the CLI's native session transcript when available.
- Stage timeout: 10,800 seconds.
- Completion condition: `claude --print` exits zero, its JSONL output contains exactly one terminal `type: "result"` event whose `session_id` equals the pre-assigned `--session-id`, and that event reports non-negative integer `usage.input_tokens` and `usage.output_tokens`.

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
  --timeout-seconds 10800
```

The adapter uses the following effective Claude Code arguments:

```text
claude --print --output-format stream-json --verbose \
  --model claude-fable-5 --effort high \
  --permission-mode bypassPermissions \
  --setting-sources project --strict-mcp-config \
  --session-id <pre-assigned-uuid> \
  -
```

`--setting-sources project` prevents the operator's personal model/effort/hook defaults from becoming an undeclared intervention; the repository's tracked `CLAUDE.md`/`AGENTS.md` remain normal repository context, matching how Codex's `--ignore-rules` leaves tracked `AGENTS.md` untouched. Omitting `--mcp-config` together with `--strict-mcp-config` loads zero MCP servers. `--session-id` is generated by the deterministic controller (a random identifier for bookkeeping, not a model output) so the adapter knows exactly where to find the native transcript afterward instead of searching for it.

### Session rollout capture

The adapter omits `--no-session-persistence`, so Claude Code persists its native session transcript — full tool-call and message payloads, not just the curated `stream-json` event log — to `$CLAUDE_CONFIG_DIR/projects/<sanitized-worktree-path>/<sessionId>.jsonl` (default `~/.claude`; sanitization replaces every path separator with `-`). Because the adapter pre-assigns the session id, it looks up this path directly rather than searching for it. Capture is best-effort: a missing file is recorded in `result.json` and does not fail an otherwise-complete stage. Record the `rollout` field verbatim; the controller does not issue `claude --resume` against either copy.

### Usage and timing capture

- Usage source: Claude `--output-format stream-json` stdout. Preserve it exactly as `events.jsonl`; preserve stderr separately.
- Input-token field: the terminal `result` event's `usage.input_tokens`.
- Output-token field: the terminal `result` event's `usage.output_tokens`.
- Cache-read field: `usage.cache_read_input_tokens`.
- Cache-write field: `usage.cache_creation_input_tokens`. Unlike Codex, Claude Code reports this directly, so the frozen pricing formula's cache-write term is populated rather than always zero.
- Reasoning-token treatment: Claude Code does not report a separate thinking/reasoning token field — thinking tokens are folded into `usage.output_tokens` with no distinct field. Record `modelUsage` (a per-model cost breakdown reported alongside `usage`) and `total_cost_usd` as vendor fields for audit only; they are not part of the frozen cost formula.
- Session identifier source: the terminal `result` event's `session_id`, cross-checked by the adapter against the pre-assigned `--session-id`.
- Multi-model sessions: if the agent delegates to a subagent that runs under a different resolved model, the terminal `result` event's `modelUsage` will contain more than one key. This recipe assumes a single model throughout the session (matching the standing repository's default subagent behavior, which inherits the parent model unless a subagent explicitly overrides it). A rehearsal that observes more than one `modelUsage` key must revise this recipe's pricing rule before it becomes eligible — the current per-token formula assumes one flat rate.
- Wall-time boundaries: immediately before process spawn and after process exit, stored in `command.json`.
- Raw record path: `benchmark/private/runs/<opaque-run-id>/stages/solo/claude/` containing `command.json`, `events.jsonl`, `stderr.log`, `selected-model.json`, `raw-usage.json`, `result.json`, `final-message.md`, and `rollout.jsonl` when the session transcript was captured (see "Session rollout capture" above).

## Review and revision limits

This is a solo configuration. There are no plan, review, revision, continuation, retry, or operator-feedback stages.

## Mechanical gates

The controller runs only the four standard gates specified in `benchmark/controller/runbook.md` after sealing. No additional eligibility gate is declared by this recipe.

## Pricing

Use the dated [`benchmark/pricing/claude-fable-5-standard.json`](../pricing/claude-fable-5-standard.json) artifact for API-list-price-equivalent cost. It records the standard rates at authoring: $10.00/M input, $1.00/M cache read, $12.50/M cache write, and $50.00/M output. The cache-write rate assumes Claude Code's default 5-minute ephemeral cache TTL (1.25x the input rate); the adapter does not request the 1-hour TTL, so no separate long-TTL pricing artifact is needed. Calculate one stage as `(input_tokens - cached_input_tokens) × input rate + cached_input_tokens × cache-read rate + cache-write tokens × cache-write rate + output_tokens × output rate`, divided by one million.

The actual run remains a subscription run; record subscription expenditure separately and do not allocate the monthly fee across entrants. A run using another service tier must use another frozen pricing artifact rather than reusing this one.

## Known harness defaults

- Claude Code CLI is run non-interactively with `--print`; no TUI, session picker, or interactive resume is involved.
- The CLI's resolved model id is captured at every run (via the `system`/`init` event and `modelUsage`) because `claude-fable-5` is not itself a dated model snapshot, the same caveat Codex's alias-like catalog slugs carry. There is no bundled catalog dump command to cross-check against, unlike Codex.
- Claude Code receives the tracked repository instructions, including `CLAUDE.md`/`AGENTS.md`; the controller does not inject an additional system prompt.
- There is no OS-level sandbox. `--permission-mode bypassPermissions` disables every permission prompt so the process can run unattended; this is a materially weaker isolation guarantee than Codex's `workspace-write` sandbox and must be represented as such in any published comparison. Personal user configuration is excluded via `--setting-sources project`; no MCP servers are loaded.
- Available effort levels are `low`/`medium`/`high`/`xhigh`/`max` — there is no Claude Code equivalent of Codex's `ultra` effort tier.
