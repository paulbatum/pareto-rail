# Benchmark releases

Version 1 is finished and its machinery is retrievable at the `benchmark-v1` git tag. The freeze record in `releases/v1/` stays checked in: published v1 run manifests under `benchmark/manifests/` reference it by hash as part of their provenance.

Version 2 runs are pinned by the private plan's `materialsCommit` and `entrantBaseline` (see `benchmark/controller/README.md`); there is no freeze record or release procedure to cut.
