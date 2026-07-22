**Strandline is complete and committed** (`b0151a2` + `cb695f7`), with every required gate passing on the final tree: `typecheck`, `build`, `check:benchmark-scope`, and `check:floor` (simulation, occlusion, perf, audio config, spawn spread — zero failures, zero warnings).

## What was built

A 60-second run (96 BPM, 24 bars = exactly 60 s) in `src/benchmark-levels/strandline-s2bq/`, freeing a gigantic jellyfish from its infestation:

- **Arc**: Drift (bars 0–4) → Bloom (4–8) → **bell reveal** (8–10, rail swings wide, callout "THE BELL", music swells) → Deep strands (10–15) → **Crown boss** (15–22) → Serene pull-back coda (22–24, harmony turns over to open D major).
- **Enemies (7 kinds)**: leeches that clamp strands then swim across the view, jittery darting mites, station-keeping spitters lobbing slow interceptable venom bolts, two-hit armored cysts that visibly crack, larval broods, the Matriarch, plus the bolts. 54 counted targets, 3-point hull.
- **Boss**: the Matriarch grips the crown behind six violet webbing curtains, one per brood; each brood kill starves its curtain (and adds a music layer). All six dead → she's bared for a 3+3 staged kill with flinch recoveries; her death triggers a duck / sub-drop / rising-major-peal finale and the camera pulls back to frame the whole animal.
- **Audio**: full Crystal-style musical action layer — transport-quantized locks/fire, per-section hidden kill-melody lanes from the live chord, escalating boss gong, brood webbing-fall glissandi, watery reject/hull sounds. Audio trace confirms the arrangement builds section by section with the swell at bar 8 and the undertow drone at bar 15.
- **Visuals**: sunlit teal-to-deep-blue water with caustic dome, god rays, marine snow, a pulsing strand forest whose bioluminescence brightens as you cleanse it, the breathing bell with trailing ribbons, violet-only parasite palette, plankton-colony letter glyphs, gold diatom reticle, and underwater effects (drifting sparks, ink clouds, sinking husks).

Simulation: perfect policy clears 54/54 including the boss (rank S); the snapshot sheet confirms the strand forest, the parasites' sour violet, the webbed boss, and the bell arcing over the crown all read on screen.

## What needs human eyes

WSL2 can't render WebGPU, so the real frame and mix are unverified. A playtester should check, in order: (1) the bar-8 bell reveal — the bell sits high in frame; judge whether it "fills the view" enough, (2) the serene pull-back — the headless snapshot harness appears to script its own camera, so the coda's turn-toward-the-bell slerp needs confirming in a real run, (3) webbing curtains visibly dying back per brood kill, (4) bloom-at-zero legibility of violet targets against the strand glow, and (5) the crown-section mix — whether the brood-kill brightness layers land audibly.