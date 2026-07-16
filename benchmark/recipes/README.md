# Agent recipes

Store one verbatim recipe per benchmark configuration at a stable path, such as `fable-solo.md` or `delegation.md`. Start from `template.md`.

A recipe states the exact model snapshot, harness and version, prompts and supplied files, session boundaries, allowed stages, time limits, review and revision rules, hidden harness defaults, controller-usage treatment, and token and wall-time capture. `benchmark/controller/runbook.md` executes these declarations without adding workflow decisions. The recipe is the intervention being measured.

Recipes may change while the protocol is being designed and rehearsed. Before a configuration's first eligible run, commit its runner, executor, and recipe and register their hashes in the private schedule. After that configuration runs, a behavior-changing edit is a new configuration identity; do not silently pool it with the earlier execution. New configurations may join an existing protocol when the shared prompt, themes, baseline, gates, failure semantics, and judgment method remain unchanged.

Cost is not a per-configuration frozen input. Every configuration's cost is measured after the fact by ccusage reading the run's isolated harness home; the recipe's Cost section states that method and the pinned ccusage version, not a dated rate table.

`codex-terra-high.md` is the full rehearsal configuration: a one-stage non-interactive `codex exec` recipe with captured JSONL usage, used to prove the controller path. It is not an eligible entrant. `codex-luna-low-smoke.md` is the permanently ineligible fast smoke recipe: Luna adapts Prism Bloom after running the normal benchmark scaffold so the real controller lifecycle can be checked without generating an original showcase level.

`pi-luna-low-smoke.md` and `pi-openrouter-deepseek-smoke.md` are the permanently ineligible pi smoke recipes, cloning the `codex-luna-low-smoke.md` assignment onto the pi harness. The pair exists to cover both of pi's billing paths: the first reaches `gpt-5.6-luna` through pi's stored subscription credential, while the second reaches an OpenRouter-hosted `deepseek/deepseek-v4-flash` with an API key and therefore bills real metered spend. pi selects its provider per invocation, so a pi configuration pins `stage.provider` alongside its model; unlike Codex and Claude, its reasoning vocabulary includes `minimal` and `off` but not `ultra`. The adapter supports the same soft-budget protocol through ccusage polling, a controller-owned notice extension, and same-session continuations. Like Claude Code CLI and unlike Codex, pi has no OS-level sandbox.

`claude-fable-5-high.md` and `codex-sol-high.md` are the solo configurations, each one fresh unattended session. The Claude recipe documents a material harness difference: Claude Code CLI has no OS-level sandbox, so unattended operation relies on `--permission-mode bypassPermissions` rather than an enforced filesystem/network boundary.

`claude-fable-5-opus-delegation.md` and `codex-sol-terra-delegation.md` are the within-harness, same-provider delegation configurations: the primary agent plans and reviews while delegating implementation to a cheaper same-provider subagent (Fable → Opus; Sol → Terra) via the harness's built-in subagent support. Both append the shared `benchmark/prompts/flexible-delegation.md` addendum to the assignment and run in an isolated per-run home so ccusage captures the full parent-plus-subagent cost.

`claude-fable-5-high-b20.md` and `codex-sol-high-b20.md` are the soft-budget solo variants. They declare `budget.usd: 20`, relative mid-turn notices, and deadline-bounded same-session continuation when an entrant submits well under budget.
