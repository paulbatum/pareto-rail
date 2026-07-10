# Benchmark plan

raild's long-term goal is a minebench-style interactive benchmark where visitors play levels built by different models and agent scaffolds, rank them blind, and see the results as a quality-versus-cost Pareto curve. Visitors who rank enough pairs could also see a personal curve.

The first experiment is personal: **is multi-agent delegation a useful sweet spot for this task—roughly 95% of solo-frontier quality at roughly 35% of the cost?** The public site is a later phase that can reuse the same records. This should be honest and repeatable, but it is a fun project rather than a scientific publication. Pairwise choices cannot establish a literal “95% quality” ratio; the decision rule must translate that motivation into observable wins, ties, reliability, and cost.

Everything below is the current protocol, not an irreversible commitment. Drafts are edited at stable paths without version suffixes. A choice becomes fixed only when a benchmark release record and Git tag are created. After the first eligible run, changing a prompt, recipe, theme, runner behavior, or evaluation rule requires restarting the affected experiment under a new release.

## Current experiment shape

- **Configurations:** Fable solo; GPT-5.6 solo; and delegation, where Fable plans and reviews while GPT-5.6 implements.
- **Replicates:** three themes crossed with all three configurations, for nine eligible runs.
- **Model identity:** use GPT-5.6 as soon as it is available and record exact model snapshot identifiers, not aliases.
- **Run policy:** each run follows a fixed recipe without operator intervention. No operator-requested retry or repair is allowed. Predeclared planning, implementation, review, and revision stages inside a delegation recipe are part of one run, not retries.
- **Mechanical eligibility:** run `npm run typecheck`, `npm run build`, `npm run check:scope -- <level-id> <entrant-baseline-ref>`, and `npm run check:floor -- --level <level-id>` against the exact evaluated working tree, including its temporary registry and generated-gallery changes. The scope gate must use the frozen baseline ref, never moving `main`. A failure is a DNF: keep its full cost and record, but do not present it for play.
- **Cost:** runs use paid subscriptions rather than API billing. Record raw token usage where the harness exposes it and compute API-list-price-equivalent USD at the run date as a model-usage comparison. Report subscription fees separately as actual expenditure; do not allocate monthly fees arbitrarily across runs. A multi-stage run includes every measured stage. Model-mediated orchestration usage must be declared and captured without double-counting; its treatment in the primary cost metric is fixed before the release. Keep both equivalent cost per run and effective equivalent cost per published level so DNFs remain visible.
- **Blinding:** each run is preassigned a random four-character slot. Its implementation id combines the theme and slot, such as `deluge-a44f`, without encoding configuration or execution order. The private randomized run schedule is also the slot-to-configuration key. Full run records, configuration identities, source branches, logs, and that schedule remain unopened until rankings are locked.
- **Comparison:** play same-theme pairs back to back. With three configurations, a complete round robin is three pairs per theme and nine pair judgments overall. Randomize pair order and which slot appears first.
- **Contamination control:** every eligible run starts from the same frozen entrant-baseline commit in an opaque worktree of this repository. The controller supplies only its assigned theme, opaque level identity, and declared prompt material; it does not direct an entrant to inspect another entrant, eligible theme, recipe, schedule, or benchmark result. This is a non-adversarial policy, not technical isolation: an entrant with ordinary Git and filesystem access can inspect repository history and unrelated tracked files. The private schedule, raw records, credentials, and session URLs remain outside the repository and unavailable to entrants.
- **Integration:** agents use the normal level workflow in their opaque worktrees, including registry and gallery edits needed for development and gates. The controller derives a clean payload commit containing only the uniquely named level directory. After ranking and unblinding, passing payloads merge into current `main`, followed by one commit that registers them all and regenerates the gallery.

## Current rehearsal implementation

The first run is an excluded one-theme, one-configuration rehearsal: `codex-terra-high` uses Codex CLI `0.144.0`, `gpt-5.6-terra`, and high reasoning in one fresh ephemeral `codex exec` session. A minimal live probe has verified the CLI's JSONL session and usage fields. `scripts/benchmark/codex-cli.mjs` captures those records; `scripts/benchmark/run.mjs` composes the declared single-run flow from rendering through payload extraction and a private manifest.

`claude-fable-5-high` is the matching Fable solo configuration: `scripts/benchmark/claude-cli.mjs` drives one fresh `claude --print --output-format stream-json` session with `--effort high`, following the same pattern. `run.mjs` now dispatches on `definition.stage.adapter` (`codex-cli` or `claude-cli`) so either harness composes the same declared flow. A minimal live probe has verified the CLI's session/usage fields and native-transcript capture; this configuration remains rehearsal-only.

The ineligible rehearsal theme is `benchmark/examples/downpour.md`. `Rush` is metadata-marked as a technical test fixture, not a playable benchmark reference, so it is excluded from overlap, distinctiveness, and quality-reference checks while remaining available in development mode.

The first rehearsal's API-list-price-equivalent cost uses the dated standard short-context Terra input in `benchmark/pricing/gpt-5.6-terra-standard-short.json`; actual Plus subscription expenditure remains separate. `benchmark/controller/failure-taxonomy.md` supplies the current draft classification rules. These materials are still drafts and are not a benchmark release.

## Artifact lifecycle

The tracked `benchmark/` tree holds authored inputs, schemas, locked slot-only rankings, and eventually published manifests. During generation, sensitive records live under ignored `benchmark/private/`:

```text
benchmark/
  controller/     harness-neutral orchestration runbook
  prompts/        shared assignment applied to every configuration
  examples/       excluded theme exemplars used for authoring and rehearsal
  themes/         the three eligible theme texts
  recipes/        verbatim configuration workflows
  pricing/        dated API list-price inputs for equivalent-cost calculation
  schemas/        freeze, private schedule, run-manifest, and ranking formats
  releases/       small immutable release records, not copies of the input tree
  rankings/       locked records containing theme and slot ids only
  manifests/      full records published only after unblinding
  private/        ignored schedule/key, raw logs, and full run records
```

Generated level code stays isolated until rankings are locked. Each run has an exact evaluated commit used for gates and blind play. For a passing run, the controller also creates a payload commit from the frozen materials commit containing only `src/levels/<level-id>/`; it excludes the run's registry and generated-gallery edits. Do not merge either form into the frozen baseline. Before unblinding, any playable deployment or ranking launcher must expose a slot id without exposing its branch, configuration, model, logs, or source.

After unblinding, merge passing payloads into current `main`. Their globally unique directories make these merges disjoint. Then update `src/levels/index.ts` once, regenerate `docs/level-gallery.md` once, verify the combined game, and commit that integration. Preserve exact evaluated commits through tags and manifests so temporary run and payload branches can be deleted.

The freeze record should identify both:

1. the materials commit containing the exact controller runbook, shared prompt, themes, recipes, schemas, decision rule, and runner/adapters; and
2. the exact entrant-baseline commit in this repository, plus hashes of every supplied artifact and the private preassigned run schedule.

Entrant worktrees intentionally share this repository's tracked material and Git history. The controller must still keep the private schedule, raw records, credentials, and session URLs outside the repository. This convenience-over-isolation choice is fixed for the release and must be reported with the result.

## Versioning

The controller runbook, prompts, recipes, themes, schemas, and runner code use stable authoring paths. Git provides file history; benchmark release metadata establishes which revisions form one experiment. Do not spread `v1` and `v2` names through the authored tree.

At a freeze, commit the final canonical materials, create `benchmark/releases/<version>/freeze.json` against `benchmark/schemas/freeze.schema.json`, and tag the release-record commit as `benchmark-<version>`. The first completed freeze will therefore create `benchmark/releases/v1/freeze.json` and tag `benchmark-v1`; neither exists while the material is still a draft.

Every run, ranking, and analysis record carries `benchmarkVersion`, while each artifact is also identified by path and SHA-256 hash. Machine record formats carry an independent numeric `schemaVersion`, because a compatible schema change is not necessarily a new benchmark intervention.

For a later benchmark, edit the same canonical paths and create a new release. Retrieve an old release through its Git tag or a worktree rather than copying the whole benchmark tree into every version folder. `benchmark/releases/README.md` defines the freeze sequence.

## Phases and gates

### 1. Resolve the protocol

Before runner implementation is considered stable:

- finalize the small benchmark additions in `benchmark/prompts/level-assignment.md`, including duration, polish emphasis, identity fields, and theme rendering while leaving the standing brief as the main task specification;
- finish the remaining harness recipes (the delegation configuration) now that both solo harnesses — Codex Terra and Claude Fable 5 — have proved the controller path;
- write all three verbatim recipes, including stage prompts, supplied files, session boundaries, stage limits, review/revision behavior, harness versions, and usage capture;
- author three eligible themes and check them for comparable specificity and distance from the hand-built gallery;
- settle the run manifest and ranking formats from rehearsal output;
- define the remaining harness usage mappings and how subscription dashboards are reconciled with equivalent-cost records;
- choose the DNF scoring rule, tie definition, quality aggregation, and delegation adoption rule;
- decide what the ranker may write as notes and whether notes are visible between later judgments; and
- generate the private randomized run schedule against `benchmark/schemas/run-schedule.schema.json`, verify its complete configuration × theme crossing and unique ids mechanically, and retain its hash without opening the mapping during ranking.

### 2. Build and rehearse the pipeline

Build the deterministic adapters and exercise `benchmark/controller/runbook.md` before the freeze. Exercise the complete path with an ineligible exemplar and a run that cannot enter the analysis:

1. create an ineligible opaque slot and unique level id, then prepare an isolated entrant checkout;
2. launch every stage without manual intervention while allowing the agent to use the normal scaffold, registry, and gallery workflow;
3. capture model snapshots, token usage, prices, wall time, prompts, logs, and the exact evaluated commit;
4. run all four mechanical gates against that evaluated commit and exercise the DNF path;
5. derive a payload commit from the frozen materials commit containing only the new level directory, and mechanically reject any extra path;
6. make the evaluated output playable through the same mechanism intended for blind ranking;
7. write and validate a slot-only ranking record; and
8. reconcile computed cost against the harness or vendor dashboard.

The rehearsal may be repeated because it is tooling validation, not an eligible run. Its model, theme, and output must be marked ineligible in advance. No eligible theme should be consumed during rehearsal.

### 3. Freeze the first release

Freeze only after the protocol and rehearsal pass:

- finish any engine, standing brief, authoring documentation, gallery, and API-wishlist work intended for the baseline;
- commit the final materials at their stable paths;
- record the frozen entrant-baseline commit used for all entrant worktrees;
- generate and validate the private preassigned run schedule;
- create the release record with the materials and entrant-baseline identities plus the private schedule hash;
- hash the controller runbook, themes, recipes, prompts, harness versions, schemas, price inputs, the schedule, and the runner/adapters;
- lock the decision rule and ranking protocol; and
- verify that a fresh entrant checkout contains exactly the intended material.

After this point, any behavior-affecting change to the baseline, controller runbook, shared prompt, runner/adapters, recipe, theme, or evaluation protocol requires a new benchmark release. Fixes to analysis or presentation code are allowed only when they do not alter recorded inputs or judgments.

### 4. Generate the nine entrants

Run in the private precomputed order, using its preassigned slot and `<theme-id>-<slot-id>` level id in a fresh entrant checkout each time. Do not tail logs, inspect diffs, play partial outputs, or intervene. The controller may observe only enough process state to know whether a run has finished.

The agent follows the ordinary level-authoring workflow, including scaffolding, registration, gallery generation, and repository commits. After the final stage, the controller mechanically captures the exact evaluated commit and runs the four gates. A harness or infrastructure failure is not automatically the model's DNF: classify failure reasons in advance, and only rerun failures explicitly defined as controller failures.

For a passing run, create a separate payload commit based on the frozen materials commit—not the entrant-baseline commit—by copying only `src/levels/<level-id>/` from the evaluated commit. Verify mechanically that its diff contains exactly that directory. Record both commits in the private manifest and mark the evaluated commit playable. Preserve DNF state and spend, but do not add it to blind play or the passing-payload merge set.

### 5. Rank blind

Create the same-theme pair schedule mechanically. For each pair, record presentation order, play counts, choice or tie, optional notes, and timestamp. The ranker may replay either slot as often as desired before deciding.

Serve the exact evaluated commits, not payload commits, because the evaluated form contains the registry state used by the gates. Do not merge any entrant into `main` yet.

DNFs are never launched. Their treatment in quality scoring must already be fixed by the decision rule; omitting them from pairwise totals without a penalty would reward unreliable configurations.

### 6. Lock, analyze, unblind, and integrate

Commit or otherwise checksum the complete ranking set and record its lock timestamp before opening the private run schedule. After opening the schedule, compute the preregistered result before any exploratory analysis. Exploratory observations are welcome afterward, but label them separately.

After unblinding, publish redacted full manifests under `benchmark/manifests/`, add configuration identities to derived analysis rather than rewriting slot-only ranking records, and retain raw records so future prices or scoring methods can be applied.

Preserve every exact evaluated commit with a benchmark-and-slot tag. On an integration branch from current `main`, merge each passing directory-only payload; do not merge into or alter the frozen entrant baseline. Update `src/levels/index.ts` once with all merged entrants, regenerate `docs/level-gallery.md`, and run typecheck, build, and the floor gate for every integrated level. Record the final integration commit in the published manifests, merge the integration branch to `main`, and delete temporary branches once their durable commits are tagged or merged.

A DNF must not break `main`. It remains preserved by its evaluated tag and manifest. Any later repair is a post-benchmark derivative: verify and label it separately before deciding whether to integrate it.

## Decisions still needed

These are the next design tasks, in dependency order:

1. **Delegation recipe:** planning artifact depth, implementer prompt, whether review gets one bounded revision, fresh versus continued sessions, and the harness for each stage.
2. **Solo recipes:** equalize what can reasonably be equalized—prompt material, unattended time policy, and handoff expectations—without pretending different harnesses have identical controls.
3. **Themes:** finish three 120–200 word themes. Decide whether they are authored by a person, a model excluded from the evaluated configurations, or a documented combination. `benchmark/examples/` is calibration material, not an eligible theme pool.
4. **Cost capture:** determine what per-run usage each subscription harness exposes, map available fields to the manifest schema, preserve vendor-specific counts, and record the exact API list prices used for equivalent-cost analysis. If exact tokens are unavailable, revise the metric before the freeze rather than presenting an estimate as measured usage.
5. **Failure taxonomy:** distinguish entrant DNF from controller failure before any eligible run.
6. **Decision rule:** define a tie, DNF treatment, the quality score derived from nine pair judgments, the relevant cost denominator, and the sentence that determines whether delegation becomes the adopted workflow.
7. **Integrated labels:** decide how the post-unblinding picker distinguishes same-theme entrants. Registry metadata can append a slot or configuration label without changing the evaluated level payload or its authored in-level title.
8. **Public anchors:** later, decide whether hand-built levels enter the public pool as calibration anchors. They have no honest generation-cost coordinate and are not part of the first personal experiment.

## Immediate next work

1. Commit the final rehearsal materials, then create the private `rehearsal-definition.json` using the committed hashes and opaque ids documented in `benchmark/controller/README.md`.
2. Run the one-theme Terra-high rehearsal without intervention. Preserve its evaluated commit, gate logs, payload when passing, raw usage, calculated equivalent cost, and controller-failure record when applicable.
3. Exercise the playable deployment and slot-only ranking-record path, including the DNF path if the rehearsal fails a gate.
4. Reconcile the captured token record against the available subscription dashboard evidence; record any limitation instead of estimating unavailable fields.
5. Use the rehearsal evidence to finalize the delegation and other solo recipes, three eligible themes, decision rule, ranking protocol, and release schedule before freezing `v1`.
