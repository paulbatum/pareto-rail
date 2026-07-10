# Benchmark plan

raild's long-term goal is a minebench-style interactive benchmark where visitors play levels built by different models and agent scaffolds, rank them blind, and see the results as a quality-versus-cost Pareto curve. Visitors who rank enough pairs could also see a personal curve.

The first experiment is personal: **is multi-agent delegation a useful sweet spot for this task—roughly 95% of solo-frontier quality at roughly 35% of the cost?** The public site is a later phase that can reuse the same records. This should be honest and repeatable, but it is a fun project rather than a scientific publication. Pairwise choices cannot establish a literal “95% quality” ratio; the decision rule must translate that motivation into observable wins, ties, reliability, and cost.

Everything below is the current protocol, not an irreversible commitment. Drafts are edited at stable paths without version suffixes. A choice becomes fixed only when a benchmark release record and Git tag are created. After the first eligible run, changing a prompt, recipe, theme, runner behavior, or evaluation rule requires restarting the affected experiment under a new release.

## Current experiment shape

- **Configurations:** Fable solo; GPT-5.6 solo; and delegation, where Fable plans and reviews while GPT-5.6 implements.
- **Replicates:** three themes crossed with all three configurations, for nine eligible runs.
- **Model identity:** use GPT-5.6 as soon as it is available and record exact model snapshot identifiers, not aliases.
- **Run policy:** each run follows a fixed recipe without operator intervention. No operator-requested retry or repair is allowed. Predeclared planning, implementation, review, and revision stages inside a delegation recipe are part of one run, not retries.
- **Mechanical eligibility:** `npm run typecheck`, `npm run build`, `npm run check:scope -- <level-id>`, and `npm run check:floor -- --level <level-id>` must pass. A failure is a DNF: keep its full cost and record, but do not present it for play.
- **Cost:** runs use paid subscriptions rather than API billing. Record raw token usage where the harness exposes it and compute API-list-price-equivalent USD at the run date as a model-usage comparison. Report subscription fees separately as actual expenditure; do not allocate monthly fees arbitrarily across runs. A multi-stage run includes every measured stage. Keep both equivalent cost per run and effective equivalent cost per published level so DNFs remain visible.
- **Blinding:** the ranker sees only random slot identifiers. Full run records, configuration identities, source branches, logs, and the slot key remain unopened until rankings are locked.
- **Comparison:** play same-theme pairs back to back. With three configurations, a complete round robin is three pairs per theme and nine pair judgments overall. Randomize pair order and which slot appears first.
- **Contamination control:** every eligible run starts from the same frozen entrant baseline and can see only its assigned theme and declared prompt material. It must not see another entrant, another eligible theme, the recipes for other configurations, the private schedule, or benchmark results.

## Artifact lifecycle

The tracked `benchmark/` tree holds authored inputs, schemas, locked slot-only rankings, and eventually published manifests. During generation, sensitive records live under ignored `benchmark/private/`:

```text
benchmark/
  prompts/        shared assignment applied to every configuration
  examples/       excluded theme exemplars used for authoring and rehearsal
  themes/         the three eligible theme texts
  recipes/        verbatim configuration workflows
  schemas/        freeze, run-manifest, and ranking formats
  releases/       small immutable release records, not copies of the input tree
  rankings/       locked records containing theme and slot ids only
  manifests/      full records published only after unblinding
  private/        ignored schedule, slot key, raw logs, and full run records
```

Generated level code stays on isolated output branches or commits. Do not merge entrants into the frozen baseline. Before unblinding, any playable deployment or ranking launcher must expose a slot id without exposing its branch, configuration, model, logs, or source.

The freeze record should identify both:

1. the materials commit containing the exact shared prompt, themes, recipes, schemas, decision rule, and runner; and
2. the exact entrant-baseline commit or archive, plus hashes of every supplied artifact.

The entrant baseline should exclude benchmark control material that an agent is not meant to see. A commit hash alone is not sufficient if the working tree still exposes other themes and recipes.

## Versioning

Prompts, recipes, themes, schemas, and runner code use stable authoring paths. Git provides file history; benchmark release metadata establishes which revisions form one experiment. Do not spread `v1` and `v2` names through the authored tree.

At a freeze, commit the final canonical materials, create `benchmark/releases/<version>/freeze.json` against `benchmark/schemas/freeze.schema.json`, and tag the release-record commit as `benchmark-<version>`. The first completed freeze will therefore create `benchmark/releases/v1/freeze.json` and tag `benchmark-v1`; neither exists while the material is still a draft.

Every run, ranking, and analysis record carries `benchmarkVersion`, while each artifact is also identified by path and SHA-256 hash. Machine record formats carry an independent numeric `schemaVersion`, because a compatible schema change is not necessarily a new benchmark intervention.

For a later benchmark, edit the same canonical paths and create a new release. Retrieve an old release through its Git tag or a worktree rather than copying the whole benchmark tree into every version folder. `benchmark/releases/README.md` defines the freeze sequence.

## Phases and gates

### 1. Resolve the protocol

Before runner implementation is considered stable:

- finalize `benchmark/prompts/level-assignment.md`, including duration, scope, creative latitude, polish expectations, and rendered assignment fields;
- write all three verbatim recipes, including stage prompts, supplied files, session boundaries, stage limits, review/revision behavior, harness versions, and usage capture;
- author three eligible themes and check them for comparable specificity and distance from the hand-built gallery;
- settle the run manifest and ranking formats;
- define how every harness reports token usage and how dashboard totals are reconciled;
- choose the DNF scoring rule, tie definition, quality aggregation, and delegation adoption rule;
- decide what the ranker may write as notes and whether notes are visible between later judgments; and
- generate the private randomized run schedule and slot mapping without opening them during ranking.

### 2. Build and rehearse the pipeline

Build the runner before the freeze. Exercise the complete path with an ineligible exemplar and a run that cannot enter the analysis:

1. prepare an isolated entrant checkout;
2. launch every stage without manual intervention;
3. capture model snapshots, token usage, prices, wall time, prompts, logs, and output commits;
4. run all four mechanical gates and exercise the DNF path;
5. assign a random slot without leaking its configuration;
6. make a passing output playable through the same mechanism intended for blind ranking;
7. write and validate a slot-only ranking record; and
8. reconcile computed cost against the harness or vendor dashboard.

The rehearsal may be repeated because it is tooling validation, not an eligible run. Its model, theme, and output must be marked ineligible in advance. No eligible theme should be consumed during rehearsal.

### 3. Freeze the first release

Freeze only after the protocol and rehearsal pass:

- finish any engine, standing brief, authoring documentation, gallery, and API-wishlist work intended for the baseline;
- commit the final materials at their stable paths;
- create the sanitized entrant baseline;
- create the release record with the materials and entrant-baseline identities;
- hash themes, recipes, prompts, harness versions, schemas, price inputs, and the runner;
- lock the decision rule and ranking protocol; and
- verify that a fresh entrant checkout contains exactly the intended material.

After this point, any behavior-affecting change to the baseline, shared prompt, runner, recipe, theme, or evaluation protocol requires a new benchmark release. Fixes to analysis or presentation code are allowed only when they do not alter recorded inputs or judgments.

### 4. Generate the nine entrants

Run in the precomputed order, using a fresh entrant checkout each time. Do not tail logs, inspect diffs, play partial outputs, or intervene. The controller may observe only enough process state to know whether a run has finished.

After each run, mechanically capture the private full record, commit the output, run the gates, and mark it playable or DNF. A harness or infrastructure failure is not automatically the model's DNF: classify failure reasons in advance, and only rerun failures explicitly defined as controller failures.

### 5. Rank blind

Create the same-theme pair schedule mechanically. For each pair, record presentation order, play counts, choice or tie, optional notes, and timestamp. The ranker may replay either slot as often as desired before deciding.

DNFs are never launched. Their treatment in quality scoring must already be fixed by the decision rule; omitting them from pairwise totals without a penalty would reward unreliable configurations.

### 6. Lock, analyze, and unblind

Commit or otherwise checksum the complete ranking set and record its lock timestamp before opening the slot key. Compute the preregistered result first. Exploratory observations are welcome afterward, but label them separately.

After unblinding, publish redacted full manifests under `benchmark/manifests/`, add configuration identities to derived analysis rather than rewriting slot-only ranking records, and retain raw records so future prices or scoring methods can be applied.

## Decisions still needed

These are the next design tasks, in dependency order:

1. **Delegation recipe:** planning artifact depth, implementer prompt, whether review gets one bounded revision, fresh versus continued sessions, and the harness for each stage.
2. **Solo recipes:** equalize what can reasonably be equalized—prompt material, unattended time policy, and handoff expectations—without pretending different harnesses have identical controls.
3. **Themes:** finish three 120–200 word themes. Decide whether they are authored by a person, a model excluded from the evaluated configurations, or a documented combination. `benchmark/examples/` is calibration material, not an eligible theme pool.
4. **Cost capture:** determine what per-run usage each subscription harness exposes, map available fields to the manifest schema, preserve vendor-specific counts, and record the exact API list prices used for equivalent-cost analysis. If exact tokens are unavailable, revise the metric before the freeze rather than presenting an estimate as measured usage.
5. **Failure taxonomy:** distinguish entrant DNF from controller failure before any eligible run.
6. **Decision rule:** define a tie, DNF treatment, the quality score derived from nine pair judgments, the relevant cost denominator, and the sentence that determines whether delegation becomes the adopted workflow.
7. **Public anchors:** later, decide whether hand-built levels enter the public pool as calibration anchors. They have no honest generation-cost coordinate and are not part of the first personal experiment.

## Immediate next work

1. Edit `benchmark/prompts/level-assignment.md`, especially its duration, scope, creative mandate, and finish standard.
2. Fill out one recipe from `benchmark/recipes/template.md`, preferably delegation because it has the most degrees of freedom.
3. Draft the remaining two eligible themes alongside `benchmark/themes/deluge.md`, then compare all three for specificity, aesthetic overlap, and implementation burden.
4. Adapt the draft schemas in `benchmark/schemas/` to real usage output from each selected harness.
5. Write the excluded rehearsal command and make it produce a private run record without yet automating all nine eligible runs.
