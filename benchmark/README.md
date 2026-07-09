# Benchmark materials

This directory holds the authored inputs and recorded data for the raild level-generation benchmark. `docs/benchmark-plan.md` explains the experiment and its decisions.

- `themes/` contains the three shared assignment themes.
- `recipes/` contains the versioned, verbatim agent recipes.
- `manifests/` contains one published run manifest per config and theme.
- `rankings/` contains locked blind-ranking records.

The canonical level-building brief remains `docs/level-brief.md` until the benchmark freeze. At that freeze, archive the exact prompt material used by the runner here and record its commit and hashes in each manifest.

Do not store the anonymous slot-to-config key in this directory. Keep it in `benchmark/private/`, which is ignored by Git, until rankings are locked.
