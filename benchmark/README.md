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

Each run receives a four-character opaque slot and a globally unique level id such as `theme-a44f`. The agent develops normally in an opaque worktree, including temporary registry and gallery edits. After gates run, the controller derives a clean payload commit containing only `src/levels/<level-id>/`. Passing payloads remain separate through blind ranking, then merge into `main`; one post-unblinding integration commit registers all merged levels and regenerates the gallery.

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
