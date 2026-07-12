# Benchmark materials

This directory holds the inputs and records for the raild level-generation benchmark. `docs/benchmark-plan.md` is the working protocol.

- `controller/` contains the harness-neutral orchestration runbook.
- `prompts/` contains the shared benchmark assignment at a stable authoring path.
- `themes/` contains eligible assignment themes.
- `examples/` contains ineligible prompt exemplars that may be used for rehearsal.
- `recipes/` contains verbatim configuration recipes and their template.
- `schemas/` defines freeze, private schedule, run-manifest, and slot-only ranking formats.
- `releases/` documents immutable benchmark freezes without duplicating the authored tree.
- `rankings/` contains immutable blind-ranking snapshots locked before their slot mappings are opened.
- `manifests/` contains redacted full run records published after unblinding.

During generation, keep the append-only randomized run schedule (which is also the slot-to-configuration key), raw logs, and complete run records under `benchmark/private/`. That directory is ignored by Git. Do not publish a full manifest until the ranking snapshot containing that slot is locked because a full manifest necessarily reveals its configuration, model, recipe, and output branch.

The controller follows `benchmark/controller/runbook.md`; coding agents do not receive that administrative prompt. The standing level-building brief remains `docs/level-brief.md`. `benchmark/prompts/level-assignment.md` adds benchmark-wide identity, duration, and polish expectations without duplicating the brief. At protocol freeze, the release record identifies the materials commit, entrant-baseline commit, and shared artifact hashes. Each configuration registration separately pins its orchestration runner, harness executor, recipe, execution settings, and configuration commit. Cost is measured after the run by ccusage and is not a pinned per-configuration input. Entrant worktree access follows the controller runbook.

Each run receives a four-character opaque slot and a globally unique level id such as `theme-a44f`. The agent develops normally in an opaque worktree, including temporary registry and gallery edits. After gates run, the controller derives a clean payload commit containing only `src/levels/<level-id>/`. Passing payloads remain separate through blind ranking, then the resumable promotion command relocates one verified payload under `src/benchmark-levels/<level-id>/`, creates its controller-owned descriptor, regenerates the gallery, runs application checks, and records a separate administrative commit. One post-unblinding integration commit is a later operation.

Author benchmark materials at stable paths without `v1` or `v2` suffixes. A version exists only when `benchmark/releases/<version>/freeze.json` and its matching `benchmark-<version>` Git tag are created. See `benchmark/releases/README.md`.

## Inspecting run results

Use `npm run benchmark:results` to summarize records under `benchmark/private/runs`. The table reports lifecycle state, gates, stage and controller elapsed time, cost, and manifest completeness without parsing entrant prose or raw logs. Rehearsal identities are visible by default; eligible benchmark identities remain blind by default.

```bash
npm run benchmark:results
npm run benchmark:results -- --version rehearsal
npm run benchmark:results -- --theme downpour --format json
npm run benchmark:results -- --identity blind
```

Use `--identity unblind` only when the relevant ranking snapshot has been locked and its mapping opened. `--format csv` is also available, and `--runs <path>` can inspect another run-artifact directory.

## Resuming and managing runs

The runner checkpoints inputs, worktree creation, dependency setup, entrant execution, sealing, gates, payload extraction, and manifest generation in `controller-state.json`. Re-running with `--resume` validates existing artifacts and continues at the first unfinished operation:

```bash
npm run benchmark:run -- --resume benchmark/private/runs/<run-id>
```

A failed harness exit is not accepted automatically. If infrastructure timed out after the entrant completed its worktree, inspect that condition and explicitly resume normal sealing and gates:

```bash
npm run benchmark:run -- \
  --resume benchmark/private/runs/<run-id> \
  --accept-stage-output true
```

This records `recovery.json`. Recovery is provenance, not a result disposition: a recovered entrant that passes every gate and produces a valid payload is `playable`.

A finalized playable run is promoted automatically by the controller. Operators can resume the same operation without rerunning generation:

```bash
npm run benchmark:promote -- --run <run-id>
```

Existing-output administration builds its inventory only from private and published manifests, then invokes the same verified promotion path for each playable eligible record:

```bash
npm run benchmark:promote -- --inventory true --out benchmark/private/migrations/inventory.json
npm run benchmark:migrate -- --version <benchmark-version>
```

The migration inventory and its machine-readable promotion record are kept under `benchmark/private/migrations/`. They coalesce consistent private and published copies, record public rollout evidence, and include payload and application commit provenance without changing the run manifests, dispositions, evaluated branches, payload branches, or recovery refs. Verified non-playable source copies are recorded as administrative cleanups rather than promoted or made ranking-eligible.

Promotion checkpoints and its private payload/promotion commit provenance live in `promotion.json`. A promotion failure never edits the run manifest or changes its playable disposition; `benchmark:manage -- status` reports the completed run as promotion-pending or promotion-failed and prints this resume command.

Whenever a controller operation fails after a worktree exists, the runner also captures tracked and untracked source in a commit under `refs/benchmark-recovery/<run-id>/...` and records it in `recovery-snapshot.json`. The snapshot uses a temporary Git index and does not alter the entrant worktree. If `/tmp` later disappears, `--resume` reconstructs the worktree from this ref before continuing.

Management is non-destructive by default:

```bash
npm run benchmark:manage -- status
npm run benchmark:manage -- archive-dnf --dry-run true
npm run benchmark:manage -- archive-dnf
npm run benchmark:manage -- unarchive --run <run-id>
```

Archiving moves only the private run record. It never removes entrant or payload worktrees, branches, commits, or source. `prune` requires the run id twice as confirmation and refuses unless each worktree is clean, its `HEAD` and branch exactly match the recorded evaluated or payload commit, and those commits resolve. It removes worktree directories without force and preserves every branch and recovery ref:

```bash
npm run benchmark:manage -- prune --run <run-id> --confirm <run-id>
```

Never remove a level directory or reset the registry in the primary repository as benchmark cleanup.

## Reconstructing an incorrectly cleaned worktree

`benchmark:restore-src` is a last-resort recovery tool for historical runs whose worktrees were destroyed. It replays only successful `Write` and `Edit` operations, uses recorded pre-edit snapshots when shell tooling created a file, and records the rollout hash in `source-recovery.json`.

```bash
npm run benchmark:restore-src -- <run-directory> --out <destination>
npm run benchmark:restore-src -- <run-directory> --worktree /tmp/raild-<run-id>
```

After reconstructing a worktree, regenerate deterministic shell-produced artifacts such as `docs/level-gallery.md`, verify the worktree mechanically, and continue with `benchmark:run -- --resume ... --accept-stage-output true`.

