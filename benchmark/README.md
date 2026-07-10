# Benchmark materials

This directory holds the inputs and records for the raild level-generation benchmark. `docs/benchmark-plan.md` is the working protocol.

- `themes/` contains eligible assignment themes.
- `examples/` contains ineligible prompt exemplars that may be used for rehearsal.
- `recipes/` contains versioned, verbatim agent recipes and their template.
- `schemas/` defines full run manifests and slot-only ranking records.
- `rankings/` contains blind judgments locked before unblinding.
- `manifests/` contains redacted full run records published after unblinding.

During generation, keep the randomized schedule, slot-to-configuration key, raw logs, and complete run records under `benchmark/private/`. That directory is ignored by Git. Do not publish full manifests until rankings are locked because a full manifest necessarily reveals its configuration, model, recipe, and output branch.

The standing level-building brief remains `docs/level-brief.md` until the benchmark freeze. The freeze record should identify the source commit, the sanitized entrant baseline, and hashes for every supplied prompt artifact. Entrant checkouts must not expose benchmark control material merely because it exists in the source repository.
