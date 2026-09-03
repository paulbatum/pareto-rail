Tinker Ball is complete under `src/benchmark-levels/tinker-ball-3ioa/`, with gallery images under `public/level-content/tinker-ball-3ioa/`. Nothing else in the repo was touched.

**What was built**

- A 60.0 s run (32 bars at 128 BPM) across one worktable: marble (bars 0–7), tennis ball (8–15), melon (16–20), the Spill boss (21–29), spotless coast (30–31). The camera height and ball radius follow one profile, so the same table shrinks around you while clutter and enemies are built bigger per act.
- Three glue creatures with distinct silhouettes and motion: button-and-spool beetles that scuttle in zigzags, pencil- or ruler-legged striders that trot in on stilts, and cardboard-winged snappers that swoop and spit lockable glue globs at a 3-point "shine" hull. Creatures assemble for 0.75 s before they can be locked.
- Kills drop every body part as a physics piece that arcs onto the road ahead, bounces, and sticks to the rolling ball, which swerves toward debris. Pieces render through one instanced mesh per supply type with per-instance tints.
- The Spill raises three shelled cores one at a time from a spreading black puddle; each broken shell showers the road, and the heart's death snaps the puddle away and reveals a clean patch the ball rolls through.
- Score: bell mallets, clipped reed-organ stabs, bouncy synth bass, handclaps, and workshop percussion in D major, turning minor for the Spill and resolving to D. Locks, kills, boss chips, and every piece that sticks are quantized, harmony-aware notes.

**Verified**

- `npm run typecheck`, `npm run build`, and `npm run check:floor -- --level tinker-ball-3ioa` pass (occlusion, perf, audio config, spread, reticle all clean).
- Simulation: perfect policy reaches rank S with the Spill snapped, imperfect reaches A, no dead-air gaps, every gameplay event fires.
- Audio trace confirms sections, beats, and instruments across all 32 bars.
- Snapshots were reviewed across the whole run, the attract screen, and the boss.

**Not verifiable here**

- `npm run check:benchmark-scope` cannot run in this checkout because `scripts/benchmark/protocol.mjs` is absent. `git status` shows only the two allowed directories as changed.
- Headless WebGPU is unavailable, so lighting balance, bloom, and the audio mix were tuned from SwiftShader snapshots and traces. A human WebGPU playtest should look first at lamp glare behind the START word, glue darkness versus the warm wood, boss-core readability among the shells, and the mix level of the piece-sticking percussion.