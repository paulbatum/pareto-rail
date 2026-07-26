**Tinker Ball** is complete at `src/benchmark-levels/tinker-ball-nirz/` — 16 files, ~4.4k lines, nothing outside the assigned directory.

## What it is

A 60-second run (33 bars at 132 BPM, ending on a clean bar of coast) across one oversized worktable. You are a marble; scratches in the wood are the road. Glue monsters wear bodies of stolen supplies around visible black adhesive cores; shooting a core scatters its pieces onto the table ahead, loose pieces crawl into the lane you're following, and the ball welds them to its surface for the rest of the run. Three scales — marble, tennis ball, melon — carried by the rail climbing, the speed profile accelerating, and the clutter tier changing from buttons and pins to spools and erasers to jars and pencil cups.

**Signature systems**
- `visuals/pieces.ts` — the kill→scatter→herd→stick loop, all instanced (6 draw calls for a whole run's cargo). Stuck pieces keep their world size as the ball grows.
- `gameplay.ts` — waves authored in screen fractions, converted to world offsets at build time from the level's own speed profile and rail length, so composition holds as the camera climbs and speeds up. Ground creatures are seated against the *table*, not the rail, so the horizon sinks through the frame as you grow.
- `spill.ts` — the boss: three crusts over three cores over a heart. Nothing is ever unlockable; a premature release flashes whatever still protects the target and glazes the heart over for a beat. The bare heart only breaks under a volley carrying every lock it can hold.
- `audio.ts` — bright workshop pop; kills read a hidden 32-step melody lane off the transport grid, locks climb a pentatonic, and each kill schedules a *pickup rattle* ~2.6 s later for when its pieces actually reach the ball.

## Verified
`typecheck`, `build`, `check:floor` (all gates pass; occlusion worst case 1.0%, all perf gates green), `check:occlusion`, `check:perf`, `simulate` across all four policies with full event coverage (perfect 63/76 rank A, imperfect ~55/76 rank A across seeds 1–3, no dead-air gaps), and `trace:audio`. The pick-up loop was exercised with a scratch driver since no headless tool both drives kills and renders — every non-stray piece welds on.

## Two real bugs found and fixed during the pass
- Scattered clutter and shadow bands were placed at *rail* height, not on the table (`scatterAlongRail` positions relative to the rail point, which climbs).
- `MultiplyBlending` ignores `opacity` — black shadow quads multiplied the frame to zero, and stacked ones cut a hole through the table.

## Needs human eyes
Never rendered under WebGPU (headless Chrome here falls back to SwiftShader). A playtester should check the ball's framing along the bottom of the frame, black glue cores against dark wood with the bloom slider at zero, whether the accumulated cargo reads as recognisable supplies rather than confetti, and whether the spill fight reads as three layers of armour. Audio has only been verified structurally via the semantic trace, never listened to.