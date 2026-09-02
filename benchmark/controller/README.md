# Benchmark controller operations

This page is the runbook for preparing, running, recovering, judging, promoting, and publishing benchmark runs. For the benchmark method and result semantics, see [`benchmark/README.md`](../README.md). For controller architecture and code ownership, see [`development.md`](development.md).

## Inspect current work

Start every benchmark session with:

```sh
npm run benchmark:status
```

The command joins every private plan and schedule with live and archived run records. It groups rows into pending, playable but not promoted, and completed work. Output is blind by default, so it is safe to repeat to the owner.

Use the other views when the status summary is not enough:

```sh
npm run benchmark:results
npm run benchmark:manage -- status
```

- `benchmark:results` reports per-run gates, timing, cost, disposition, and manifest completeness from live run records.
- `benchmark:manage -- status` emphasizes lifecycle, recovery, and promotion state.
- Add `--unblind` only when the recipient may see configuration and model identities under the [fairness and blindness rules](../README.md#fairness-and-blindness).

## Prepare a plan

Plans are hand-edited JSON files under `benchmark/private/`. They are private because they map opaque level ids to configurations.

```json
{
  "benchmarkVersion": "v3",
  "baselinePolicy": "scrubbed",
  "materialsCommit": "<commit>",
  "entrantBaseline": "<commit>",
  "runs": [
    {
      "runId": "<opaque-id>",
      "slotId": "<opaque-slot>",
      "levelId": "<theme-id>-<opaque-slot>",
      "themeId": "<theme-id>",
      "themePath": "benchmark/themes/<theme-id>.md",
      "configurationId": "<configuration-id>",
      "recipePath": "benchmark/recipes/<harness>-cli.md",
      "kind": "benchmark",
      "entrantBaseline": "<optional row override>",
      "stage": {
        "adapter": "codex-cli",
        "model": "<exact-model>",
        "effort": "high",
        "timeoutSeconds": 10800,
        "provider": "<provider when required>",
        "budget": { "usd": 20 }
      },
      "delegation": {
        "promptPath": "benchmark/prompts/flexible-delegation.md",
        "delegateModel": "<model>",
        "delegateEffort": "high"
      }
    }
  ]
}
```

### Plan-level fields

| Field | Requirement |
| --- | --- |
| `benchmarkVersion` | Use the benchmark era assigned to the series. |
| `baselinePolicy` | Use `scrubbed` for a new series. Use `open` only to preserve the historical conditions of an existing v1 or v2 theme. |
| `materialsCommit` | Commit containing the assignment template, themes, and recipe documents used by every row in the file. |
| `entrantBaseline` | Default commit checked out for entrants. A row may override it. |

### Run-level fields

- `levelId` must equal `<themeId>-<slotId>`.
- The theme file's first level-one heading supplies the level title.
- `stage.adapter` is `codex-cli`, `claude-cli`, `pi-cli`, `prime-agent-cli`, or `agy-cli`.
- `provider`, `budget`, adapter-specific sandbox or network settings, and Prime Agent autonomous settings are optional configuration mechanisms. Their recipe documents define when to use them.
- `delegation` appends the recorded delegation prompt and selects the delegate model and effort.
- `kind` defaults to `benchmark`. Use `rehearsal` for a run that must never enter promotion, the results pool, or the catalog.

The plan writer knows the private mapping. Opaque slot ids do not hide that mapping from the writer, and a repeated row order can reveal it. Do not report configuration identities to the owner before they have voted on the theme.

### Baseline policy

Before launch, the controller inspects the declared baseline commit.

- Under `scrubbed`, any promoted benchmark source, benchmark records, non-built-in public content, or generated catalog content aborts the run. Cut a clean baseline before launching.
- Under `open`, the same findings are recorded in `manifest.baseline.guard` and printed as disclosures. They do not block the historical row.

Legacy v1 and v2 themes retain the entrant-visible trees used by their existing entrants. Changing those trees would break the within-theme comparison, so do not replace their expected findings with a scrubbed baseline.

- Future v1 rows use `benchmark/baseline/v1-directory-floor`. It changes only `scripts/check-floor-cli.ts`, removing the requirement to regenerate the shared `docs/level-gallery.md` file excluded by the directory-only output contract.
- Future v2 rows use `benchmark/baseline/v2-floor-output`. It changes only floor-check diagnostics while preserving the thresholds and level APIs.

Existing run records keep their recorded baselines.

## Cut a scrubbed baseline

For a new series, cut the entrant baseline from the source commit containing that series' shared application and built-in levels:

```sh
npm run benchmark:cut-baseline -- --source <commit-ish> --branch <branch-name>
```

The command uses a temporary worktree, removes benchmark entrants and records, removes non-built-in public content, regenerates the built-in gallery, empties the benchmark rank catalog, commits the result, and runs typecheck and build in the scrubbed checkout. Record the printed commit in the plan.

Do not use this command for maintenance rows on legacy v1 or v2 themes. Use the recorded maintenance baseline for that era.

## Add a newer configuration to an older theme

An older materials commit may not contain the new configuration's recipe document. Do not point the row at another configuration's recipe, and do not advance the whole plan to newer materials that change the assignment.

Derive a materials commit instead:

1. Read `benchmark/private/runs/<sibling-run-id>/rendered-assignment.json` for an existing entrant on the same theme. Record `template.sha256` and `theme.sha256`.
2. Branch from the materials commit used by that sibling. Add only the new recipe document and commit it.
3. Confirm `git diff --name-only <old-materials> <new-materials>` names only that recipe document.
4. Put the new rows in a separate plan using the derived commit as `materialsCommit`. Keep the sibling's `benchmarkVersion`, `baselinePolicy`, and entrant baseline.
5. Hash the template and theme at the derived commit and compare both hashes with step 1. They must match before launch.

Compare against a sibling on the same theme. Themes from one benchmark era can use different materials commits.

## Prepare the sandbox host

Scrubbed Codex, Claude, and pi rows run with an entrant boundary: the entrant checkout is the only writable tree, the primary repository and sibling checkouts are unreadable, and external network egress is blocked while loopback remains available to the checks.

Claude and pi require these host tools:

```sh
sudo apt-get install bubblewrap socat
npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/pareto-rail/chrome-headless-shell
```

The controller checks `bwrap` and `socat` before launch. The adapters print the browser installation command when `chrome-headless-shell` is absent.

The current Ubuntu 22.04 WSL2 host permits the required unprivileged user namespaces. On Ubuntu 24.04 or later, an AppArmor restriction can produce `bwrap: loopback: Failed RTM_NEWADDR`. Install an AppArmor profile granting `bwrap` the `userns` permission; do not disable the restriction globally.

`agy-cli` and `prime-agent-cli` cannot provide the entrant sandbox. The controller warns before launch and records `sandboxUnavailable: true`. These rows still require the contamination audit before promotion. An open-policy row is also unisolated by policy. Never describe either case as sandboxed.

## Launch a run

The controller repository must be clean before a new run starts.

```sh
npm run benchmark:run -- --plan benchmark/private/<plan>.json --run <run-id>
```

The command executes one plan row:

1. capture and render inputs;
2. create the entrant checkout and isolated harness home;
3. run the harness stage;
4. seal the entrant output;
5. run typecheck, build, scope, and floor gates;
6. derive a mergeable payload when all gates pass; and
7. measure usage and write the run manifest.

Artifacts and checkpoints are written under `benchmark/private/runs/<run-id>/`. A successful command ends with a complete manifest and playable payload. A failed command leaves the completed checkpoints and recovery evidence in place.

Rows are independent. A failure or pending owner decision on one row does not block other planned rows.

## Monitor a live run

Use `npm run benchmark:status` or `npm run benchmark:manage -- status` for controller state. Do not start a second controller or resume process against a run that still has a live process; concurrent processes can corrupt its worktree or session.

For a pi stage, `events.jsonl` can remain unwritten for roughly half an hour because the harness flushes it lazily. Inspect the native session under the run's `harness-home/sessions/` instead. A growing session is live. A session that stops growing without a new `quota-wait/quota-waits.jsonl` entry indicates a stall.

When the `kimi-coding` subscription reaches its quota, the controller-owned extension normally waits in process. If the process dies during the wait, preserve the existing session and use same-session recovery after confirming no controller or adapter process remains active.

## Resume or recover a run

### Continue from the next checkpoint

```sh
npm run benchmark:run -- --resume benchmark/private/runs/<run-id>
```

The controller validates completed artifacts and resumes at the first unfinished checkpoint. It restores a missing temporary worktree from the retained recovery ref when one exists.

### Accept a completed worktree after a nonzero stage exit

Use this only after inspecting the worktree and confirming that the entrant completed the assignment before the harness exited:

```sh
npm run benchmark:run -- \
  --resume benchmark/private/runs/<run-id> \
  --accept-stage-output true
```

This skips further model work and proceeds to sealing and gates. Do not use it to turn partial output into a completed stage.

### Continue the same harness session

Claude, pi, and Prime Agent can re-enter their recorded session after an interruption:

```sh
npm run benchmark:run -- \
  --resume benchmark/private/runs/<run-id> \
  --continue-stage true
```

Use same-session continuation when the worktree contains useful entrant work and the previous process ended because of an expired credential, stream stall, quota interruption, reboot, or similar infrastructure failure. It preserves the entrant's context and worktree. A fresh relaunch would discard the session context.

A stage killed while it ran records no stage launch, because the controller writes that record only after the harness process returns. Continuation still works: the Claude adapter reads the session identity from the transcript the run-local harness home holds, selecting the one that opens with this stage's assignment. It stops when the home holds no such transcript or holds several. The pi and Prime Agent adapters need the recorded result, so a stage of theirs that died before writing one has no session to continue.

The killed round leaves no usage or event artifacts in its stage directory. Cost still comes from the harness home, which holds the whole session, and the continuation round supplies the command and event records the manifest needs.

The controller refuses this option for budgeted stages, whose budget protocol owns continuation, and for harnesses without session re-entry. It performs one continuation request; it does not keep restarting the process automatically.

For repeated Claude authentication failures, run `claude` interactively on the owner's account to refresh the stored credential before continuing. Resume recopies that credential into the isolated run home.

## Investigate and adjudicate a failed run

A failed gate records an `unadjudicated` disposition. The controller does not decide whether the entrant failed or the infrastructure denied it a fair attempt.

Collect these facts in `benchmark/private/runs/<run-id>/incident.json` and report them to the owner:

- stage exit and final message;
- source left in the entrant worktree;
- failed gate and its output;
- whether the harness stopped itself or infrastructure terminated it; and
- recovery attempts already made.

The owner chooses one verdict:

```sh
npm run benchmark:manage -- adjudicate \
  --run <run-id> \
  --as dnf|infrastructure \
  --reason "<reason>"
```

- `dnf`: the entrant failed. Preserve and report the result as a DNF.
- `infrastructure`: the run did not provide a fair attempt. Rerun the planned work and preserve the cost and evidence of every attempt.

The command writes `adjudication.json` beside the run without changing the manifest. A run can be adjudicated once.

## Regate sealed output

Use regating only when gate tooling changed and rerunning the same deterministic check is valid. Rename the run's `gates/` directory inside its record, then resume the run:

```sh
npm run benchmark:run -- --resume benchmark/private/runs/<run-id>
```

The scope gate runs from the current controller checkout, so a controller-side scope fix can affect an existing sealed run. Typecheck, build, and floor run inside the entrant checkout, so they use the scripts pinned by its baseline. A controller change cannot replace those scripts for an existing run.

When the baseline's floor check caused the failure, do not regate the old run against a different check. Record and adjudicate the infrastructure failure, then use the corrected baseline for future runs.

## Audit and promote a playable run

Run the contamination audit before promotion:

```sh
npm run benchmark:contamination -- --run <run-id> --json
```

Review every finding. For each `web` event, compare the activity with the entrant output and decide whether external level material could have been reused. A `web-self-lookup` or another violation blocks promotion until the review resolves it. Record the verdict in the promotion decision.

Promote an accepted run:

```sh
npm run benchmark:promote -- --run <run-id>
```

Promotion validates the recorded run and payload, materializes the entrant under `src/benchmark-levels/<level-id>/`, converts entrant PNG content to AVIF when needed, runs the four checks, and commits the promoted output. Progress is checkpointed in `promotion.json`; rerun the same command after an interruption.

Promotion does not create the public showcase images. Run the `level-content-images` workflow for each promoted level before catalog export. The export rejects a descriptor without `contentImages.hero`.

## Publish entrants and evidence

Publishing uses `benchmark/private/publication.json` as the hand-edited list of public themes and entrants.

### Update publication metadata

Before export:

- add the promoted run to the publication manifest;
- list every accepted entrant baseline for its theme;
- add a new configuration to both `configurationLabels` and `PUBLISHED_CONFIGURATIONS` in `scripts/benchmark/export-rank-catalog.mjs`; and
- confirm each published descriptor has its public content images.

A configuration label defines public identity. `PUBLISHED_CONFIGURATIONS` controls publication scope. A budgeted variant has its own configuration id and should name the budget in `workflowName`.

Publication flags have these effects:

| Flag | Effect |
| --- | --- |
| Theme or entrant `retired` | Remains visible as history and keeps past votes, but receives no new matchup. |
| Theme `experimental` | Appears for direct play but does not enter matchup scheduling. |

### Export the site catalog

```sh
npm run benchmark:export-rank-catalog
npm run test:benchmark-domain
npm run test:benchmark-catalog
npm run typecheck
npm run build
```

The export rejects a live entrant whose baseline is not accepted by its theme and withholds a configuration missing either publication gate. It also reports mismatches with `src/app/featured-models.md` without changing that file. Report a mismatch to the owner and ask whether the public model list should change.

### Export public provenance

```sh
npm run benchmark:export-provenance
```

The command writes the allowlisted public record under `benchmark/manifests/`, removes stale exported runs, and fails when a copied file matches a credential pattern. Run it after promotion. See [`../manifests/README.md`](../manifests/README.md) for the public artifact contract.

### Export and upload transcripts

```sh
npm run benchmark:export-rollouts -- --upload
```

The command stages compressed transcripts under `tmp/rollouts-export/`, scans them for credentials with the built-in checks and betterleaks or gitleaks, uploads them to the Hugging Face dataset, and updates `benchmark/manifests/rollouts.json`. Install one supported leak scanner on `PATH` or under `~/.local/bin`, and authenticate `hf` with write access before upload. Omit `--upload` to stage and scan without publishing.

The two scans dominate the export's running time, so the command records a clean verdict for each scanned file in `benchmark/private/rollout-scan-cache.json`. Each verdict is keyed on the sha256 of the scanned bytes together with a fingerprint of the scan rules: the scanner name, the scanner version, `scripts/benchmark/betterleaks.toml`, the `SECRET_PATTERNS` regexes, and the `scanLines` and `leakScan` functions in `scripts/benchmark/export-rollouts.mjs`. A file is skipped only when its bytes and the current fingerprint both match a stored verdict, so a change to any rule input discards the whole cache and every file is scanned again. A missing or unreadable cache file also scans everything. Only clean verdicts are stored: a file that produced a hit, or that a scanner failed on, is never cached. The command prints how many files it scanned and how many cached verdicts it reused.

Pass `--rescan` to ignore the stored verdicts and scan every file again. Use it to confirm a clean export independently of the cache.

The cache is gitignored, holds only hashes, and is never part of the staged upload.

The publication manifest can also list rehearsal transcripts and explicitly selected diagnostic sessions. These affect only the rollout export; they do not publish an entrant or provenance record.

Commit the catalog, public provenance, rollout index, promoted content images, and any public copy changes together.

### Keep transcript uploads incremental

The dataset tracks `*.gz` in Git LFS by a wildcard rule, and Hugging Face adds a per-path LFS rule whenever a file crosses 10 MB. A `rollout.jsonl` under that size stays a regular git file, so every upload resends it in full. Adding a wildcard rule for `*.jsonl` to the dataset's `.gitattributes` puts every transcript in LFS, after which an upload transfers only the files whose bytes changed.

Make that edit once, on the dataset itself; the export does not stage `.gitattributes`.

```sh
hf download paulbatum/pareto-rail-rollouts .gitattributes --repo-type dataset --local-dir tmp/hf-attrs
echo '*.jsonl filter=lfs diff=lfs merge=lfs -text' >> tmp/hf-attrs/.gitattributes
hf upload paulbatum/pareto-rail-rollouts tmp/hf-attrs/.gitattributes .gitattributes --repo-type dataset
```

Keep the per-path rules already in the file. The first upload after this change rewrites the existing `.jsonl` files as LFS pointers, so it transfers all of them once; later uploads send only new transcripts.

## Preserve pinned commits

Published entrants depend on commits outside mainline: evaluated output, payload, materials, and entrant baseline. Preserve them under lightweight `benchmark/` tags.

| Commit | Tag |
| --- | --- |
| Evaluated branch `benchmark-run-<run-id>` | `benchmark/run/<run-id>/evaluated` |
| Payload branch `benchmark-payload-<run-id>` | `benchmark/run/<run-id>/payload` |
| Materials ref `refs/benchmark-materials/<name>` | `benchmark/materials/<name>` |
| Entrant baseline | `benchmark/baseline/<name>` |

Create the materials ref and tag when the materials commit is outside mainline:

```sh
git update-ref refs/benchmark-materials/<name> <commit>
git tag benchmark/materials/<name> <commit>
```

Tag each run and push the benchmark tag namespace:

```sh
git tag benchmark/run/<run-id>/evaluated benchmark-run-<run-id>
git tag benchmark/run/<run-id>/payload benchmark-payload-<run-id>
git push origin 'refs/tags/benchmark/*:refs/tags/benchmark/*'
```

Keep the recorded run and payload branch names. Promotion resolves those branches and requires them to point at the commits recorded by the run. A clone containing the tags but not the branches can restore them before promotion:

```sh
git branch benchmark-run-<run-id> benchmark/run/<run-id>/evaluated
git branch benchmark-payload-<run-id> benchmark/run/<run-id>/payload
```

## Archive, prune, or delete records

Use the least destructive operation that meets the need:

| Need | Command | Preserved evidence |
| --- | --- | --- |
| Move failed or incomplete runs out of the live directory | `npm run benchmark:manage -- archive-dnf [--dry-run true]` | Worktrees, branches, commits, and records |
| Restore one archived run | `npm run benchmark:manage -- unarchive --run <run-id-or-directory>` | Entire archived record |
| Reclaim temporary worktree storage | `npm run benchmark:manage -- prune --run <id> --confirm <id>` | Branches, commits, and records |
| Remove a valueless aborted run | `npm run benchmark:manage -- delete --run <id> --confirm <id> [--dry-run true]` | Nothing |

`delete` refuses promoted, published, or provenance-exported runs and runs outside its allowed failed states. It never edits a plan. Remove or replace the plan row separately.
