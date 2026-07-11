# Recipe: claude-fable-5-opus-delegation

Status: draft; rehearsal-only. This is a within-harness, same-provider delegation configuration and is not eligible until the failure taxonomy and remaining release controls are frozen.

This configuration is one unattended `claude --print` stage in which the primary agent (Fable) plans and reviews the level itself while delegating the implementation to a same-provider Opus subagent through Claude Code's built-in `Agent`/`Task` tool. It is still one CLI invocation, not a controller-agent conversation: the deterministic controller starts a fresh `claude --print` process in the opaque entrant worktree, captures its `stream-json` event log, then runs the normal administrative seal and gates. Delegation happens entirely inside that single process.

## Identity

- Configuration id: `claude-fable-5-opus-delegation`
- Stages: `solo` (one CLI invocation; the manifest may split it per model — see Cost)

## Shared inputs

- Entrant baseline: the run's declared baseline commit
- Shared assignment template: `benchmark/prompts/level-assignment.md`
- Delegation addendum: `benchmark/prompts/flexible-delegation.md`, rendered and appended after the shared assignment body (see "Delegation" below)
- Rendered assignment: private controller artifact (shared body + delegation addendum); supplied to the CLI as stdin byte-for-byte
- Standing brief: `docs/level-brief.md`
- Assigned theme: the frozen theme inserted into the rendered assignment
- Entrant checkout: the whole opaque worktree. The agent may read ordinary tracked repository material required by the standing brief. It must not receive `benchmark/private/`, other entrant worktrees, or any controller record.

## Delegation

- Mechanism: Claude Code's built-in `Agent`/`Task` tool. Its `model` input accepts harness aliases (`opus`/`sonnet`/`haiku`/`fable`); the addendum instructs the primary to spawn the implementer with `model="opus"`.
- Delegate model: `opus`. Delegate reasoning level: `{{DELEGATE_EFFORT}}` in the addendum — **high** for the real configuration; the rehearsal definition overrides both parent and delegate effort to **low** to exercise the path cheaply.
- The addendum is the only thing that induces delegation: no harness flag sets the delegate model. Whether the primary actually delegates, and whether the requested delegate effort is honored, are empirical questions confirmed at rehearsal; if the effort request is not settable it is a documented best-effort limitation.
- The subagent transcript is written under `$CLAUDE_CONFIG_DIR/projects/<sanitized-cwd>/<sid>/subagents/agent-<id>.jsonl` (recursing for nested spawns) inside the isolated per-run home, so ccusage sees the delegated cost.

## Runtime policy

- Overall timeout: 43,200 seconds, measured from process launch to exit.
- Operator interaction after launch: none.
- Network access: unrestricted, matching the operator's own network access. Claude Code CLI has no OS-level sandbox equivalent to Codex's `workspace-write`.
- Working tree access: **weaker isolation than the Codex configuration.** Unattended operation requires `--permission-mode bypassPermissions`, which skips every permission prompt. Confinement to the worktree is a non-adversarial convention identical in kind to the general worktree-access policy in `benchmark/controller/runbook.md`, not a technically enforced boundary, and must not be described as one.
- Isolated per-run home: the controller sets `CLAUDE_CONFIG_DIR` to a fresh per-run home and copies the operator's `~/.claude/.credentials.json` into it so login works. The credential copy is a declared operator convenience, of a kind with the worktree-access convention — not a security boundary. The home is retained as the run's rollout audit artifact and is the exact scope ccusage reads for cost.
- Harness continuation behavior: none. One fresh local `claude --print` process per run; never `--resume`, `--continue`, `--fork-session`, or any other continuation flag.
- Failure behavior: a nonzero exit, timeout, missing terminal `result` event, a `result.session_id` that does not match the pre-assigned `--session-id`, or missing/malformed `usage.input_tokens`/`usage.output_tokens` stops the run for controller-failure classification. A misconfigured per-run home (ccusage returns no session or zero tokens/cost) is likewise a controller failure rather than a recorded $0.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree as unmeasured deterministic setup.
- Commit behavior: the agent may use the normal repository workflow. After it exits, the controller seals permitted changes, then derives the payload.

## Stage: solo

- Role: `solo` (one CLI invocation). The primary is Fable acting as planner/reviewer/orchestrator; the delegated implementer is Opus.
- Model provider: Anthropic Claude Code subscription
- Exact model selection: primary `claude-fable-5` with `--effort high` (rehearsal: `--effort low`); delegated subagent `opus` at the addendum's requested effort. Capture `claude --version`, the resolved model in the JSONL `system`/`init` event's `model` field, and the terminal `result` event's `modelUsage` keys (the models actually billed). Do not describe `claude-fable-5` as a weight-pinned dated snapshot — the resolved id captured at runtime is the evidence of record.
- Harness and version: Claude Code CLI `2.1.207` is pinned for this configuration. The adapter records the installed version at launch; a version other than the pinned one is a controller failure under the frozen taxonomy rather than a silent substitution.
- Session: fresh process. The adapter pre-assigns the session id via `--session-id` and leaves session persistence enabled so the native transcripts (parent and `subagents/`) can be captured.
- Working tree access: no OS sandbox. `--setting-sources project` excludes the operator's personal `~/.claude/settings.json`; `--strict-mcp-config` with no `--mcp-config` loads zero MCP servers.
- Required output artifact: code changes in the entrant worktree plus `final-message.md` and the `stream-json` event log in private controller storage. The controller also copies the native session transcript(s) and retains the isolated home.
- Completion condition: `claude --print` exits zero, its JSONL output contains exactly one terminal `type: "result"` event whose `session_id` equals the pre-assigned `--session-id`, and that event reports non-negative integer `usage.input_tokens` and `usage.output_tokens`.

### Verbatim prompt

```text
The controller supplies the rendered benchmark assignment followed by the rendered delegation addendum as the complete stdin prompt, byte-for-byte. No controller preface, progress note, or extra handoff text is added.
```

### Harness invocation

The controller launches this configuration through `npm run benchmark:run` with a delegation-bearing run definition (the `delegation` object carries the addendum artifact, `delegateModel`, and `delegateEffort`); the adapter arguments are identical to `claude-fable-5-high`:

```text
claude --print --output-format stream-json --verbose \
  --model claude-fable-5 --effort high \
  --permission-mode bypassPermissions \
  --setting-sources project --strict-mcp-config \
  --session-id <pre-assigned-uuid> \
  -
```

The rehearsal definition sets `stage.effort` and `delegation.delegateEffort` to `low`.

### Usage and timing capture

Same as `claude-fable-5-high`: the `stream-json` stdout is preserved as `events.jsonl`, the terminal `result` usage and `modelUsage` are recorded for audit, and the pre-assigned session id is cross-checked. Because delegation is expected, `modelUsage` and the ccusage `modelBreakdowns` will contain more than one model; this is handled by the ccusage cost method below rather than by any per-token rule.

## Review and revision limits

The primary owns planning and review of the delegated implementation within the single session, per the addendum. There are no separate controller-driven plan, review, revision, continuation, retry, or operator-feedback stages.

## Mechanical gates

The controller runs only the four standard gates specified in `benchmark/controller/runbook.md` after sealing. No additional eligibility gate is declared by this recipe.

## Cost

Cost is measured by [ccusage](https://github.com/ccusage/ccusage), pinned in the repository's `package.json` (`20.0.17`) and invoked with the repository's own Node. After the stage, the controller runs `ccusage claude session --json` scoped to this run's isolated `CLAUDE_CONFIG_DIR` home; ccusage descends into the `subagents/` tree, so the delegated Opus cost is included in the run total. The manifest records ccusage's computed USD as `cost.totalUsd`, the per-model detail from `modelBreakdowns` in `cost.models` (Claude reports per-model cost — the delegated Opus cost must be present and nonzero), and the tool/version provenance in `cost.costSource`. Because per-model cost is available, the manifest emits one stage per model: the parent (Fable) as `orchestrate` and the delegated Opus as `implement`. `cost.orchestrationTreatment` is `included`. We do not compute prices ourselves, so no frozen pricing artifact can rot when rates change.

The actual run remains a subscription run; record subscription expenditure separately and do not allocate the monthly fee across entrants. ccusage misses the small Claude background auxiliary-model usage that has no transcript (measured ~0.2%); that gap is accepted and not reconciled.

## Known harness defaults

- Claude Code CLI is run non-interactively with `--print`; no TUI, session picker, or interactive resume is involved.
- The resolved model ids are captured at every run because `claude-fable-5`/`opus` are aliases, not dated snapshots. There is no bundled catalog dump command, unlike Codex.
- Claude Code receives the tracked repository instructions, including `CLAUDE.md`/`AGENTS.md`; the controller does not inject an additional system prompt beyond the rendered assignment and delegation addendum on stdin.
- There is no OS-level sandbox. `--permission-mode bypassPermissions` disables every permission prompt so the process can run unattended; this is materially weaker isolation than Codex's `workspace-write` sandbox and must be represented as such in any published comparison.
- Available effort levels are `low`/`medium`/`high`/`xhigh`/`max` — there is no Claude Code equivalent of Codex's `ultra` tier, for either the primary or the delegated subagent.
