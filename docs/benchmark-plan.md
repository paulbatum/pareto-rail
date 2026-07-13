# Benchmark plan

raild's long-term goal is a minebench-style interactive benchmark where visitors play levels built by different models and agent scaffolds, rank them blind, and see the results as a quality-versus-cost Pareto curve. Visitors who rank enough overlapping sets or targeted pairs could also see a personal curve.

The first experiment is personal: **is multi-agent delegation a useful sweet spot for this task—roughly 95% of solo-frontier quality at roughly 35% of the cost?** The public site is a later phase that can reuse the same records. This should be honest and repeatable, but it is a fun project rather than a scientific publication. Preference rankings cannot establish a literal “95% quality” ratio; the decision rule must translate that motivation into observable ranks, ties, reliability, and cost.

Everything below is the current protocol, not an irreversible commitment. Drafts are edited at stable paths without version suffixes. A protocol becomes fixed when its release record and Git tag are created. The shared prompt, eligible themes, entrant baseline, gates, and judgment method define that protocol. Configurations are append-only registrations: a later configuration may join the same protocol when its recipe and execution inputs are pinned before its first run. Changing an already-run configuration or a shared protocol input requires a new identity or protocol version; it does not invalidate honest earlier snapshots.

## Current experiment shape

- **Initial configurations:** Fable solo; GPT-5.6 solo; and delegation, where Fable plans and reviews while GPT-5.6 implements. This is the initial question, not a permanently closed roster.
- **Replicates:** each registered configuration runs once on each of the three frozen themes. The initial three configurations therefore produce nine eligible runs; later configurations add three runs each.
- **Model identity:** use GPT-5.6 as soon as it is available and record exact model snapshot identifiers, not aliases.
- **Run policy:** each run follows a fixed recipe without operator intervention. No mid-run repair, feedback, or prompt adjustment is allowed. Predeclared planning, implementation, review, and revision stages inside a delegation recipe are part of one run, not retries.
- **Rerun policy:** failed runs may be rerun at operator discretion — infrastructure failures routinely, gate-failure DNFs occasionally. In practice (v1 and v2) a rerun reuses the same run id and slot; there is no per-attempt tracking. The archived run directory (timestamped under `benchmark/private/archive/runs/`) is the durable record of each earlier attempt and its cost, so published cost summaries should be derived with archives included. This is an accepted compromise: results read as "the configuration's accepted attempt," not "first attempt," and rerunning a gate-failure DNF trades comparison fairness for coverage.
- **Mechanical eligibility:** run `npm run typecheck`, `npm run build`, the version-selected scope command, and `npm run check:floor -- --level <level-id>` against the exact evaluated working tree. v1 uses `npm run check:scope -- <level-id> <entrant-baseline-ref>`; the directory-only protocol uses `npm run check:benchmark-scope -- --version <benchmark-version> --level <level-id> --base <entrant-baseline-ref>`. The scope gate must use the frozen baseline ref, never moving `main`. A failure is a DNF: keep its full cost and record, but do not present it for play.
- **Cost:** runs use paid subscriptions rather than API billing. Cost is measured by [ccusage](https://github.com/ccusage/ccusage) (pinned in `package.json`), which parses each run's isolated harness home and prices the persisted rollouts — parent and any delegated subagents — with its own maintained rate database. The recorded basis is ccusage's computed USD per run, captured alongside the ccusage version; we do not maintain our own pricing tables, so no dated pricing artifact can rot when rates change. Report subscription fees separately as actual expenditure; do not allocate monthly fees arbitrarily across runs. Delegated-subagent usage is included in the run total without double-counting, because ccusage reads exactly one per-run home. Keep both cost per run and effective cost per published level so DNFs remain visible. ccusage misses a small Claude background auxiliary-model gap (~0.2%, no transcript); that is accepted and not reconciled.
- **Blinding:** each run is preassigned a random four-character slot. Its implementation id combines the theme and slot, such as `deluge-a44f`, without encoding configuration or execution order. The private randomized run schedule is also the slot-to-configuration key. Full run records, configuration identities, source branches, logs, and that schedule remain unopened until rankings are locked.
- **Comparison:** the primary judgment is one same-theme ranked set, with anonymous entrants placed into best-to-worst tiers and ties allowed. Randomize presentation order and record play counts. Binary pairs remain available for targeted comparisons or larger pools; a complete pairwise round robin is not required.
- **Contamination control:** every eligible run starts from the same frozen entrant-baseline commit in an opaque worktree of this repository. The controller supplies only its assigned theme, opaque level identity, and declared prompt material; it does not direct an entrant to inspect another entrant, eligible theme, recipe, schedule, or benchmark result. This is a non-adversarial policy, not technical isolation: an entrant with ordinary Git and filesystem access can inspect repository history and unrelated tracked files. The private schedule, raw records, credentials, and session URLs remain outside the repository and unavailable to entrants.
- **Integration:** v1 agents use the normal level workflow in their opaque worktrees, including temporary registry and gallery edits needed for development and gates. Directory-only entrants author under `src/benchmark-levels/` and do not edit the registry. The controller derives a clean payload commit containing only the uniquely named level directory under the version-selected source root. After ranking and unblinding, passing payloads merge into current `main`; v1 then registers them in one integration commit, while directory-only payloads are already discovered and only need the derived gallery/integration verification.

## Budget protocol

Some configurations naturally stop much earlier than others, while others continue polishing far beyond a comparable effort level. Budgeted configurations use a soft USD task budget to calibrate that effort: entrants are told only that a budget exists, receive relative spend notices in 25% increments while working, and may be resumed when they submit with substantial budget remaining. The budget is guidance rather than a hard cap; exceeding it never kills a run, though notices at and above 100% ask the entrant to finalize.

The protocol measures the complete isolated harness home with ccusage, including continuation turns and protocol-induced usage. Delivery, exact notice and continuation text, resume commands, deadline bounds, and multi-turn artifacts are specified in `benchmark/recipes/claude-fable-5-high-b20.md` and `benchmark/recipes/codex-sol-high-b20.md`.

## Public site publication

The public rank catalog is generated with `npm run benchmark:export-rank-catalog`. The exporter reads the private schedule and run pricing together with public theme and level descriptors, and publishes a theme only when every scheduled level for that theme has a promoted directory; missing promotions therefore require no site code change. The browser-local scheduler starts with coverage-first pairings, favoring two unseen levels and alternating themes on ties, then moves to least-judged pairs for refinement. Run `npm run benchmark:export-rank-catalog`, `npm run test:benchmark-domain`, `npm run test:benchmark-catalog`, `npm run typecheck`, and `npm run build` when refreshing the publication.

## Ranking and rolling snapshots

For each theme, play every passing entrant in the current snapshot and submit one ordered tier list. A record such as `[[slot-d], [slot-a, slot-c], [slot-b]]` means D is preferred, A and C tie, and B is last. Treat that as one judgment with several implied preferences, not as six independent binary observations.

The initial summary is deliberately simple. For an entrant in a theme with `n` playable entrants, calculate:

```text
normalized score = (number ranked below + 0.5 × number of other entrants tied) / (n - 1)
```

This yields 1 for a sole first place, 0 for a sole last place, and 0.5 for the middle of the field or an all-way tie. Average across themes, publish the raw tier lists beside the average, and do not imply more precision than three themes and one ranker support. DNFs are reported as reliability and cost outcomes rather than silently omitted or invented as play judgments.

When a later configuration joins, preserve every locked ranking record and create a new ranking snapshot. While the field remains small, replay and rerank the complete same-theme set. For a larger pool, use randomized overlapping subsets or targeted pairwise placement, keeping the comparison graph connected. A future multi-user analysis may fit a Plackett–Luce-style model to complete and partial rankings; Elo may be displayed for an online stream but is not the canonical small-sample result.

Ranking may begin before the roster is permanently closed, but a schedule and its judgments become immutable once their snapshot is locked. Record timestamps and presentation order. Occasional repeated anonymous anchor judgments may measure evaluator drift; store reversals as new evidence rather than rewriting old choices.

## Current rehearsal implementation

The first run is an excluded one-theme, one-configuration rehearsal: `codex-terra-high` uses Codex CLI `0.144.0`, `gpt-5.6-terra`, and high reasoning in one fresh ephemeral `codex exec` session. A minimal live probe has verified the CLI's JSONL session and usage fields. `scripts/benchmark/codex-cli.mjs` captures those records; `scripts/benchmark/run.mjs` composes the declared single-run flow from rendering through payload extraction and a private manifest.

`claude-fable-5-high` is the matching Fable solo configuration: `scripts/benchmark/claude-cli.mjs` drives one fresh `claude --print --output-format stream-json` session with `--effort high`, following the same pattern. `run.mjs` now dispatches on `definition.stage.adapter` (`codex-cli` or `claude-cli`) so either harness composes the same declared flow. A minimal live probe has verified the CLI's session/usage fields and native-transcript capture; this configuration remains rehearsal-only.

The two within-harness delegation configurations — `claude-fable-5-opus-delegation` (Fable plans and reviews, Opus implements) and `codex-sol-terra-delegation` (Sol plans and reviews, Terra implements) — are built and rehearsed here in Phase 2. Both are same-provider and driven by the shared `benchmark/prompts/flexible-delegation.md` addendum; cross-provider delegation is deliberately out of scope. Their rehearsal uses low reasoning for both the parent and the delegated subagent to exercise the full path cheaply, and is explicitly ineligible.

The ineligible rehearsal theme is `benchmark/examples/downpour.md`. `Rush` is metadata-marked as a technical test fixture, not a playable benchmark reference, so it is excluded from overlap, distinctiveness, and quality-reference checks while remaining available in development mode.

Run cost is measured by ccusage against each run's isolated harness home; actual subscription expenditure remains separate. `benchmark/controller/failure-taxonomy.md` supplies the current draft classification rules. These materials are still drafts and are not a benchmark release.

## Artifact lifecycle

The tracked `benchmark/` tree holds authored inputs, schemas, locked slot-only rankings, and eventually published manifests. During generation, sensitive records live under ignored `benchmark/private/`:

```text
benchmark/
  controller/     harness-neutral orchestration runbook
  prompts/        shared assignment applied to every configuration
  examples/       excluded theme exemplars used for authoring and rehearsal
  themes/         the three eligible theme texts
  recipes/        verbatim configuration workflows
  schemas/        freeze, private schedule, run-manifest, and ranking formats
  releases/       small immutable release records, not copies of the input tree
  rankings/       locked records containing theme and slot ids only
  manifests/      full records published only after unblinding
  private/        ignored schedule/key, raw logs, and full run records
```

Generated level code stays isolated until rankings are locked. Each run has an exact evaluated commit used for gates and blind play. For a passing run, the controller also creates a payload commit from the frozen materials commit containing only the assigned level directory under the version-selected source root. v1 payloads use `src/levels/<level-id>/`; directory-only payloads use `src/benchmark-levels/<level-id>/` and include the entrant-authored descriptor. It excludes registry and generated-gallery edits. Do not merge either form into the frozen baseline. Before unblinding, any playable deployment or ranking launcher must expose a slot id without exposing its branch, configuration, model, logs, or source.

After unblinding, merge passing payloads into current `main`. Their globally unique directories make these merges disjoint. For v1, update `src/levels/index.ts` once and regenerate `docs/level-gallery.md` once; for directory-only outputs, leave the built-in registry untouched and regenerate only the derived gallery. Verify the combined game and commit that integration. Preserve exact evaluated commits through tags and manifests so temporary run and payload branches can be deleted.

The protocol freeze record should identify both:

1. the materials commit containing the exact controller runbook, shared prompt, themes, schemas, gates, judgment method, and shared administration components (`admin.mjs`, `common.mjs`, and `render-assignment.mjs`); and
2. the exact entrant-baseline commit in this repository.

Each configuration is separately pinned by its immutable id, recipe hash, runner and executor hashes, exact model/harness settings, and configuration commit before its first assignment runs. The private schedule is an append-only ledger: extending it preserves all existing assignments and creates opaque assignments only for newly registered configuration × theme cells. Every run records the schedule revision hash that authorized it.

Entrant worktrees intentionally share this repository's tracked material and Git history. The controller must still keep the private schedule, raw records, credentials, and session URLs outside the repository. This convenience-over-isolation choice is fixed for the release and must be reported with the result.

## Versioning

The controller runbook, prompts, recipes, themes, schemas, and runner code use stable authoring paths. Git provides file history; protocol releases and per-configuration commits establish the exact revisions used. Do not spread `v1` and `v2` names through the authored tree.

The frozen v1 contract is historical: its entrant payloads originate at `src/levels/<level-id>/` and the normal entrant workflow may temporarily edit the built-in registry and gallery. The next directory-only protocol version uses the recorded version (v2 and later directory-only releases) to select `src/benchmark-levels/<level-id>/` for scope, gates, and payload extraction. Tools must dispatch from that recorded version; they must not probe which source directory happens to exist. A v2 entrant starts with `npm run scaffold -- --mode benchmark`, owns its descriptor, and never edits `src/levels/index.ts`. The permanent benchmark catalog validates the descriptor against the loaded `LevelDefinition`, so the descriptor is metadata input rather than an unchecked second gameplay identity.

A v2 baseline check verifies the expected built-in tree and rejects any direct child output under `src/benchmark-levels/` other than permanent discovery infrastructure and test fixtures. A directory-only payload is already in the benchmark source domain, so it does not go through the v1 relocation/promotion step; after rankings are locked, it can be integrated as a directory-only merge. Historical v1 records and their `src/levels/` paths remain governed by the v1 contract.

At a protocol freeze, commit the final canonical materials, create `benchmark/releases/<version>/freeze.json` against `benchmark/schemas/freeze.schema.json`, and tag the release-record commit as `benchmark-<version>`. The first completed freeze will therefore create `benchmark/releases/v1/freeze.json` and tag `benchmark-v1`; neither exists while the material is still a draft.

Every run, ranking, and analysis record carries `benchmarkVersion`, while each artifact is also identified by path and SHA-256 hash. Machine record formats carry an independent numeric `schemaVersion`, because a compatible schema change is not necessarily a new benchmark intervention.

For a later protocol, edit the same canonical paths and create a new release. Merely registering a new configuration against unchanged frozen inputs does not create a new protocol. Retrieve an old release through its Git tag or a worktree rather than copying the whole benchmark tree into every version folder. `benchmark/releases/README.md` defines the freeze sequence.

## Phases and gates

### 1. Resolve the protocol

Before runner implementation is considered stable:

- finalize the small benchmark additions in `benchmark/prompts/level-assignment.md`, including duration, polish emphasis, identity fields, and theme rendering while leaving the standing brief as the main task specification;
- finish the remaining harness recipes (the delegation configuration) now that both solo harnesses — Codex Terra and Claude Fable 5 — have proved the controller path;
- write all three verbatim recipes, including stage prompts, supplied files, session boundaries, stage limits, review/revision behavior, harness versions, and usage capture;
- author three eligible themes and check them for comparable specificity and distance from the hand-built gallery;
- settle the run manifest and ranking formats from rehearsal output;
- define how subscription dashboards are reconciled with the ccusage-measured cost records;
- choose the DNF scoring rule, tie definition, quality aggregation, and delegation adoption rule;
- decide what the ranker may write as notes and whether notes are visible between later judgments; and
- generate the initial private randomized run schedule against `benchmark/schemas/run-schedule.schema.json`, verify its complete registered-configuration × theme crossing and unique ids mechanically, and keep the mapping blind; later append-only extensions receive new schedule revision hashes.

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
- generate and validate the initial private preassigned run schedule;
- create the release record with the frozen shared materials and entrant-baseline identities;
- hash the controller runbook, shared administration components, themes, prompts, schemas, gates, and judgment rules; pin each initial configuration's runner, executor, recipe, harness, and model in the schedule before it runs;
- lock the decision rule and ranking protocol; and
- verify that a fresh entrant checkout contains exactly the intended material.

After this point, a behavior-affecting change to the baseline, shared prompt, theme, gates, failure policy, or judgment protocol requires a new benchmark release. Runners and harness executors are configuration-scoped: they may change for a newly registered configuration, but changing code or a recipe after that configuration has run requires a new configuration id. A runner change that also changes shared assignment rendering, sealing, gates, or failure semantics is a protocol change regardless of its filename. Fixes to analysis or presentation code are allowed only when they do not alter recorded inputs or judgments.

### 4. Generate the initial entrants

Run in the private precomputed order, using its preassigned slot and `<theme-id>-<slot-id>` level id in a fresh entrant checkout each time. Do not tail logs, inspect diffs, play partial outputs, or intervene. The controller may observe only enough process state to know whether a run has finished.

The agent follows the workflow selected by the protocol version. v1 includes scaffolding, registration, gallery generation, and repository commits; directory-only entrants scaffold under `src/benchmark-levels/`, own `level.json`, and never edit shared registry code. After the final stage, the controller mechanically captures the exact evaluated commit and runs the four gates. A harness or infrastructure failure is not automatically the model's DNF: classify failure reasons in advance, and only rerun failures explicitly defined as controller failures.

For a passing run, create a separate payload commit based on the frozen materials commit—not the entrant-baseline commit—by copying only the assigned directory from the evaluated commit. Select `src/levels/<level-id>/` for v1 and `src/benchmark-levels/<level-id>/` for the directory-only protocol from the recorded version. Verify mechanically that its diff contains exactly that directory. Record both commits in the private manifest and mark the evaluated commit playable. Preserve DNF state and spend, but do not add it to blind play or the passing-payload merge set.

### 5. Rank blind and lock a snapshot

Create the same-theme ranked-set schedule mechanically. For each theme, record randomized presentation order, play counts, ordered tiers, optional notes, and timestamp. The ranker may replay any slot as often as desired before deciding. Use targeted binary pairs only when the full set is too large or a later entrant needs efficient placement.

Serve the exact evaluated commits, not payload commits, because they are the trees used by the gates. v1 evaluated trees contain their temporary registry state; directory-only evaluated trees are discoverable from their assigned benchmark directory without a registry edit. Do not merge any entrant into `main` yet.

DNFs are never launched. Report their rate and cost alongside quality rather than allowing an unplayable output to disappear from the comparison.

### 6. Lock, analyze, unblind, and integrate

Commit or otherwise checksum the complete ranking snapshot and record its lock timestamp before opening the relevant slot mapping. Compute the declared normalized-rank and reliability summaries before exploratory analysis. Later entrants and judgments belong to a later snapshot; never rewrite the locked one.

After unblinding, publish redacted full manifests under `benchmark/manifests/`, add configuration identities to derived analysis rather than rewriting slot-only ranking records, and retain raw records so future prices or scoring methods can be applied.

Preserve every exact evaluated commit with a benchmark-and-slot tag. On an integration branch from current `main`, merge each passing payload; do not merge into or alter the frozen entrant baseline. Register v1 payloads in `src/levels/index.ts` once with all merged entrants; directory-only payloads require no registry edit. Regenerate `docs/level-gallery.md`, and run typecheck, build, and the floor gate for every integrated level. Record the final integration commit in the published manifests, merge the integration branch to `main`, and delete temporary branches once their durable commits are tagged or merged.

A DNF must not break `main`. It remains preserved by its evaluated tag and manifest. Any later repair is a post-benchmark derivative: verify and label it separately before deciding whether to integrate it.

## Decisions still needed

These are the next design tasks, in dependency order:

1. **Delegation recipe:** planning artifact depth, implementer prompt, whether review gets one bounded revision, fresh versus continued sessions, and the harness for each stage.
2. **Solo recipes:** equalize what can reasonably be equalized—prompt material, unattended time policy, and handoff expectations—without pretending different harnesses have identical controls.
3. **Themes:** finish three 120–200 word themes. Decide whether they are authored by a person, a model excluded from the evaluated configurations, or a documented combination. `benchmark/examples/` is calibration material, not an eligible theme pool.
4. **Cost capture:** resolved. Cost is measured by ccusage (pinned in `package.json`) reading each run's isolated harness home; the recorded basis is ccusage's computed USD per run, captured with the ccusage version, and it includes delegated subagents. Claude exposes per-model cost; Codex exposes per-model tokens only, so its per-model `costUsd` is omitted and the run total stands. The accepted limitations are the small Claude auxiliary-model gap (~0.2%, no transcript) and Codex's missing per-model cost; both are documented rather than estimated.
5. **Failure taxonomy:** distinguish entrant DNF from controller failure before any eligible run.
6. **Decision rule:** confirm the tier semantics, normalized-rank summary, DNF reliability reporting, relevant cost denominator, and the sentence that determines whether delegation becomes the adopted workflow.
7. **Integrated labels:** decide how the post-unblinding picker distinguishes same-theme entrants. Registry metadata can append a slot or configuration label without changing the evaluated level payload or its authored in-level title.
8. **Public anchors:** later, decide whether hand-built levels enter the public pool as calibration anchors. They have no honest generation-cost coordinate and are not part of the first personal experiment.

## Immediate next work

1. Commit the final rehearsal materials, then create the private `rehearsal-definition.json` using the committed hashes and opaque ids documented in `benchmark/controller/README.md`.
2. Run the rehearsal without intervention. Preserve its evaluated commit, gate logs, payload when passing, raw usage, ccusage-measured cost, and controller-failure record when applicable.
3. Exercise the playable deployment and slot-only ranking-record path, including the DNF path if the rehearsal fails a gate.
4. Reconcile the captured token record against the available subscription dashboard evidence; record any limitation instead of estimating unavailable fields.
5. Use the rehearsal evidence to finalize the delegation and other solo recipes, three eligible themes, decision rule, ranking protocol, and release schedule before freezing `v1`.
