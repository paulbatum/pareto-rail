# Benchmark controller

`runbook.md` is the stable, harness-neutral instruction set for an agent that coordinates benchmark stages and other agents. It is not a prompt for a level author.

A controller may use any orchestration harness capable of launching the models and sessions declared by a recipe. Harness-specific commands, model selectors, continuation mechanics, and usage extraction belong in recipes or deterministic adapters, not in the shared runbook.

Use a fresh controller context for every eligible run. A dispatcher may launch those isolated contexts in the private schedule order, but it must not pass source, logs, stage artifacts, judgments, or conversational history from one entrant to another.

## Generic controller tools

The scripts below implement deterministic administration only. They do not launch a model, choose a configuration, calculate cost, classify failures, or make quality judgments. Hash their exact paths and revisions as runner artifacts at freeze.

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

The renderer requires exactly one each of `{{LEVEL_ID}}`, `{{LEVEL_TITLE}}`, and `{{THEME}}`; it rejects any other placeholder. The metadata records SHA-256 hashes for the template, theme, and rendering.

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
