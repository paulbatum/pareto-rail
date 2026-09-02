I have initiated `npm run typecheck` in the background to verify the baseline build and will proceed with developing the Strandline benchmark level once it confirms a clean typecheck.
I have launched the eight-frame review sheet generation via `npm run snapshot:gameplay` in the background and will inspect the candidate timestamps once rendered.
I'll wait for the eight-frame review sheet capture to finish rendering.
I will await the final frames of the review sheet.
I have set a timer waiting on task-240 and will process the review sheet upon completion.
I have launched the four-frame overview sheet generation in the background and will proceed once it finishes.
# Benchmark Level Complete: Strandline (`strandline-u5oa`)

A complete benchmark level has been created for **Strandline** (`src/benchmark-levels/strandline-u5oa/`), strictly following the directory-only output contract, the assigned theme, `docs/level-brief.md`, and `docs/level-authoring.md`.

---

## 1. Level Architecture & Implementation

### A. Assigned Theme & Dramatic Arc
- **The World**: Clear sunlit aquamarine/cyan waters shading into deep abyssal blue with distance. Above, ethereal sun shafts stream through the water; surrounding the rail is an expansive forest of 52 undulating bioluminescent tentacles trailing backwards from the colossal **Titan Medusa**.
- **The Infestation**: Sickly bruised purple carapaces, toxic magenta fins, and necrotic violet cores mark the infesting parasites.
- **The Journey (30 bars @ 120 BPM = exactly 60.0 seconds)**:
  1. **Descent (Bars 0–6, 0.0s–12.0s)**: Ambient oceanic sub-pulse, descending past outer tentacles; clamped polyp parasites (`clasper`) unclamp and corkscrew toward the reticle.
  2. **Strand Forest (Bars 6–14, 12.0s–28.0s)**: Dense tentacle grove; four-on-the-floor sub-kick and shimmering bell arpeggios kick in; serpentine leeches (`skimmer`) dash in sinuous undulating waves across the screen.
  3. **The Wide Swell (Bars 14–20, 28.0s–40.0s)**: The rail banks wide outside the strand curtain. For several breathtaking seconds, the colossal bell fills the view like a radiant green-gold moon while floating brood pods (`spore_sac`) lob interceptable homing spore stingers (`spore_bolt`).
  4. **The Crown & Parent Organism (Bars 20–26, 40.0s–52.0s)**: Rail dives toward the crown junction under the bell. The grotesque Parent Organism queen defends herself behind a pulsating toxic web lattice, spawning broods. Purging the broods collapses the lattice, exposing the queen's core for the final volley.
  5. **Purification & Drift (Bars 26–30, 52.0s–60.0s)**: The boss disintegrates with a harmonic bloom. The music ducks and resolves into a serene D-major choral wash; the camera smoothly pulls back across 48 meters to bring the entire, clean glowing animal into frame as it drifts forward peacefully into the deep ocean.

### B. Enemy Lineup (5 distinct hostile kinds)
1. [`clasper`](file:///tmp/pareto-rail-run-rghm80o45h/src/benchmark-levels/strandline-u5oa/visuals/enemies.ts): Parasitic polyp clamped to tentacles; unspools with 6 flared leg-claws and a glowing core, spiraling outward.
2. [`skimmer`](file:///tmp/pareto-rail-run-rghm80o45h/src/benchmark-levels/strandline-u5oa/visuals/enemies.ts): Elongated serpentine leech with lateral barbed fins and twin pincer claws, executing wide left-to-right and right-to-left wave sweeps.
3. [`spore_sac`](file:///tmp/pareto-rail-run-rghm80o45h/src/benchmark-levels/strandline-u5oa/visuals/enemies.ts): Floating brood pod cluster that bobs buoyantly and launches lockable hostile homing stingers.
4. [`spore_bolt`](file:///tmp/pareto-rail-run-rghm80o45h/src/benchmark-levels/strandline-u5oa/visuals/enemies.ts): Interceptable homing projectile (`countsTowardTotal: false`, 1 HP) using `steerHomingShot` and `updateHostileShotImpact`.
5. [`parent`](file:///tmp/pareto-rail-run-rghm80o45h/src/benchmark-levels/strandline-u5oa/visuals/enemies.ts): Queen boss rooted at the crown with 4 mandibles and a 2-stage health bar (`hitStages: [4, 4]`).

### C. Procedural Web Audio & Musical Action Integration
- Authored via [`audio.ts`](file:///tmp/pareto-rail-run-rghm80o45h/src/benchmark-levels/strandline-u5oa/audio.ts) and [`audio-voices.ts`](file:///tmp/pareto-rail-run-rghm80o45h/src/benchmark-levels/strandline-u5oa/audio-voices.ts) using `createBeatLevelAudio` and `createScore`.
- Live harmony in D minor transitioning through expansive modal chords into a pure D-major/Lydian resolution.
- Rez-style melodic kill lanes: each section features a dedicated 32-step kill lane note sequence. Every kill triggers a note from the live chord lead set so volleys perform melodic solo runs over the backing track.
- Quantized actions: player locks, fires, hits, and reject SFX snap to transport and live chord roots.

---

## 2. Verification & Automated Gates Summary

| Verification Gate | Command | Result | Notes |
| :--- | :--- | :--- | :--- |
| **Typecheck** | `npm run typecheck` | **PASS (0 errors)** | Strict TypeScript throughout |
| **Vite Production Build** | `npm run build` | **PASS (0 errors)** | Built in 652ms |
| **Floor Readiness Gate** | `npm run check:floor -- --level strandline-u5oa` | **ACCEPT** | 0 occlusion warnings, 0 perf failures, 0 audio failures, 0 centerness warnings |
| **Benchmark Scope Gate** | `npm run check:benchmark-scope -- --level strandline-u5oa --base bce6a97aa046c8b675661966f55da2ff218ee30d` | **PASS** | Exactly 17 owned/permitted paths in scope |
| **Gameplay Simulation** | `npm run simulate -- --level strandline-u5oa --heatmap` | **PASS** | 52/52 kills (100%), 0 impossible moments, avg distance 32.2m (limit 60m) |

---

## 3. Public Showcase Assets Created

Generated via the `level-content-images` workflow into [`public/level-content/strandline-u5oa/`](file:///tmp/pareto-rail-run-rghm80o45h/public/level-content/strandline-u5oa/):
- `hero.png`: Full-resolution 1920x1080 capture of the wide swell at 33.8s, showing the colossal bell glowing like an emerald moon, sun shafts, trailing tentacles, and parasites.
- `start.png`: 1920x1080 capture of attract mode at 0.8s featuring "START!" in glowing marine plankton glyphs within the strand forest.
- `overview.png`: 4-quadrant panel capturing the run's narrative arc (Descent -> Forest Weave -> Wide Bell Swell -> Crown Boss Confrontation).
- `docs/level-gallery.md`: Regenerated via `npm run gallery` with the filled-in [`level.md`](file:///tmp/pareto-rail-run-rghm80o45h/src/benchmark-levels/strandline-u5oa/level.md) and asset references.

---

## 4. Human Playtester Guidance

Because WSL2 headless environments run on SwiftShader software rasterization, final visual feel and audio mixing should be verified in a real WebGPU-capable browser:
1. Launch `npm run dev` and navigate to `http://localhost:5173/?level=strandline-u5oa`.
2. **Audio Mix**: Listen to how chained volleys perform melodic runs over the live chord progression, and confirm the breath/ducking when the boss core is destroyed before the serene D-major outro begins.
3. **Wide Swell Set Piece**: At 28–34s, observe the camera banking wide outside the tentacle curtain to reveal the bell filling the screen like a green moon.
4. **Boss Encounter & Finale**: Check the confrontation at the crown (40–52s) and the smooth camera pull-back (52–60s) revealing the cleansed creature drifting forward.
