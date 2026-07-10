# Benchmark releases

Author benchmark prompts, recipes, themes, schemas, and runner code at their stable paths. Do not add version suffixes while they are drafts. Git preserves their history; a release record identifies the exact combination used by an eligible experiment.

When freezing a release:

1. Commit the final canonical materials and record that commit as the materials commit.
2. Create and verify the sanitized entrant baseline, which must not expose other themes, recipes, controller instructions, or private records.
3. Generate ignored `benchmark/private/run-schedule.json` against `benchmark/schemas/run-schedule.schema.json` without inspecting its slot-to-configuration mapping.
4. Create `benchmark/releases/<version>/freeze.json`, validated against `benchmark/schemas/freeze.schema.json`, including the private schedule's path and hash.
5. Commit the release record without changing the frozen canonical materials.
6. Create an annotated `benchmark-<version>` Git tag on the release-record commit.
7. Record the benchmark version and relevant artifact hashes in every run and ranking record.

For example, the first freeze creates `benchmark/releases/v1/freeze.json` and tag `benchmark-v1`. Do not create that directory before the freeze: its presence means the release exists.

A later experiment edits the same canonical paths and creates a new release. Retrieve an old release through its tag rather than maintaining duplicate trees on the current branch:

```sh
git show benchmark-v1:benchmark/prompts/level-assignment.md
git worktree add /tmp/raild-benchmark-v1 benchmark-v1
```

Schema versions are independent from benchmark versions. A compatible record-format change may increment `schemaVersion` without changing the benchmark intervention; a prompt or recipe change after eligible runs begin requires a new benchmark release even when the schemas are unchanged.
