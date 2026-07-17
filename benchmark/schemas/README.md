# Record schemas

- `run-manifest.schema.json` documents the complete v2 run record written by `run.mjs` `createManifest`. It is a documentary contract, not a runtime validator — the controller validates manifests with hand-rolled checks in `results.mjs` and `run.mjs`. Schema version 2 records a `measured` cost with ccusage's computed USD as `cost.totalUsd`, the tool/version provenance in `cost.costSource`, per-model detail in `cost.models`, and a `reconciliation` cross-check against the harness's own counter; it also supports an explicitly `unavailable` cost and never treats unavailable as zero. Cost is measured after the run by ccusage reading the run's isolated harness home — there is no per-configuration pricing artifact.

The v1-era schemas (freeze, run-schedule, ranking, ranking-snapshot, ranked-set) belonged to the deleted freeze/schedule/ranking machinery and live at the `benchmark-v1` git tag.
