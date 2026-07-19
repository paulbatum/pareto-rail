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

## Vote data admin page

While the Vite dev server is running, `/dev/admin` provides a local-only page for inspecting vote rows, computing participant hashes, and resetting local or production vote data. The page and its API are mounted by dev-server middleware and are not included in production builds; its environment switcher reads local values from `.env` and production values from `.env.prod`. Treat the production delete controls as destructive and use them only when explicitly intended.

## Compatibility

The vote API is a public contract with deployed clients and stored data. Before changing stored data shapes or vote endpoints, read `docs/compat.md`.
