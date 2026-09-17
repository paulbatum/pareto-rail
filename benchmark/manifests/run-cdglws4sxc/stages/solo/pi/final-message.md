Everything is verified and the footprint is clean. Final state:

## Tinker Ball — `src/benchmark-levels/tinker-ball-x9a0/` (+ `public/level-content/tinker-ball-x9a0/`)

**The level (60.0s at 128 BPM, 32 bars exactly):**
- **Arc**: marble warm-up among notions (beetle waves) → tennis-ball chorus with flapping peg birds → three recycled glue-spill shells (3 stages × 2 hits each, on successive phrases at bars 22/25/28) → four-bar clean-table coda. The final core shrinks with each shell break and the spill floor dissolve matches.
- **Signature mechanic**: kills scatter real supply meshes (buttons, pencils, spools, rulers, jars, clips, beads) that fall, land on the table, and persist. The ball steers continuously toward the nearest fresh debris field while the camera stays on the authored route; landed pieces visibly stick to its rolling surface (verified: 101 pickups, radius 0.8 → 1.7). Its lopsided silhouette is the kill record.
- **Enemies**: button-beetles (hop-scuttle), pencil-striders (long lateral sway), peg-birds (flap-bobbing), spill-core boss — four kinds, distinct silhouettes and motion. Each creature is a dark adhesive core with cream eyes and a body of recognizable supplies; cores break into the very materials that then get collected.
- **Audio**: bright eccentric pop — mallet bells, clipped reed-organ stabs, triangle bass, handclaps, workshop ticks, kick. Four sections at the gameplay phrase boundaries; lock/fire/hit/kill quantize to the transport and pitch from the live chord; kills follow written per-section melody lanes; boss stage breaks duck the mix and add rising mallets; finale cadence ends on a rising C-major bell arpeggio. Trace: 972 events, no gaps.
- **Legibility with bloom at 0**: lock rings, eyes, glyphs, and reticle are all basic-material geometry; palette was verified in a bloom-off capture path.

**Verification run in this sandbox (SwiftShader, no WebGPU):**
- `npm run typecheck` ✅ · `npm run build` ✅ (bundle budget pass)
- `npm run check:floor -- --level tinker-ball-x9a0` ✅ — occlusion 0 warnings, perf gates 0 failures, audio config 0 failures, all floor items pass. One warning: destruction concentration 30.4% vs 25% center threshold (soft).
- `npm run simulate`: perfect 56/56 kills, 0 missed, 0 impossible moments; imperfect seed also 56/56; no dead air before the 51.5s coda; `playerhit` unexercised by design (no hull).
- `check:occlusion` seeded run: 0 warnings across 56 targets.
- Audio trace: 4 sections, all instruments present from the first bar; spawn trace: 56 entries, 0.9s–52.5s.
- Attract screen verified by pixel inspection after a real bug was found and fixed (dark ink glyph pixels were invisible against the cream tile in the lit scene; solved via an in-scene A/B variant test, now coral glyphs on riveted wooden tiles — confirmed readable in the final 1920×1080 attract capture).
- Showcase images produced per the content-images skill: ranked 8-frame review sheet → hero (48.8s boss shell), 4-frame unlabeled overview (3.8/26.3/41.3/48.8s), start screen — all AVIF in `public/level-content/tinker-ball-x9a0/`, wired via `level.json`.
- `check:benchmark-scope` cannot execute in this checkout: its companion `scripts/benchmark/protocol.mjs` was scrubbed from the entrant baseline (the script itself documents they "travel together in the isolated entrant checkout"). Equivalent verified manually: `git status` shows only the two allowed paths.

**Needs human WebGPU playtest:** bloom/motion-blur look and the actual mix. First things to watch: ball steering vs camera route during collection, boss-shell readability at 40–50s, and mallet-kill level vs claps/bass.