# Speedsolve

One continuous boss fight against a colossal twisting-puzzle cube hanging in a pale void. Shooting it solves it: every square you destroy ratchets a layer rotation onto the next beat, every solved face sheds its tiles and bares a weakpoint, and the rail snaps 90° around the cube — face after face — until the shells blast off and the naked core bursts into a confetti storm.

## Visual language
Six saturated solve colors owned entirely by the cube; everything else stays out of their way. A softly lit pale void, white-and-grey machinery inside the corner-up cube, ink drafting-mark optics (reticle, lock brackets, letter plates built from sticker cubies), candy polyhedra hostiles with ink rims, enemy fire in the cube's own colors, and a finale of six-color confetti physics.

## Musical language
128 BPM in C major, 32 bars = exactly 60 seconds, and the cube is the percussion section: clicks, snaps, and layer ratchets quantized dead on the grid. The arrangement gains one layer per conquered face — clock, kick, hats and snap, sequencer, lead, full machine — turns minor and urgent for the core, then either resolves into music-box confetti or powers down unresolved. Locks, shots, chips, and kills are transport-quantized notes on the live chord with hidden per-section kill-melody lanes.

## Mechanical signature
A 60-second run with a 3-point hull built from six identical 4-bar face rituals: four glowing solve squares (any order advances the solve), a two-lock weakpoint under the fallen face, and a two-beat rail swing to the next face — all on fixed musical deadlines. Orbiting waves of tetrahedra, octahedra, and prisms shoot interceptable bolts throughout, and the three-stage core takes the final barrage on a hard bar-30 deadline.

## What to read
- `src/benchmark-levels/speedsolve-q7ld/structure.ts`
- `src/benchmark-levels/speedsolve-q7ld/timing.ts`
- `src/benchmark-levels/speedsolve-q7ld/gameplay.ts`
- `src/benchmark-levels/speedsolve-q7ld/audio.ts`
- `src/benchmark-levels/speedsolve-q7ld/visuals/cube.ts`
- `src/benchmark-levels/speedsolve-q7ld/visuals/index.ts`

## Status & notes
Built to the standing brief from the Speedsolve theme assignment. Verified headless: typecheck, build, check:scope, check:floor (simulation, occlusion, perf, audio config), trace:audio. WSL2 cannot render WebGPU, so the real frame and the mix need a human playtest — check first that ratchet snaps land audibly on the beat, that face fall-aways and the bar-24 shell blast feel like payoffs, and that the confetti finale resolves with the music.
