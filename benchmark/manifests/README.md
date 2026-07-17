# Published run manifests

Full run records remain under ignored `benchmark/private/` while ranking is blind. After the snapshot containing a slot is locked and its mapping is opened, copy the redacted publishable record here and validate it against `benchmark/schemas/run-manifest.schema.json`. A rehearsal record may omit the release-record reference and may report cost as explicitly unavailable only when ccusage cannot measure the run; otherwise it records the ccusage-measured cost. A rehearsal is not a publishable eligible result.

A manifest records the configuration, the executing controller commit, exact model snapshots, recipe and theme hashes, stage-level token usage, the ccusage-measured cost (with its tool/version provenance and per-model detail), wall time, frozen baseline, gate results, slot id, exact evaluated commit, directory-only payload commit when produced, post-unblinding integration commit when merged, and final disposition. Preserve raw token fields so cost can be recomputed later.

Do not redact failures or omit DNF spend. Remove credentials, private dashboard links, and sensitive harness session URLs before publication.

## Website run metadata

After mappings are opened, `npm run benchmark:export-rank-catalog` projects the publishable parts of the private manifests into the checked-in `src/benchmark/rank-catalog.json`. The projection includes generation and total wall time, completion state, orchestration treatment, and per-model input, output, cache, reasoning, and cost fields. It also publishes configuration summaries and the rendered delegation guidance. It deliberately excludes run ids, session ids, branches, commits, hashes, raw prompts, transcripts, logs, and private paths.

The site keeps this material behind post-vote and expandable disclosures. Curve points identify every published level contributing to a configuration so their mean costs are auditable.
