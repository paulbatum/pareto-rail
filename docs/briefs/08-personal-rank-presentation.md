# Brief 08 — Personal ranking: staged presentation

## Problem

Brief 07 replaced the personal rating model: `PersonalCurve` now exposes per-point `status` (`pending` / `provisional` / `stable`), win-tie-loss records, `placedCount`, and `frontierReady`, and the scheduler runs a coverage-then-playoffs season. The `/rank` page still presents this with placeholder plumbing: a bare table before `frontierReady`, a status chip that reads "2 placed · 3 comparisons", and no visual distinction between provisional and stable points on the chart.

This brief makes the presentation match the data model: a standings view that is worth looking at from the first vote, a chart that distinguishes settled results from early estimates, and copy that explains the arc without leaking internal vocabulary.

Scope is `src/app/pages/RankPage.tsx` (the `PersonalCurve` / `PersonalCurveTable` area) and `src/app/style.css`. Do not change `src/benchmark/` logic. Keep everything inside the existing visual language of the page (same panel, type scale, and color variables already used by the curve panel and compare cards).

## Vocabulary

Internal statuses must not appear verbatim in user-facing text. Map them:

- `pending` → **Needs matchups** (the configuration has not earned a position yet)
- `provisional` → **Early estimate** (positioned, but one vote could still move it on or off the frontier)
- `stable` → **Settled**

"Placed" and "frontier-ready" are likewise internal terms; the UI speaks in terms of configurations appearing on the chart.

## Stage 1 — Standings (before `frontierReady`)

Replace the current bare-table branch with a proper standings panel:

- Heading: **Your standings** (the panel becomes "Your Pareto curve" only in stage 2). Keep the "Personal results" eyebrow.
- A one-line progress narrative instead of the raw status chip, e.g. "2 of 8 configurations are on the board — keep voting to reveal your chart." Derive counts from `placedCount` and the number of catalog points. Zero comparisons gets an invitation ("Play a matchup to start your personal standings.") rather than an empty table alone.
- The standings table (evolves `PersonalCurveTable`, used in both stages):
  - Columns: Configuration, Record, Preference, Mean cost, Status.
  - Record renders as `3–1–2` (wins–ties–losses) with an accessible label spelling it out; configurations with no comparisons show an em dash.
  - Preference shows the rating when present, em dash otherwise.
  - Status uses the vocabulary above; frontier rows in stage 2 additionally show the existing frontier treatment.
  - Sort: rated configurations by rating descending, then unrated ones, ties by configuration id (current behavior, keep it).

## Stage 2 — Chart (once `frontierReady`)

Keep the existing SVG scatter, axes, tooltip, and label spreading. Add:

- **Provisional point styling**: points with status `provisional` render with a dashed circle stroke and slightly reduced fill opacity; `stable` points stay as today. The distinction must survive both the frontier and non-frontier point styles and be visible in the legend (add a legend entry for early estimates).
- Tooltip and aria labels say "Early estimate" / "Settled" instead of the raw status (aria currently reads `Status: provisional.`).
- **Unplotted configurations**: points with status `pending` are absent from the chart (they have no rating). Below the chart, before the table, add a single quiet line listing them when any exist: "Not yet on the board: Claude Fable 5 · high, Codex Sol · delegation." No pseudo-points on the chart.
- The status chip in the heading becomes the same progress narrative as stage 1 while pending configurations remain, and "All N configurations settled" when every point is `stable`; otherwise "N on the board · M still moving" style copy. Keep it to one short phrase.
- The frontier line and `curve-help` copy stay; update the help sentence to mention that dashed points are early estimates that firm up with more matchups.

## Debug export

Bump the export header to `PERSONAL CURVE DEBUG v3`. It already carries wins/ties/losses/status; ensure the header names the stage the UI rendered (standings vs chart) and drop any references to removed fields. Developer-only output may keep internal vocabulary.

## Verification

- `npm run typecheck`
- `npm run build`
- `npm run test:benchmark-domain`

Visual verification is by human playtest (headless WebGPU is unavailable in this environment); keep markup and class names semantic so review-by-reading is practical. Report results. Do not commit.
