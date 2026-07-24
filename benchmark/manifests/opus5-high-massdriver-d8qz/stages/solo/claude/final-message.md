**Mass Driver** is built at `src/benchmark-levels/mass-driver-d8qz/` — directory plus the regenerated `docs/level-gallery.md`, nothing else touched.

## The idea it's built on

One accelerator ring is placed at the rail position the camera occupies on each beat (121 rings, beats 0–120). That single fact does the theme's work for free: the speed profile alone makes the rings spread apart as the payload accelerates while the pulse never changes, and the kick that fires on every beat for all sixty seconds *is* the ring pass. Ring heat ramps arc blue → violet → blinding white along the barrel; under it a single continuous rail hum glides A0 → A1 → A2 → A3 and becomes the muzzle scream.

**Structure** (128 BPM, 32 bars = 60.000 s): breech → cold barrel → drive → arc phase → interlock fault (bar 20) → charge → the peak at bar 28 → muzzle at bar 30 → 3.75 s of silent open space.

**Boss:** six two-stage safety interlocks station-keep as a slow-turning wheel 34 units ahead. Clear them before bar 28 and the gun fires (white flash, runaway roll, muzzle exit into stars). Miss one and it calls `damagePlayer(9)` — a fault-red rupture and a forced `—` rank.

**Bore geometry as a design rule:** every ring, coil and wall panel lives outside radius 23; every target lives inside 12.6, and drones/sentries are dragged toward the axis as they close. That's why a solid tunnel produces zero occlusion warnings, and why targets stay in frame for their whole authored window.

## Verified headless
- `typecheck`, `build`, `check:floor` — all pass (5 spawned kinds, no missing event coverage, 0 occlusion warnings, 0 perf gate failures, 0 centerness/distance warnings).
- `simulate`: perfect 98/98 rank S, imperfect 61/98 rank A, no-fire dies at 52.5 s as designed. Kills average 29.9 m out and land on a ring around the frame, not in the middle.
- `simulate --engagement`: 92/92 lead contracts pass.
- Audio trace via the harness: 8 sections on the right bars, 128 beats, 120 kicks at exactly one beat apart, one-shots on their markers.
- Gameplay and model snapshots (SwiftShader) used to tune brightness down from a genuine whiteout at 40–55 s, and to fix an interlock whose rim light was mounted on the wrong side of its clamp.

## Needs human eyes
This box can't render WebGPU, so nothing about the actual frame or the mix is confirmed. First things to look at: whether the ring flash reads as "you passed through that one" at 128 BPM (the audio transport can start up to one 16th late relative to run start, so audio/ring sync drifts ≤117 ms); whether bars 44–55 are still too hot on real bloom; the mix balance between the climbing hum, the four-on-the-floor and the kill-lane melody; and the successful launch at bar 28, which is unreachable headlessly because the snapshot player never fires.

Two notes on scope: `check:scope` hard-codes `src/levels/<id>/` and so reports this level's own files as out-of-scope — it doesn't know the benchmark directory contract; the actual boundary (my directory + the gallery) holds. `trace:spawns` and `trace:audio` are likewise restricted to built-in levels, so I ran the audio trace harness directly instead.