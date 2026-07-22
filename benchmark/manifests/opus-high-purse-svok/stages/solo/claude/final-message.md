**Purse Pursuit** (`purse-pursuit-svok`) is built — ~4,600 lines under `src/benchmark-levels/purse-pursuit-svok/`, plus the regenerated `docs/level-gallery.md`. Nothing else in the repo is touched.

## What it is

A 60-second (32 bars @ 128 BPM, exactly) night chase down a six-lane city highway. You're hanging out the passenger window: the car's sill, roof rail, A-pillar and wing mirror frame the lower-left and **lag a beat behind your head**, so the bodywork leans after you do. Amber sodium lamps strobe overhead at a rate driven by real rail speed, not a timer.

- **Four rider grammars, four silhouettes**: tucked sport bikes braiding the lane grid; raked choppers with ape-hangers arcing off the shoulder and pressing against your flank; slab-wide tourers pumping forward/back that kick spike clusters loose at close range; dirt bikes airborne off overpass abutments, rider standing on the pegs.
- **Boss**: a chromed cruiser in four bolt-on plates with the purse on a chain strap. It alternates authored *exposure windows* (lockable) with *barrages* (untargetable, drops into your lane, lobs homing satchel bombs and scatters road-nailed spike clusters). 18 locks. Kill it and the purse arcs out of the fireball, you catch it, and the frame turns blue — the only blue in the level.
- **The hook is the player's instrument**: the lead states an 8-bar topline once, in the chorus; after that the chorus kill lane *is* that contour in scale degrees, so a chained six-kill volley performs the tune. Verse/boss/payoff each get their own lane, timbre and register. Locks climb a pentatonic, one rung per blade on the rev-counter reticle.

## Verified headless

`typecheck`, `build`, `check:benchmark-scope` (22 paths, clean), `check:floor` — **all gates pass**: 7 enemy kinds, full event coverage, 0 occlusion warnings, 0 perf failures, 0 audio-config failures. Simulation: 103/105 kills / rank A under perfect play, 90/105 under seeded imperfect, no dead-air gaps, ~24 m average destruction distance. `trace:audio` confirms the arrangement structure (lead enters at 22.6 s = bar 12, snare at 41.8 s = bar 22, 128 beats).

One standing warning, not a failure: destruction concentration in the centre 0.25-NDC circle is 26.4% against a 25% advisory threshold. I pushed it down from 53% by widening lanes, shortening spawn distance and widening the weave; the residue is mostly homing bombs, which converge on the windscreen by design.

## Needs a human

WSL2 can't render WebGPU, so all stills above are the SwiftShader/WebGL fallback — the real frame and the entire mix are unverified by ear or eye. First things to check:

1. Does the cockpit's lag read as leaning out of a moving car, or as a HUD overlay pasted on the lens? (I retuned its brightness three times against the fallback renderer; absolute values may sit differently under real bloom.)
2. Is the overhead sodium strobe exciting or fatiguing at chorus speed?
3. Does the purse read instantly as the only blue thing on screen — both on the shoulder and in the catch?
4. Is a chained six-kill volley in the chorus audibly the song's hook?
5. The purse catch and the boss fanfare are the one sequence no headless tool can reach (the snapshot policy never fires), so they are entirely unseen and unheard.