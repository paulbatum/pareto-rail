# Mechanism: Claude Code CLI

The Claude harness. One unattended `claude --print` process per stage, launched by the deterministic controller in the opaque entrant worktree, with its `stream-json` event log captured. The controller is a process runner, not a Claude agent, so it contributes no model usage of its own.

The adapter is `scripts/benchmark/claude-cli.mjs`, pinned by the plan's materials commit.

## Knobs

Set per configuration in the plan row's `stage` block, not here:

`model`, `effort`, `timeoutSeconds`, `budget.usd`, `sandbox`, and the `delegation` object when the configuration delegates.

## Model and effort

`claude --version` is captured at launch. The CLI has no bundled catalog dump to cross-check against — unlike Codex — so the evidence of record is the resolved model reported in the JSONL `system`/`init` event, available before any output, together with the terminal `result` event's `modelUsage` keys, which name the models actually billed. A configured model id is not a dated snapshot and must not be described as one.

## Invocation

```sh
npm run benchmark:claude -- \
  --worktree <entrant-worktree> \
  --prompt <private-rendered-assignment> \
  --out <private-stage-directory> \
  --model <model-id> \
  --effort <effort> \
  --timeout-seconds <seconds>
```

The rendered assignment is supplied as the complete stdin prompt, byte-for-byte, with no controller preface.

The effective arguments are constructed by the adapter and recorded verbatim in `command.json`. Three of them are load-bearing and worth naming because they define what the entrant is not exposed to. `--permission-mode bypassPermissions` is what makes unattended operation possible at all, since it skips every permission prompt. `--setting-sources project` excludes the operator's personal settings so their model, effort, and hook defaults cannot become an undeclared intervention; tracked `CLAUDE.md` and `AGENTS.md` remain normal repository context. `--strict-mcp-config` with no `--mcp-config` loads zero MCP servers.

The adapter pre-assigns the session id with `--session-id` — a controller-generated identifier for bookkeeping, not a model output — so the native transcript can be located directly afterward instead of searched for.

## Isolation

The entrant sandbox is owned by `benchmark/controller/README.md`, "Entrant sandbox". Two Claude-specific consequences documented there matter when reading a run: `WebFetch` and `WebSearch` run in the harness process outside the bash sandbox and are therefore disabled at the tool level, and because Claude reads an entrant-writable project `.claude/settings.json` that could widen the boundary, the adapter refuses to launch if one exists and denies writing one during the run.

Note that `bypassPermissions` is a permission mode, not a boundary. On a row without the sandbox, confinement to the worktree is a non-adversarial convention rather than an enforced guarantee, and must never be published as one.

## Session rollout capture

The adapter omits `--no-session-persistence`, so Claude Code writes its native transcript — full tool-call and message payloads — under the run's isolated `CLAUDE_CONFIG_DIR`. Because the session id is pre-assigned, the adapter reads that path directly. Capture is best-effort: a missing file is recorded in `result.json` and does not fail an otherwise-complete stage. The controller never issues `claude --resume` against a copy.

Delegated subagent transcripts are written beneath the parent session in a `subagents/` tree, recursing for nested spawns, which is what lets ccusage see delegated cost. See `delegation.md`.

## Usage and timing

- Usage source: the `--output-format stream-json` stdout, preserved exactly as `events.jsonl`; stderr preserved separately.
- Input tokens: the terminal `result` event's `usage.input_tokens` is already the uncached remainder rather than a total. The adapter adds `usage.cache_read_input_tokens` back in before recording `inputTokens`, so the normalized field matches the total-including-cached shape the other adapters use. These normalized counts are for audit; cost comes from ccusage.
- Output tokens: the terminal `result` event's `usage.output_tokens`.
- Cache: `cache_read_input_tokens` and `cache_creation_input_tokens`. Claude reports cache-write directly, which Codex does not.
- Reasoning tokens: no separate field exists — thinking is folded into `output_tokens`. `modelUsage` and `total_cost_usd` are recorded as vendor fields for audit only.
- Session id: the terminal `result` event's `session_id`, cross-checked against the pre-assigned value.
- Wall time: recorded around process spawn and exit in `command.json`.
- Stage artifacts live under `benchmark/private/runs/<run-id>/stages/<stage>/claude/`.

A solo configuration expects one key in `modelUsage`. If a run records more than one, cost is still attributed per model and the manifest emits one stage per model; no per-token pricing rule is involved. Deliberate multi-model work is a delegation configuration, not this case.

## Completion and failure

A stage completes when `claude --print` exits zero, its output contains exactly one terminal `result` event whose `session_id` matches the pre-assigned id, and that event reports non-negative integer input and output tokens. A nonzero exit, a timeout, a missing terminal event, a session-id mismatch, or malformed usage stops the run for controller-failure classification.

## Cost

Measured after the run by ccusage against the run's isolated `CLAUDE_CONFIG_DIR`, per `benchmark/README.md`, "Cost". Claude reports per-model cost, so `cost.models` carries `costUsd` per row. Claude's terminal `result` event carries a `modelUsage` counter tallied from the API responses themselves, which is the cross-check against transcript replay that `cost.reconciliation` records. The counter restates the whole session on every resumed round, so the final round's counter is the run's counter and rounds are never summed.

ccusage misses a small Claude background auxiliary-model share that has no transcript, measured at roughly 0.2%. That gap is accepted and documented rather than estimated.
