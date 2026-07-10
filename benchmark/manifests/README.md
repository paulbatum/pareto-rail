# Published run manifests

Full run records remain under ignored `benchmark/private/` while ranking is blind. After rankings are locked and the slot key is opened, copy redacted publishable records here and validate them against `benchmark/schemas/run-manifest.schema.json`.

A manifest records the configuration, exact model snapshots, recipe and theme hashes, stage-level token usage and list-price cost, wall time, frozen baseline, gate results, output commit, slot id, and final disposition. Preserve raw token fields so costs can be recomputed later.

Do not redact failures or omit DNF spend. Remove credentials, private dashboard links, and sensitive harness session URLs before publication.
