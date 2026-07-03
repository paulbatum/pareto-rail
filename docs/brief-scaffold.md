# Brief: "raild" — Rez-inspired rail shooter (scaffold + gameplay)

Build the scaffolding and gameplay mechanics for a short browser rail shooter inspired by Rez. A separate visual pass will happen later by someone else — your job is a clean, working game with deliberately plain placeholder visuals and a crisp seam so the visual layer can be swapped without touching game logic.

## Stack (hard requirements)

- Vite + TypeScript (strict mode).
- three.js, latest release, **WebGPU only**: use `WebGPURenderer` from `three/webgpu`. No WebGL fallback. If `navigator.gpu` is missing, show a styled full-screen message ("This game requires WebGPU") and stop.
- Renderer init is async (`await renderer.init()`); structure bootstrap accordingly.
- No external assets (no textures, models, or audio files). Everything procedural.
- `npm run dev`, `npm run build`, `npm run typecheck` (tsc --noEmit) must all work.

## Game design — one 30-second run

- **Rail**: the camera flies along a `CatmullRomCurve3` through space for exactly 30 seconds, easing along the curve, always looking ahead down the path (look-at a point further along the curve). Design a curve with a few sweeping bends so the ride has motion interest. The run ends when the 30s ride completes.
- **Lock-on shooting (the Rez signature)**:
  - A reticle follows the mouse (screen-space, projected into the world ahead of the camera).
  - While the mouse button is held, sweeping the reticle over enemies locks them (max 8 simultaneous locks). Locked enemies are visually marked (placeholder: color change is fine).
  - On release, homing projectiles fire at each locked target in quick sequence (~60ms stagger). Projectiles travel fast, home to their target, and destroy it on contact.
  - Clicking (press+release without sweeping over anything) fires nothing — that's fine.
- **Enemies**: spawned from a hardcoded timeline (spawn time + position offset relative to the rail + movement pattern). Aim for ~25–35 enemies over the run, in small waves. Two or three simple movement patterns are enough (e.g., hold position ahead of the rail, slow drift across the path, small orbit). Enemies that the camera passes are removed and count as "missed". No player damage/death — score-attack only.
- **Scoring**: +100 per kill, with a multiplier bonus for multi-kills from a single lock-release volley (e.g., releasing 8 locks that all hit scores more than 8 separate single locks). Track kills / missed.
- **HUD** (plain DOM overlay, minimal styling — it will be restyled later): score, time remaining, current lock count. End screen after 30s: SCORE, kills/total, a simple rank letter (thresholds up to you), and "Press R to replay". R restarts cleanly (full state reset, no page reload needed).
- **Audio**: procedural WebAudio only, and keep it *simple and modular* (single `src/audio/` module). A minimal synthwave-ish beat clock at 120 BPM (kick + hat is plenty), lock/fire/kill SFX as short synth blips. Quantize fire SFX to the next 16th note (Rez-style). Start audio on first user gesture. Expose the beat clock through the event bus (see below) — the visual layer will pulse to it.

## Architecture — the visual seam (important)

- `src/events.ts`: a tiny typed event bus. Game logic emits at minimum: `spawn`, `lock`, `unlock`, `fire`, `hit` (with world position), `kill` (with world position), `miss`, `beat` (with beat number / is-downbeat), `runstart`, `runend`. The visual and audio layers subscribe; game logic never imports them for effects.
- `src/visuals/`: **all** mesh/material/effect creation lives here behind factory functions — e.g. `createEnvironment(scene)`, `createEnemyMesh(kind)`, `createReticle()`, `createProjectileMesh()`, plus an `updateVisuals(dt, ctx)` hook called every frame and event subscriptions for hit/kill effects. Placeholders must be *deliberately basic*: default `MeshBasicMaterial` flat colors, simple geometry, no shaders, no postprocessing, no particles. Do not attempt any visual polish — it will be replaced wholesale.
- `src/game/`: rail/camera, input, lock-on system, enemy spawner/patterns, projectiles, scoring, run state machine (ready → running → ended). Game logic must not construct materials or read anything from `src/visuals/` internals — it asks factories for objects and moves them.
- Keep files small and focused. No classes-for-everything; plain modules and functions are fine.

## Verification

- `npm run typecheck` and `npm run build` pass.
- Launch the dev server and confirm the page loads and the run starts (a WebGPU-capable headless check may not be available; if you cannot verify rendering headlessly, say so explicitly in your report and verify everything else).
- Report: what works, what's unverified, any deviations from this brief.

Do not commit. Leave the working tree for review.
