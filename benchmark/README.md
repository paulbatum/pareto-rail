# Benchmark materials

This directory holds the inputs and records for the raild level-generation benchmark. `docs/benchmark-plan.md` is the working protocol.

- `prompts/` contains the shared benchmark assignment at a stable authoring path.
- `themes/` contains eligible assignment themes.
- `examples/` contains ineligible prompt exemplars that may be used for rehearsal.
- `recipes/` contains verbatim configuration recipes and their template.
- `schemas/` defines freeze, run-manifest, and slot-only ranking formats.
- `releases/` documents immutable benchmark freezes without duplicating the authored tree.
- `rankings/` contains blind judgments locked before unblinding.
- `manifests/` contains redacted full run records published after unblinding.

During generation, keep the randomized schedule, slot-to-configuration key, raw logs, and complete run records under `benchmark/private/`. That directory is ignored by Git. Do not publish full manifests until rankings are locked because a full manifest necessarily reveals its configuration, model, recipe, and output branch.

The standing level-building brief remains `docs/level-brief.md`. `benchmark/prompts/level-assignment.md` narrows it with benchmark-wide identity, duration, creativity, and finish expectations. At freeze, the release record identifies the materials commit, sanitized entrant baseline, and hashes for every supplied artifact. Entrant checkouts must not expose benchmark control material merely because it exists in the source repository.

Author at stable paths without `v1` or `v2` suffixes. A version exists only when `benchmark/releases/<version>/freeze.json` and its matching `benchmark-<version>` Git tag are created. See `benchmark/releases/README.md`.
