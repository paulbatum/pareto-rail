# Benchmark controller runbook

This runbook is for an agent that orchestrates other agents and harnesses. It is deliberately vendor-neutral. Follow the frozen release, private run schedule, selected recipe, and schemas exactly; do not improve the experiment while executing it.

## Role

The controller is benchmark administration, not an extra level designer. It prepares isolated workspaces, renders frozen prompts, launches declared stages, preserves artifacts and usage, runs mechanical gates, derives mergeable payloads, and protects blinding.

Do not interpret the theme, suggest creative decisions, summarize one stage's artifact for another, review source, repair an entrant, or add an undeclared continuation. Pass artifacts between declared stages byte-for-byte. If the recipe assigns the controller itself a planning, implementation, review, or revision role, that work is a measured stage and follows the recipe's prompt and accounting.

Any model usage required to orchestrate a run must be declared by the recipe and captured when the harness exposes it. Record separately measurable usage as an `orchestrate` stage unless it is already included in another measured stage; never double-count a shared session. Whether orchestration usage contributes to the primary cost metric must be fixed before the release.

## Invocation boundaries

Use a fresh controller context for each rehearsal or eligible run. It may coordinate every stage inside that one recipe, including declared continuations, but it must not retain context from another entrant.

A dispatcher may iterate through the private schedule by launching isolated controller contexts. The dispatcher may provide one assignment and its selected recipe to each context. It must not read entrant source or logs, summarize prior outcomes, alter later prompts, or pass conversational history between controllers.

Run preparation, eligible generation, blind ranking, and post-unblinding integration are separate modes. Never cross into a later mode early.

## Non-negotiable invariants

- Every eligible run starts from the frozen entrant-baseline commit identified by the release record.
- The controller receives exactly one private assignment containing an opaque run id, slot, configuration, recipe, theme, level id, and title.
- The level id is `<theme-id>-<slot-id>` and the four-character slot encodes no model, configuration, theme, or schedule position.
- The controller supplies only the rendered assignment, declared repository material, recipe-authorized earlier-stage artifacts, and the entrant's own working tree. It does not direct an entrant to inspect another theme, recipe, entrant, ranking, schedule, slot mapping, or benchmark result.
- Entrants use worktrees of the main repository under a non-adversarial access policy. Repository history and unrelated tracked files are not technically hidden; this accepted limitation must not be represented as technical isolation.
- Prompts, stage order, model snapshots, session boundaries, time limits, tool access, and review/revision count come from the configuration's registered recipe. The controller does not improvise them.
- No operator follows logs, reads diffs, plays partial output, supplies feedback, or requests a retry.
- Gates run against the exact evaluated working tree. Blind play serves that same evaluated commit.
- A payload is derived only after evaluation and contains only the assigned directory under the source root selected by the recorded benchmark version: `src/levels/<level-id>/` for v1 or `src/benchmark-levels/<level-id>/` for the directory-only protocol.
- Nothing is merged into `main` before rankings are locked and the schedule is opened.
- Secrets, credentials, and private session URLs never enter commits, public logs, or player-facing deployments. Before unblinding, configuration mappings do not enter them either.

## Source-root protocol dispatch

The recorded `benchmarkVersion` selects the source-root contract. Historical v1 (and rehearsal) uses `src/levels/<level-id>/` and its legacy registry-aware scope and payload rules. The directory-only protocol uses `src/benchmark-levels/<level-id>/`; its entrant starts with benchmark-mode scaffolding, includes `level.json`, does not edit `src/levels/index.ts`, and is checked with `scripts/check-benchmark-scope.mjs --version <version>`. Payload extraction uses the same selected root. Never choose a root by probing which directory exists.

For directory-only releases, run `npm run check:benchmark-baseline` against the recorded entrant baseline before launching a model. It verifies the expected built-in tree and rejects promoted benchmark output from the baseline. The descriptor is authored input, but the application catalog must validate its id and title against the loaded definition before the output is considered discoverable.

## Required inputs

Do not start an eligible run until all of these exist and agree:

- a frozen release record validated against `benchmark/schemas/freeze.schema.json`;
- the materials commit and entrant-baseline commit named by that record, plus its v1 registry allowlist or directory-only baseline contract;
- a private append-only schedule revision containing the assignment, with its hash pinned by the run definition;
- exactly one assignment selected from that schedule without exposing the other assignments;
- the assignment's recipe and theme with matching paths and hashes, plus the immutable configuration commit containing its runner, executor, and recipe;
- the frozen shared assignment template and controller runbook;
- deterministic adapters or documented harness procedures for launching every recipe stage and capturing usage;
- a predeclared failure taxonomy; and
- private storage outside the entrant checkout.

Use this private layout unless the registered configuration runner declares an equivalent one:

```text
benchmark/private/
  run-schedule.json
  runs/<run-id>/
    assignment.json
    rendered-assignment.md
    stages/<stage-id>/
      prompt.txt
      input/
      output/
      raw-usage.json
      log.txt
    gates/<gate-id>.log
    manifest.json
```

Private paths are controller storage. Do not expose or mount the parent `benchmark/private/` tree into an entrant session.

## Release preparation mode

Follow `benchmark/releases/README.md` in order:

1. Commit final canonical materials and record the materials commit.
2. Cut, record, and verify the frozen entrant-baseline commit used for all opaque worktrees. For v1, record every permitted registry id in `entrantBaseline.allowedLevelIds`; for the directory-only protocol, record the output root and expected built-in baseline fingerprint, then run the baseline check to reject promoted output. See `benchmark/releases/README.md` for the clean-baseline procedure.
3. Create and validate the protocol freeze record, commit it, and create the annotated release tag.
4. Generate the initial private randomized schedule against `benchmark/schemas/run-schedule.schema.json`.
5. Mechanically verify complete registered-configuration × theme coverage, contiguous schedule positions, unique run/slot/level ids, fixed-length opaque slots, and exact `<theme-id>-<slot-id>` construction. Hash the schedule without printing its contents.
6. For a later configuration, pin its runner, executor, and recipe at a configuration commit and extend the schedule. Preserve every earlier assignment and add only missing cells. New configuration code may implement delegation or different accounting, but it may not silently change shared task, baseline, gate, or judgment semantics.
7. Re-open a fresh entrant worktree and verify that it is at the declared baseline commit. Verify that private schedule data, raw records, credentials, and session URLs are absent; do not claim that tracked repository material or Git history is hidden.

Do not hand-author or inspect the live slot mapping. If schedule generation or validation is not yet automated, the release is not ready to freeze.

## Rehearsal mode

Use an ineligible exemplar, model/workflow, run id, and slot declared ineligible before launch. Exercise the same checkout, rendering, stage execution, usage capture, evaluated commit, gates, payload derivation, playable deployment, ranking record, and cost reconciliation intended for eligible runs.

Rehearsal may be repeated to repair controller tooling. Never use an eligible theme or silently promote a rehearsal output into the experiment.

## Eligible run mode

### 1. Select one assignment

A dispatcher selects the next assignment by `scheduleIndex` and starts a fresh controller context with only that assignment. Do not display configuration identity or the schedule row in a user-visible transcript. Verify the assignment against the registered recipe hash, frozen theme hash, schedule revision, and level-id convention.

Create `benchmark/private/runs/<run-id>/assignment.json` and initialize a private manifest. The private record may contain configuration identity; no public artifact may expose it before unblinding.

### 2. Prepare the entrant checkout

Materialize a fresh worktree from the frozen entrant-baseline commit using an opaque branch or workspace name based on `runId`, never configuration or model. Verify repository cleanliness and the baseline identifier before launch.

Keep controller records outside this worktree. Do not copy the private schedule, release-control records, or another stage's undeclared artifacts into it. The worktree shares tracked repository material and Git history with the main repository; do not describe it as a sanitized or technically isolated checkout.

### 3. Render the shared assignment

Load `benchmark/prompts/level-assignment.md` from the frozen materials commit and replace exactly:

- `{{LEVEL_ID}}` with the assignment's `levelId`;
- `{{LEVEL_TITLE}}` with its `levelTitle`; and
- `{{THEME}}` with the complete frozen theme Markdown.

Reject missing, duplicate, or unknown placeholders. Make no other textual changes. Save the rendered text privately, hash both template and rendering, and use the identical rendering for every recipe stage that declares the shared assignment as input.

### 4. Execute the recipe

For each stage in recipe order:

1. Select the exact model snapshot, harness version, permissions, working-tree access, and fresh/continued session behavior declared by the recipe.
2. Construct the exact stage prompt from frozen text and declared artifacts. Do not add advice, status commentary, or summaries.
3. Start timing immediately before launch and stop after the harness returns.
4. Capture the session identifier, raw prompt, declared inputs, raw output artifact, logs, result, all usage fields available from the harness, and, when available, a best-effort copy of the harness's native session record.
5. Hash prompt, input, output, and logs without printing their content into the controller transcript.
6. If the next stage consumes this output, pass the captured artifact unchanged.
7. Apply only the recipe's predeclared completion and failure behavior.

Do not retry a model error, extend a timeout, add a fix-it prompt, or ask the operator what to do. A continuation is allowed only when it is already a recipe stage. Classify infrastructure failures using the frozen failure taxonomy; when the taxonomy does not cover a failure, stop rather than inventing a favorable classification.

Controller operations are checkpoints. Persist each completed operation atomically and validate it before skipping it on resume. On failure, snapshot the complete tracked and untracked worktree through a temporary Git index to a durable run-specific recovery ref without changing the entrant index or branch. Preserve the worktree, branch, stage artifacts, snapshot record, and every completed checkpoint. If temporary storage disappears, reconstruct the same tree from the recovery ref before resuming. A harness timeout does not by itself prove the entrant work is incomplete: when an operator classifies the worktree as completed, record that recovery decision and continue with the unchanged sealing and gate procedure. Recovery provenance is orthogonal to disposition; passing normal gates and payload validation still yields a playable run.

The coding agent follows the repository's normal workflow. It may scaffold, register the level, regenerate the gallery, inspect the game, and commit as directed by repository instructions. Do not tell it to create benchmark manifests, payloads, deployments, or anonymization records.

### 5. Seal the evaluated commit

After the final declared stage returns:

1. End all model sessions for the run.
2. Mechanically verify that changed and untracked paths satisfy the level scope relative to the entrant baseline; do not inspect file contents.
3. If permitted changes remain uncommitted, commit them without editing or formatting their content.
4. Require a clean tracked working tree and record the resulting commit as `output.evaluated.commit`.
5. Record its opaque branch or ref privately.

This commit is the entrant. No model or operator may alter it after sealing.

### 6. Run mechanical gates

Run every gate independently against the sealed evaluated commit and capture command, exit code, duration, and complete redirected output:

```sh
npm run typecheck
npm run build
npm run check:scope -- <level-id> <entrant-baseline-ref>
npm run check:floor -- --level <level-id>
```

Use the local Git ref corresponding to the entrant baseline for the scope command. Do not rely on a moving `main` default. Hash gate logs and keep them private. Verify that gates did not change tracked files; a changed evaluated tree is a controller failure, not an opportunity to amend the commit.

Any failed required gate makes the entrant a DNF unless the frozen failure taxonomy identifies a controller failure. Record all gate outcomes even when an earlier gate fails, except where a failed prerequisite makes a later command impossible; record that later gate as not run with the reason.

### 7. Derive the payload

Only passing entrants enter the merge set. Create an opaque payload branch from the frozen **materials commit**, not from the entrant-baseline commit:

1. Verify the assigned directory under the version-selected source root does not exist at the materials commit.
2. Copy exactly that directory from the evaluated commit.
3. Commit it without editing its contents.
4. Compare payload tip to the materials commit.
5. Require a non-empty diff in which every path begins the version-selected assigned directory and no path is deleted or renamed from outside that directory. Directory-only payloads must retain their authored `level.json`; v1 payloads must not contain one.
6. Record the payload commit and private branch under `output.payload`.

Payload derivation is deterministic administration, not a model revision. Do not rerun creative stages. The exact evaluated commit remains the source for blind play because it contains the evaluated application state exercised by the gates; directory-only evaluated trees are discovered without a temporary registry edit.

For a DNF, preserve the evaluated commit and do not create a mergeable passing payload. A diagnostic extraction, if ever needed, must not be confused with the passing merge set. Archiving a DNF moves only its private controller record; it must not remove its worktree, branch, commit, or source. Destructive pruning is a separate confirmed operation and is forbidden until an evaluated commit is durable.

### 8. Finalize the private manifest

Validate the full record against `benchmark/schemas/run-manifest.schema.json` and enforce cross-field rules not expressible in JSON Schema:

- assignment, runner, executor, recipe, theme, release, and schedule identities agree;
- stage order and count match the recipe;
- usage and stage costs reconcile to totals under the registered configuration cost rule;
- all four gate ids are accounted for;
- playable disposition implies every required gate passed and a valid payload exists;
- DNF disposition implies no blind deployment or passing payload; and
- evaluated and payload commits match their recorded refs.

Store the complete manifest privately. Before unblinding, report only opaque completion state needed to operate the benchmark; do not reveal model, configuration, branch names, costs, logs, source observations, or cross-run comparisons.

## Blind ranking preparation mode

When the playable pool is ready for a ranking snapshot:

1. Read only slot, theme, and playable/DNF disposition from private records through a mechanical projection that omits configuration and model identity.
2. Generate one ranked set per theme and randomize set and presentation order without exposing the schedule mapping. For a large pool, overlapping subsets or targeted pairs are allowed when the declared analysis can connect them.
3. Serve each slot from its exact evaluated commit using an opaque deployment or local launcher.
4. Hide source, branch, logs, model identity, configuration identity, and private URLs from the ranker.
5. Record best-to-worst tiers against `benchmark/schemas/ranked-set.schema.json`. Binary judgments may use `ranking.schema.json` when explicitly scheduled.
6. Do not merge payloads into `main` or open the private schedule.

The human ranker may replay any slot and may tie slots by placing them in the same tier. The controller records the decision; it does not judge quality or expand one ranked set into supposedly independent observations.

## Lock and unblind mode

Before opening the private schedule:

1. Validate every ranking record against its set or pair schedule.
2. Verify coverage of the declared snapshot and report DNFs separately as reliability outcomes.
3. Commit or checksum the complete ranking snapshot and record its lock timestamp against `benchmark/schemas/ranking-snapshot.schema.json`.

Only then open the relevant slot mapping and join slots to configurations. Compute the declared normalized-rank and reliability summaries before exploratory analysis. Preserve ranking records unchanged; configuration identity belongs in derived analysis and published manifests. Later configurations create a later snapshot rather than reopening this one.

## Integration mode

After unblinding:

1. Tag every exact evaluated commit with benchmark version and slot.
2. Create an integration branch from current `main`, never from the frozen entrant baseline.
3. Merge each passing payload. Stop on any unexpected path conflict rather than resolving source creatively.
4. For v1, update `src/levels/index.ts` once to register all merged entrants, using the frozen publication-label decision. Directory-only payloads require no registry edit.
5. Run `npm run gallery` once.
6. Run `npm run typecheck`, `npm run build`, and `npm run check:floor -- --level <level-id>` for every integrated entrant.
7. Commit the gallery integration (and the v1 registry integration when applicable) and record that commit id.
8. Write redacted published manifests referencing that integration commit and commit them separately.
9. Merge the integration branch to `main`.
10. Delete temporary evaluated and payload branches only after evaluated commits are tagged and payload commits are merged.

Publish redacted manifests after removing credentials, private dashboard links, sensitive session URLs, and raw logs. Do not omit DNF spend or rewrite blind ranking records.

A DNF does not enter playable `main` as-is. Any later repair is a post-benchmark derivative and must be labeled and verified separately.

## Stop conditions

Stop without improvising when:

- release, schedule, runner, executor, recipe, theme, or prompt hashes disagree;
- the entrant checkout is not the frozen baseline;
- private schedule data, raw records, credentials, or session URLs are visible inside the entrant session;
- a requested model snapshot or session boundary cannot be honored;
- the harness cannot provide the usage evidence required by the registered cost rule;
- the controller observes cross-run contamination;
- scope contains undeclared files;
- payload diff contains anything outside the assigned level directory;
- rankings are incomplete or unlocked at an unblinding request; or
- an uncategorized failure would require judgment about whether to retry.

Record the administrative failure privately and ask for protocol-level resolution. Do not silently continue under altered conditions.
