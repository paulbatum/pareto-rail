# Mechanism: within-harness delegation

A delegation configuration has a primary agent plan and review the level itself while delegating the implementation to a cheaper same-provider subagent, through the harness's own built-in subagent support.

It is still one CLI invocation. The controller starts one process, the delegation happens entirely inside it, and the normal seal and gates follow. There is no controller-agent conversation and no extra stage.

This is a mechanism rather than a knob because it changes the assignment the entrant receives.

## What the entrant sees

`benchmark/prompts/flexible-delegation.md` is rendered and appended after the shared assignment body. That file is the artifact — versioned, hashed, and rendered into the run's assignment — so the instruction the entrant actually got is recoverable per run rather than described here.

The plan row carries a `delegation` object holding the rendered addendum artifact, the delegate model, and the delegate effort.

## How each harness spawns

Claude uses Claude Code's built-in `Agent`/`Task` tool, whose `model` input accepts harness aliases. The addendum instructs the primary which alias to spawn the implementer with.

Codex uses its built-in agent-spawn tool. The controller enables the `multi_agent_v2` feature through explicit config overrides, because the run ignores user configuration and an isolated harness home, so the operator's own config — which normally carries that feature — is not loaded. Without the overrides the older spawn path silently inherits the parent model instead of honoring the requested delegate model. This is a workaround for [openai/codex#31814](https://github.com/openai/codex/issues/31814) and should be dropped once that is fixed. The adapter applies it only when a configuration asks for delegation.

## Cost and the transcript

The point of the isolated per-run harness home is that ccusage sees the full parent-plus-subagent cost.

Claude writes each subagent transcript beneath the parent session in a `subagents/` tree, recursing for nested spawns, and ccusage descends into it. Codex persists each subagent as a separate thread with its own rollout file in the isolated harness home, and ccusage sums them.

For Codex there is a trap worth stating plainly: `codex exec --json` stdout usage reflects the **root thread only** and omits spawned subagents. Reading run cost from the event stream would silently undercount the delegated work. The complete picture is in the persisted rollouts, which is what ccusage reads.

Where per-model cost is available, the manifest emits one stage per model — the primary as `orchestrate` and the delegate as `implement` — and `cost.orchestrationTreatment` is `included`. A delegation run whose delegate cost is absent or zero did not delegate, whatever its transcript says, and should be treated as a failed configuration rather than a cheap one.

Subagent threads are also where transcript replay has historically under-reported output, since a message that never finalized on disk keeps the small snapshot taken at message start. That is what the ccusage cross-check against the harness's own counter exists to catch; see `benchmark/README.md`, "Cost".
