# Pareto Rail level-generation benchmark

Multiple agent configurations each build a complete, playable rail-shooter level from the same theme prompt — unattended, in one shot. Visitors to the site play pairs of these levels blind on the Rank page, vote, and see the results as a quality-versus-cost Pareto curve. This directory holds the benchmark's inputs, records, and operating procedures.

The motivating question: **is multi-agent delegation a useful sweet spot — near frontier-solo quality at a fraction of the cost?** Each provider fields a solo configuration (one frontier model does everything) and a delegated configuration (the same model plans and reviews while a cheaper same-provider model implements). The roster is append-only: later configurations can join an existing protocol when their recipe and execution inputs are pinned before their first run. This is honest and repeatable, but it is a fun project rather than a scientific publication; preference votes cannot establish a literal quality ratio.

## How a run works

- Each registered configuration runs once per theme, in a private randomized order. A run executes a fixed recipe (`recipes/`) in one unattended session: no operator feedback, no mid-run repair, no prompt adjustment. Predeclared stages inside a delegation recipe are part of one run, not retries.
- Every run starts from the same frozen entrant-baseline commit in an opaque git worktree. The controller renders the shared assignment (`prompts/level-assignment.md`) with the theme text and a preassigned level id such as `skyhook-a44f` — theme plus a random four-character slot that encodes nothing about configuration or execution order.
- After the run, four mechanical gates run against the exact evaluated tree: `npm run typecheck`, `npm run build`, the version-selected scope check, and `npm run check:floor`. A gate failure is a DNF: its full cost and record are kept, but the level is never presented for play.
- Failed runs may be rerun at operator discretion — infrastructure failures routinely, gate-failure DNFs occasionally. A rerun reuses the same run id and slot; the timestamped directory under `benchmark/private/archive/runs/` is the durable record of each earlier attempt and its cost, so published cost summaries should include archives.

## Cost

Runs use paid subscriptions rather than API billing. Cost is measured after the run by [ccusage](https://github.com/ccusage/ccusage) (pinned in `package.json`), which reads the run's isolated harness home and prices the persisted rollouts — parent and any delegated subagents — with its own maintained rate database. There is no hand-maintained pricing table to rot. Subscription fees are reported separately as actual expenditure, never allocated across runs. Two accepted gaps are documented rather than estimated: a small Claude auxiliary-model share (~0.2%, no transcript) and Codex's missing per-model cost split (its run totals stand).

Pricing the persisted rollouts assumes the rollouts are complete, and they are not always. Claude Code writes one line per content block and updates the line's usage when the message finalizes; a message that never finalizes keeps the small snapshot taken at message start, so replaying the transcript under-reports its output. Subagent threads are where this has shown up — one delegated run recorded a 37k-character thinking block as two output tokens. So the runner cross-checks ccusage against the harness's own counter (Claude's terminal result event carries a per-model `modelUsage` tallied from the API responses themselves) and records the outcome in `cost.reconciliation`, with each row's winner in `cost.models[].usageSource`. The direction of a gap identifies the faulty source: a counter above replay is replay having lost a message, and the counter is taken; a counter below replay cannot be explained that way, so replay stands and the run is flagged `suspect` for a human. Runs measured before this cross-check existed were restated in place from their retained artifacts by `npm run benchmark:reconcile-cost` (never re-measured), which moved published v1 cost up by $1.88 in total. A run with no terminal result event — a timeout — has no counter and stays `unavailable`, so its figures keep whatever bias replay gave them.

Both Claude's and Codex's counters restate the whole session on every resumed round rather than reporting that round's share, so the final round's counter is the run's counter and rounds are never summed. This is checked, not assumed: in the one resumed run on record each round's counter equals the run total exactly. pi is the exception and inverts this: each of its `message_end` events carries only that one API call's usage, so its counter is the sum across a session's assistant messages. Its adapter does the summing and reports the result in the same shape as Claude's counter, so the cross-check itself is unchanged.

A pi stage's `events.jsonl` is the retained event stream rather than a verbatim copy of the harness's stdout: pi's `message_update` events each repeat the whole message built so far instead of the new delta, so keeping them grows the log with the square of a message's length — a five-minute stage emitted 251MB of them against a 172KB session file. They are dropped as they stream, since each is superseded by the `message_end` closing its message with the final content and usage, and the count dropped is recorded alongside the log. The complete transcript remains the session file, which is captured as the run's rollout artifact and is the same file ccusage replays.

ccusage scopes to a run's isolated home by environment variable for Claude and Codex, but its pi view takes an explicit `--pi-path` sessions directory instead; the cost module carries that difference per harness so every view is still measured against one run's rollouts and nothing else. Costs are not uniformly subscription-priced: a pi configuration reaches its model through a selectable provider, so an OpenRouter-backed configuration bills real metered API spend while a subscription-backed one does not. Because `orchestrationTreatment` and the subscription caveat differ between those, a pi configuration's billing path is a property of its recipe, not of the harness.

Some configurations use a soft USD task budget to calibrate effort (the `-b20` recipes): the entrant is told a budget exists, receives relative spend notices in 25% increments, and may be resumed when it submits with substantial budget remaining. The budget is guidance, not a cap; exceeding it never kills a run.

## Blinding

The private run schedule under ignored `benchmark/private/` is both the execution order and the slot-to-configuration key. Full run records, configuration identities, source branches, and logs stay unopened until the relevant ranking snapshot is locked. Contamination control is a non-adversarial policy, not technical isolation: entrant worktrees share this repository's tracked material and history, but the controller never supplies another entrant's output, an unassigned theme, a recipe, the schedule, or benchmark results — and the private records stay outside the repository entirely.

## Judgment

Judgment is blind pairwise play on the public site. A visitor is assigned two levels from the same theme, must play both, and votes one of four verdicts: **A is better**, **B is better**, **both are good**, or **both are bad**. The first two are decisive preferences; the ties carry positive or negative sentiment that is reported separately but never changes the relative ordering. Model, workflow, and measured cost are revealed only after the vote.

Each visitor's votes fit a regularized Bradley–Terry model per configuration, plotted against mean measured generation cost as a personal Pareto curve with an explicit frontier. Votes are also recorded anonymously (salted participant hashes, idempotent, append-only) in a Postgres backend for future aggregate results.

The published rank catalog (`src/benchmark/rank-catalog.json`) retains one slice per benchmark version. New matchups come only from the active version, but every retained slice stays valid: returning visitors keep their old judgments, and the personal curve pools evidence by configuration id across versions — reusing a configuration id across versions asserts "same intervention" and connects the comparison graph.

## Versions and releases

Benchmark materials are authored at stable paths without version suffixes; Git provides history. A version exists only when `releases/<version>/freeze.json` and its matching `benchmark-<version>` tag are created. The freeze pins the shared protocol — runbook, prompt, themes, schemas, gates, judgment semantics, entrant baseline — while each configuration registration separately pins its runner, executor, recipe, and configuration commit in the private schedule. A behavior-affecting change to shared inputs requires a new protocol version; a behavior-changing recipe edit after a configuration has run requires a new configuration id; machine record formats carry an independent `schemaVersion`.

The frozen v1 contract is historical: its entrants used the normal level workflow with payloads rooted at `src/levels/<level-id>/`, later migrated into the benchmark domain. Directory-only releases (v2 onward) instead scaffold with `npm run scaffold -- --mode benchmark`, author under `src/benchmark-levels/<level-id>/`, own their descriptor, and never edit the built-in registry. Tools dispatch on the recorded benchmark version — never infer the protocol from whichever source directory happens to exist.

## Directory map

- `controller/` — harness-neutral orchestration runbook and failure taxonomy.
- `prompts/` — the shared assignment and delegation addendum, with rendering rules.
- `themes/` — eligible theme texts and authoring guidance.
- `examples/` — ineligible prompt exemplars for calibration and rehearsal.
- `recipes/` — verbatim configuration recipes and their template. The recipe is the intervention being measured.
- `schemas/` — freeze, private schedule, run-manifest, and ranking record formats.
- `releases/` — immutable freeze records and the release procedure.
- `rankings/` — locked blind-ranking snapshots, slot ids only.
- `manifests/` — redacted full run records published after unblinding, and the website projection boundary.
- `analysis/` — per-run rollout analysis packages (normalized traces, annotations, reconstructed screenshots) for unblinded runs.
- `public/` — reviewed input seam for generated website catalog artifacts.
- `private/` (ignored) — the schedule/key, raw logs, complete run records, archives, and retired outputs.

Each directory's README is the authoritative contract for the artifacts it holds.

## Inspecting run results

Use `npm run benchmark:results` to summarize records under `benchmark/private/runs`. The table reports lifecycle state, gates, stage and controller elapsed time, cost, and manifest completeness without parsing entrant prose or raw logs. Rehearsal identities are visible by default; eligible benchmark identities remain blind by default.

```bash
npm run benchmark:results
npm run benchmark:results -- --version rehearsal
npm run benchmark:results -- --theme downpour --format json
npm run benchmark:results -- --identity blind
```

Use `--identity unblind` only when the relevant ranking snapshot has been locked and its mapping opened. `--format csv` is also available, and `--runs <path>` can inspect another run-artifact directory.

Fresh launches verify the executing controller code against the release's frozen hashes. Once post-freeze controller development has drifted those files, launch with `PARETO_RAIL_ACCEPT_CONTROLLER_DRIFT=1`; each drifted path is recorded with its frozen and executing hashes in the run's `controller-drift.json`. Entrant-facing frozen material (theme, recipe, prompt template, baseline) is always strictly verified regardless of this flag.

## Resuming and managing runs

The runner checkpoints inputs, worktree creation, dependency setup, entrant execution, sealing, gates, payload extraction, and manifest generation in `controller-state.json`. Re-running with `--resume` validates existing artifacts and continues at the first unfinished operation:

```bash
npm run benchmark:run -- --resume benchmark/private/runs/<run-id>
```

A failed harness exit is not accepted automatically. If infrastructure timed out after the entrant completed its worktree, inspect that condition and explicitly resume normal sealing and gates:

```bash
npm run benchmark:run -- \
  --resume benchmark/private/runs/<run-id> \
  --accept-stage-output true
```

This records `recovery.json`. Recovery is provenance, not a result disposition: a recovered entrant that passes every gate and produces a valid payload is `playable`.

A finalized playable run is promoted automatically by the controller. Operators can resume the same operation without rerunning generation:

```bash
npm run benchmark:promote -- --run <run-id>
```

Existing-output administration builds its inventory only from private and published manifests, then invokes the same verified promotion path for each playable eligible record:

```bash
npm run benchmark:promote -- --inventory true --out benchmark/private/migrations/inventory.json
npm run benchmark:migrate -- --version <benchmark-version> [--accept-diverged <level-id>[,<level-id>...]]
```

Use `--accept-diverged` only for explicitly reviewed post-run source maintenance. The migration records the payload commit and diverging source paths for each accepted derivative; unlisted divergences remain blocking.

The migration inventory and its machine-readable promotion record are kept under `benchmark/private/migrations/`. They coalesce consistent private and published copies, record public rollout evidence, and include payload and application commit provenance without changing the run manifests, dispositions, evaluated branches, payload branches, or recovery refs. Verified non-playable source copies are recorded as administrative cleanups rather than promoted or made ranking-eligible.

Promotion checkpoints and its private payload/promotion commit provenance live in `promotion.json`. A promotion failure never edits the run manifest or changes its playable disposition; `benchmark:manage -- status` reports the completed run as promotion-pending or promotion-failed and prints this resume command.

Whenever a controller operation fails after a worktree exists, the runner also captures tracked and untracked source in a commit under `refs/benchmark-recovery/<run-id>/...` and records it in `recovery-snapshot.json`. The snapshot uses a temporary Git index and does not alter the entrant worktree. If `/tmp` later disappears, `--resume` reconstructs the worktree from this ref before continuing.

Management is non-destructive by default:

```bash
npm run benchmark:manage -- status
npm run benchmark:manage -- archive-dnf --dry-run true
npm run benchmark:manage -- archive-dnf
npm run benchmark:manage -- unarchive --run <run-id>
```

Archiving moves only the private run record. It never removes entrant or payload worktrees, branches, commits, or source. `prune` requires the run id twice as confirmation and refuses unless each worktree is clean, its `HEAD` and branch exactly match the recorded evaluated or payload commit, and those commits resolve. It removes worktree directories without force and preserves every branch and recovery ref:

```bash
npm run benchmark:manage -- prune --run <run-id> --confirm <run-id>
```

Routine benchmark management does not remove level directories or reset the registry in the primary repository. For an intentional retirement, preserve any needed source output under `benchmark/private/outputs/` first, then remove it from the application tree and regenerate the gallery.

## Publishing to the website

After mappings are opened, `npm run benchmark:export-rank-catalog` projects the publishable parts of every private run schedule into the checked-in `src/benchmark/rank-catalog.json`, one retained slice per schedule, with the numerically greatest `v<n>` schedule as the active matchup pool. A theme is published within a version only when every publicly labeled level for that theme has a promoted directory, and only configurations registered in the exporter's label map are published (withheld assignments are warned about, never silently dropped). When refreshing the publication, run `npm run benchmark:export-rank-catalog`, `npm run test:benchmark-domain`, `npm run test:benchmark-catalog`, `npm run typecheck`, and `npm run build`.

## Reconstructing an incorrectly cleaned worktree

`benchmark:restore-src` is a last-resort recovery tool for historical runs whose worktrees were destroyed. It replays only successful `Write` and `Edit` operations, uses recorded pre-edit snapshots when shell tooling created a file, and records the rollout hash in `source-recovery.json`.

```bash
npm run benchmark:restore-src -- <run-directory> --out <destination>
npm run benchmark:restore-src -- <run-directory> --worktree /tmp/pareto-rail-<run-id>
```

After reconstructing a worktree, regenerate deterministic shell-produced artifacts such as `docs/level-gallery.md`, verify the worktree mechanically, and continue with `benchmark:run -- --resume ... --accept-stage-output true`.
