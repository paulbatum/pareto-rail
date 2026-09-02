# Benchmark controller development

This page explains the controller's component boundaries, data flow, invariants, and focused verification commands. Use [`README.md`](README.md) to operate runs. Use [`../recipes/README.md`](../recipes/README.md) to define configurations and decide whether a behavior change creates a new configuration identity.

## Development invariants

Preserve these contracts when changing controller code:

- A new run starts only from a clean controller checkout and records the executing controller commit.
- The plan resolves to `run-definition.json` before execution. Resume reads that recorded definition rather than a current plan row.
- Materials are read from `materialsCommit`; the entrant checkout comes from `entrantBaseline`.
- Every completed checkpoint is validated before reuse. Resume does not silently recompute or overwrite accepted evidence.
- The harness stage is the expensive, non-repeatable intervention. Sealing, gates, payload construction, manifest projection, promotion, and export are deterministic operations over recorded inputs.
- A failed gate produces an unadjudicated result. Only the owner assigns `dnf` or `infrastructure`.
- Promotion validates and materializes a recorded payload. It does not edit the run manifest or its disposition.
- Blind output remains the default for status and results commands.
- Run-local credentials, raw harness state, and private mappings never enter public provenance.
- Level ownership comes from `scripts/level-footprint.mjs`. Controller components consume that model instead of maintaining path lists of their own.

The run manifest's `controller.commit` identifies the source that executed the run. A materials commit pins prompts, themes, and recipe documents; it does not substitute its copy of the controller for the executing checkout.

## Component map

| Component | Responsibility |
| --- | --- |
| `run.mjs` | Validate plans, resolve run definitions, execute checkpoints, select adapters, build manifests, and coordinate resume and recovery. |
| `admin.mjs` | Create entrant worktrees, seal evaluated commits, run the four gates, and derive payload commits. |
| `*-cli.mjs` adapters | Invoke one harness, isolate its home, capture native artifacts, normalize stage usage, and implement supported session continuation. |
| `common.mjs` | Shared argument parsing, validation, hashing, JSON records, path safety, round-artifact discovery, and continuation detection. |
| `protocol.mjs` | Constants shared by baseline creation and validation. |
| `render-assignment.mjs` | Render and validate the shared assignment and delegation addendum. |
| `baseline-policy.mjs` | Inspect a commit tree for content forbidden by the scrubbed policy. |
| `cut-baseline.mjs` | Produce and verify a scrubbed entrant baseline in an isolated worktree. |
| `entrant-sandbox.mjs` | Decide sandbox activation and availability, validate host dependencies, and construct the shared Claude/pi policy. |
| `pi-sandbox-extension.js` | Apply the controller-owned sandbox policy to pi commands and native file tools. |
| `sandbox-probe.mjs` and `sandbox-gate-check.mjs` | Exercise the boundary and confirm the entrant checks still run inside it. |
| `budget.mjs` and budget hooks/extensions | Define spend notices, continuation decisions, and harness-specific delivery. |
| `pi-quota-wait-extension.js` | Keep supported pi quota waits inside the live stage when possible. |
| `ccusage-cost.mjs`, `tokscale-cost.mjs`, and `rate-card.mjs` | Measure recorded usage, apply the selected pricing source, and reconcile available counters. |
| `reconcile-cost.mjs` | Restate eligible historical cost records from retained evidence after reconciliation rules change. |
| `recovery-snapshot.mjs` | Snapshot entrant work to durable refs and restore a missing temporary worktree. |
| `results.mjs` | Validate and project run artifacts into per-run result states. |
| `status.mjs` | Join plans, schedules, live records, and archives into pending, promotion, and completed buckets. |
| `manage-run.mjs` | Adjudicate, archive, restore, prune, and delete run records with safety checks. |
| `promote.mjs` | Validate a playable run, materialize its payload, convert content images, run promotion checks, and commit the result. |
| `export-rank-catalog.mjs` | Project the private publication manifest into the public site catalog. |
| `export-provenance.mjs` | Copy and scan the allowlisted public run record. |
| `export-rollouts.mjs` | Stage, scan, index, and optionally upload full transcripts. |

Harness documents under [`../recipes/`](../recipes/) explain what each adapter captures and which limitations affect interpretation. Keep harness-as-intervention facts there; keep implementation ownership here.

## Run data flow

`run.mjs` executes these checkpoints in order:

1. `inputs`
2. `worktree`
3. `setup`
4. `stage`
5. `seal`
6. `gates`
7. `payload`
8. `manifest`

`controller-state.json` records checkpoint progress. Each checkpoint writes its durable artifact before the state marks it complete.

### Inputs

For a new run, the controller validates the plan and writes the resolved row to `run-definition.json`. It resolves commit references before recording them.

The input checkpoint reads the assignment template, theme, recipe document, and optional delegation prompt from `materialsCommit`. It writes the rendered assignment and hashes used for sibling comparison. A pre-launch check requires siblings on the same theme to share the theme and assignment-template hashes; level ids and budget mechanisms may differ.

### Worktree and setup

`admin.mjs` creates a temporary entrant worktree at `entrantBaseline`. The setup checkpoint installs dependencies inside that worktree. The selected baseline policy determines whether the launch guard blocks forbidden content or records it as an open-policy disclosure.

The harness home lives under the private run directory. Redirecting the harness home keeps sessions and cost attribution local to one run; it is not the entrant security boundary.

### Stage

The adapter receives the recorded worktree, rendered prompt, stage directory, model settings, and run-local harness home. It writes the stage's command, identity, events, usage, result, final message, and available native rollout artifacts.

A session continuation writes round-suffixed artifacts and updates the current launch record. `common.mjs` discovers the recorded rounds; cost code decides how to interpret their counters. Do not duplicate that algorithm in documentation. The manifest records the selected sources, and `controller.commit` identifies the implementation that selected them.

A long stage runs periodic recovery snapshots. A controller failure after worktree creation also attempts a recovery snapshot before recording the failure. Snapshot failure is evidence in the run record, not a reason to disturb a still-running stage.

### Seal and gates

`admin.mjs` stages the entrant's tracked and untracked source, validates the assigned descriptor, and seals one evaluated commit. The gates then run against that commit:

- typecheck;
- build;
- benchmark scope; and
- level floor.

The scope gate invokes the controller's checker by absolute path. Typecheck, build, and floor execute commands from the entrant checkout. This boundary determines whether a controller change can affect an existing sealed run: scope changes can, while checkout-owned gate changes require a new baseline.

### Payload and manifest

A passing run derives a payload containing only the assigned level footprint on top of `materialsCommit`. Both `admin.mjs` and `run.mjs` use `benchmarkLevelFootprint()` to build and validate it.

The manifest projects the recorded definition, inputs, controller commit, stages, cost, gates, output commits, and disposition. Failed gates still produce a manifest, but no payload. Runtime manifest checks live in `run.mjs` and `results.mjs`; `benchmark/schemas/run-manifest.schema.json` is the documentary record shape rather than the runtime validator.

## Resume and recovery design

Resume takes a run directory, reads `run-definition.json`, validates checkpoint artifacts, and continues at the first incomplete checkpoint.

Two explicit stage overrides exist:

- `--accept-stage-output true` accepts a failed stage's current worktree after an operator confirms the entrant completed its work.
- `--continue-stage true` asks a supported adapter to re-enter the recorded session. It invalidates stale evaluated and payload records because the entrant can modify the worktree again. It accepts a stage directory with no launch record, since a killed stage writes none; the adapter then recovers the session identity from the harness home. Manifest projection reads the stage's command and event log from the earliest round that recorded them, so a round that recorded nothing does not block the manifest.

Budgeted stages reject manual session continuation because the budget protocol owns their continuation sequence.

Recovery refs preserve tracked and untracked entrant source outside the temporary worktree. Periodic snapshots use a private index, skip unchanged trees, and never alter the entrant's index or files. Keep recovery creation and restoration symmetric when changing either side.

## Adapter contract

`ADAPTERS` in `run.mjs` maps a plan's `stage.adapter` to:

- adapter script and stage directory;
- harness name and binary option;
- isolated-home environment variable;
- credential source and destination;
- provider identity;
- stage-specific arguments; and
- optional delegation behavior.

Each adapter owns the harness invocation and must leave enough durable evidence for the controller to determine completion, session identity, usage, timing, selected model, and available transcript artifacts. Effective arguments belong in `command.json`; secrets do not.

When adding a harness:

1. Add the adapter CLI and package command.
2. Register it in `ADAPTERS`.
3. Classify its sandbox support explicitly.
4. Add its cost measurement path or record why cost is unavailable.
5. Define completion and continuation behavior from observable harness output.
6. Capture the harness version, selected model, command, usage, result, final message, and native rollout when available.
7. Add a mechanism document under `benchmark/recipes/`.
8. Add focused controller, contamination, budget, sandbox, and promotion coverage where the new behavior reaches those components.
9. Rehearse the complete lifecycle before creating an eligible configuration.

A behavior-changing adapter edit can change the intervention. After a configuration has run, follow `recipes/README.md`: assign a new configuration identity when the change affects what the entrant sees or how it can work.

## Entrant sandbox design

The sandbox contract is common even though harnesses reach it differently:

- the entrant worktree is the only writable tree;
- the primary repository and sibling run checkouts are unreadable;
- external network egress is unavailable; and
- loopback remains available for floor and snapshot checks.

Codex implements the boundary through its permission profile. Claude uses its built-in bubblewrap sandbox with web tools disabled outside that boundary. pi uses `pi-sandbox-extension.js` over `sandbox-runtime` to cover both shell commands and native file tools.

`entrant-sandbox.mjs` owns activation, unsupported-adapter classification, dependency checks, shared paths, and the pi policy. It also writes pi's worktree-local git exclude for shielded sandbox paths; the same mounts make those paths unwritable, so the exclude cannot conceal entrant work.

Treat an unavailable sandbox as an explicit recorded condition, never a silent fallback. A new adapter must enter either the sandboxed or unavailable set before eligible use.

Run both probes when changing the boundary. The expected result is:

```sh
node scripts/benchmark/sandbox-probe.mjs
node scripts/benchmark/sandbox-gate-check.mjs --worktree <checkout>
```

- repository and sibling reads denied;
- external egress and DNS denied;
- loopback working;
- worktree reads and writes working; and
- entrant gates passing.

## Cost and provenance design

Cost is derived after the stage from the run-local harness evidence. The cost modules own transcript discovery, tool invocation, normalized summaries, pricing basis, counter reconciliation, and source selection. `run.mjs` projects their result into the manifest.

Do not restate per-harness aggregation rules in standing documentation. They can change with harness output formats, and the controller commit already pins the exact implementation used by a run. Document only the observable record contract and harness-specific evidence limitations.

When changing cost logic:

1. Preserve raw token and tool evidence.
2. Keep actual tool output distinguishable from normalized fields.
3. Record why an independent counter is unavailable.
4. Never represent unavailable cost as zero.
5. Update runtime validation and the documentary schema together.
6. Add a fixture that fails under the previous rule.
7. Use `reconcile-cost.mjs` only when retained artifacts contain enough evidence to restate historical records without re-measuring them.

Promotion and export must use the recorded cost; they must not recalculate it from the current checkout.

## Promotion and publication design

Promotion is a separate checkpointed transaction over a completed run. `promote.mjs`:

1. validates the manifest, gates, refs, payload, and current repository state;
2. materializes the recorded payload;
3. converts entrant PNG content to AVIF and records every hash-changing conversion;
4. runs promotion checks;
5. verifies that only the expected level footprint changed; and
6. commits the promoted output.

The promotion lock prevents concurrent mutations of the shared repository. Resume revalidates completed promotion checkpoints rather than repeating them.

The three exporters share `benchmark/private/publication.json` as selection input but publish different products:

- the site catalog;
- the allowlisted provenance tree; and
- the external full-transcript dataset and checked-in index.

Keep selection shared so a run cannot enter one public surface accidentally through an unrelated list. Keep payload rules in `scripts/level-footprint.mjs`, not in an exporter-specific path list.

## Focused verification

Run the focused command for the component changed, then run the repository-required typecheck and build.

| Change | Focused verification |
| --- | --- |
| Run checkpoints, manifests, adapters, cost, results, or management | `npm run test:benchmark-controller` |
| Baseline policy or baseline cutting | `npm run test:benchmark-baseline` |
| Budget protocol or delivery | `npm run test:benchmark-budget` |
| pi quota waiting | `npm run test:benchmark-quota-wait` |
| Contamination detection | `npm run test:benchmark-contamination` |
| Promotion | `npm run test:benchmark-promotion` |
| Catalog export | `npm run test:benchmark-catalog` and `npm run test:benchmark-domain` |
| Vote API | `npm run test:vote-api` |

For sandbox changes, also run the sandbox probe and gate check above on a prepared host. These are behavioral probes, not substitutes for the focused unit coverage.

Finish every controller change with:

```sh
npm run typecheck
npm run build
```

Use the repository's gitignored `tmp/` directory for fixtures, staged exports, and other scratch output.
