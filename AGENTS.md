# AGENTS.md

## Project

raild — a 30-second Rez-inspired rail shooter. Vite + strict TypeScript + three.js **WebGPU only** (`WebGPURenderer` from `three/webgpu`; no WebGL fallback). Everything is procedural: no textures, models, fonts, or audio files.

## Architecture — respect the seams

- `src/game/` — rail/camera, input, lock-on system, spawn timeline, projectiles, scoring, state machine (`attract` → `running` → `ended`). Game logic never constructs meshes/materials or makes sound; it calls `src/visuals/` factories and emits events.
- `src/events.ts` — typed event bus (`spawn`, `lock`, `fire`, `hit`, `kill`, `beat`, `runstart`, …). Visual and audio layers subscribe; this is the only coupling.
- `src/visuals/` — all look: crystal enemy generator (`crystal.ts`), letter targets (`letters.ts`), tunnel/starfield (`environment.ts`), pooled effects (`effects.ts`), bloom postprocessing (`post.ts`). Hand-tuned; change with care. `setGlowLevel(0..1)` scales bloom and is bound to the pause-menu Glow slider.
- The enemy tuning gallery lives at `/dev` during `npm run dev`; `src/visuals/crystal-template.json` is the source of truth for crystal tuning.
- `src/audio/` — procedural WebAudio: 126 BPM layered arrangement, ambient mode for attract/end, SFX pitched in A minor and quantized to the grid. Mode switches are driven by `runstart`/`runend` events on the same tempo grid (that's what makes transitions seamless). `setMasterVolume(0..1)` is bound to the Volume slider.
- `src/ui/` — DOM HUD, pause menu, end panel.

## Gotchas

- Hot/bright elements use HDR colors (values > 1) so bloom picks them up; large bright screen areas white out the frame — keep glow on thin lines and small cores, and dim hot elements with camera distance (see `updateVisuals`).
- Any axis passed to `setFromAxisAngle` must be unit length; a non-unit axis compounds into exploding instance matrices.
- Headless Chrome in WSL2 cannot render WebGPU (broken device limits); typecheck/build/HTTP checks work, but visual verification requires a human playtest.

## Verification

`npm run typecheck` and `npm run build` must pass. `npm run dev` to playtest.
