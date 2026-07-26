I have built and verified the complete benchmark level **Tinker Ball** (`tinker-ball-xa2f`) according to all instructions in `AGENTS.md`, `docs/level-brief.md`, and `docs/level-authoring.md`.

### Implementation Summary

- **Level Identity & Directory Contract**:
  - Module location: [src/benchmark-levels/tinker-ball-xa2f/](file:///tmp/pareto-rail-run-v3xa2fxuvx/src/benchmark-levels/tinker-ball-xa2f/)
  - Descriptor: [level.json](file:///tmp/pareto-rail-run-v3xa2fxuvx/src/benchmark-levels/tinker-ball-xa2f/level.json) (`id: "tinker-ball-xa2f"`, `title: "Tinker Ball"`)
  - `src/levels/index.ts` was left untouched in accordance with the benchmark directory-only contract.

- **World & Visual Environment**:
  - Oversized wooden worktable with a dark-green cutting mat, grid lines, scratch marks, and scattered stationery clutter (pencil holder, erasers, paper clips, thimbles).
  - Warm desk-lamp lighting with golden spotlighting and ambient warmth.
  - **Rolling Ball & Debris Pickup**: The player controls a rolling ball that scales across three acts (Marble $\rightarrow$ Tennis Ball $\rightarrow$ Melon). Defeated glue monsters scatter clean supplies (buttons, pins, spools, erasers, rulers) on the table floor; as the rolling ball passes through debris fields, loose supplies physically cling to its surface.
  - **Procedural Enemy Meshes**:
    - `beetle`: Button shield back, thread spool body, pin peg legs.
    - `bird`: Cardboard wings, clothespin beak, dark glue core center.
    - `walker`: Ruler/pencil quadruped tripod with glue core joint.
    - `spillcore`: Central glue spill boss with dark core and orbiting ruler armor plates.
    - `glueblob`: Homing adhesive projectile.
  - **Glyphs & Reticle**: Distinct 5x7 button/pin block meshes for `START!` and `REPLAY`. Reticle visual size precisely matches `lockRadiusNdc` (0.085 NDC).

- **Audio & Score**:
  - Bright, eccentric pop soundtrack composed at 128 BPM across 32 bars (60.0s total duration).
  - Four-bar pop chord progression ($C\text{maj7} - F\text{maj7} - A\text{m7} - G7$).
  - Synthesized instruments: bell-like mallet marimba/glockenspiel leads, clipped reed-organ stabs, bouncy synth bass, and workshop percussion (ticks, wood taps, handclaps).
  - Melodic kill lanes quantize player volleys to scale notes from the active chord, turning chained kills into melodic solos.

### Empirical Verification

1. **Typecheck**: `npm run typecheck` passed clean (0 errors).
2. **Production Build**: `npm run build` passed clean (benchmark entrant auto-discovered and bundled into `dist/assets/tinker-ball-xa2f-*.js`).
3. **Floor Readiness Gate**: `npm run check:floor -- --level tinker-ball-xa2f` passed all checks:
   - 0 target occlusion warnings
   - 0 performance gate failures
   - 0 audio configuration failures
   - 0 spawn centerness/distance warnings
   - 0 reticle warnings
   - 0 start/replay word warnings
4. **Gameplay Simulation**: `npm run simulate -- --level tinker-ball-xa2f` verified 60.0s run length, 5 spawned enemy kinds, 0 impossible moments, and S-rank perfection.
5. **Audio & Spawn Traces**: Both `trace:audio` and `trace:spawns` completed successfully.
