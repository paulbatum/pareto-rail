# Recipe: codex-sol-terra-delegation

Status: draft; rehearsal-only. This is a within-harness, same-provider delegation configuration and is not eligible until the failure taxonomy and remaining release controls are frozen.

This configuration is one unattended `codex exec` stage in which the primary agent (Sol) plans and reviews the level itself while delegating the implementation to a same-provider Terra subagent through Codex's built-in `spawn_agent` tool. It is still one CLI invocation, not a controller-agent conversation: the deterministic controller starts a fresh `codex exec` process in the opaque entrant worktree, captures its JSONL event stream, then runs the normal administrative seal and gates. Delegation happens entirely inside that single process.

## Identity

- Configuration id: `codex-sol-terra-delegation`
- Stages: `solo` (one CLI invocation; see Cost for how the manifest represents it)

## Shared inputs

- Entrant baseline: the run's declared baseline commit
- Shared assignment template: `benchmark/prompts/level-assignment.md`
- Delegation addendum: `benchmark/prompts/flexible-delegation.md`, rendered and appended after the shared assignment body (see "Delegation" below)
- Rendered assignment: private controller artifact (shared body + delegation addendum); supplied to the CLI as stdin byte-for-byte
- Standing brief: `docs/level-brief.md`
- Assigned theme: the frozen theme inserted into the rendered assignment
- Entrant checkout: the whole opaque worktree. The agent may read ordinary tracked repository material required by the standing brief. It must not receive `benchmark/private/`, other entrant worktrees, or any controller record.

## Delegation

- Mechanism: Codex's built-in agent-spawn tool. The addendum instructs the primary to spawn the implementer with `model="gpt-5.6-terra"`. The controller enables the `multi_agent_v2` feature via explicit `-c` overrides (`features.multi_agent_v2.hide_spawn_agent_metadata=false`, `features.multi_agent_v2.tool_namespace="agents"`); without it the older spawn path silently inherits the parent model instead of honoring the requested delegate model. Because the run uses `--ignore-user-config` and an isolated `CODEX_HOME`, the operator's own config.toml (which normally carries this feature) is not loaded, so the adapter re-declares it for delegation runs only. This is a workaround for [openai/codex#31814](https://github.com/openai/codex/issues/31814) and can be dropped once that is fixed.
- Delegate model: `gpt-5.6-terra`. Delegate reasoning level: `{{DELEGATE_EFFORT}}` in the addendum — **high** for the real configuration; the rehearsal definition overrides both parent and delegate effort to **low** to exercise the path cheaply.
- The addendum is the only thing that induces delegation: no harness flag sets the delegate model. Whether the primary actually delegates, and whether the requested delegate effort is honored, are empirical questions confirmed at rehearsal; if the effort request is not settable it is a documented best-effort limitation.
- Each subagent runs as a separate thread with its own rollout file under `$CODEX_HOME/sessions`, inside the isolated per-run home, so ccusage sums the delegated cost into the run total.

## Runtime policy

- Overall timeout: 43,200 seconds, measured from process launch to exit.
- Operator interaction after launch: none.
- Network access: no `--search`. The `workspace-write` sandbox blocks outbound connections and loopback `listen()` by default, which prevents the entrant's own dev-server-backed self-checks from running. The adapter overrides this with `-c sandbox_workspace_write.network_access=true`, keeping every other sandbox restriction (filesystem confined to the worktree, no elevated approvals) in place. This is a declared harness override, not the CLI's out-of-the-box default.
- Isolated per-run home: the controller sets `CODEX_HOME` to a fresh per-run home and copies the operator's `~/.codex/auth.json` into it so login works. `--ignore-user-config` still excludes the operator's `config.toml`; only auth is carried in. The credential copy is a declared operator convenience, of a kind with the worktree-access convention — not a security boundary. The home is retained as the run's rollout audit artifact and is the exact scope ccusage reads for cost.
- Harness continuation behavior: none. One fresh local `codex exec` process per run; never `codex exec resume`, `fork`, or any continuation command.
- Failure behavior: a nonzero exit, timeout, missing JSONL session id, missing `turn.completed` usage, or unsupported model/effort stops the run for controller-failure classification. A misconfigured per-run home (ccusage returns no session or zero tokens/cost) is likewise a controller failure rather than a recorded $0.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree as unmeasured deterministic setup.
- Commit behavior: the agent may use the normal repository workflow. After it exits, the controller seals permitted changes, then derives the payload.

## Stage: solo

- Role: `solo` (one CLI invocation). The primary is Sol acting as planner/reviewer/orchestrator; the delegated implementer is Terra.
- Model provider: OpenAI Codex subscription
- Exact model selection: primary `gpt-5.6-sol` with `model_reasoning_effort="high"` (rehearsal: `low`); delegated subagent `gpt-5.6-terra` at the addendum's requested effort. Capture `codex --version`, the complete `codex debug models --bundled` output, and the selected catalog entry. Do not describe these alias-like catalog slugs as weight-pinned snapshots.
- Harness and version: Codex CLI `0.144.1` for this rehearsal. The adapter records the installed version at launch; an eligible recipe must pin the exact observed version or intentionally revise and rehearse again.
- Session: fresh process. Native session persistence remains enabled for rollout capture; the primary thread and each spawned subagent thread persist under `$CODEX_HOME/sessions`.
- Working tree access: write access only to the entrant worktree through Codex `workspace-write` sandbox. No additional writable directories.
- Required output artifact: code changes in the entrant worktree plus `final-message.md` and the `--json` event stream in private controller storage. The controller also copies the primary session rollout and retains the isolated home (which holds every thread).
- Completion condition: `codex exec` exits zero, reports one session id, and reports non-negative integer `input_tokens` and `output_tokens` in its final `turn.completed` JSONL event.

### Verbatim prompt

```text
The controller supplies the rendered benchmark assignment followed by the rendered delegation addendum as the complete stdin prompt, byte-for-byte. No controller preface, progress note, or extra handoff text is added.
```

### Harness invocation

The controller launches this configuration through `npm run benchmark:run` with a delegation-bearing run definition (the `delegation` object carries the addendum artifact, `delegateModel`, and `delegateEffort`); the adapter arguments extend `codex-sol-high` with the `multi_agent_v2` overrides:

```text
codex exec --json --color never --ignore-user-config --ignore-rules --strict-config \
  -m gpt-5.6-sol -c model_reasoning_effort="high" -c approval_policy="never" \
  -c sandbox_workspace_write.network_access=true \
  -c features.multi_agent_v2.hide_spawn_agent_metadata=false \
  -c features.multi_agent_v2.tool_namespace="agents" \
  -s workspace-write -C <worktree> --output-last-message <private-final-message> -
```

The rehearsal definition sets `stage.effort` and `delegation.delegateEffort` to `low`.

### Usage and timing capture

Same as `codex-sol-high`: the `--json` stdout is preserved as `events.jsonl`; the primary `turn.completed` usage is recorded for audit. Note that `codex exec --json` stdout usage reflects the **root thread only** and omits spawned subagent threads — the complete picture lives in the persisted rollouts under `$CODEX_HOME`, which is exactly what ccusage reads for cost below.

## Review and revision limits

The primary owns planning and review of the delegated implementation within the single session, per the addendum. There are no separate controller-driven plan, review, revision, continuation, retry, or operator-feedback stages.

## Mechanical gates

The controller runs only the four standard gates specified in `benchmark/controller/README.md` after sealing. No additional eligibility gate is declared by this recipe.

## Cost

Cost is measured by [ccusage](https://github.com/ccusage/ccusage), pinned in the repository's `package.json` (`20.0.17`) and invoked with the repository's own Node. After the stage, the controller runs `ccusage codex session --json` scoped to this run's isolated `CODEX_HOME`; ccusage sums all thread rollouts, so the delegated Terra thread is included in the run total. The manifest records ccusage's computed USD as `cost.totalUsd` and the tool/version provenance in `cost.costSource`. ccusage attributes per-model **tokens** for Codex but not per-model cost, so `cost.models` carries per-model token detail (including the delegated Terra thread) with no per-model `costUsd`, and the manifest's single stage carries the run total. `cost.orchestrationTreatment` is `included`. We do not compute prices ourselves, so no frozen pricing artifact can rot when rates change.

The actual run remains a subscription run; record subscription expenditure separately and do not allocate the monthly fee across entrants.

## Known harness defaults

- Codex CLI is run non-interactively with `codex exec`; no TUI, session picker, resume, cloud task, or user approval prompt is involved.
- The bundled model catalog and binary version are captured at every run because the selected slugs are not dated model snapshots.
- Codex receives the tracked repository instructions, including `AGENTS.md`; the controller does not inject an additional system prompt beyond the rendered assignment and delegation addendum on stdin.
- The sandbox is `workspace-write` with `network_access=true`; web search is not enabled; personal user configuration and exec-policy rules are ignored (auth is carried in via the isolated home). Network access is confined to the sandboxed process the same way filesystem access is confined to the worktree — it is not an escape from `workspace-write`.
