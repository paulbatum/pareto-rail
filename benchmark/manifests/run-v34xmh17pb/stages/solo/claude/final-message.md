**Thermal Ink** is built at `src/benchmark-levels/thermal-ink-4xmh/` — 18 files, ~4,500 lines, nothing outside the assigned directory.

## The level

A 60.000s run (96 BPM × 24 bars) that is one continuous boss fight. The octopus is on screen from the first frame, wrapped around a wreck it drags through the water; every wave of scavengers is something it shakes loose.

**The signature mechanic.** Three times across the run it fires an ink cloud over the rail. The clouds are real transparent geometry placed exactly where the camera will be during their authored bars, so a wall of ink visibly arrives and then multiplies normal sight down to nothing. Infrared engages only inside a cloud, only while the trigger is held — the `active` flag the engine passes to `setReticleActive` is the whole input — and lingers ~0.9s so a volley fired blind is still watched home. Raising it swaps every surface's colour through one `thermalUniform` and drops the clouds' opacity, so the imager genuinely sees through the ink rather than tinting it. The beak only opens inside the cloud: a release aimed at the core in clear water is turned away, so the last volley has to land through the final blackout.

Six enemy kinds (scuttlers raking the frame edges, jetting hatchlings, wallowing vent pods on 2 HP, interceptable ink bolts, four arms on `hitStages [3,3]`, the core on `[2,4]`), a 4-point hull, authored speed surging into each cloud, and a rail that stops at 87% of its curve so there is always harbour ahead.

**Audio**: slow industrial pulse, bouncing resonant bass, sparse inharmonic metal, one haunting melody in the *lower* half of the lead set — kills read a hidden lane in the octave above it, so a chained volley solos over the tune. Infrared is a mix move: a grit sub-bus ducks 78% and the melody's filter opens.

## Verified

- `npm run typecheck`, `npm run build` — pass.
- `npm run check:floor -- --level thermal-ink-4xmh` — **all checks pass, zero warnings** (6 kinds, full event coverage, 0 occlusion warnings, 0 perf failures, 0 centerness/distance warnings, reticle drawn at 0.99× the lock radius).
- `npm run simulate` — perfect 70/74 kills, rank S; imperfect 66/74, rank S; no dead-air gaps, no impossible moments, pressure peak 5–6.
- `trace:audio` and `trace:spawns` both work on this level and read as authored.
- Scope: `git status` shows only `src/benchmark-levels/thermal-ink-4xmh/`. `npm run check:benchmark-scope` could not run — `scripts/benchmark/protocol.mjs` is missing from this checkout, so the script crashes before doing anything; I verified the boundary by hand instead.

## What needs human eyes

WebGPU can't render here, so every still came from the SwiftShader/WebGL fallback and **the audio has never been heard**. In order:

1. **The first blackout (bar 6, ~15s).** Does "INK — HOLD TO RAISE INFRARED" land before frustration does? This is the one moment the level has to teach itself.
2. **Infrared brightness at gameplay distance** — the charcoal/white-hot image looked right headless, but bloom and the real tone curve may want the `HOT` values or the post charcoal floor nudged.
3. **The grit-bus duck under the imager** — measurable, not yet audible to me; likewise whether the kill lane sits above the melody cleanly or crowds it.
4. **Murk legibility in the empty stretches** (~10–14s, ~58s), where the creature's dark mass fills the frame with few lamps nearby. That's the weakest-looking part of the run.