# Benchmark controller

`runbook.md` is the stable, harness-neutral instruction set for an agent that coordinates benchmark stages and other agents. It is not a prompt for a level author.

A controller may use any orchestration harness capable of launching the models and sessions declared by a recipe. Harness-specific commands, model selectors, continuation mechanics, and usage extraction belong in recipes or deterministic adapters, not in the shared runbook.

Use a fresh controller context for every eligible run. A dispatcher may launch those isolated contexts in the private schedule order, but it must not pass source, logs, stage artifacts, judgments, or conversational history from one entrant to another.

## Codex CLI adapter

`scripts/benchmark/codex-cli.mjs` is the deterministic adapter for a non-interactive Codex stage. It runs `codex exec`, not the interactive TUI. The draft `benchmark/recipes/codex-terra-high.md` is its first consumer and is rehearsal-only while the broader release protocol remains unresolved.

The adapter receives an already-rendered private prompt and sends it to `codex exec -` on stdin. It uses an ephemeral session, ignores user configuration and exec-policy rules, fixes the model, reasoning effort, sandbox, and approval policy, captures JSONL stdout without mixing in the controller's output, and records the final message separately. It validates the installed bundled model catalog before launch, then requires a `thread.started` session id and `turn.completed.usage.input_tokens` plus `output_tokens`; otherwise the stage is not eligible for a measured-cost record.

```sh
npm run benchmark:codex -- \
  --worktree /tmp/raild-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/codex \
  --model gpt-5.6-terra \
  --effort high \
  --timeout-seconds 10800
```

The output directory must be private or external to the repository and outside the entrant worktree. It contains raw JSONL, stderr, model-catalog and selected-model captures, normalized/raw usage, command/timing data, and the final agent message. The controller copies its hashes and fields into the private manifest; it must not inspect the level source or use the final message as feedback.

## Single-run rehearsal controller

`npm run benchmark:run` executes one private run definition end-to-end. It is intended first for an explicitly ineligible rehearsal, not a one-cell eligible experiment. The definition pins commits, assignment artifacts, worktree and payload locations, the Codex stage settings, and a dated API-list-price input. The controller verifies every supplied artifact against the materials commit, requires a clean controller repository, renders the prompt privately, runs `npm ci`, launches the declared stage, seals, gates, extracts a passing payload, calculates equivalent cost from the captured JSONL usage, and writes either a private manifest or a controller-failure record.

```sh
npm run benchmark:run -- \
  --definition benchmark/private/rehearsal-definition.json \
  --out benchmark/private/runs/<opaque-run-id>
```

The definition is deliberately private because it combines opaque assignment data with temporary worktree and branch identities. It must use an ineligible theme and set `mode` to `rehearsal`; a future eligible definition additionally needs the frozen-release comparison and full schedule controls described in the runbook.

### Preflight and launch

Start only from a clean, committed repository. The `materialsCommit` and `entrantBaseline` should both be the current commit for this first rehearsal. Generate hashes from that committed content rather than typing them:

```sh
git status --short
git rev-parse HEAD
sha256sum \
  benchmark/prompts/level-assignment.md \
  benchmark/examples/downpour.md \
  benchmark/recipes/codex-terra-high.md \
  benchmark/controller/failure-taxonomy.md \
  benchmark/pricing/gpt-5.6-terra-standard-short.json
```

Create `benchmark/private/rehearsal-definition.json` from the shape below, replacing every placeholder with the commit and matching hash above. Predeclare a fresh opaque `runId` and four-character `slotId`; the level id must be `downpour-<slotId>`. Then launch exactly once:

```sh
npm run benchmark:run -- \
  --definition benchmark/private/rehearsal-definition.json \
  --out benchmark/private/runs/<opaque-run-id>
```

Do not inspect entrant source or logs while it runs. When it finishes, inspect only its controller result and private manifest, then follow the rehearsal checklist in `benchmark/controller/runbook.md` for playable deployment, ranking-record validation, and cost reconciliation.

Its required shape is:

```json
{
  "schemaVersion": 1,
  "benchmarkVersion": "rehearsal",
  "mode": "rehearsal",
  "assignment": {
    "runId": "<opaque-run-id>",
    "slotId": "<opaque-slot>",
    "configurationId": "codex-terra-high",
    "recipe": { "path": "benchmark/recipes/codex-terra-high.md", "sha256": "<sha256>" },
    "theme": { "id": "<ineligible-theme-id>", "path": "benchmark/examples/<theme>.md", "sha256": "<sha256>" },
    "levelId": "<theme-id>-<opaque-slot>",
    "levelTitle": "<theme H1>"
  },
  "baseline": { "materialsCommit": "<commit>", "entrantBaseline": "<commit>" },
  "template": { "path": "benchmark/prompts/level-assignment.md", "sha256": "<sha256>" },
  "failureTaxonomy": { "path": "benchmark/controller/failure-taxonomy.md", "sha256": "<sha256>" },
  "stage": { "adapter": "codex-cli", "model": "gpt-5.6-terra", "effort": "high", "timeoutSeconds": 10800 },
  "worktree": { "path": "/tmp/raild-<opaque-run-id>" },
  "payload": { "path": "/tmp/raild-payload-<opaque-run-id>", "branch": "benchmark-payload-<opaque-run-id>" },
  "pricing": { "path": "benchmark/pricing/gpt-5.6-terra-standard-short.json", "sha256": "<sha256>" }
}
```

## Generic controller tools

The admin scripts below implement deterministic administration only. They do not launch a model, choose a configuration, calculate cost, classify failures, or make quality judgments. `benchmark:run` is the separate declared single-run controller above. Hash every runner and adapter path and revision at freeze.

### Render the shared assignment

```sh
npm run benchmark:render -- \
  --template benchmark/prompts/level-assignment.md \
  --theme benchmark/themes/<theme-id>.md \
  --level-id <theme-id>-<slot-id> \
  --level-title '<theme H1>' \
  --out benchmark/private/runs/<run-id>/rendered-assignment.md \
  --metadata benchmark/private/runs/<run-id>/rendered-assignment.json
```

The renderer requires exactly one each of `{{LEVEL_TITLE}}` and `{{THEME}}`, and at least one `{{LEVEL_ID}}` (the template may repeat it for emphasis, e.g. in a directory-path sentence); it rejects any other placeholder. The metadata records SHA-256 hashes for the template, theme, and rendering.

### Generate and validate the private run schedule

Create a private definition file containing the benchmark version, configuration ids with hashed recipe artifacts, and theme ids with hashed theme artifacts and H1-derived titles:

```json
{
  "benchmarkVersion": "v<release>",
  "configurations": [
    {
      "id": "<configuration-id>",
      "recipe": { "id": "<configuration-id>", "path": "benchmark/recipes/<recipe>.md", "sha256": "<sha256>" }
    }
  ],
  "themes": [
    {
      "id": "<theme-id>",
      "path": "benchmark/themes/<theme-id>.md",
      "sha256": "<sha256>",
      "levelTitle": "<theme H1>"
    }
  ]
}
```

```sh
npm run benchmark:schedule -- create \
  --definition benchmark/private/schedule-definition.json \
  --out benchmark/private/run-schedule.json
npm run benchmark:schedule -- validate \
  --definition benchmark/private/schedule-definition.json \
  --schedule benchmark/private/run-schedule.json
```

Generation uses cryptographic randomness, assigns opaque run and slot ids, shuffles execution order, and does not print assignments. Validation enforces the complete configuration × theme crossing, unique ids, contiguous schedule indexes, recipe/theme hash agreement, H1-derived titles, and `<theme-id>-<slot-id>` level ids.

### Create and validate blind ranking pairs

The input projection contains only `benchmarkVersion` and each theme's playable slot ids—never configurations or models. Keep it private until rankings are locked.

```sh
npm run benchmark:ranking -- pairs \
  --projection benchmark/private/playable-projection.json \
  --out benchmark/private/ranking-pairs.json
npm run benchmark:ranking -- validate \
  --projection benchmark/private/playable-projection.json \
  --pairs benchmark/private/ranking-pairs.json \
  --rankings benchmark/rankings
```

Pair generation randomizes pair order and first presentation. Validation checks that the ranking set covers every passing same-theme pair exactly once and that every verdict, winner, play count, and presentation order is valid.

### Administer worktrees, gates, and payloads

All worktree paths must be outside the primary working tree. Gate output must be in `benchmark/private/` or outside the repository. These commands emit only opaque identifiers and commit ids; store the full records privately.

```sh
npm run benchmark:admin -- worktree \
  --baseline <entrant-baseline-commit> \
  --run-id <opaque-run-id> \
  --path /tmp/raild-<opaque-run-id>

npm run benchmark:admin -- seal \
  --worktree /tmp/raild-<opaque-run-id> \
  --baseline <entrant-baseline-commit> \
  --level-id <theme-id>-<slot-id>

npm run benchmark:admin -- gates \
  --worktree /tmp/raild-<opaque-run-id> \
  --baseline <entrant-baseline-commit> \
  --level-id <theme-id>-<slot-id> \
  --out benchmark/private/runs/<opaque-run-id>/gates

npm run benchmark:admin -- payload \
  --repo . \
  --materials <materials-commit> \
  --evaluated <evaluated-commit> \
  --level-id <theme-id>-<slot-id> \
  --path /tmp/raild-payload-<opaque-run-id> \
  --branch benchmark-payload-<opaque-run-id>
```

`worktree` does not install dependencies; the frozen recipe or controller procedure must declare any dependency provisioning before the first model stage. `seal` runs the baseline-aware scope gate, commits only the already-permitted working-tree changes, and requires a clean result. `gates` runs all four required gates independently, writes complete logs and their hashes, and rejects a gate that changes the sealed tree. `payload` creates a worktree at the materials commit, copies only the assigned level directory from the evaluated commit, and rejects empty, deleting, renaming, or out-of-directory diffs.

Run the synthetic controller checks with:

```sh
npm run test:benchmark-controller
```

The controller runbook remains editable until a benchmark release is frozen. At freeze, record its path and SHA-256 hash as a `controller-runbook` artifact.
