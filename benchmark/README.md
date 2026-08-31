# Pareto Rail level-generation benchmark

Pareto Rail measures how well coding-agent configurations build complete browser rail-shooter levels in one unattended run. Configurations receive a shared level assignment and one of the benchmark themes. Visitors play two levels from the same theme without seeing who made them, vote, and then see the configurations and their measured generation costs. The site plots the resulting quality ratings against cost.

This directory contains the benchmark inputs, operating procedures, public provenance, and private run records.

## Terms

- A **configuration** is the intervention being measured: a plan row that selects a harness, model, effort, provider, budget, delegation behavior, and other execution settings. `recipes/README.md` documents the roster and the mechanisms configurations compose.
- A **theme** is the creative assignment shared by the configurations compared within one matchup group.
- An **entrant** is the level produced by one benchmark run.
- The **owner** decides what runs and votes on the site. The host, accounts, and repository clone belong to the owner.
- The **agent** operates the benchmark harness and reports results. The agent can inspect configuration identities; the owner must remain blind until they say they have voted on that theme.

## Run lifecycle

Start with:

```sh
npm run benchmark:status
```

The command joins private plans and schedules with live and archived run records. It reports runs that are pending, playable but not promoted, or complete.

A benchmark run then follows this lifecycle:

1. The controller reads one row from a private plan.
2. It creates an entrant checkout at the recorded baseline commit and renders the assignment from the recorded materials commit.
3. The selected harness builds the level in that checkout.
4. The controller seals the output and runs the typecheck, build, scope, and level-floor gates.
5. It records the inputs, commits, harness output, disposition, usage, and cost in the run record.
6. An accepted run is promoted into the application and added to the publication manifest.
7. Catalog, provenance, and rollout exports publish the entrant and its evidence.

Local records live under `benchmark/private/runs/<run-id>/`. See [`controller/README.md`](controller/README.md) for plan files, launch commands, monitoring, recovery, adjudication, promotion, publishing, and cleanup.

## Fairness and blindness

Configurations compared on one theme receive equivalent theme text and shared assignment text. The opaque level id differs per entrant, and a configuration may receive a mechanism-specific addition such as the delegation addendum because that mechanism is part of the intervention being measured. Each run records the rendered assignment and its inputs.

The private plan pins two commits:

- The **materials commit** supplies the assignment template, theme, and mechanism documents.
- The **entrant baseline** supplies the repository that the entrant can inspect and modify.

Matchups compare entrants only within the same theme. The publication manifest records which entrant baselines that theme accepts, so conditions can differ between themes without creating a direct vote between those conditions. Published provenance discloses the materials and baseline commits used by each entrant.

When a harness supports confinement, the entrant sandbox makes the entrant checkout the only writable tree, hides the primary repository and other run checkouts, and blocks external network access while preserving the local access required by the checks. A harness that cannot provide this boundary runs unisolated. The runner warns before launch and records that condition in the run manifest.

Every promoted run receives a transcript-based contamination review. The audit can find recorded reads, copies, and network activity, but it cannot prove that no unrecorded access occurred. The sandbox contract, host requirements, audit command, and promotion decision procedure belong to [`controller/README.md`](controller/README.md). Known failures and their corrective actions are recorded under [`incidents/`](incidents/).

Visitors remain blind until they vote. The site reveals model, workflow, and measured cost only after the vote. The agent operating the benchmark must also withhold the mapping between opaque level ids and configurations from the owner until the owner says they have voted on that theme.

## Judgment and ratings

A visitor plays two entrants from the same theme and selects one verdict:

- **A is better**
- **B is better**
- **Both are good**
- **Both are bad**

The first two verdicts provide a preference between configurations. The two ties record positive or negative sentiment but do not change their relative ordering.

The site fits a regularized Bradley–Terry rating per configuration from the visitor's preferences. A configuration can join the displayed Pareto frontier after its comparison count reaches both thresholds:

- at least 80% of the median comparison count; and
- at least three comparisons.

The chart still shows configurations below the threshold but marks them as provisional. It also excludes a disconnected comparison group from the frontier until votes connect that group to the main comparison graph. A configuration represented on only one theme remains limited by the comparisons available in that theme, so the benchmark must run it on more themes before additional voting can provide broader coverage.

Votes are stored anonymously as salted participant hashes and append-only, idempotent records. Existing votes remain attached to immutable theme, level, and configuration identifiers.

## Generation cost

Generation cost is the benchmark's valuation of the model usage captured for a run. It can include the primary agent and delegated subagents when their transcripts are part of the run's isolated harness record. A reported dollar value does not necessarily equal a charge paid by the owner: configurations can use subscriptions, metered APIs, discounted routes, or rate-card valuation.

The run manifest records the evidence needed to interpret the result:

- token counts and available per-model detail;
- the pricing tool and pricing basis;
- the selected usage source;
- reconciliation between transcript-derived usage and an independent harness counter when the harness provides one; and
- an explicit reason when a cost is unavailable.

A configuration without an available dollar value remains eligible for scheduling, voting, and rating. Its votes contribute to quality ratings, but it has no point on the cost axis. A pooled rating also has no mean cost when any contributing configuration is unpriced.

The manifest is the record of the result. Its `controller.commit` identifies the controller and adapter source that performed the calculation, including transcript discovery, resumed-session accounting, and source selection. See [`schemas/run-manifest.schema.json`](schemas/run-manifest.schema.json) for the record shape, [`recipes/`](recipes/) for harness-specific evidence and limitations, and [`manifests/`](manifests/) for published run records.

## Published evidence

Publishing preserves enough evidence to inspect what an entrant received, produced, and cost:

- the rendered assignment and its inputs;
- the materials and entrant-baseline commits;
- the sealed output and payload records;
- gate results and the promotion decision;
- any incident note;
- harness command, usage, and final-message records; and
- the measured or unavailable cost record.

`npm run benchmark:export-provenance` writes the repository-sized subset under [`manifests/`](manifests/). Full transcripts are published separately in the [Pareto Rail rollouts dataset](https://huggingface.co/datasets/paulbatum/pareto-rail-rollouts), with hashes recorded in `manifests/rollouts.json`. Credential-bearing harness state and private controller records are not published.

The run's evaluated output, payload, materials, and entrant baseline can live outside mainline history. The publishing procedure therefore also preserves their commits under benchmark tags. See [`controller/README.md`](controller/README.md) for the export, scanning, tagging, and verification commands.

## Versions

Version names such as `v1` and `v2` identify eras of the controller and configuration roster, not separate published rankings. Current plans pin their materials and entrant-baseline commits. The `benchmark-v1` tag retains the first version's machinery and freeze record, while its published entrants remain part of the live provenance set.

## Documentation map

| Need | Document |
| --- | --- |
| Run, monitor, recover, adjudicate, promote, or publish | [`controller/README.md`](controller/README.md) |
| Change controller components | [`controller/development.md`](controller/development.md) |
| Understand or add a configuration | [`recipes/README.md`](recipes/README.md) |
| Inspect a harness or cross-cutting mechanism | [`recipes/`](recipes/) |
| Understand prompt rendering | [`prompts/README.md`](prompts/README.md) |
| Write or select a theme | [`themes/README.md`](themes/README.md) |
| Interpret the run-manifest record | [`schemas/README.md`](schemas/README.md) |
| Inspect public provenance and transcript indexes | [`manifests/README.md`](manifests/README.md) |
| Inspect rollout analysis packages | [`analysis/README.md`](analysis/README.md) |
| Review known benchmark failures | [`incidents/`](incidents/) |
| Understand rehearsal-only prompt exemplars | [`examples/README.md`](examples/README.md) |

Each directory README owns the standing contract for the artifacts in that directory. Historical run behavior comes from the commits and artifacts recorded for that run, not from the current working tree.
