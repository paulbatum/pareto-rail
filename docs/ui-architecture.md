# UI architecture

The website shell — everything outside the WebGPU game runtime — lives under `src/app/`: React layout, pages, reusable links, the benchmark controller, and route lifecycle.

## Routing

Client-side via the History API (`src/app/router.ts`). An unrecognized path resolves to `{ kind: 'notFound' }` and renders a 404 view.

## The `/levels` pages

`/levels` browses every level as a thumbnail gallery; `/levels/data` shows the catalog tree and full run records. Both are driven by the rank catalog and the built-in registry, so a benchmark level reaches these pages by being published to the catalog.

## The `/match` page

`/match?a=<level-id>&b=<level-id>` is a casual, shareable head-to-head. It mirrors the `/rank` flow — play both anonymous levels, vote which felt better, then the identities, cost, and run details are revealed — but **persists nothing**: no vote is recorded locally or remotely, no `localStorage` is written, and the personal curve is untouched. State lives only in memory (`CustomMatchController` in `src/app/match.ts`), so a refresh restarts the match by design. The page states the casual, unrecorded nature before the vote and again on the reveal.

Eligibility is deliberately broader than the ranked scheduler: any entrant in the rank catalog resolves via `findCatalogEntrant`, including retired entrants and entrants of retired or experimental themes (which `schedulingPool` excludes). When both sides share a theme the header shows it; when they differ, each card shows its own theme title and prompt.

Visiting `/match` with missing parameters (and, above a short notice, the `same`/`unknown` error cases) renders a blind level picker instead of the URL-shape instructions. It reuses the levels-gallery theme bands but shows every playable catalog entrant with no category filter — retired and experimental themes included — and each card shows only the thumbnail and level id, never the model or cost, so the person building the match can still play it blind. The first pick is side A and the second is side B (a third replaces B); once both are chosen an action bar starts the match or copies the absolute share link. Selection is transient React state, consistent with the rest of the page.

The route is `robots: noindex` (see `applyRouteHead` in `src/app/seo.ts`) because each link is an ephemeral, parameterized share URL; it is intentionally absent from the sitemap and prerender scripts, which only enumerate the listed static routes. The compare cards, vote buttons, reveal cards, and generation details are shared with `/rank` through `src/app/components/matchup.tsx`.

## The `/analysis` pages

`/analysis` lists every rollout analysis package committed under `benchmark/analysis/<level-id>/` (auto-discovered via Vite glob imports — no registry edit); `/analysis/<level-id>` is the explorer. The module lives in `src/app/analysis/`: `data.ts` loads a package's JSON lazily and resolves snapshot PNG URLs, `model.ts` builds the cross-file joins (agent lanes, event index, annotation attachment, the merged chronological stream), and five views render it — Story (narrative + chapters), Timeline (overview strip + virtualized event stream via `@tanstack/react-virtual`), Files (edit map + per-file history), Snapshots (reconstructed renders + provenance), and Run data (full mechanical record plus raw package JSON). The active view and focused event deep-link via `?view=` and `?event=`. Package format: `docs/analysis-package-format.md`.

## The GameFrame boundary

`GameFrame` bridges React pages to the imperative game runtime and is loaded lazily (via `LazyGameFrame`) so the three.js/WebGPU runtime stays out of the shell bundle. Content pages and the level/matchup pickers must not statically import it.

## SEO / indexing

The site is a single-page app, so crawlers need help discovering its routes.

- `public/robots.txt` allows all crawlers and points them at `https://paretorail.com/sitemap.xml`. Vite copies it verbatim into `dist/`.
- `scripts/generate-sitemap.mjs` runs after `vite build` in the `build` script and writes `dist/sitemap.xml`. It is dependency-free and derives its URL list from the same data files the app uses, so it can't drift: static routes, `/play/<id>` for every playable level (built-in registry ids excluding `technical` levels, plus non-retired rank-catalog entrant ids; test fixtures never appear because they never enter the catalog), and `/analysis/<id>` for each package directory under `benchmark/analysis/`. It fails the build loudly if it can't enumerate the built-in registry or the rank catalog. On Vercel, static files in `dist` are served before the SPA catch-all rewrite applies, so `sitemap.xml` and `robots.txt` are reachable despite that rewrite.
- `vercel.json` adds a permanent redirect from the `paretorail.vercel.app` host to `https://paretorail.com/<same path>`, giving the site one canonical origin. The redirect excludes `api/` paths (via the same `(?!api/)` negative lookahead the SPA rewrite uses) so API clients pinned to the vercel.app host keep working.
- **Route metadata** — `src/app/route-metadata.json` is the single source of truth for per-route SEO head data (title, meta description, canonical path) for the indexable static routes: `/`, `/levels`, `/levels/data`, `/rank`, `/leaderboard`, `/about`, `/analysis`. It is plain JSON so both the TypeScript app (via `src/app/seo.ts`, `resolveJsonModule`) and the plain-node build script read the exact same values — the prerendered head and the client-navigation head can't drift. `SITE_ORIGIN` (`https://paretorail.com`) lives in `seo.ts` alongside `metaForRoute` (adds the dynamic-route and 404 entries) and `applyRouteHead`.
- **Runtime head sync** — `App.tsx` calls `applyRouteHead(route)` on every route change. It sets `document.title`, the description meta, the canonical link (absolute `https://paretorail.com` URL), and og/twitter title/description/url so client-side navigation keeps the head consistent with the prerendered file. Dynamic routes (`/play/<id>`, `/analysis/<id>`) get a title/canonical derived from the id. The 404 route additionally gets a `robots: noindex` meta (added on entry, removed on leave) so soft-404s — which the SPA rewrite serves with a 200 — aren't indexed.
- `scripts/prerender-heads.mjs` runs after `vite build` (before `generate-sitemap.mjs`). It copies `dist/index.html` to each static route's file (`/about` → `dist/about/index.html`, `/levels/data` → `dist/levels/data/index.html`, …) with the head rewritten from `route-metadata.json`, and normalizes `dist/index.html` itself with the home entry. Each rewrite is anchored on an existing tag and asserts exactly one match, failing the build loudly if index.html's head shape changes. On Vercel these files are served before the SPA rewrite, so a crawler gets a route-specific head; dynamic routes have no prerendered file and fall through to the rewrite (handled by the runtime head sync). Keep the static-route list here in sync with `STATIC_ROUTES` in `generate-sitemap.mjs`.
- `index.html` carries the base head (canonical/og/twitter pointing at `https://paretorail.com/`) plus a static JSON-LD `WebSite` structured-data block for the home page.

## Homepage bundle budget

`scripts/check-bundle-budget.mjs` runs at the end of `npm run build` and measures the gzip size of the eager homepage graph — the entry chunk plus everything it *statically* imports (JS and CSS), i.e. what a first visitor downloads before any lazy route or `LazyGameFrame` loads. Small growth is allowed; a jump past `MAX_GROWTH_RATIO` (15%) over the seeded baseline fails the build, which is what catches a heavy feature accidentally reaching the shell instead of sitting behind `React.lazy`. When growth is intentional, re-seed `BASELINE_GZIP_BYTES` to the size the failure message reports. The check relies on `build.manifest` being enabled in `vite.config.ts`.
