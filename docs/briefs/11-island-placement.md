# Brief 11 — Chart comparison islands as early estimates

## Problem

The featured openers (brief 09) make a player's first votes form two comparison islands: the solo pair and the delegated pair, each with a doubled edge and no edge between them. Placement currently requires membership in the *main* comparison component, so after four votes a player who judged both delegated matchups still sees only the two solo points — their delegated verdicts appear to have vanished into "Not yet ranked". Real transcript: 4 comparisons, `claude-fable-5-opus-delegation` and `codex-sol-terra-delegation` each judged twice, both absent from the chart.

Judged data must never be invisible. A configuration with enough comparisons should be plotted even when its island is not yet connected — but honestly marked, because its position *relative to the other island* rests on the regularization prior, not evidence.

Scope: `src/benchmark/personal-curve.ts` and `src/benchmark/domain.test.ts` only.

## Change

In `recomputePersonalCurve`:

- **Placement** becomes `comparisons >= 2` alone. Drop the main-component membership requirement from `placedIds`.
- **Status cap for islands**: a placed point whose configuration is *not* in the main comparison component is always `provisional` — skip its flip test. Points in the main component keep the existing flip-test semantics (their synthetic-vote refits may now include island points among the placed set; that is fine, the ratings exist).
- `mainComparisonComponent` stays as-is; it now only determines which points are exempt from the island cap.
- `placedCount`, `frontierReady`, and the frontier computation operate on the new placed set unchanged. The frontier may span islands; island members on it render as early estimates, which is the intended presentation.

## Tests (`src/benchmark/domain.test.ts`)

1. **Island placement** — reproduce the transcript shape: 2 themes, 4 configs (two featured), the four cold-start votes (featured pair twice, remaining pair twice). Assert all four configurations are placed, the chart-side points for the disconnected island report `provisional`, and `placedCount` is 4.
2. **Connection promotes** — add a fifth cross-island vote; assert the graph is one component and formerly capped points become eligible for `stable` (assert at least that the cap no longer applies, e.g. a decisive history yields `stable` island-free statuses).
3. **Self-healing schedule** — after the four featured cold-start votes, assert the next scheduled matchup pairs a solo configuration against a delegated one (guards the playoff information metric that reconnects islands).

Existing tests asserting placement/connectivity may need updating where they relied on the main-component requirement; preserve their intent (e.g. `testSchedulerCoverage`'s connected cold-start still places all four).

## Verification

- `npm run typecheck`
- `npm run build`
- `npm run test:benchmark-domain`
- `npm run test:benchmark-controller`

Report results. Do not commit.
