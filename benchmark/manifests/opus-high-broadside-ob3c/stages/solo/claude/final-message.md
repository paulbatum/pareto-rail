**Broadside** is built at `src/benchmark-levels/broadside-ob3c/` — 112 BPM, 28 bars, exactly 60.000 seconds.

## What I built

**The central technical idea:** capital ships aren't placed in world space, they're **ribbons lofted along the rail**. A station table says where each hull's centreline sits in the rail's own frame at each bar, so a hull is exactly as close as authored regardless of what the flight path does, and the flagship's dorsal trench is guaranteed to contain the rail. A `corridorAt()` table — the negative of those hulls — fits every enemy into free space before placing it, which is also the level's shape: open in the crossfire, squeezed to port along the friendly cruiser, flattened under the enemy warship, squeezed to starboard down the flagship's flank, boxed in on all four sides in her trench.

**Arc:** catapult → gauntlet → flank run under a firing broadside → the belly (near-silence) → five shield generators → fighters → trench → pull-out. Eight enemy kinds, 4-point hull, `validateRelease` rule named for the level: capital armour needs three locks, but small targets in the same release still fire.

**Audio:** synthetic orchestra (timpani, contrabass, four brass colors, bowed/spiccato strings, celesta, choir), D minor throughout, leaving minor exactly once when the flagship breaks. Kills play the section's hidden melody lane from the live chord in that section's brass voice.

## Verified headless
`typecheck`, `build`, `check:benchmark-scope` (16 paths), `check:floor` — **all green with zero warnings**, including target occlusion (0), performance gates (0 failures), and spawn distance/centerness (0 warnings). Simulation: perfect 109/119, imperfect 72/119 surviving on 1 hull, full event coverage, no dead air.

## Things worth knowing about the process
Three real bugs surfaced only from the tools, and I'd have shipped all three blind:

1. **The camera far plane is 500.** My nebula dome at 6000 and cloud banks at 2400–3900 were being clipped into hard-edged polygon fragments — the "sky" was garbage geometry, not a nebula. Rescaling the whole sky layer inside the clip plane fixed the level's entire art direction at once.
2. **Enemy meshes were never disposed** — geometry count grew 10.6× over a run and failed the perf gate.
3. **Hostile bolts at skyhook-like speeds simply never arrived**; at 30–45 u/s the camera overtakes them. They needed ~4× the speed, and then a lower fire rate so an average run survives.

## What still needs human eyes
I can't render WebGPU here — the snapshots are SwiftShader fallback, and **I have not heard the audio at all**. The arrangement's shape is verified (I probed it with a stubbed audio context: voices-per-bar climbs 17 → 136 and collapses to 2 in the eye of the battle), but balance, timbre, and whether the brass actually sounds like brass are unverified. Check first: hull-scale contrast (vast/slow vs quick/small), bloom-zero legibility, the bar-12 drop to silence, and whether the bar-27 pull-out lands.