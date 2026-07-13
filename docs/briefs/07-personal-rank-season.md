# Brief 07 — Personal ranking: Bradley-Terry ratings and an adaptive "season" scheduler

## Problem

The personal rank experience (`/rank`) asks a player to vote on blind within-theme level matchups and rewards them with a personal Pareto chart (preference rating vs generation cost, one point per configuration). The current implementation does not scale past a handful of configurations:

- `src/benchmark/personal-curve.ts` runs **online Elo** (K=32, sequential replay). At 4–20 total votes this is order-dependent, has no notion of uncertainty, and its "full curve" flag (`isFull`, ≥2 comparisons per config) triggers at the same moment the chart unlocks, so the early-estimate state never meaningfully displays.
- `src/benchmark/scheduler.ts` has a refinement phase that ignores which **configuration** pairs have been judged and picks alphabetically, and its coverage phase prefers both-unseen pairs unconditionally — which, once a rated pool exists, would pair newly added configurations against each other, leaving them disconnected from the rated graph.
- The catalog will grow: more configurations will be added to existing themes incrementally, 2 at a time. Round-robin coverage of configuration pairs is off the table (8 configs per theme = 28 pairs). The design goal is a "sports season": broad coverage gives seeding, then a small number of targeted "playoff" matches settle what actually matters — membership of the Pareto frontier.

This brief replaces the rating model and the scheduler and defines per-point placement/stability semantics. A follow-up brief will redesign the chart UI; this brief only keeps the existing UI compiling and honest.

## Constraints

- Matchups remain **within-theme only**. Cross-theme analysis happens later by post-processing stored votes; do not add cross-theme matchups or cross-theme model terms.
- Everything stays deterministic: no `Math.random()`, no wall-clock input to scheduling or rating. Same stored history ⇒ same outputs.
- Raw votes remain the source of truth; ratings are always recomputed from full history (the existing seam).
- **No backward compatibility for local data.** The user will clear local storage. Bump `BENCHMARK_STORAGE_VERSION` to 2 and delete the v0/legacy migration branches in `BenchmarkLocalStore.read()` (the unversioned-envelope path, `candidate.votes`/`candidate.unfinished` fallbacks, and the `'a-complete'` kind normalization). Unrecognized stored data is simply discarded.
- Also remove the legacy aliases in `personal-curve.ts` if nothing uses them after your change: `PersonalRatingPoint.entrantId`, the `entrantId` fallback in `PersonalHistoryEntrant`, `recomputePersonalRatings`, `calculateParetoFrontier`. (`MatchupVote.aEntrantId`/`bEntrantId` in `types.ts` are live fields — leave them.)
- Keep the modules dependency-free (the domain test runs under Node type-stripping with no test framework).

## Part 1 — Rating model: regularized Bradley-Terry

Replace the Elo loop in `recomputePersonalCurve` with a Bradley-Terry fit over the full history, aggregated by `configurationId`.

**Data prep.** For each history entry, resolve both sides to configuration ids (existing `configurationIdFor`). A vote contributes to the pair (cA, cB): `relative === 'a'` ⇒ 1 win for cA; `'b'` ⇒ 1 win for cB; `'tie'` ⇒ 0.5 wins each (both-good and both-bad are identical here; sentiment is not an ordinal signal). Skip entries where both sides resolve to the same configuration.

**Regularization / anchoring.** Add a virtual anchor opponent with fixed strength π = 1. Every configuration that appears in history gets one pseudo-comparison against the anchor scored as a tie (0.5 win, 0.5 loss). This keeps undefeated configs finite, shrinks small samples toward the center, and fixes the scale (no normalization step needed).

**Fit.** Standard MM iteration on strengths π_c:

```
π_c ← W_c / Σ_o n_co / (π_c + π_o)
```

where W_c is c's total wins (including the 0.5 vs the anchor), o ranges over opponents including the anchor, and n_co is the number of comparisons between c and o (including the 1 pseudo-comparison). Iterate until `max |log π change| < 1e-10` or 500 iterations. Deterministic iteration order (sort config ids).

**Display scale.** `rating = 1000 + 400 * log10(π_c)`. A config with no history renders no rating.

**Predicted win probability** (used by the scheduler and stability test): `p(a beats b) = π_a / (π_a + π_b)`.

## Part 2 — Placement and stability (replaces `unlocked` / `isFull` / `earlyEstimate`)

Compute per-point status so that adding new configurations later never regresses the whole chart:

- **Comparison graph**: nodes are configurations with ≥1 vote, edges are judged config pairs.
- A configuration is **placed** when it has ≥2 comparisons and is in the main component of the graph (the component with the most total comparisons; tie-break: the component containing the lexicographically smallest config id). Unplaced-but-seen configs are `pending`.
- A placed configuration is **stable** or **provisional** per a one-vote flip test on its frontier membership. Frontier is computed over *placed* points only (existing `paretoFrontier` dominance rule, meanCost from catalog):
  - On the frontier: refit BT with one synthetic loss added against the highest-rated placed config with strictly lower meanCost. If membership flips ⇒ `provisional`. If no cheaper placed config exists (it is the cheapest), it is `stable`.
  - Off the frontier: refit with one synthetic win against the highest-rated placed config with strictly lower meanCost (its blocker). If it would enter the frontier ⇒ `provisional`.
- Point status field: `status: 'pending' | 'provisional' | 'stable'`.

`PersonalCurve` output shape (rename/replace fields; update all consumers):

- `comparisonCount` — unchanged.
- `points` — one per configuration seen in history **plus** one per catalog configuration not yet seen (so the UI can show what's coming; unseen points carry cost and label, no rating, status `'pending'`, `comparisons: 0`). Each point gains `wins`, `ties`, `losses` (raw counts from history) and `status`; `frontier` remains but is only ever true for placed points.
- `placedCount` — number of placed points.
- `frontierReady` — `placedCount >= 2` (the chart can draw a frontier over placed points; the UI decides presentation).
- Drop `unlocked`, `isFull`, `earlyEstimate`.

Update `src/app/pages/RankPage.tsx` and its debug export only as much as needed to compile and stay truthful with the new fields (e.g. gate the chart on `frontierReady`, plot only placed points, keep the table listing everything with status). Do not redesign the presentation — that is the next brief.

## Part 3 — Scheduler: coverage with anchoring, then adaptive playoffs

Rewrite `nextScheduledMatchup` in `src/benchmark/scheduler.ts`. It now needs vote outcomes, not just judged pair ids: change `SchedulerHistory` to carry `judged: readonly { matchupId: string; relative: RelativeOutcome }[]` (replacing `judgedMatchupIds`), keep `themeHistory`. Update `CatalogBenchmarkApi.nextMatchup` to pass outcomes from the store (`data.history`), and simplify `NextMatchupRequest` accordingly (`judgedMatchupIds` → `judged` with outcomes; the catalog API may keep ignoring request fields when the store has data). `levelExposureCounts` stays as-is.

Candidate pairs are within-theme unordered level pairs whose configurations differ (never schedule same-configuration pairs, even if a future catalog puts two levels of one configuration in a theme).

**Phase A — coverage (any catalog level unseen, exposure 0).**

- Theme choice: the theme with the most unseen levels; tie-break: a theme different from the last assignment's theme; then lexicographic theme id.
- If no configuration has any votes yet (cold start): choose a both-unseen pair, minimizing judged-configuration-pair count (as today), tie-break smallest |generationCost difference| between the two entrants, then pair id. Cost adjacency makes early votes frontier-relevant; the config-pair-count minimum keeps edges diverse across themes so the config graph connects.
- Otherwise (a rated pool exists): the unseen level must debut against a **seen** anchor, never another unseen level, so new arrivals connect to the rated graph. Among (unseen, seen) pairs in the chosen theme: prefer anchors whose configuration is placed, then minimize |cost(unseen config) − cost(anchor config)|, then judged-config-pair count, then pair id.

**Phase B — playoffs (all levels seen).**

- Theme choice: the theme with the fewest judged votes (keeps themes balanced within one vote of each other, preserving cross-theme post-processing); tie-break: different from last theme; then lexicographic.
- Within the theme, score every candidate pair with BT ratings from Part 1: `info = p·(1−p) / (1 + judgedConfigPairCount)` where p is the predicted win probability between the two configurations. Pick the maximum; tie-break: fewer judgments of this exact level pair, then smaller |cost difference|, then pair id. This is Swiss-system logic pointed at the frontier: close-rated, under-measured pairs first, and repeats decay naturally.
- Keep the existing deterministic side-order hash.

Delete the now-dead helpers (`selectCoveragePair`, `selectPartialCoveragePair`, `selectRefinementPair`, `bestCoverageCandidate`) rather than adapting them; the phase logic above is the spec.

## Tests (`src/benchmark/domain.test.ts`)

Keep the existing style (plain asserts, no framework). Replace tests that encode Elo or old scheduler behavior. Add at minimum:

1. **Order independence**: a fixed set of votes fed in two different orders produces identical ratings.
2. **Regularization**: an undefeated configuration gets a finite rating; a config with a single win rates above one with a single loss.
3. **Tie handling**: both-good and both-bad produce identical rating effects.
4. **Cold start**: on a 4-config × 2-theme catalog, the first 4 assignments cover all 8 levels, use 4 distinct configuration pairs, and yield a connected config graph (all 4 configs placed after 4 votes).
5. **Newcomer anchoring**: after votes exist, add 2 configs (4 levels) to the catalog; every debut assignment pairs an unseen level with a seen one, never unseen-vs-unseen; after each newcomer has 2 votes it is placed while established points never lose placed status.
6. **Theme balance**: simulate ~30 votes with a deterministic voter; per-theme judged counts never differ by more than 1.
7. **Convergence**: simulate a voter with a fixed true strength ordering; after enough votes, the BT rating order matches the true order and frontier configs report `stable`; assert the flip test reports `provisional` for a freshly placed config whose membership one vote could change.
8. **Same-config pairs never scheduled** (catalog fixture with two levels sharing a configuration in one theme).

Also update `src/benchmark/fixtures.ts` and any callers if their compilation depends on changed types.

## Verification

- `npm run typecheck`
- `npm run build`
- `npm run test:benchmark-domain`
- `npm run test:benchmark-controller`

Report results. Do not commit.
