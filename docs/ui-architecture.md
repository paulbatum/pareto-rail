# UI architecture

The website shell — everything outside the WebGPU game runtime — lives under `src/app/`: React layout, pages, reusable links, the benchmark controller, and route lifecycle.

## Routing

Client-side via the History API (`src/app/router.ts`). An unrecognized path resolves to `{ kind: 'notFound' }` and renders a 404 view.

## The `/levels` pages

`/levels` browses every level as a thumbnail gallery; `/levels/data` shows the catalog tree and full run records. Both are driven by the rank catalog and the built-in registry, so a benchmark level reaches these pages by being published to the catalog.

## The GameFrame boundary

`GameFrame` bridges React pages to the imperative game runtime and is loaded lazily (via `LazyGameFrame`) so the three.js/WebGPU runtime stays out of the shell bundle. Content pages and the level/matchup pickers must not statically import it.
