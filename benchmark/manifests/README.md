# Published run manifests

Public provenance for every published benchmark entrant: enough of each run's honesty record for a skeptical reader to check the rendered prompt, the baseline and sealed commits, the gate results, the contamination and promotion decision, and the measured cost — without the bulk transcript or anything carrying live credentials.

`npm run benchmark:export-provenance` writes this tree from the gitignored run records under `benchmark/private/runs/`, one directory per published run, driven by the entrants in `benchmark/private/publication.json`. It copies an allowlisted subset — the run manifest and definition, the rendered assignment and its inputs, the payload and evaluation records, the gate and promotion-check records, any incident note, and each stage's command, usage, and final message — and enforces a denylist so the raw rollout and event logs, model catalogs, credential sources, controller state, and the harness home and budget directories never appear here. After copying it scans every exported file for credential-shaped content and fails on a hit. The export is idempotent: re-running changes nothing, and a run dropped from the publication manifest has its directory pruned. `index.json` maps each `runId` to its level, theme, and configuration so the tree can be navigated without the private plan.

The transcripts themselves are too large for the repository and live on the [`paulbatum/pareto-rail-rollouts`](https://huggingface.co/datasets/paulbatum/pareto-rail-rollouts) Hugging Face dataset, published by `npm run benchmark:export-rollouts -- --upload`. `rollouts.json` here is that dataset's checked-in index: per run, each transcript's dataset path, uncompressed size, and sha256.

`benchmark:export-provenance` and `benchmark:export-rollouts` are documented alongside catalog export on the operations page (`benchmark/controller/README.md`).

The `benchmark-v1` git tag holds the v1-era published manifests and the machinery that produced them.
