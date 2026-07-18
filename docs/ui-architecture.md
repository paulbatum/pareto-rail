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
