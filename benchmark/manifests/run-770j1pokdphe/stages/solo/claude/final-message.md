Done and committed. Here's the handoff.

## What I built

**Skyhook** — a 60-second climb up a space-elevator tether, at `src/benchmark-levels/skyhook-560p/`. No registry edit, directory-only contract respected.

The structural decision the level is built on: **the camera flies straight up**. World +Y is altitude and the camera's up vector is world +Z, so the tether recedes to a vanishing point dead ahead and everything else — rain, cloud, shed ice, hostiles — falls past the frame. That makes the shared rail frame in `src/engine/rail.ts` degenerate, so gameplay places everything with its own fixed climb basis (`climbOffset`).

The organising idea, applied to both halves: **the world runs out of air as you climb**. Fog density, effect vocabulary (condensation rings become bare structural rims), reverb sends, arrangement layers, and the player's own instrument timbre all ride the same altitude curve — a wet storm deck down low, a dry structure-borne vacuum mix for the boss, four near-silent bars at the dock.

Six enemy kinds plus a staged boss. **Latchers** ignore the player entirely: they converge on the car, clamp onto the cowl at the bottom of the frame and cut into the hull until pried off. **The Descender** grips the tether above and hauls itself down for the whole fight — four arms hold it on, every arm torn off makes it slip visibly back up, and a tether toll in the score subdivides from quarters to sixteenths as it closes, so distance is audible.

## Verified

`typecheck`, `build`, `check:floor` (simulation, occlusion 0 warnings, performance, audio config, gallery) all pass. Simulated: perfect policy survives at rank B with 1 hull hit; do-nothing dies at 48s; no dead-air gaps before the intended docking quiet.

Two things I corrected only because I looked at headless stills rather than trusting the code: the tether originally read as a *horizontal* cable crossing the frame, and the sun's halo bloomed into a white ball that dominated several seconds. Both are fixed; the second became a physics detail (halo is scattering, so it dies with the air).

## Needs human eyes

**WebGPU cannot render in this environment** — everything visual above was checked through the SwiftShader WebGL snapshot fallback, which is best-effort and does not match the real frame. Nothing about the audio has been *heard*; it is verified only structurally.

A playtester should look at, in order:
1. **The cloud-deck punch at bar 8 (12s)** — glare, FOV kick, and whether the transition from storm to sunlight lands as one event.
2. **The Descender through bars 24–35** — does it read as genuinely closing, and is the arm→setback loop legible?
3. **The docking sweep at bar 38** — the camera pitches ~104° to look back down the tether at the planet. This is the one place I'd expect a problem; it's a large authored move and I could only confirm the final framing, not the motion.
4. **The mix at the two extremes** — whether the wet/dry contrast between bar 4 and bar 30 actually reads as altitude rather than as a mistake.