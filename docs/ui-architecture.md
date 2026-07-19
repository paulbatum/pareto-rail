# UI architecture

The website shell — everything outside the WebGPU game runtime — lives under `src/app/`: React layout, pages, reusable links, the benchmark controller, and route lifecycle.

## Routing

Client-side via the History API (`src/app/router.ts`). An unrecognized path resolves to `{ kind: 'notFound' }` and renders a 404 view.

## The `/levels` pages

`/levels` browses every level as a thumbnail gallery; `/levels/data` shows the catalog tree and full run records. Both are driven by the rank catalog and the built-in registry, so a benchmark level reaches these pages by being published to the catalog.

## The `/analysis` pages

`/analysis` lists every rollout analysis package committed under `benchmark/analysis/<level-id>/` (auto-discovered via Vite glob imports — no registry edit); `/analysis/<level-id>` is the explorer. The module lives in `src/app/analysis/`: `data.ts` loads a package's JSON lazily and resolves snapshot PNG URLs, `model.ts` builds the cross-file joins (agent lanes, event index, annotation attachment, the merged chronological stream), and five views render it — Story (narrative + chapters), Timeline (overview strip + virtualized event stream via `@tanstack/react-virtual`), Files (edit map + per-file history), Snapshots (reconstructed renders + provenance), and Run data (full mechanical record plus raw package JSON). The active view and focused event deep-link via `?view=` and `?event=`. Package format: `docs/analysis-package-format.md`.

## The GameFrame boundary

`GameFrame` bridges React pages to the imperative game runtime and is loaded lazily (via `LazyGameFrame`) so the three.js/WebGPU runtime stays out of the shell bundle. Content pages and the level/matchup pickers must not statically import it.

## Homepage bundle budget

`scripts/check-bundle-budget.mjs` runs at the end of `npm run build` and measures the gzip size of the eager homepage graph — the entry chunk plus everything it *statically* imports (JS and CSS), i.e. what a first visitor downloads before any lazy route or `LazyGameFrame` loads. Small growth is allowed; a jump past `MAX_GROWTH_RATIO` (15%) over the seeded baseline fails the build, which is what catches a heavy feature accidentally reaching the shell instead of sitting behind `React.lazy`. When growth is intentional, re-seed `BASELINE_GZIP_BYTES` to the size the failure message reports. The check relies on `build.manifest` being enabled in `vite.config.ts`.
