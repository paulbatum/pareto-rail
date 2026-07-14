# Benchmark releases

Author the controller runbook, prompts, recipes, themes, schemas, and execution code at their stable paths. Do not add version suffixes while they are drafts. Git preserves their history; a protocol release identifies shared inputs and evaluation semantics, while each schedule registration identifies the exact configuration commit, orchestration runner, harness executor, and other execution inputs.

When freezing a release:

1. Commit the final canonical materials and record that commit as the materials commit.
2. Cut a clean entrant-baseline commit from the final materials, then record and verify it for every opaque worktree. A historical v1 baseline records `entrantBaseline.allowedLevelIds` and checks the built-in registry. A directory-only baseline records `entrantBaseline.outputRoot: "src/benchmark-levels"`, the expected built-in level ids/tree fingerprint, and must contain no promoted direct-child benchmark output other than permanent discovery infrastructure and test fixtures. The one-command check is `npm run check:benchmark-baseline -- --version v2 --ref <baseline> ...`; it rejects a baseline that already contains a promoted benchmark directory. Follow the worktree-access policy in `benchmark/controller/runbook.md`.
3. Create `benchmark/releases/<version>/freeze.json`, validated against `benchmark/schemas/freeze.schema.json`, containing the shared protocol artifacts and baseline. Include `scripts/benchmark/admin.mjs`, `common.mjs`, and `render-assignment.mjs` as `controller-admin` artifacts; a directory-only release also freezes `scripts/check-benchmark-baseline.mjs`, `scripts/check-benchmark-scope.mjs`, and `scripts/benchmark/protocol.mjs`. Eligible preflight requires these current hashes to remain frozen. The configuration roster and `run.mjs`/executor implementations are not part of this immutable release.
4. Generate ignored `benchmark/private/run-schedule.json` against `benchmark/schemas/run-schedule.schema.json` without inspecting its slot-to-configuration mapping. Record its hash in each authorized run rather than in the protocol release.
5. Commit the release record without changing the frozen canonical materials.
6. Create an annotated `benchmark-<version>` Git tag on the release-record commit.
7. Record the benchmark version and relevant artifact hashes in every run and ranking record.

For example, the first freeze creates `benchmark/releases/v1/freeze.json` and tag `benchmark-v1`. Its baseline section includes the exact permitted registry ids. For a directory-only release, calculate the built-in tree fingerprint from the recorded baseline with `git ls-tree -r -z --full-tree <baseline> -- src/levels | sha256sum` and store it as `entrantBaseline.builtInTreeSha256` alongside `expectedBuiltInLevelIds` and `outputRoot`:

```json
{
  "entrantBaseline": {
    "kind": "git-commit",
    "identifier": "<clean-baseline-commit>",
    "allowedLevelIds": ["crystal-corridor", "helios", "prism-bloom", "rezdle", "rush"]
  }
}
```

Do not create that directory before the freeze: its presence means the release exists. A later directory-only release uses the same stable authoring paths but changes the recorded source-root contract rather than probing the working tree.

A later experiment edits the same canonical paths and creates a new release. Retrieve an old release through its tag rather than maintaining duplicate trees on the current branch:

```sh
git show benchmark-v1:benchmark/prompts/level-assignment.md
git worktree add /tmp/pareto-rail-benchmark-v1 benchmark-v1
```

Schema versions are independent from benchmark versions. A compatible record-format change may increment `schemaVersion` without changing the benchmark protocol. Changing a shared prompt, theme, baseline, gate, or judgment method requires a new protocol release. Changing a recipe after that configuration has run requires a new configuration id; adding a separately pinned configuration does not.

To add a configuration, commit its runner, executor, and recipe, add it to the private schedule definition, and run `benchmark:schedule -- extend`. Extension preserves every existing assignment and execution hash and adds only the missing configuration × theme cells. Each eligible run pins that configuration commit and the resulting schedule revision hash. New execution code is allowed when it belongs only to the new configuration; changing shared task, baseline, gate, or judgment semantics still requires a protocol release.
