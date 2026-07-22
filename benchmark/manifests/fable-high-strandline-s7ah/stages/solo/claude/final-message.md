**Strandline is complete** — a 60-second (24 bars at 96 BPM, exactly 60.0s) benchmark level at `src/benchmark-levels/strandline-s7ah/`, built to the theme: freeing a gigantic jellyfish from a parasite infestation, ending with the earned pull-back of the whole animal glowing clean.

## What was verified in this environment

- `npm run typecheck`, `npm run build`, `npm run check:benchmark-scope -- --base HEAD` — all pass (16 paths, gallery regenerated).
- `npm run check:floor` — **all gates pass**: 0 occlusion warnings, 0 perf gate failures, audio config valid, full event coverage, no unintended dead-air. One soft warning remains (26.7% center kill concentration vs 25% threshold) — inherent to the centered crown finale, not a failure.
- Simulation: perfect policy scores 12,435, rank A, kills the Matriarch and all 9 broods; imperfect rank A; the no-fire policy dies to venom at 54s. The only quiet stretch (53.5–59.5s) is the post-severance calm by design.
- `trace:audio` confirms the arrangement: heartbeat from bar 0, kit arriving at bar 4, the reveal gong at 29.4s, crown dread at 42.6s, resolution chime at 59.1s.
- SwiftShader snapshots confirm the two signature moments read on screen: the bell fills the frame at ~29.5s, and the boss fight sits framed upper-center from bar 18.

## Design highlights

- **Geometry-driven set pieces.** A spiral rail can never look at its own axis, so the reveal is a *radial strafe* — the rail swings wide, then flies straight at the animal while climbing, and the bell rises over the strand horizon on a struck glass gong — and the crown fight is one long straight ascent that keeps the Matriarch steady in frame for five bars. I verified both numerically (per-bar pitch/yaw vs. target elevation) before trusting snapshots.
- **Boss without sim deadlocks.** The Matriarch is lockable from spawn but *sheds* volleys (crystal-warden `validateRelease` pattern, with `shielded` flares and a rubbery deny sound) until both brood waves die and its web starves — then two 3-hit stages with a convulsing flinch.
- **The cleanse dial**: kills, brood clears, and the severance progressively turn the colony from sick teal to green-gold — strands, bell, nodules, post-grade, and the music (heartbeat + water bed that clears; kill-lane melodies per section; D dorian resolving to D major).
- Perf discipline: merged strand groups with baked vertex tints, merged bell ribs/web/boss shells, instanced camera-wrapped snow/bubbles, and level-owned disposal of enemy/projectile geometry.

## What still needs human eyes (WSL2 can't render WebGPU)

1. The strafe + gong bell reveal at ~bar 11.75 — does it land as one held-breath moment at speed?
2. Bloom-at-zero legibility of violet parasites against the teal forest, and the reticle/letters.
3. The final mix — especially heartbeat/kick balance and whether the post-kill pull-back plus major-key peal resolves as serenely as intended.