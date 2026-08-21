I have launched the gameplay review sheet snapshot generation in the background. Once completed, I'll review the frames to pick the hero and overview moments, render the final high-resolution assets, convert them to AVIF, and finalize the benchmark level.
I have launched the overview sheet generation task in the background and will wait for it to complete.
I have launched the PNG to AVIF conversion task in the background and will wait for it to complete.
# Benchmark Level: Tinker Ball (`tinker-ball-7umh`)

A benchmark rail-shooter level built according to [docs/level-brief.md](file:///tmp/pareto-rail-run-v37umhrqn6/docs/level-brief.md) and [docs/level-authoring.md](file:///tmp/pareto-rail-run-v37umhrqn6/docs/level-authoring.md) using the directory-only output contract under [`src/benchmark-levels/tinker-ball-7umh/`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/).

---

## 🎨 Creative & Mechanical Direction

### 1. Theme & Setting: The Oversized Worktable
- **World & Atmosphere**: An oversized crafter's worktable bathed in the warm amber glow of an articulated brass desk lamp (`LAMP_WARM` & `LAMP_BEAM`).
- **Surface & Landmarks**: Green self-healing cutting mat with millimeter grid lines, towering wooden ruler bridges and ramps, glass button/marble jars, giant steel shears plunged into a pink eraser block, sketchbooks, and spools of thread.
- **Debris Scatter**: Pins, beads, buttons, clips, and pencil shavings scattered along the rail.

### 2. Mechanical Signature: Scaling Tinker Ball & Craft Debris Sweep
- **Rolling Ball Avatar**: Sits ahead of the camera and dynamically rolls based on rail velocity ($d\theta = \Delta s / r$).
- **Three-Act Scale Progression**:
  1. *Act 1 (Marble scale, $r=0.38\text{m}$)*: Weaving between loose pins and button beetles.
  2. *Act 2 (Tennis-ball scale, $r=0.85\text{m} \to 1.25\text{m}$)*: Crashing past ruler ramps and striding pencil walkers.
  3. *Act 3 (Melon scale, $r=1.7\text{m} \to 2.2\text{m}$)*: Rolling through the great adhesive spill to restore the table.
- **Magnetic Debris Accumulation**: Destroying dark adhesive cores frees craft supplies (buttons, clips, pins, pencils, spools, rulers, cardboard) into physical loose scatter; as the ball sweeps through, items magnetize and attach rigidly to the ball's rotating surface.

### 3. Enemy Roster (5 Archetypes + Multi-Phase Boss)
- **Button Beetle** (`beetle`): 4-hole domed button shell with thread spool rollers and bent paperclip antennae clutching a dark glue core.
- **Paperclip Skitterer** (`skitterer`): High-speed paperclip and brass pin frame dashing across the cutting mat.
- **Pencil Walker** (`walker`, HP 2): Quadruped of sharpened yellow HB pencils with pink eraser caps and graphite tips.
- **Cardboard Snapper** (`snapper`, HP 1): Folded corrugated kraft-paper wings and wooden clothespin beak swooping down from above.
- **Paint-Pot Mortar** (`mortar`, HP 3): Orange ceramic paint pot launching lockable glue-encased hazard bead projectiles.
- **The Great Glue Spill** (Boss): 4 orbiting auxiliary glue cores with rotating ruler shields (`spill-core-1..4`, HP 2 each) protecting a massive 6 HP pulsating central adhesive heart (`spill-heart`).

### 4. Audio Score & Sound Synthesis
- **Tempo & Structure**: 128 BPM bright pop score over 32 bars (exact 60.00s playable run).
- **Harmony**: Uplifting C major progression (`Cmaj7 → G6/B → Am7 → Fmaj7`), transitioning to tense boss harmony (`Dm7 → G7 → Em7 → A7`) and resolving cleanly on bar 30.
- **Instruments**: Synthesized bouncy rubber bass, clipped reed-organ stabs, celesta/mallet arpeggios, punchy kicks, handclaps, 16th hats, and workshop woodblocks.
- **Gameplay Feedback**: Glockenspiel lock pings, ruler twang/snap fire zaps, woodblock hit clicks, and 3-act melodic marimba kill lanes.

---

## 📁 File Manifest

- [`src/benchmark-levels/tinker-ball-7umh/level.json`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/level.json): Identity descriptor and content image paths.
- [`src/benchmark-levels/tinker-ball-7umh/level.md`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/level.md): Complete level identity card and architecture documentation.
- [`src/benchmark-levels/tinker-ball-7umh/timing.ts`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/timing.ts): 128 BPM tempo constants, sections, bars, and steps.
- [`src/benchmark-levels/tinker-ball-7umh/gameplay.ts`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/gameplay.ts): 3D rail geometry, speed profile, spawn timeline, enemy AI motion, and scoring.
- [`src/benchmark-levels/tinker-ball-7umh/audio-voices.ts`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/audio-voices.ts): Synthesized voice definitions.
- [`src/benchmark-levels/tinker-ball-7umh/audio.ts`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/audio.ts): Beat audio arrangement, melodic kill lanes, and audio trace harness.
- [`src/benchmark-levels/tinker-ball-7umh/visuals/index.ts`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/visuals/index.ts): Visual manager, enemy mesh factory, and camera feel bindings.
- [`src/benchmark-levels/tinker-ball-7umh/visuals/palette.ts`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/visuals/palette.ts): Color palettes (table wood, craft supplies, dark glue, lighting).
- [`src/benchmark-levels/tinker-ball-7umh/visuals/letters.ts`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/visuals/letters.ts): 3D wooden craft alphabet blocks for START! / REPLAY glyphs.
- [`src/benchmark-levels/tinker-ball-7umh/visuals/player-ball.ts`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/visuals/player-ball.ts): Rolling Tinker Ball avatar, scaling logic, and magnetic debris collection system.
- [`src/benchmark-levels/tinker-ball-7umh/visuals/table-environment.ts`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/visuals/table-environment.ts): Procedural tabletop, desk lamp, cutting mat, props, and rail scatter.
- [`src/benchmark-levels/tinker-ball-7umh/visuals/enemies.ts`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/visuals/enemies.ts): Procedural 3D enemy models.
- [`src/benchmark-levels/tinker-ball-7umh/visuals/effects.ts`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/visuals/effects.ts): Woodchip particles, golden shockwaves, brass reticle ($r = 0.085$ NDC), needle-pin projectiles.
- [`src/benchmark-levels/tinker-ball-7umh/visuals/post-fx.ts`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/visuals/post-fx.ts): TSL post-processing with amber hit flashes.
- [`src/benchmark-levels/tinker-ball-7umh/index.ts`](file:///tmp/pareto-rail-run-v37umhrqn6/src/benchmark-levels/tinker-ball-7umh/index.ts): LevelDefinition export and runtime loop.
- **Showcase Images** ([`public/level-content/tinker-ball-7umh/`](file:///tmp/pareto-rail-run-v37umhrqn6/public/level-content/tinker-ball-7umh/)):
  - `hero.avif` (1920×1080)
  - `overview.avif` (960×540 4-frame grid)
  - `start.avif` (1920×1080 attract screen)

---

## 🔍 Verification & Gate Results

- `npm run typecheck`: **0 errors**
- `npm run build`: **Passed** (bundle within limits, dynamic benchmark entrant registered)
- `npm run check:floor -- --level tinker-ball-7umh`: **Passed with 0 warnings & 0 failures**
  - Target occlusion warnings: `0`
  - Performance gate failures: `0` (peak 129 draw calls vs 500 limit, peak 272 objects vs 5,000 limit)
  - Audio configuration failures: `0`
  - Spawn centerness/distance warnings: `0`
  - Reticle visual warnings: `0`
  - Start/replay word warnings: `0`
- `npm run simulate -- --level tinker-ball-7umh --heatmap`: **Passed** (49/49 kills, 0 misses, S-rank on perfect run; 0 impossible moments, peak pressure 5)
- `npm run trace:audio -- --level tinker-ball-7umh`: **Passed** (1436 musical events across all sections)
