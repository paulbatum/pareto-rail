# Rollout analysis packages

Each `<level-id>/` directory is a self-contained analysis of one benchmark run, extracted from private run artifacts by `scripts/analysis/extract-trace.mjs` to drive the website's "watch the agent build the level" view. The package format, layer model, and blindness timing rule are documented in `docs/analysis-package-format.md`.
