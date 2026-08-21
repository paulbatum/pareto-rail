# Configurations and mechanisms

The configuration is the intervention being measured. This directory documents the **mechanisms** a configuration is built from, and carries the **roster** of configurations that compose them.

## How a configuration is defined

A configuration is a row in the private plan, not a file here. The row's `stage` block is what the controller actually executes — adapter, model, effort, provider, timeout, budget, network — and the run record afterwards captures what really happened: the verbatim arguments in `command.json`, the observed harness version, the resolved model, the rendered assignment, the measured cost.

So a document is written only for something neither of those can hold:

- **A mechanism** — a harness, or a cross-cutting behavior that changes what the entrant sees or how the harness is wired. One document, shared by every configuration that uses it.
- **Intent** — why a configuration exists and what it is being contrasted against. One row in the roster below.

Everything else is a knob. A new effort level, a new model on an existing harness, a different budget amount, a different timeout: all of these are a plan row and nothing more. There is no file to add.

Two rules follow, and they are the ones this directory kept violating before it was restructured:

**Never assert in prose what the system measures.** Harness versions are the standing example. The adapter records the installed version into every run record; a version written down here as well is a second source of truth that can only drift out of agreement with the first. The same goes for the effective command line, the resolved model id, and the delivered budget notices.

**Never restate what a commit already pins.** The plan's materials commit pins every adapter, prompt, and mechanism document in force for a run. Describing adapter behavior in prose does not make it more fixed; it makes it more likely to be wrong later.

## Mechanisms

Harnesses:

- [`codex-cli.md`](codex-cli.md) — Codex CLI
- [`claude-cli.md`](claude-cli.md) — Claude Code CLI
- [`pi-cli.md`](pi-cli.md) — pi CLI, the one harness that selects a provider, and therefore a billing path
- [`agy-cli.md`](agy-cli.md) — Antigravity CLI, which cannot be sandboxed and is not priced by ccusage
- [`prime-agent-cli.md`](prime-agent-cli.md) — Prime Agent CLI, whose only tool is an IPython kernel and whose delegated subagents are sessions of their own; also cannot be sandboxed

Cross-cutting:

- [`budget-protocol.md`](budget-protocol.md) — the soft USD task budget, its notices, and same-session continuation
- [`delegation.md`](delegation.md) — within-harness delegation to a same-provider subagent

Owned elsewhere, and deliberately not restated here: the entrant sandbox and the four mechanical gates are in `benchmark/controller/README.md`; cost measurement is in `benchmark/README.md`; the assignment and the delegation addendum are files under `benchmark/prompts/`.

## Roster

Every configuration id, what it composes, and what it is for. Model and effort are shown as documentation of intent — the plan row is authoritative, and the run record is what actually ran.

### Eligible track

| Configuration | Model @ effort | Adds | Purpose |
| --- | --- | --- | --- |
| `claude-fable-5-high` | `claude-fable-5` @ high | — | Claude solo baseline. |
| `claude-fable-5-high-b20` | `claude-fable-5` @ high | budget $20 | Does a stated budget change Fable's effort? |
| `claude-fable-5-opus-delegation` | `claude-fable-5` @ high → `opus` | delegation | Does planning-and-reviewing while a cheaper same-provider model implements beat working alone? |
| `claude-opus-4-8-high` | `claude-opus-4-8` @ high | — | Opus 4.8 against Fable on the same harness. |
| `claude-opus-4-8-high-b20` | `claude-opus-4-8` @ high | budget $20 | Budget variant of the above. |
| `claude-opus-5-high` | `claude-opus-5` @ high | — | Opus 5 on the same harness. |
| `codex-sol-high` | `gpt-5.6-sol` @ high | — | Codex solo baseline. |
| `codex-sol-high-b20` | `gpt-5.6-sol` @ high | budget $20 | Budget variant of the above. |
| `codex-sol-max` | `gpt-5.6-sol` @ max | — | Reasoning effort against `codex-sol-high`, nothing else varied. |
| `codex-sol-terra-delegation` | `gpt-5.6-sol` @ high → `gpt-5.6-terra` | delegation | The Codex-side counterpart to the Claude delegation configuration. |
| `codex-luna-high` | `gpt-5.6-luna` @ high | — | Luna on Codex; pairs with `pi-luna-high` to isolate harness. |
| `pi-luna-high` | `gpt-5.6-luna` @ high, `openai-codex` | — | The same model as `codex-luna-high` through a different harness. Harness is part of the intervention, so these are separate ids. |
| `prime-agent-luna-max` | `gpt-5.6-luna` @ max, `openai-codex` | — | The same model again through Prime Agent, whose only tool is an IPython kernel and whose delegated subagents are sessions of their own. Runs unisolated, because its harness cannot be sandboxed: the contamination audit is its only control and the manifest records `sandboxUnavailable`. Its effort is `max` where the other luna rows are `high`, so a harness-only comparison needs a matching-effort row on either side. |
| `agy-gemini-3-6-flash-high` | `gemini-3.6-flash` @ high | — | Gemini on the Antigravity subscription. The one eligible configuration that runs unisolated, because its harness cannot be sandboxed; the contamination audit is its only control and the manifest records `sandboxUnavailable`. Also the only configuration priced by tokscale rather than ccusage, so its cost carries basis `rate-card` where every other row carries `metered` — see `agy-cli.md`. |
| `agy-gemini-3-7-flash-high` | `gemini-3.7-flash` @ high | — | The next Gemini generation against `agy-gemini-3-6-flash-high`, model varied and nothing else. Shares that row's conditions: unisolated, and priced by tokscale on basis `rate-card`. |
| `pi-kimi-k3-max` | `k3` @ max, `kimi-coding` | — | Kimi K3 on Moonshot's own subscription endpoint, against the metered OpenRouter path below. |
| `pi-openrouter-deepseek-v4-flash-max` | `deepseek/deepseek-v4-flash-0731` @ max, `openrouter` | — | A cheap, fast model at its top thinking level, metered — what the low-cost end of the frontier can reach. |
| `pi-openrouter-ox-alpha-high` | `stealth/ox-alpha` @ high | — | A cloaked model published for evaluation, reached through OpenRouter. pi has no catalog entry for it, so the id is passed through as a custom model and no reasoning tier is documented; `high` stands in. OpenRouter bills nothing for it, so ccusage's figure is a rate estimate rather than metered spend — see the run note. |
| `pi-openrouter-inkling-high` | `thinkingmachines/inkling` @ high, `openrouter` | — | Inkling, metered API billing. |
| `pi-openrouter-inkling-high-b20` | `thinkingmachines/inkling` @ high, `openrouter` | budget $20 | Budget variant of the above. |
| `pi-openrouter-kimi-k3-max` | `moonshotai/kimi-k3` @ max, `openrouter` | — | Kimi K3, metered. `max` is the model's only tier, standing in for the others' `high` rather than intensifying it. |
| `pi-openrouter-kimi-k3-max-b20` | `moonshotai/kimi-k3` @ max, `openrouter` | budget $20 | Budget variant of the above. |

### Rehearsal only

| Configuration | Model @ effort | Purpose |
| --- | --- | --- |
| `codex-terra-high` | `gpt-5.6-terra` @ high | The full rehearsal configuration that proved the controller path. Never an eligible entrant. |

### Permanently ineligible smokes

These exercise the controller lifecycle cheaply and must never be registered in an eligible schedule, promoted, or included in analysis. Note that `scripts/benchmark/run.mjs` always renders the real assignment — what keeps a smoke cheap is its short stage timeout, not a reduced task, so a smoke that hits its timeout mid-task is the expected outcome rather than a failure.

| Configuration | Model @ effort | Covers |
| --- | --- | --- |
| `codex-luna-low-smoke` | `gpt-5.6-luna` @ low | The original Codex lifecycle smoke. |
| `claude-haiku-low-sandbox-smoke` | `claude-haiku-4-5` @ low | Claude under the entrant sandbox. |
| `pi-luna-low-smoke` | `gpt-5.6-luna` @ low, `openai-codex` | pi on a subscription credential. |
| `pi-luna-low-sandbox-smoke` | `gpt-5.6-luna` @ low, `openai-codex` | pi under the entrant sandbox. |
| `pi-luna-b20-smoke` | `gpt-5.6-luna` @ low, `openai-codex` | The budget protocol itself — polling, notices, same-session resume. |
| `pi-openrouter-deepseek-smoke` | `deepseek/deepseek-v4-flash` @ low | pi's metered OpenRouter billing path. |
| `pi-openrouter-inkling-smoke` | `thinkingmachines/inkling` @ high | Reachability and effort mapping for Inkling. |
| `pi-openrouter-kimi-k3-smoke` | `moonshotai/kimi-k3` @ max | Reachability for Kimi K3, and a read on its reported flakiness. |
| `pi-openrouter-gemini-3-6-flash-smoke` | `google/gemini-3.6-flash` @ high | Gemini through OpenRouter; ended in mid-run truncation. |
| `agy-gemini-3-6-flash-smoke` | `gemini-3.6-flash` @ high | The Antigravity boundary, and what an agy adapter can and cannot record. |
| `claude-haiku-low-sandbox-b2-smoke` | `claude-haiku-4-5` @ low, budget $2 | The budget protocol under the entrant sandbox on Claude. |
| `codex-luna-low-sandbox-b2-smoke` | `gpt-5.6-luna` @ low, budget $2 | The same, on Codex. |
| `pi-luna-low-sandbox-b2-smoke` | `gpt-5.6-luna` @ low, budget $2 | The same, on pi. |

The three `-b2-smoke` rows exist because the budget protocol had only ever run on open-policy plans. The hook that delivers a notice reads its state from under `benchmark/private/`, which the sandbox makes unreadable, and it swallows every error — so a failure there is silent, and a run would complete looking budgeted while its entrant was never told. What these confirm is that the notices arrive; the controller-side resume logic polls from outside the boundary and was never in doubt.

## Adding a configuration

Add a plan row. Add a roster line saying what it is for. That is the whole procedure.

Write a mechanism document only if you are adding a harness, or a behavior that changes what the entrant sees. If you find yourself copying an existing document and changing a model name, the thing you are adding is a knob, and it does not want a document.

Before a configuration's first eligible run, commit its adapter and the mechanisms it composes, and record the materials commit in the private plan. After it has run, a behavior-changing edit is a new configuration identity — the ranking pools votes by configuration id, so reusing an id asserts "same intervention". Do not silently pool a changed configuration with its earlier execution.

## Provenance and the `recipe` field

A plan row's `recipePath` points at the harness mechanism document, and the runner reads it from the materials commit, hashes it, and stamps path and hash into the manifest. Nothing parses it.

Manifests published before this restructure point at the per-configuration files that existed then. Those references still resolve: they name a path and hash at a specific commit, and git retains the blob. Historical provenance is unaffected by the reorganization, and those manifests must not be rewritten to match the new layout — they record what was in force at the time, which is the point of them.
