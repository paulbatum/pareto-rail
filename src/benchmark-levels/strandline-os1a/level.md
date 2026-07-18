# Strandline

Sixty seconds inside the trailing tentacles of an animal the size of a weather system. You fly the rail through a forest of glowing strands in sunlit water, cutting a violet infestation off a jellyfish far too big to see all at once — until, twice, the rail banks clear of the skirt and the bell is just *there*, a green moon over the frame. The run ends at the crown, where every strand roots into the bell and something has moved in.

## Visual language

Clear blue-green water shading into deep blue with distance, lit from a surface somewhere far above. The animal's bioluminescence layers green-gold on top of it: photophore bead chains down every strand, a flattened bell that physically contracts on the transport, four oral arms, and twelve heavy tentacles that only become the animal's silhouette in the final shot. Sickly violet is the only sour colour in the level and belongs exclusively to the parasites — clings, larvae, spitters, spores, broods, and the parent's webbing. The player's own light is the coldest thing in the water: white-gold shots, a photophore reticle whose six petals light one per lock, and lock rings made of the animal's own beads. Almost the entire environment is additive, which is both what bioluminescence in clear water looks like and the reason the forest never hides a target.

## Musical language

96 BPM in D minor; 24 bars is exactly sixty seconds. The score is additive, because the level is about something coming back to life: bell pulse at bar 2, the water opening at bar 6, groove and arps in the thicket, the parasite's detuned tritone groan taking the harmony hostage at the crown, and a resolution to D major in the last two bars with everything else stripped away. The *pulse* is the animal's bell contracting — a swell-then-body rather than a kick — and the environment squeezes the bell mesh on the same grid, so the metronome you hear and the metronome you see are the same organ. Locks, volleys, chips and kills are transport-quantized and pitched from the live chord; kills walk per-section melodic lanes, so a chained six-kill volley performs a written line. Twice, at each wide bank, a slow whale-song glide is the loudest thing in the mix.

## Mechanical signature

A 60-second, three-hull run with a variable-speed rail and two authored banks that leave the strand forest behind — the forest is anchored to the un-banked centreline, so swinging wide genuinely takes you out of it. Clings ride the strands, shiver, then let go and swim at the centre of the frame; larvae cross in undulating schools; spitters creep up and down one strand and lob interceptable spores. The crown fight puts the boss's health bar somewhere else on the screen: the parent is untargetable behind three panels of its own webbing, and each panel is kept alive by a brood it has extruded on a violet umbilical. Kill a brood, starve a panel; kill all three and the parent rears out of the socket for six locks. Leave one alive and it cannot be killed at all. When it dies the camera lets go of the rail and falls back, and back, and back.

## What to read

- `src/benchmark-levels/strandline-os1a/timing.ts`
- `src/benchmark-levels/strandline-os1a/gameplay.ts`
- `src/benchmark-levels/strandline-os1a/crown.ts`
- `src/benchmark-levels/strandline-os1a/audio.ts`
- `src/benchmark-levels/strandline-os1a/visuals/index.ts`
- `src/benchmark-levels/strandline-os1a/visuals/environment.ts`

## Status & notes

Built to the standing brief from the Strandline theme assignment. Inspection markers: `open` (bar 6, first bank), `thicket` (bar 8), `rise` (bar 14, second bank), `crown` (bar 16, the parent), and `adrift` (bar 22, the pull-back). Verified headless: typecheck, build, benchmark scope, and the floor gate (simulation, target occlusion, performance, audio config). WSL2 cannot render WebGPU, so the real frame and the mix still need a human playtest. First things to check by eye: that both banks read as leaving the strand forest, that the bell's contraction lands on the beat, that the parasites stay legible against the green water with bloom at zero, and that the final pull-back frames the whole animal.
