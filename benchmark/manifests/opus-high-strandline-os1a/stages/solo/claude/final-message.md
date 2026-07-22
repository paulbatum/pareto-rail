**Strandline** is built — `src/benchmark-levels/strandline-os1a/`, ~4,600 lines across a timing/gameplay/crown/audio spine with visual and voice leaves.

## The level

96 BPM, 24 bars, exactly 60.0 seconds. Six sections: strands → openwater → thicket → rise → crown → adrift.

**The two wide swings are structural, not decorative.** The strand forest is anchored to the *un-banked centreline* while the rail banks away from it, so swinging wide genuinely leaves the thicket behind and opens the bell. Both banks are placed by musical bar, not by eye — whatever the speed profile does, the lift lands where the arrangement opens.

**Enemies** (six kinds, three grammars): clings ride strands, shiver a telegraph, then let go and swim at frame centre; larvae cross in chain-articulated undulating schools; spitters creep one strand and lob interceptable spores.

**The boss puts its own health bar somewhere else on the screen.** The parent is untargetable behind three webbing panels, each fed by a brood it extrudes on a violet umbilical. Kill a brood → starve a panel. Clear all three → it rears out of the socket for six locks. Leave one and it cannot be killed at all.

**Musically**, the bell contraction *is* the kick — a swell-then-body on half notes, and the environment squeezes the bell mesh on the same grid, so the metronome you hear and the one you see are the same organ. D minor throughout; the crown drags it flat with a detuned tritone groan; the last two bars are the level's first D major.

## Verified headless

`typecheck`, `build`, `check:benchmark-scope` (16 paths, clean), and `check:floor` — all pass: 6 enemy kinds, full event coverage, **0 occlusion warnings**, 0 perf gate failures, 0 centerness/distance warnings.

Three things I found and fixed by measurement, not by eye:
- A geometry leak (4.08× growth) — every enemy was allocating fresh geometries. Now cached per kind and merged by material.
- Severe overexposure — the first contact sheet was a green-white haze at 0.71 luminance. Rebalanced to ~0.42.
- **The hull system was inert.** Spores maxed at 12 u/s against a camera doing ~16, so they were always overtaken and `playerhit` never fired across any policy. Now 2 hits if you ignore them, 1 if you play well.

## Needs human eyes

WSL2 can't render WebGPU, so all stills above are SwiftShader fallback — the real frame and the entire mix are unverified. Check first:
1. Whether both banks read as *leaving* the forest.
2. Whether the bell's contraction lands audibly on the beat.
3. Parasite legibility against green water **with bloom at zero** — I leaned hard on additive materials for the occlusion win, so this is the riskiest thing I can't confirm.
4. Whether the bar-22 pull-back frames the whole animal. The headless stills suggest yes, and it's the shot the level is built around.

One honest caveat: the simulator's `perfect` policy only ever locks a target once, so it never kills multi-HP enemies efficiently and finishes at rank B with one panel alive. The `imperfect` policy does clear the parent, which is what tells me the fight is winnable — but a human should confirm the crown act isn't too tight.