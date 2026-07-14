# Brief 13 — Server-side vote tracking backend

## Context

The `/rank` arena (see `docs/benchmark-web-ui-plan.md`, especially "Submission API and persistence" and "Phase 4") currently runs fully in the browser: `CatalogBenchmarkApi` (`src/benchmark/catalog-api.ts`) assigns matchups from `src/benchmark/rank-catalog.json`, and votes live only in `BenchmarkLocalStore` (localStorage). This brief adds durable server-side vote persistence in PostgreSQL via Prisma, deployed as Vercel serverless functions, while keeping the existing client flow fully functional when the server is unreachable.

Pattern (adapted from minebench): **anonymous participant → immutable raw vote row → matchup row created only at vote time → aggregates computed later**. No rating pipeline server-side yet; raw votes are append-only and replayable.

Scope decision, deliberate: matchup **assignment stays client-side** (the local scheduler is personal-history-aware and works offline). The server is a validated vote sink. Server-issued assignments/signed tokens are future work, not this brief.

## Already in place (do not redo)

- `prisma/schema.prisma` — datasource + `prisma-client` generator outputting to `src/generated/prisma` (no models yet). Prisma CLI 7.8 is a devDependency.
- `prisma.config.ts` — loads `.env` (or `$PRISMA_ENV_FILE`) via `process.loadEnvFile`.
- `.env` — `DATABASE_URL` pointing at a **running local Prisma dev Postgres** (`npx prisma dev --name raild -d`; TCP port 51214), plus `PARTICIPANT_SALT`.
- `.env.prod` (gitignored) — production Prisma Postgres URL + prod salt. Same vars already set in Vercel production env. **Never run destructive commands against `.env.prod`.** You should not need it at all; work only against the local DB.

## Data model (Prisma schema + one migration)

Use Prisma enums where natural (verdict, relative, sentiment, data class). Names below are indicative; follow repo naming taste.

```
model RankMatchup {
  id               String   @id            // canonical pair id from pairId(): "theme:levelA__levelB" (sorted)
  benchmarkVersion String                  // e.g. "rank-catalog-v1"
  themeId          String
  levelIdFirst     String                  // canonical (sorted) order, matching the id
  levelIdSecond    String
  createdAt        DateTime @default(now())
  votes            RankVote[]
}

model RankVote {
  id                String   @id @default(uuid())
  matchupId         String                 // FK -> RankMatchup
  participantHash   String                 // sha256(PARTICIPANT_SALT + participantId), hex; raw id never stored
  schemaVersion     Int                    // start at 1
  aLevelId          String                 // presentation order as shown to this participant
  bLevelId          String
  verdict           enum: a-better | b-better | both-good | both-bad
  relative          enum: a | b | tie      // derived server-side via mapVerdict()
  sentiment         enum?: positive | negative
  playCountA        Int
  playCountB        Int
  bestScoreA        Int?
  bestScoreB        Int?
  dataClass         enum: eligible | rehearsal | development   // resolved server-side from catalog
  assignedAt        DateTime?              // client-reported assignment time
  clientSubmittedAt DateTime?
  createdAt         DateTime @default(now())   // server timestamp
  idempotencyKey    String?
  @@unique([matchupId, participantHash])
}
```

The unique constraint is the real duplicate-vote enforcement. Votes are append-only: no update/delete paths anywhere in this feature.

## Server architecture

Three layers, so the same logic serves Vercel and local dev:

1. **Core** — e.g. `server/rank-votes.ts`: framework-agnostic. Exports handlers that take a parsed/validated request and a Prisma client, return `{ status, body }`. Plus a small hand-rolled validation module (no zod; repo has no validation dep and shouldn't gain one for two endpoints). Prisma client construction in a shared module using `@prisma/client` + `@prisma/adapter-pg` (works for both local TCP and prod Prisma Postgres TCP URLs; pool max ~2, module-level singleton).
2. **Vercel functions** — `api/rank/votes.ts` (POST) and `api/rank/stats.ts` (GET), thin adapters. Prefer the web-standard `Request`/`Response` handler signature if it keeps the adapter thin; otherwise `@vercel/node` types as a devDependency.
3. **Vite dev middleware** — a small plugin in `vite.config.ts` (dev only, `configureServer`) that mounts the same core handlers at `/api/rank/*`, so `npm run dev` serves a working end-to-end stack against the local DB. This must not affect production builds.

### POST /api/rank/votes

Request body (client sends):

```
{ matchupId, participantId, benchmarkVersion, themeId,
  aLevelId, bLevelId,               // presentation order
  verdict, playCounts: {a, b},
  bestScores?: {a?, b?},
  assignedAt?, clientSubmittedAt?, idempotencyKey? }
```

Server behavior:

- Strict payload limits: reject non-JSON, bodies > 8 KB, unknown verdicts, malformed fields → 400.
- Validate against the server-owned catalog (import `src/benchmark/rank-catalog.json` + helpers from `src/benchmark/catalog.ts` / `scheduler.ts` — plain TS/JSON, importable server-side): theme exists, both level ids are entrants of that theme, `matchupId === pairId(themeId, aLevelId, bLevelId)`, `playCounts.a >= 1 && playCounts.b >= 1`. Reject otherwise (422).
- Never trust client for identity/cost/dataClass: `relative`/`sentiment` derived via `mapVerdict(verdict)`, `dataClass` resolved from the catalog entrants (eligible only if both entrants eligible, else the weaker class).
- `participantHash = sha256(PARTICIPANT_SALT + participantId)` (node:crypto).
- Single transaction: create-if-absent the `RankMatchup` row (canonical order), then insert the `RankVote` tolerating the unique-constraint duplicate. A duplicate returns `200 { ok: true, duplicate: true }` — friendlier for browser retries. New vote returns `200 { ok: true, duplicate: false }`.
- No CORS headers (same-origin only). Include a basic per-IP in-memory rate limit (e.g. 20 requests / 10 s) with a comment noting it is best-effort per serverless instance.

### GET /api/rank/stats

Deployment smoke-check endpoint: `{ ok: true, votes: <count>, matchups: <count>, latestVoteAt: <iso|null> }`. No identities, no per-participant data.

## Client integration

Add a small isolated module, e.g. `src/benchmark/remote-recorder.ts`:

- After a successful local `submitVote` in `RankController` (`src/app/rank.ts:106`), build the payload above (best scores per side from the store's `levelRuns` if cheaply available, else omit) and POST it fire-and-forget.
- On failure (offline, 5xx, no API in static contexts), push the payload into a localStorage outbox (versioned key, cap ~50 entries, dedup by matchupId+participantId) and retry pending entries on rank-page load and after each subsequent vote. Server-side idempotency makes retries safe.
- The `/rank` UX must be completely unaffected by server availability: no new spinners, no blocked transitions, no console spam beyond a single debug-level line.
- Do not change `BenchmarkApi`, the state machine, the scheduler, or reveal flow.

## Build & scripts

- `postinstall: prisma generate`; also run generate before `build` so Vercel deploys work. Gitignore `src/generated/`.
- Confirm strict typecheck passes with the generated client under `src/` (it is inside the tsconfig root).
- Add npm scripts as needed (e.g. `db:migrate` → `prisma migrate dev`). Document that local dev needs `npx prisma dev --name raild -d` once per boot.
- New runtime deps allowed: `@prisma/client`, `@prisma/adapter-pg`, `pg` (+ types). Nothing else new at runtime.

## Verification (all must pass; report results)

1. `npm run typecheck` and `npm run build`.
2. Existing suites: `npm run test:benchmark-domain`, `test:benchmark-controller`, `test:benchmark-catalog`.
3. New `npm run test:vote-api` following the repo's node-script test convention (`node --experimental-strip-types ...`), run against the live local dev DB: valid vote inserts matchup+vote; duplicate submit is idempotent (`duplicate: true`, still one row); forged matchupId / wrong-theme pair / zero play counts rejected; stats endpoint reflects counts. Use a throwaway participantId per run so reruns stay green.
4. End-to-end HTTP smoke: start `npm run dev`, `curl` a valid vote payload into `http://localhost:<port>/api/rank/votes`, verify 200 and that `/api/rank/stats` counts it. (Headless WebGPU is broken in this environment — do not attempt to playtest the game; the curl path is sufficient.)

## Documentation

- Update `docs/benchmark-web-ui-plan.md` Phase 4 status minimally (what now exists vs deferred: server-issued assignment, reveal gating, leaderboard endpoint, rating pipeline).
- Add a short "Vote tracking backend" note to `AGENTS.md`: local dev DB command, env vars (`DATABASE_URL`, `PARTICIPANT_SALT`, `.env` local / `.env.prod` production via `PRISMA_ENV_FILE`), where the API lives, and the migrate-deploy command for prod.

## Non-goals (do not build)

- Server-side matchup assignment, signed matchup tokens, reveal gating, leaderboard endpoint.
- Glicko/Bradley-Terry server-side rating or job/worker tables.
- Play-session telemetry beyond what is listed (durations, crash flags — future).
- Accounts, CAPTCHA, fingerprinting.
- Do not commit.
