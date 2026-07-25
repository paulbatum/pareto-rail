# Backend

The vote-tracking backend persists ranking votes. The shared request handlers live in `server/`; Vercel adapters wrap them in `api/rank/`, and Vite mounts the same handlers during `npm run dev`, so local and production run identical logic.

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

## Vote data admin page

While the Vite dev server is running, `/dev/admin` provides a local-only page for inspecting vote rows, computing participant hashes, and resetting local or production vote data. The page and its API are mounted by dev-server middleware and are not included in production builds; its environment switcher reads local values from `.env` and production values from `.env.prod`. Treat the production delete controls as destructive and use them only when explicitly intended.

## Serverless import hygiene

The `api/` functions run on Vercel under native Node ESM, which requires every runtime import to carry an explicit extension (`./foo.js`, not `./foo`). TypeScript's bundler resolution and Vite both tolerate extensionless specifiers, so `typecheck` and the client build will not catch a missing extension — but the serverless function fails to load at cold start and every request 500s. Any module reachable from `api/` (including shared files under `src/benchmark/` that the client also imports) must use `.js` on value imports; `import type` is erased and unaffected. `npm run check:serverless-imports` walks the value-import graph from the `api/` entry points and enforces this; it runs as part of `npm run build`.

## Compatibility

The vote API is a public contract with deployed clients and stored data. Before changing stored data shapes or vote endpoints, read `docs/compat.md`.
