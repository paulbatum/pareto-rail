# Brief 10 — Personal results: verdict log before the chart

## Problem

The personal results panel on `/rank` currently appears after the player's first *run* (before any vote) and speaks in score-leaderboard vocabulary ("Your standings", "Record", "on the board"). Players who just finished a scored run can read it as a ranking of their own performance. And before the chart is ready, the panel shows an aggregate table (records, ratings, statuses) built from one or two votes — manufactured aggregate where no meaningful aggregate exists yet.

Replace the pre-chart presentation with a **verdict log**: a recap of the matchups the player has judged. A verdict log cannot be mistaken for a score leaderboard (each row is something the player did), it preserves the reveal ceremony's storytelling, and accumulating rows naturally build toward the chart.

Scope: `src/app/pages/RankPage.tsx`, `src/app/rank.ts` (one accessor), `src/app/style.css`. No changes under `src/benchmark/`.

## Staging

**Zero verdicts — no panel.** Render nothing when `curve.comparisonCount === 0`. Replace the current `controller.hasPlayed` gate in `RankContent` with this condition (the `hasPlayed` getter in `rank.ts` becomes unused; remove it).

**One or more verdicts, chart not ready (`!curve.frontierReady`) — the verdict log.**

- Eyebrow: `Your verdicts`. Heading: `How you rank the models`.
- Intro line: `Every verdict ranks the model and workflow behind each level — your run scores don't affect this.`
- Progress line: `Your Pareto chart unlocks as verdicts accumulate.` (one sentence; no counts of internal entities).
- The log lists judged matchups **newest first**. Each row shows the theme title and an outcome sentence with full identities and costs, e.g.:
  - win: **Mass Driver** — `Claude Fable 5 · solo` beat `GPT-5.6 Sol · solo` ($65.53 vs $3.00)
  - both-good tie: **Skyhook** — Both impressed you: `Claude Fable 5 · delegated` and `GPT-5.6 Sol · delegated`
  - both-bad tie: same shape with `Neither impressed you:`
  Use `vote.verdict` for phrasing and the reveal entrants for identities/costs. Keep rows compact (one or two lines each) and styled consistently with the existing panel (monospace accents, existing color variables).
- Keep the dev-only debug copy button on this panel.

**Chart ready (`curve.frontierReady`) — the chart, as today, with copy fixes:**

- Status chip goes noun-free: `3 ranked · 1 pending` while placements remain, `All settled` when every point is stable. Do not say "configurations" or "on the board".
- `Not yet on the board:` → `Not yet ranked:`.
- Table caption: `Chart data`. Column `Configuration` → `Model` (rows already render model name + workflow).
- Below the table, add a collapsed `<details>` titled `All your verdicts (N)` containing the same verdict log, so the log persists after the chart takes over. Reuse one log component for both stages.
- Keep the heading `Your Pareto curve`, the intro, legend, and early-estimate styling as they are.

## Data access

Completed matchups (vote + reveal) live in the local store. Add a proper accessor on `RankController` (e.g. `get judgedMatchups()`) returning them in submission order; do not reach through `debugSnapshot` for player-facing UI. Theme titles: derive the theme id from the matchup id prefix (`themeId:levelA__levelB`) and look up the title in `rankCatalog.themes`, falling back to the raw id.

Update the debug export's stage label from `standings` to `verdicts` for the pre-chart stage.

## Verification

- `npm run typecheck`
- `npm run build`
- `npm run test:benchmark-domain`

Visual verification is by human playtest. Report results. Do not commit.
