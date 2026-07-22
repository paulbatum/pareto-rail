Done. The level is complete, committed, and passing every gate.

## What I built

`src/benchmark-levels/mass-driver-detailed-om6f/` — a 60-second ride down an orbital railgun at 128 BPM, built entirely on `createLockOnRunner`.

**The load-bearing idea:** ring *k* is placed at `railProgress(k × beatSeconds)` — the same authored speed curve the camera flies. Crossings land on the beat by construction, not by tuning, and the visual crossing pulse is nudged onto the audible transport by measuring drift from `beat` events.

- `timing.ts` — one BPM constant, the section map, the accelerating speed profile (with the ~3× surge straddling bar 28), and the derived muzzle/ring/charge functions everything else reads.
- `gameplay.ts` — rail, spawn choreography, five enemy motion grammars, the six-interlock deadline boss, scoring and rank.
- `audio.ts` / `audio-voices.ts` — E-minor arrangement in five sections (Em–Em–C–D, boss bars on ♭II, muzzle resolving to E major), the persistent climbing hum as one long-lived voice, and player instruments quantized to the transport with per-section timbre crossfades and hidden kill-melody lanes.
- `visuals/` — palette, one tint pass driving every enemy state, ring/rail/wall/streak/starfield environment, electrical effects with jagged arc-lightning polylines, stencil-plate letters, six-segment charge-gauge reticle.
- `post-fx.ts` — three TSL overlays (flash, charge, detonation).

## Verified

`typecheck`, `build`, `check:benchmark-scope` (16 paths, no leakage), and `check:floor` all pass with **zero warnings** — occlusion 0, perf 0, audio config 0, spawn centerness/distance 0. Duration is exactly 60.0 s. Simulation: perfect policy 59/66 kills → rank A; no-fire policy dies at 52.52 s (the detonation deadline fires correctly). `trace:audio` shows the expected structure — klaxon at bar 20, snare roll at bar 27, `humCut` at 52.6 s, sparkle tail after.

## What still needs human eyes

WSL2 can't render WebGPU headless, so I inspected via the SwiftShader fallback only. I dialed ring energy down substantially after the first snapshot sheet showed the breech washing out — that judgement was made on a fallback renderer and should be re-checked under real WebGPU with the bloom slider at both extremes.

Check first: whether ring crossings *feel* beat-locked; whether the bar-28 shot lands as the biggest moment; and whether the six interlocks stay legible against the charge glow in the last bar and a half.

One deliberate trade-off worth knowing: the engagement report flags short windows for wall-riding coils. That's geometric — a target at the bore rim leaves the lock frustum in the last quarter of its approach, and being overtaken there *is* its exit. Widening the window enough to satisfy the contract would have pushed engagement distance past the floor gate. I noted this in `level.md` rather than hiding it.