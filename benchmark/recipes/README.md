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
| `pi-kimi-k3-max` | `k3` @ max, `kimi-coding` | — | Kimi K3 on Moonshot's own subscription endpoint, against the metered OpenRouter path below. |
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

## Adding a configuration

Add a plan row. Add a roster line saying what it is for. That is the whole procedure.

Write a mechanism document only if you are adding a harness, or a behavior that changes what the entrant sees. If you find yourself copying an existing document and changing a model name, the thing you are adding is a knob, and it does not want a document.

Before a configuration's first eligible run, commit its adapter and the mechanisms it composes, and record the materials commit in the private plan. After it has run, a behavior-changing edit is a new configuration identity — the ranking pools votes by configuration id, so reusing an id asserts "same intervention". Do not silently pool a changed configuration with its earlier execution.

## Provenance and the `recipe` field

A plan row's `recipePath` points at the harness mechanism document, and the runner reads it from the materials commit, hashes it, and stamps path and hash into the manifest. Nothing parses it.

Manifests published before this restructure point at the per-configuration files that existed then. Those references still resolve: they name a path and hash at a specific commit, and git retains the blob. Historical provenance is unaffected by the reorganization, and those manifests must not be rewritten to match the new layout — they record what was in force at the time, which is the point of them.
