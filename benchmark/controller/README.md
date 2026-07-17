# Benchmark controller

`runbook.md` is the stable, harness-neutral instruction set for an agent that coordinates benchmark stages and other agents. It is not a prompt for a level author.

A controller may use any orchestration harness capable of launching the models and sessions declared by a recipe. Harness-specific commands, model selectors, continuation mechanics, and usage extraction belong in recipes or deterministic adapters, not in the shared runbook.

Use a fresh controller context for every eligible run. A dispatcher may launch those isolated contexts in the private schedule order, but it must not pass source, logs, stage artifacts, judgments, or conversational history from one entrant to another.

## Codex CLI adapter

`scripts/benchmark/codex-cli.mjs` is the deterministic adapter for a non-interactive Codex stage. It runs `codex exec`, not the interactive TUI. The draft `benchmark/recipes/codex-terra-high.md` is its first consumer and is rehearsal-only while the broader release protocol remains unresolved.

The adapter receives an already-rendered private prompt and sends it to `codex exec -` on stdin. It fixes the declared model and runtime settings, captures stage output and usage without mixing them into the controller's output, and validates the installed bundled model catalog before launch. See the selected recipe for the complete session policy, invocation, and artifact contract.

```sh
npm run benchmark:codex -- \
  --worktree /tmp/pareto-rail-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/codex \
  --model gpt-5.6-terra \
  --effort high \
  --timeout-seconds 10800
```

The output directory must be private or external to the repository and outside the entrant worktree. It contains the stage records declared by the selected recipe. The controller copies their hashes and fields into the private manifest; it must not inspect the level source or use the final message as feedback.

## Single-run rehearsal controller

`npm run benchmark:run` executes one private run definition as a resumable sequence. The definition pins commits, assignment artifacts, worktree and payload locations, the stage settings, and — for a delegation configuration — the `delegation` block (addendum artifact, delegate model, delegate effort). The controller verifies every supplied artifact against the materials commit, requires a clean controller repository for a new run, renders the prompt privately, runs `npm ci`, launches the declared stage in an isolated per-run harness home, seals, gates, extracts a passing payload, measures cost with ccusage, and writes a private manifest. Each operation is checkpointed; failures preserve all prior artifacts and the entrant worktree. The recorded benchmark version selects the source root: v1/rehearsal uses the historical `src/levels/<level-id>/` payload contract, while the directory-only protocol uses `src/benchmark-levels/<level-id>/` and does not run relocation promotion.

```sh
npm run benchmark:run -- \
  --definition benchmark/private/rehearsal-definition.json \
  --out benchmark/private/runs/<opaque-run-id>
```

The definition is deliberately private because it combines opaque assignment data with temporary worktree and branch identities. It must use an ineligible theme and set `mode` to `rehearsal`. An eligible definition additionally requires `release`, `schedule`, `runner`, and `executor` hashed artifacts plus `baseline.configurationCommit`. Before launching a model, the runner verifies the release against its `benchmark-<version>` tag, shared inputs against that release, the exact assignment against the private schedule revision, the selected source-root baseline contract, and runner/executor/recipe inputs against the configuration commit and current checkout.

### Preflight and launch

Start only from a clean, committed repository. The `materialsCommit` and `entrantBaseline` should both be the current commit for this first rehearsal. Generate hashes from that committed content rather than typing them:

```sh
git status --short
git rev-parse HEAD
sha256sum \
  benchmark/prompts/level-assignment.md \
  benchmark/examples/downpour.md \
  benchmark/recipes/codex-terra-high.md \
  benchmark/controller/failure-taxonomy.md
```

For a delegation configuration, also hash `benchmark/prompts/flexible-delegation.md` and add it as the definition's `delegation.prompt` artifact.

Create `benchmark/private/rehearsal-definition.json` from the shape below, replacing every placeholder with the commit and matching hash above. Predeclare a fresh opaque `runId` and four-character `slotId`; the level id must be `downpour-<slotId>`. Then launch exactly once:

```sh
npm run benchmark:run -- \
  --definition benchmark/private/rehearsal-definition.json \
  --out benchmark/private/runs/<opaque-run-id>
```

Do not inspect entrant source or logs while it runs. When it finishes, inspect only its controller result and private manifest, then follow the rehearsal checklist in `benchmark/controller/runbook.md` for playable deployment, ranking-record validation, and cost reconciliation.

Resume an interrupted controller without repeating completed work:

```sh
npm run benchmark:run -- --resume benchmark/private/runs/<opaque-run-id>
```

If a harness process timed out after leaving completed work, operator classification may explicitly accept that worktree and resume sealing. The resulting recovery record is audit provenance and does not demote a gate-passing playable result:

```sh
npm run benchmark:run -- \
  --resume benchmark/private/runs/<opaque-run-id> \
  --accept-stage-output true
```

Never delete an entrant worktree merely because the controller or harness failed. Failures are snapshotted to durable `refs/benchmark-recovery/<run-id>/...` refs, including untracked files, without changing the entrant index. Resume reconstructs a missing temporary worktree from that snapshot. See `benchmark/README.md` for non-destructive archive, unarchive, and strictly verified prune commands.

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
  "worktree": { "path": "/tmp/pareto-rail-<opaque-run-id>" },
  "payload": { "path": "/tmp/pareto-rail-payload-<opaque-run-id>", "branch": "benchmark-payload-<opaque-run-id>" }
}
```

A delegation configuration adds a `delegation` block and (for the rehearsal) sets both efforts to `low`:

```json
{
  "stage": { "adapter": "codex-cli", "model": "gpt-5.6-sol", "effort": "low", "timeoutSeconds": 10800 },
  "delegation": {
    "prompt": { "path": "benchmark/prompts/flexible-delegation.md", "sha256": "<sha256>" },
    "delegateModel": "gpt-5.6-terra",
    "delegateEffort": "low"
  }
}
```

## Generic controller tools

The shared `admin.mjs`, `common.mjs`, and `render-assignment.mjs` components implement deterministic administration. They do not launch a model, choose a configuration, calculate cost, classify failures, or make quality judgments. `benchmark:run` is the separate configuration-scoped runner above. None of this tooling is frozen: each run records the executing controller commit, and gate results can be reproduced or re-run (regate) against the sealed evaluated commit at any tooling version.

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
      "configurationCommit": "<commit-containing-recipe>",
      "recipe": { "id": "<configuration-id>", "path": "benchmark/recipes/<recipe>.md", "sha256": "<sha256>" },
      "stage": { "adapter": "<adapter-id>", "model": "<exact-model>", "effort": "high", "timeoutSeconds": 10800 }
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

A configuration may add `"budget": { "usd": 20 }` to its `stage`. The amount must be positive and finite; omitting it preserves the single-turn adapter path and artifacts.

Generation uses cryptographic randomness, assigns opaque run and slot ids, shuffles execution order, and does not print assignments. Validation reads each configuration artifact from its own `configurationCommit`, then enforces complete registered-configuration × theme coverage, unique ids, contiguous schedule indexes, recipe/theme hash agreement, H1-derived titles, and `<theme-id>-<slot-id>` level ids.

To register another configuration later, commit its recipe, append it to the definition without changing existing entries, and extend the schedule in place (or through a temporary output followed by an atomic replacement):

```sh
npm run benchmark:schedule -- extend \
  --definition benchmark/private/schedule-definition.json \
  --schedule benchmark/private/run-schedule.json \
  --out benchmark/private/run-schedule.next.json
```

Extension rejects changed or removed configurations/themes, preserves every old assignment and index, and appends only the newly required cells. Pin the new schedule hash and configuration commit in each eligible run definition.

### Create and validate blind ranked sets

The input projection contains only `benchmarkVersion` and each theme's playable slot ids—never configurations or models. Keep it private until rankings are locked.

```sh
npm run benchmark:ranking -- sets \
  --projection benchmark/private/playable-projection.json \
  --out benchmark/private/ranking-sets.json
npm run benchmark:ranking -- validate-sets \
  --projection benchmark/private/playable-projection.json \
  --sets benchmark/private/ranking-sets.json \
  --rankings benchmark/rankings
```

Set generation creates one randomized presentation per theme for every snapshot with at least two passing entrants. Validation checks exact slot coverage, play counts, presentation order, and best-to-worst tiers. A later configuration produces a new set schedule and locked snapshot; it does not rewrite the old one.

The legacy `pairs` and `validate` commands remain available for targeted binary judgments. `extend-pairs` preserves existing pair ids and presentation orders while adding only newly possible pairs; exhaustive pair coverage is optional policy rather than the primary workflow.

### Promote a finalized playable run

Promotion is separate post-run administration for historical v1 outputs. It validates the private manifest, gate record, evaluated and payload refs, and assignment metadata before relocating a v1 payload byte-for-byte under `src/benchmark-levels/<level-id>/`, creating its controller-owned `level.json`, regenerating the derived gallery, running typecheck, build, benchmark scope, and floor checks, and recording a separate administrative commit. Directory-only protocol outputs already live under the discovered benchmark root and do not use this relocation step. The private `promotion.json` record is checkpointed atomically and includes the payload and promotion commit provenance; it never changes `manifest.json` or its playable disposition.

```sh
npm run benchmark:promote -- --run <opaque-run-id>
```

The controller automatically invokes the same command path after finalizing a playable v1 manifest. If that invocation fails, `benchmark:manage status` reports `run completed, promotion pending` or `run completed, promotion failed` and prints the resume command. Directory-only manifests report promotion as not required. Promotion operations use a Git lock and refuse unrelated local changes. Repeating the command validates completed checkpoints and reuses the existing source and administrative commit.

### Administer worktrees, gates, and payloads

All worktree paths must be outside the primary working tree. Gate output must be in `benchmark/private/` or outside the repository. These commands emit only opaque identifiers and commit ids; store the full records privately.

```sh
npm run benchmark:admin -- worktree \
  --baseline <entrant-baseline-commit> \
  --run-id <opaque-run-id> \
  --path /tmp/pareto-rail-<opaque-run-id>

npm run benchmark:admin -- seal \
  --worktree /tmp/pareto-rail-<opaque-run-id> \
  --baseline <entrant-baseline-commit> \
  --level-id <theme-id>-<slot-id>

npm run benchmark:admin -- gates \
  --worktree /tmp/pareto-rail-<opaque-run-id> \
  --baseline <entrant-baseline-commit> \
  --level-id <theme-id>-<slot-id> \
  --out benchmark/private/runs/<opaque-run-id>/gates

npm run benchmark:admin -- payload \
  --repo . \
  --materials <materials-commit> \
  --evaluated <evaluated-commit> \
  --level-id <theme-id>-<slot-id> \
  --path /tmp/pareto-rail-payload-<opaque-run-id> \
  --branch benchmark-payload-<opaque-run-id>
```

`worktree` does not install dependencies; the registered recipe or controller procedure must declare any dependency provisioning before the first model stage. `seal` runs the baseline-aware scope gate, commits only the already-permitted working-tree changes, and requires a clean result. `gates` runs all four required gates independently, writes complete logs and their hashes, and rejects a gate that changes the sealed tree. `payload` creates a worktree at the materials commit, copies the present roots from the assigned level footprint in the evaluated commit, and rejects empty, deleting, renaming, or out-of-footprint diffs.

Run the synthetic controller checks with:

```sh
npm run test:benchmark-controller
```

The controller runbook remains editable until a benchmark release is frozen. At freeze, record its path and SHA-256 hash as a `controller-runbook` artifact.
