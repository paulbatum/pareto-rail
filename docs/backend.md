# Backend

The vote-tracking backend persists ranking votes. The shared request handlers live in `server/`; Vercel adapters wrap them in `api/rank/`, and Vite mounts the same handlers during `npm run dev`, so local and production run identical logic.

## Endpoints

- `POST /api/rank/votes` — records one vote.
- `GET /api/rank/stats` — vote, matchup, and latest-vote counters.
- `GET /api/rank/aggregate` — the tally the public leaderboard is drawn from: eligible votes only, deduplicated to the newest vote per matchup and participant, then collapsed to one row per level pair (`aWins`, `bWins`, `ties`) with the pair normalized to sorted level-id order. Entrant identity, cost, and model names are not returned; the client joins the pairs against the catalog it already ships and fits the same Bradley-Terry curve the `/rank` page uses for personal results. The optional `exclude=<hex prefix>` parameter drops votes whose participant hash starts with that prefix — the development-only owner filter on the leaderboard page uses it, and it changes nothing about how the tally is computed.

## Local setup

Run the Prisma dev database once per boot:

```sh
npx prisma dev --name raild -d
```

The server reads `DATABASE_URL` and `PARTICIPANT_SALT`. Local values live in the ignored `.env`.

## Production

Production values live in `.env.prod`, selected for Prisma commands with `PRISMA_ENV_FILE=.env.prod`. Apply production migrations with:

```sh
PRISMA_ENV_FILE=.env.prod npm run db:migrate:deploy
```

Never run destructive commands against the production environment.

## Vote data snapshots

Export every matchup and vote row to a timestamped JSON file in the ignored `benchmark/private/votes/`:

```sh
npm run db:export-votes              # production (default)
npm run db:export-votes -- --env=local
```

Load a snapshot back into the local dev database, replacing whatever is there:

```sh
npm run db:import-votes              # newest snapshot in benchmark/private/votes/
npm run db:import-votes -- benchmark/private/votes/prod-2026-01-01T00-00-00Z.json
```

The import only ever writes to the local environment and refuses to run unless the local `DATABASE_URL` points at a loopback host. Participant and IP hashes carry the source environment's salt, so hashes in an imported production snapshot will not match locally computed ones.

## Seeing a production vote history locally

Importing rows does not make votes appear in the local app. The client never reads votes back from the server: ranking history, the personal curve, and reveals all come from browser localStorage (`pareto-rail-benchmark` and `pareto-rail-participant-id`, see `src/benchmark/storage.ts`), which is per-origin. Carry those two keys across instead.

In the production tab's console, this builds the whole command and puts it on the clipboard:

```js
copy(['pareto-rail-benchmark', 'pareto-rail-participant-id']
  .map((k) => [k, localStorage.getItem(k)])
  .filter(([, v]) => v !== null)
  .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
  .join('\n') + '\nlocation.reload()')
```

Paste it into the console on the local origin and run it unedited. Chrome blocks the first console paste until you type `allow pasting`. Where `copy()` is unavailable, run the expression without it and use "Copy string contents" on the returned string — copying the printed output gives an escaped, truncated version that will not work.

The carried participant id then posts local votes under the same identifier but a different hash than the imported rows, which is harmless for scratch data. Removing both keys restores an empty local history.

## Vote data admin page

While the Vite dev server is running, `/dev/admin` provides a local-only page for inspecting vote rows, computing participant hashes, and resetting local or production vote data. The page and its API are mounted by dev-server middleware and are not included in production builds; its environment switcher reads local values from `.env` and production values from `.env.prod`. Treat the production delete controls as destructive and use them only when explicitly intended.

## Social cards for match links

`middleware.ts` rewrites the head of a shared `/match` link so crawlers, which do not run JS, get a card instead of the SPA's default metadata. `api/og/match.tsx` renders that card. Two link shapes are carded, and both files must agree on which: the middleware decides in `cardQuery`, and the card function repeats the same test on its own query string.

- `?a=<id>&b=<id>` names both levels, so the card composites their two hero screenshots with a VS badge.
- `?model=<slug>`, with an optional `&vs=<slug>`, leaves the pair to a draw made when the link opens. The card tiles four heroes from `drawCandidateLevelIds`, which orders the reachable levels one theme at a time so the four span as many themes as possible. A pool of exactly two levels admits one matchup, and gets the VS composite instead.

Neither card carries model names, so a shared link previews what is in play without revealing who built which side.

To see a card without deploying, build the site (heroes are generated into `dist/social/heroes/`), bundle the function with `npx esbuild api/og/match.tsx --bundle --format=esm --platform=node --outfile=tmp/og-card.mjs --external:@vercel/og --loader:.json=json`, then import its `GET` and call it with a `Request` whose origin serves `dist/`.

## Serverless import hygiene

The `api/` functions run on Vercel under native Node ESM, which requires every runtime import to carry an explicit extension (`./foo.js`, not `./foo`). TypeScript's bundler resolution and Vite both tolerate extensionless specifiers, so `typecheck` and the client build will not catch a missing extension — but the serverless function fails to load at cold start and every request 500s. Any module reachable from `api/` (including shared files under `src/benchmark/` that the client also imports) must use `.js` on value imports; `import type` is erased and unaffected. `npm run check:serverless-imports` walks the value-import graph from the `api/` entry points and enforces this; it runs as part of `npm run build`.

## Compatibility

The vote API is a public contract with deployed clients and stored data. Before changing stored data shapes or vote endpoints, read `docs/compat.md`.
