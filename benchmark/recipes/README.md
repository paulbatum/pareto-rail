# Agent recipes

Store one verbatim recipe per benchmark configuration at a stable path, such as `fable-solo.md` or `delegation.md`. Start from `template.md`.

A recipe states the exact model snapshot, harness and version, prompts and supplied files, session boundaries, allowed stages, time limits, review and revision rules, hidden harness defaults, controller-usage treatment, and token and wall-time capture. `benchmark/controller/runbook.md` executes these declarations without adding workflow decisions. The recipe is the intervention being measured.

Recipes may change while the protocol is being designed and rehearsed. Before a configuration's first eligible run, commit its runner, executor, and recipe and register their hashes in the private schedule. After that configuration runs, a behavior-changing edit is a new configuration identity; do not silently pool it with the earlier execution. New configurations may join an existing protocol when the shared prompt, themes, baseline, gates, failure semantics, and judgment method remain unchanged.

Cost is not a per-configuration frozen input. Every configuration's cost is measured after the fact by ccusage reading the run's isolated harness home; the recipe's Cost section states that method and the pinned ccusage version, not a dated rate table.

`codex-terra-high.md` is the current first-trial draft. It demonstrates a one-stage non-interactive `codex exec` recipe with captured JSONL usage and the draft failure taxonomy. It remains rehearsal-only until the full release protocol is frozen. `codex-sol-high.md` declares the matching Sol configuration and must be rehearsed before it becomes eligible.

`claude-fable-5-high.md` is the first Claude Code configuration trial, using the same one-stage non-interactive pattern against `claude --print --output-format stream-json`. It documents a material difference from the Codex configurations: Claude Code CLI has no OS-level sandbox, so unattended operation relies on `--permission-mode bypassPermissions` rather than an enforced filesystem/network boundary. It remains rehearsal-only.

`claude-fable-5-high-b20.md` and `codex-sol-high-b20.md` are the corresponding soft-budget configurations. They declare `budget.usd: 20`, relative mid-turn notices, and deadline-bounded same-session continuation when an entrant submits well under budget.

`claude-fable-5-opus-delegation.md` and `codex-sol-terra-delegation.md` are the within-harness, same-provider delegation drafts: the primary agent plans and reviews while delegating implementation to a cheaper same-provider subagent (Fable → Opus; Sol → Terra) via the harness's built-in subagent support. Both append the shared `benchmark/prompts/flexible-delegation.md` addendum to the assignment and run in an isolated per-run home so ccusage captures the full parent-plus-subagent cost. They are rehearsal-only.
