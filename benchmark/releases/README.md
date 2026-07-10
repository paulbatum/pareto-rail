# Benchmark releases

Author the controller runbook, prompts, recipes, themes, schemas, and execution code at their stable paths. Do not add version suffixes while they are drafts. Git preserves their history; a protocol release identifies shared inputs and evaluation semantics, while each schedule registration identifies the exact configuration commit, orchestration runner, harness executor, and other execution inputs.

When freezing a release:

1. Commit the final canonical materials and record that commit as the materials commit.
2. Record and verify the frozen entrant-baseline commit used to create every opaque worktree. Follow the worktree-access policy in `benchmark/controller/runbook.md`.
3. Create `benchmark/releases/<version>/freeze.json`, validated against `benchmark/schemas/freeze.schema.json`, containing the shared protocol artifacts and baseline. Include `scripts/benchmark/admin.mjs`, `common.mjs`, and `render-assignment.mjs` as `controller-admin` artifacts; eligible preflight requires their current hashes to remain frozen. The configuration roster and `run.mjs`/executor implementations are not part of this immutable release.
4. Generate ignored `benchmark/private/run-schedule.json` against `benchmark/schemas/run-schedule.schema.json` without inspecting its slot-to-configuration mapping. Record its hash in each authorized run rather than in the protocol release.
5. Commit the release record without changing the frozen canonical materials.
6. Create an annotated `benchmark-<version>` Git tag on the release-record commit.
7. Record the benchmark version and relevant artifact hashes in every run and ranking record.

For example, the first freeze creates `benchmark/releases/v1/freeze.json` and tag `benchmark-v1`. Do not create that directory before the freeze: its presence means the release exists.

A later experiment edits the same canonical paths and creates a new release. Retrieve an old release through its tag rather than maintaining duplicate trees on the current branch:

```sh
git show benchmark-v1:benchmark/prompts/level-assignment.md
git worktree add /tmp/raild-benchmark-v1 benchmark-v1
```

Schema versions are independent from benchmark versions. A compatible record-format change may increment `schemaVersion` without changing the benchmark protocol. Changing a shared prompt, theme, baseline, gate, or judgment method requires a new protocol release. Changing a recipe after that configuration has run requires a new configuration id; adding a separately pinned configuration does not.

To add a configuration, commit its runner, executor, recipe, and pricing material, add it to the private schedule definition, and run `benchmark:schedule -- extend`. Extension preserves every existing assignment and execution hash and adds only the missing configuration × theme cells. Each eligible run pins that configuration commit and the resulting schedule revision hash. New execution code is allowed when it belongs only to the new configuration; changing shared task, baseline, gate, or judgment semantics still requires a protocol release.
