# Recipe: claude-opus-4-8-high

Status: draft; not yet rehearsed or eligible until the failure taxonomy and remaining release controls are frozen.

This is the solo Opus configuration: the same unattended Claude Code CLI mechanism as `claude-fable-5-high`, pointed at `claude-opus-4-8` instead of `claude-fable-5`, with no delegation. It is one unattended solo stage, not a controller-agent conversation. The deterministic controller starts a fresh `claude --print` process in the opaque entrant worktree, captures its `stream-json` event log, then runs the normal administrative seal and gates.

## Identity

- Configuration id: `claude-opus-4-8-high`
- Stages: `solo`

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
- Network access: unrestricted, matching the operator's own network access. Claude Code CLI has no OS-level sandbox equivalent to Codex's `workspace-write`, so there is no network toggle to declare.
- Working tree access: **weaker isolation than the Codex configuration.** Unattended operation requires `--permission-mode bypassPermissions`, which skips every permission prompt, including ones for filesystem writes or shell commands outside the worktree. Codex's `workspace-write` sandbox enforces filesystem confinement at the OS level; Claude Code CLI has no equivalent enforcement mechanism at any permission mode. Confinement to the worktree here is a non-adversarial convention identical in kind to the general worktree-access policy in `benchmark/controller/README.md`, not a technically enforced boundary, and it must not be described as one.
- Harness continuation behavior: none. The controller starts one fresh local `claude --print` process per stage and never issues `claude --resume`, `--continue`, `--fork-session`, or any other continuation flag.
- Failure behavior: a nonzero exit, timeout, missing terminal `result` event, a `result.session_id` that does not match the pre-assigned `--session-id`, or missing/malformed `usage.input_tokens`/`usage.output_tokens` stops the run for controller-failure classification. At an eligible freeze, the controller must additionally compare the captured CLI version to its frozen identity before classifying the run. Entrant and infrastructure classifications remain subject to the frozen taxonomy.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree and records its command, version, exit code, timing, and complete log as unmeasured deterministic setup. This is not a model stage.
- Commit behavior: the agent may use the normal repository workflow. After it exits, the controller seals permitted changes, then derives the payload.
- Controller usage treatment: deterministic/no model usage. The controller is a process runner, not a Claude agent.

## Stage: solo

- Role: `solo`
- Model provider: Anthropic Claude Code subscription
- Exact model selection: `claude-opus-4-8` with `--effort high`. The CLI does not expose a model-catalog dump command (unlike Codex's `debug models --bundled`); capture `claude --version` and the resolved model reported in the JSONL `system`/`init` event's `model` field (available before any output) plus the terminal `result` event's `modelUsage` keys (the model actually billed). Do not describe `claude-opus-4-8` as an alias — capture the resolved id at runtime as the evidence of record regardless.
- Harness and version: Claude Code CLI `2.1.207` is pinned for this configuration, the same pin as the other Claude configurations. The adapter records the installed version at launch; a version other than the pinned one is a controller failure under the frozen taxonomy rather than a silent substitution.
- Session: fresh process following the continuation policy above. The adapter pre-assigns the session id via `--session-id` (rather than discovering it after the fact) and leaves session persistence enabled so the native transcript can be captured.
- Working tree access: no OS sandbox (see Runtime policy above). `--setting-sources project` excludes the operator's personal `~/.claude/settings.json`; `--strict-mcp-config` with no `--mcp-config` loads zero MCP servers. This repository has no tracked `.claude/` directory, so no repository-declared hooks or MCP servers apply either.
- Input artifacts from earlier stages: none.
- Required output artifact: code changes in the entrant worktree plus `final-message.md` and the `stream-json` event log in private controller storage. The controller also copies the CLI's native session transcript when available.
- Stage timeout: 43,200 seconds.
- Completion condition: `claude --print` exits zero, its JSONL output contains exactly one terminal `type: "result"` event whose `session_id` equals the pre-assigned `--session-id`, and that event reports non-negative integer `usage.input_tokens` and `usage.output_tokens`.

### Verbatim prompt

```text
The controller supplies the rendered benchmark assignment as the complete stdin prompt, byte-for-byte. No controller preface, progress note, or extra handoff text is added.
```

### Harness invocation

```sh
npm run benchmark:claude -- \
  --worktree /tmp/pareto-rail-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/claude \
  --model claude-opus-4-8 \
  --effort high \
  --timeout-seconds 43200
```

The adapter uses the following effective Claude Code arguments:

```text
claude --print --output-format stream-json --verbose \
  --model claude-opus-4-8 --effort high \
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
- Input-token field: the terminal `result` event's `usage.input_tokens`. Unlike Codex, this is already the uncached remainder, not a total that includes cache hits — the adapter adds `usage.cache_read_input_tokens` back in before recording `inputTokens`, so the normalized field matches the total-including-cached shape used across adapters. These normalized counts are recorded for audit; run cost is measured by ccusage (see Cost below), not derived from them.
- Output-token field: the terminal `result` event's `usage.output_tokens`.
- Cache-read field: `usage.cache_read_input_tokens`.
- Cache-write field: `usage.cache_creation_input_tokens`. Unlike Codex, Claude Code reports this directly.
- Reasoning-token treatment: Claude Code does not report a separate thinking/reasoning token field — thinking tokens are folded into `usage.output_tokens` with no distinct field. Record `modelUsage` (a per-model breakdown reported alongside `usage`) and `total_cost_usd` as vendor fields for audit only.
- Session identifier source: the terminal `result` event's `session_id`, cross-checked by the adapter against the pre-assigned `--session-id`.
- Multi-model sessions: this solo configuration expects a single resolved model, so the terminal `result` event's `modelUsage` should contain one key. If a run nonetheless records more than one model, the ccusage cost method already attributes cost per model and the manifest emits one stage per model — no per-token pricing rule is involved. This configuration is deliberately not delegated; see `claude-fable-5-opus-delegation.md` for the delegated counterpart that also routes work to Opus.
- Wall-time boundaries: immediately before process spawn and after process exit, stored in `command.json`.
- Raw record path: `benchmark/private/runs/<opaque-run-id>/stages/solo/claude/` containing `command.json`, `events.jsonl`, `stderr.log`, `selected-model.json`, `raw-usage.json`, `result.json`, `final-message.md`, and `rollout.jsonl` when the session transcript was captured (see "Session rollout capture" above).

## Review and revision limits

This is a solo configuration. There are no plan, review, revision, continuation, retry, or operator-feedback stages.

## Mechanical gates

The controller runs only the four standard gates specified in `benchmark/controller/README.md` after sealing. No additional eligibility gate is declared by this recipe.

## Cost

Cost is measured by [ccusage](https://github.com/ccusage/ccusage), pinned in the repository's `package.json` (`20.0.17`) and invoked with the repository's own Node. After the stage, the controller runs `ccusage claude session --json` scoped to this run's isolated `CLAUDE_CONFIG_DIR` home. ccusage parses the persisted rollouts and prices them with its own maintained rate database; the manifest records ccusage's computed USD as `cost.totalUsd`, the per-model detail from `modelBreakdowns` in `cost.models` (Claude reports per-model cost), and the tool/version provenance in `cost.costSource`. We do not compute prices ourselves, so no frozen pricing artifact can rot when rates change. The controller records the exact ccusage version in the manifest.

The actual run remains a subscription run; record subscription expenditure separately and do not allocate the monthly fee across entrants. ccusage misses the small Claude background auxiliary-model usage that has no transcript (measured ~0.2%); that gap is accepted and not reconciled.

## Known harness defaults

- Claude Code CLI is run non-interactively with `--print`; no TUI, session picker, or interactive resume is involved.
- The CLI's resolved model id is captured at every run (via the `system`/`init` event and `modelUsage`), the same discipline applied to the other alias-like Claude and Codex model slugs. There is no bundled catalog dump command to cross-check against, unlike Codex.
- Claude Code receives the tracked repository instructions, including `CLAUDE.md`/`AGENTS.md`; the controller does not inject an additional system prompt.
- There is no OS-level sandbox. `--permission-mode bypassPermissions` disables every permission prompt so the process can run unattended; this is a materially weaker isolation guarantee than Codex's `workspace-write` sandbox and must be represented as such in any published comparison. Personal user configuration is excluded via `--setting-sources project`; no MCP servers are loaded.
- Available effort levels are `low`/`medium`/`high`/`xhigh`/`max` — there is no Claude Code equivalent of Codex's `ultra` effort tier.
