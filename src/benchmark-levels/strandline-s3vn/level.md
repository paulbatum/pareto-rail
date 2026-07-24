# Strandline

Sixty seconds inside the trailing strands of a jellyfish the size of a cathedral, cutting a violet infestation off it. Most of the run is a forest of glowing green-gold strands in sunlit blue water; the bell swims ahead of you the whole way, arriving out of the haze as the rail banks wide into open water and hanging over the frame like a green moon before you climb into the crown where the parent is dug in. Nothing on screen is violet except the parasites, and every one you cut loose measurably brightens the animal and the score.

## Visual language
Clear blue-green water shading into deep blue with distance, lit from a surface you never see through drifting shafts and plankton. The animal is thirty-six alpha-blended jelly strands rooted in a shallow luminous bell, with a chain of bioluminescent beads down every strand that flashes tip-to-crown on the pulse and a violet rot that burns off as you clear it. Parasites are matte violet-black shells with pale sickly chitin edges and one hot magenta organ, so a violet shape is always something to shoot; player fire is the only cold white in the water. START/REPLAY read AWAKEN and REVIVE, written as 5×7 colonies of polyps budded on a translucent membrane with a tendril fringe.

## Musical language
112 BPM in D, 28 bars = exactly 60 seconds, scored as an animal waking up. It opens with water, one bell contraction every half bar, and a chord that takes two bars to arrive; sand-and-shell percussion, a plucked line, glass bells and a doubled pulse arrive at each set piece and never leave. The crown empties the bright register for a groaning two-saw motif so the player's own notes are the only light in the mix, and the clear resolves to D major with the pulse slowing to a drift. Two live beds track the animal underneath — the water, and a shimmer the runtime opens a little further every time you free a strand. Locks, volleys, chips and kills are transport-quantized and pitched from the live chord; kills walk hidden per-section melody lanes.

## Mechanical signature
A 60-second, three-hull run against five parasite grammars: clamped clings that let go and pulse at you medusa-style, larvae crossing the full width of the frame, two-shell borers screwing down a strand, station-keeping spitters with interceptable homing spores, and the parent's broods. The rail weaves between strands, banks hard out of the bundle for the open-water reveal, and coasts to almost nothing for the last three bars. The parent hides behind three panels of its own webbing and answers every bite with a fresh brood: shots on it bounce while a brood is feeding, clearing the brood withers that third of the lattice and opens a two-hit window, and three windows kill it. Miss the deadline and the rail leaves the crown with the colony still on the animal.

## What to read
- `src/benchmark-levels/strandline-s3vn/timing.ts`
- `src/benchmark-levels/strandline-s3vn/gameplay.ts`
- `src/benchmark-levels/strandline-s3vn/parent.ts`
- `src/benchmark-levels/strandline-s3vn/audio.ts`
- `src/benchmark-levels/strandline-s3vn/visuals/index.ts`
- `src/benchmark-levels/strandline-s3vn/visuals/animal.ts`

## Status & notes
Built to the standing brief from the Strandline theme assignment. Inspection markers: `swarm` (bar 4), `open` (bar 9), `dive` (bar 13), `crown` (bar 18), `clear` (bar 25). Verified headless: typecheck, build, scope, simulate (all policies), occlusion, performance, and audio trace. WSL2 cannot render WebGPU, so the real frame and the mix still need a human playtest — check first that the bell reads as a green moon rather than a light source through bars 9–14, that the parasites stay legible in violet against the green bundle with bloom at zero, and that the bead pulse running the strands lands on the beat.
