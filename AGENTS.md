# AGENTS.md

## Project

Pareto Rail is a benchmark for one-shot, model-built game levels, built as a browser rail shooter. Models generate levels; the site lets visitors play them and compare entrants blind, ranking quality against cost. Crystal Corridor is the hand-built reference level the entrants are calibrated against.

Stack: Vite + strict TypeScript + three.js **WebGPU only** (`WebGPURenderer` from `three/webgpu`; no WebGL fallback). Everything is procedural: no textures, models, fonts, or audio files.

## Architecture

- `src/main.tsx` — React entrypoint for the route-based website shell.
- `src/app/` — React website shell: layout, pages, client-side routing, and the benchmark controller. `LazyGameFrame` is the only bridge to the WebGPU runtime; content pages and pickers must not statically import `GameFrame`. See `docs/ui-architecture.md`.
- `vercel.json` — SPA rewrite so deep links (`/rank`, `/play/<id>`, …) serve `index.html` instead of 404ing; the `(?!api/)` exclusion keeps the `api/` functions live. Any new deploy target needs an equivalent fallback.
- `src/game/` — the imperative WebGPU game runtime: renderer, scene/camera, postprocessing, pause menu, level picker, and runtime mount/disposal.
- `src/engine/` — level-agnostic mechanics and utilities shared across levels; `lock-on-runner.ts` is the shared rail-shooter flow. The engine module list lives in `docs/level-authoring.md`.
- `src/events.ts` — typed event bus (`spawn`, `lock`, `fire`, `hit`, `kill`, `beat`, `runstart`, …). Gameplay, visuals, and audio coordinate through events.
- `src/levels/<level-id>/` — independent built-in level modules; each owns its own gameplay, rail, enemies, visual language, effects, environment, and procedural music/SFX.
- `src/benchmark-levels/<level-id>/` — promoted benchmark outputs, each with a `level.json` descriptor and `index.ts` module. Vite auto-discovers these directories — no registry edit, unlike built-in levels. Test-only fixtures go under `src/benchmark-levels/test-fixtures/` and are not catalog or gallery entries.
- `src/levels/index.ts` — hand-maintained registry for the in-game picker and `?level=<id>`, the counterpart to the auto-discovered benchmark dirs. The first entry is the default a visitor lands on — keep the most polished level first.
- `src/ui/` — DOM HUD, pause menu, end panel.
- `/dev` (dev server only) — enemy tuning gallery for `crystal-corridor`.
- See `docs/level-authoring.md` before adding or reshaping levels, and build new levels to the standing brief in `docs/level-brief.md`. Authoring covers the *how* — module layout, runner contract, conventions; the brief is the *assignment* handed to an implementing agent — the effort bar, the floor, and what gets judged.
- The level-generation benchmark — methodology, protocol, and operations — is documented in `benchmark/README.md`. Its canonical level footprints (built-in and benchmark; owned per-id roots and shared derived files) live in `scripts/benchmark/protocol.mjs`; scope, payload, and promotion code must consume that model rather than hardcode owned paths.
- Public compatibility contracts (identifier immutability, localStorage evolution, vote API rollout rules) are documented in `docs/compat.md`. Read it before renaming ids, changing stored data shapes, or touching the vote API.

## Verification

`npm run typecheck` and `npm run build` must pass for any change. Level and benchmark tasks have additional readiness gates (scope, floor) — see `docs/level-authoring.md` and `docs/level-brief.md`.

Headless Chrome in WSL2 cannot render WebGPU (broken device limits), so the game itself won't run headless. The snapshot tools fall back to SwiftShader/WebGL for best-effort visual inspection (see `docs/visual-tools.md`); use them for self-review. Final visual and audio quality still needs a human WebGPU playtest.

## Keeping docs current

When adding or changing repo tools, update the appropriate human-facing docs in the same change. For level-building tools this usually means `docs/level-authoring.md` or `docs/level-brief.md`; edit `AGENTS.md` only when the guidance is broadly useful across repo tasks.

## Licensing

Pareto Rail is MIT-licensed. Keep `THIRD_PARTY_NOTICES.md` accurate when adding distributed dependencies or copying third-party material; the Vite build emits that file with the deployed app.

## Vote tracking backend

Vote persistence runs on a Prisma database (`server/` handlers, `api/rank/` Vercel adapters). Local setup and production migrations are in `docs/backend.md`.
