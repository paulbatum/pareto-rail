# Published run manifests

Full run records remain under ignored `benchmark/private/` while ranking is blind. After rankings are locked and the private run schedule is opened, copy redacted publishable records here and validate them against `benchmark/schemas/run-manifest.schema.json`.

A manifest records the configuration, exact model snapshots, recipe and theme hashes, stage-level token usage and list-price-equivalent cost, wall time, frozen baseline, gate results, slot id, exact evaluated commit, directory-only payload commit when produced, post-unblinding integration commit when merged, and final disposition. Preserve raw token fields so costs can be recomputed later.

Do not redact failures or omit DNF spend. Remove credentials, private dashboard links, and sensitive harness session URLs before publication.
