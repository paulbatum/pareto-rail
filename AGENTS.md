# AGENTS.md

## Project

raild — a browser rail shooter. Vite + strict TypeScript + three.js **WebGPU only** (`WebGPURenderer` from `three/webgpu`; no WebGL fallback). Everything is procedural: no textures, models, fonts, or audio files.

## Architecture — respect the seams

- `src/main.ts` — shared app shell: WebGPU renderer, scene/camera setup, pause menu, player volume/bloom settings, level picker, resize loop, and postprocessing.
- `src/engine/` — reusable mechanics and utilities. `lock-on-runner.ts` provides the shared lock-on rail-shooter flow; `input.ts`, `rail.ts`, `scoring.ts`, `music.ts`, and `spawn-patterns.ts` are level-agnostic helpers; `post.ts` owns shared bloom/vignette.
- `src/events.ts` — typed event bus (`spawn`, `lock`, `fire`, `hit`, `kill`, `beat`, `runstart`, …). Gameplay, visuals, and audio coordinate through events.
- `src/levels/<level-id>/` — independent level modules. A level owns its gameplay design, rail, enemy types, visual language, effects, environment, and procedural music/SFX. Do not turn an existing level into a parameterized template for new levels.
- `src/levels/index.ts` — level registry used by the in-game picker and `?level=<id>` URL parameter. The first entry is the default level a visitor lands on; keep the most polished level first.
- `src/ui/` — DOM HUD, pause menu, end panel.
- The enemy tuning gallery lives at `/dev` during `npm run dev`; it is specifically for `crystal-corridor` and edits `src/levels/crystal/visuals/crystal-template.json`.
- See `docs/level-authoring.md` before adding or reshaping levels; it defines the spine/leaf convention. New levels are built to the standing brief in `docs/level-brief.md`.

## Gotchas

- Hot/bright elements use HDR colors (values > 1) so bloom picks them up; large bright screen areas white out the frame. Keep glow on thin lines and small cores, and dim hot elements with camera distance where appropriate.
- Any axis passed to `setFromAxisAngle` must be unit length; a non-unit axis compounds into exploding instance matrices.
- Headless Chrome in WSL2 cannot render WebGPU (broken device limits); typecheck/build/HTTP checks work, but visual verification requires a human playtest.

## Verification

`npm run typecheck` and `npm run build` must pass. Level-building tasks must also pass `npm run check:scope -- <level-id>`. `npm run dev` to playtest.

Use `npm run scaffold -- --id <level-id> [--title <Title>] [--bpm <n>]` to create a blank level scaffold.

Use `npm run gallery` to regenerate `docs/level-gallery.md` from per-level `level.md` cards.

Use `npm run trace:spawns -- --level <level-id>` to dump expanded spawn timelines; use `--write` and `--compare` for timeline-preserving refactors.

Use `npm run snapshot -- --module <path> --export <factory>` to capture PNGs of procedural models under `snapshots/` from headless Chrome's SwiftShader WebGL backend.

Use `npm run snapshot:gameplay -- --level <level-id> --time <seconds>` to capture best-effort gameplay PNGs under `snapshots/gameplay/`. Use `--thumbnails <count>` for an evenly sampled contact sheet, or combine `--sheet --times <seconds,...>` for a contact sheet at specific times. Gameplay snapshots use immortal player mode by default, hide projectiles by default, and seed randomness for reproducibility; pass `--mortal` to allow death, `--projectiles` to include projectiles, or `--seed <int>` to override the seed. Levels remain WebGPU-only; this tool owns its WebGL/SwiftShader fallbacks (`full`, `postless`, `flat`) so level authors do not need to design for WebGL compatibility.

When adding or changing repo tools, update the appropriate human-facing docs in the same change. For level-building tools this usually means `docs/level-authoring.md` or `docs/level-brief.md`; edit `AGENTS.md` only when the guidance is broadly useful across repo tasks.
