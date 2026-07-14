# AGENTS.md

## Project

Pareto Rail — a browser rail shooter. Vite + strict TypeScript + three.js **WebGPU only** (`WebGPURenderer` from `three/webgpu`; no WebGL fallback). Everything is procedural: no textures, models, fonts, or audio files.

## Architecture — respect the seams

- `src/main.tsx` — React entrypoint for the route-based website shell.
- `src/app/` — React layout, pages, reusable links, benchmark controller, and route lifecycle. Routing is client-side via the History API (`src/app/router.ts`); an unrecognized path resolves to `{ kind: 'notFound' }` and renders a 404 view. `GameFrame` bridges React pages to the imperative game runtime and is loaded lazily (via `LazyGameFrame`) so the three.js/WebGPU runtime stays out of the shell bundle — content pages and the level/matchup pickers must not statically import it.
- `vercel.json` — SPA rewrite so deep links (`/rank`, `/play/<id>`, …) serve `index.html` instead of 404ing; the `(?!api/)` exclusion keeps the `api/` functions live. Any new deploy target needs an equivalent fallback.
- `src/game/` — WebGPU renderer, scene/camera setup, pause menu, player volume/bloom settings, level picker, resize loop, postprocessing, and game-runtime mount/disposal.
- `src/engine/` — reusable mechanics and utilities. `lock-on-runner.ts` provides the shared lock-on rail-shooter flow; `input.ts`, `rail.ts`, `scoring.ts`, `music.ts`, and `spawn-patterns.ts` are level-agnostic helpers; `post.ts` owns shared bloom/vignette.
- `src/events.ts` — typed event bus (`spawn`, `lock`, `fire`, `hit`, `kill`, `beat`, `runstart`, …). Gameplay, visuals, and audio coordinate through events.
- `src/levels/<level-id>/` — independent built-in level modules. A level owns its gameplay design, rail, enemy types, visual language, effects, environment, and procedural music/SFX. Do not turn an existing level into a parameterized template for new levels.
- `src/benchmark-levels/<level-id>/` — promoted generated benchmark outputs. Each direct child directory owns a `level.json` descriptor and an `index.ts` module; Vite discovers these directories without a hand-edited registry. Benchmark metadata is eager, while level modules load lazily. Test-only fixtures belong under `src/benchmark-levels/test-fixtures/` and are not catalog or gallery entries.
- `src/levels/index.ts` — human-maintained built-in registry used by the in-game picker and `?level=<id>` URL parameter. The first entry is the default level a visitor lands on; keep the most polished level first. Built-in and benchmark catalog entries retain their domain when composed.
- `src/ui/` — DOM HUD, pause menu, end panel.
- The enemy tuning gallery lives at `/dev` during `npm run dev`; it is specifically for `crystal-corridor` and edits `src/levels/crystal/visuals/crystal-template.json`.
- See `docs/level-authoring.md` before adding or reshaping levels; it defines the spine/leaf convention. New levels are built to the standing brief in `docs/level-brief.md`.
- The level-generation benchmark — methodology, protocol, and operations — is documented in `benchmark/README.md`.
- Public compatibility contracts (identifier immutability, localStorage evolution, vote API rollout rules) are documented in `docs/compat.md`. Read it before renaming ids, changing stored data shapes, or touching the vote API.

## Gotchas

- Hot/bright elements use HDR colors (values > 1) so bloom picks them up; large bright screen areas white out the frame. Keep glow on thin lines and small cores, and dim hot elements with camera distance where appropriate.
- Any axis passed to `setFromAxisAngle` must be unit length; a non-unit axis compounds into exploding instance matrices.
- Headless Chrome in WSL2 cannot render WebGPU (broken device limits); typecheck/build/HTTP checks work, but visual verification requires a human playtest.

## Verification

`npm run typecheck` and `npm run build` must pass. Level-building tasks must also pass `npm run check:scope -- <level-id>`. Directory-only benchmark tasks use `npm run check:benchmark-scope -- --version v2 --level <level-id> --base <entrant-baseline-ref>`. `npm run dev` to playtest.

Use `npm run benchmark:manage -- status` to check benchmark run status, and `npm run benchmark:manage -- archive-dnf` to archive failed/DNF benchmark runs and clean up active worktrees.


Use `npm run scaffold -- --id <level-id> [--title <Title>] [--bpm <n>]` to create a built-in blank level scaffold. Future directory-only benchmark entrants use `npm run scaffold -- --mode benchmark --id <level-id> --title <Title>`; this creates the assigned `src/benchmark-levels/<level-id>/` directory without editing the built-in registry.

Use `npm run gallery` to regenerate `docs/level-gallery.md` from per-level `level.md` cards.

Use `npm run trace:spawns -- --level <level-id>` to dump expanded spawn timelines; use `--write` and `--compare` for timeline-preserving refactors.

Use `npm run snapshot -- --module <path> --export <factory>` to capture PNGs of procedural models under `snapshots/` from headless Chrome's SwiftShader WebGL backend.

Use `npm run snapshot:gameplay -- --level <level-id> --time <seconds>` to capture best-effort gameplay PNGs under `snapshots/gameplay/`. Use `--thumbnails <count>` for an evenly sampled contact sheet, or combine `--sheet --times <seconds,...>` for a contact sheet at specific times. Gameplay snapshots use immortal player mode by default, hide projectiles by default, and seed randomness for reproducibility; pass `--mortal` to allow death, `--projectiles` to include projectiles, or `--seed <int>` to override the seed. Levels remain WebGPU-only; this tool owns its WebGL/SwiftShader fallbacks (`full`, `postless`, `flat`) so level authors do not need to design for WebGL compatibility.

When adding or changing repo tools, update the appropriate human-facing docs in the same change. For level-building tools this usually means `docs/level-authoring.md` or `docs/level-brief.md`; edit `AGENTS.md` only when the guidance is broadly useful across repo tasks.

## Vote tracking backend

Local vote persistence uses a Prisma dev database: run `npx prisma dev --name raild -d` once per boot. The server reads `DATABASE_URL` and `PARTICIPANT_SALT`; local values live in ignored `.env`, while production values live in `.env.prod` and are selected for migrations with `PRISMA_ENV_FILE=.env.prod`. The shared handlers are in `server/`, Vercel adapters are in `api/rank/`, and Vite mounts the same handlers during `npm run dev`. Apply production migrations with `PRISMA_ENV_FILE=.env.prod npm run db:migrate:deploy`; never use destructive commands against that environment.
