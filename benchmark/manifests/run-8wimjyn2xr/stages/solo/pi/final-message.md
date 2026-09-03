All gates pass. Handoff summary:

## Vespers (`vespers-dade`) — complete

**Run:** 60.0s at 84 BPM (21 bars), fully inside the 55–65s window. `typecheck`, `build`, and `check:floor` all pass ("All floor checks passed", full event coverage, 0 occlusion/perf/audio failures).

**What was built** (touches only `src/benchmark-levels/vespers-dade/` + `public/level-content/vespers-dade/`, confirmed via `git status`):
- **World** — black nave: merged-draw-call piers/arcades/galleries/vault ribs, candle sea, 28 stained-glass lancets (cobalt/red/green/gold), dead rose wheel at the west end. Every kill relights one dead window in the victim's stolen color for the rest of the run; killing the Eater ignites the whole rose at once.
- **Enemies** — moths (drift), gargoyles (lunge + fire homing cinders, 3-point hull), thuribles (pendulum swing), 4 orbiting rose petals (`hitStages [1,1]`, so `stage` events fire), 6-HP Eater core (`hitStages [2,2,2]`). Flat black bodies with burning chest gems + dim jewel edge-work so silhouettes read on black.
- **Music** — the building's organ, zero percussion: lone D pedal, then flute/principal/choir entering voice-by-voice over a 21-bar D-minor→D-major progression; dark span drops to one voice (bars 12–15, 3 lone targets); finale opens every rank + bell peal in D major. Locks/fire/kills are transport-quantized organ voices pitched from live harmony; chained kills ring a held-back bell rank; 6 per-section kill lanes.
- **Gallery** — `hero.avif` (Eater looming), `overview.avif` (4-frame arc), `start.avif` (gold START in the nave), wired through `level.json contentImages`; build generated the social hero JPEG.

**Bugs found & fixed along the way:** `section()` double-counting absolute times (spawns ran to 101s); score `leadSet` missing for custom chord shape; 854 draw calls (merged statics + enemies → under budget); targets spawning inside piers (widened nave, capped offsets); linear→sRGB washing blacks grey (crushed stone palette); invisible enemy bodies (edge-work + lifted black).

**What still needs human eyes (no WebGPU here):**
- Real playtest of mix balance (organ vs. kill-lane audibility), rose-ignition impact, boss readability at full bloom.
- `check:benchmark-scope` tool itself is broken in this checkout (`ERR_MODULE_NOT_FOUND scripts/benchmark/protocol.mjs`, pre-existing) — scope verified manually instead.
- Two warnings-only items: destruction centerness 28% vs 25% (heatmap looks well spread), and START-screen capture at t=0 renders black headless (identical for crystal-corridor; t=0.8 capture works and is used for `start.avif`).