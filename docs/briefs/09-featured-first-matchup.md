# Brief 09 — Featured first matchup per theme

## Problem

The headline question for a visitor to `/rank` is "Claude solo vs GPT solo" — the two frontier models on their plain single-agent workflows. The delegation configurations are interesting but second-order. Today the scheduler's cold-start picks the first pair by configuration-pair diversity and cost adjacency, so a visitor's first matchup in a theme may be any pairing.

Make the first matchup a participant receives in each theme always be the featured pairing: the two configurations marked featured in the catalog (currently `claude-fable-5-high` and `codex-sol-high`).

## Changes

**Catalog schema.** Add optional `featured?: boolean` to `RankCatalogEntrant` (`src/benchmark/catalog.ts`).

**Export script** (`scripts/benchmark/export-rank-catalog.mjs`). Extend the `configurationLabels` map so each entry can carry `featured: true` (set it on `claude-fable-5-high` and `codex-sol-high`), and emit `featured: true` on the corresponding entrants. Regenerate the checked-in catalog with `npm run benchmark:export-rank-catalog` and commit the resulting `src/benchmark/rank-catalog.json` change as part of the work.

**Scheduler** (`src/benchmark/scheduler.ts`). In the coverage phase, after the theme is selected: if this participant has zero judged matchups in that theme and the theme's candidate pairs include one whose two configurations are both featured, schedule that pair (tie-break by pair id if several levels share a featured configuration). This override beats cold-start configuration-pair diversity, cost adjacency, and newcomer anchoring — it fires for any theme with no judgments yet, including a theme added to the catalog later. When a theme lacks a both-featured pair (or has judgments already), behavior is unchanged.

Accepted consequence, do not "fix" it: with two featured solo configurations and two delegated ones per theme, coverage now produces a comparison graph whose solo pair and delegated pair are separate components until the playoff phase connects them. The solo configurations therefore reach the chart first — which is the desired presentation — and the delegated ones join a few votes later. Existing tests using unfeatured fixture catalogs keep their current guarantees.

## Tests (`src/benchmark/domain.test.ts`)

- Give `makeSchedulerCatalog` an option to mark a subset of configurations featured (default: none, so existing tests are untouched).
- The first assignment in every theme is the featured pair, for at least two different participant ids.
- A theme still gets full level coverage after the featured opener.
- A theme with no featured configurations behaves exactly as today (covered by existing tests).
- A theme added to the catalog after votes exist opens with its featured pair.

## Verification

- `npm run typecheck`
- `npm run build`
- `npm run test:benchmark-domain`
- `npm run test:benchmark-controller`

Report results. Do not commit.
