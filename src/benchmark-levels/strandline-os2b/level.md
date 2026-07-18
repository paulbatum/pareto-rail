# Strandline

Sixty seconds in the trailing strands of a jellyfish the size of a cathedral, taking the parasites off it. Most of the run is a forest of glowing tentacles in sunlit water — banking around them, threading between them — until one wide arc swings clear of the forest and the bell is simply there, a green moon filling the frame. Then the rail dives back in and climbs to the crown, where the parent organism is dug in behind three sheets of its own webbing.

## Visual language
Clear blue-green water shading to deep blue with distance, lit from above by drifting shafts and a screen-space caustic net, with marine snow rising past the camera the whole way. Everything alive is green-gold: strands are tapered ropes strung with luminous nodules, the bell is a translucent vertex-graded dome with radial canals and a bright margin, and it does not take fog — it hangs in the blue like a moon and fades in as the murk thins. The infestation is the only violet in the level, reserved absolutely for parasite bodies, their webbing, and denial. Player optics are the one cold thing on screen. Letters are colonies of gold photophores on dark membrane discs. Strand light is a single continuous number driven by how much of the animal you have freed, so the water gets brighter as you clear it.

## Musical language
96 BPM in D, 24 bars is exactly 60 seconds, and the arrangement is the animal waking up. There is no drum kit: the downbeat is the bell contracting — a soft sub thump plus the water it displaces — the hats are particulate ticking past the ear, and the melodic layer is struck glass. Drift is one drone and a contraction every other beat; bloom adds body tone and a walking light; the wide arc drops percussion entirely for a bowed swell; the deep and the braid stack everything; the crown strips it back to a detuned growl. Locks climb a D pentatonic, shots fall a fifth from the live chord root, and kills read a hidden per-section melody lane out of the current harmony, so a chained volley performs a real phrase. Tearing the parent loose ducks the mix and opens the level's only fully resolved chord under a peal falling from the top of the register.

## Mechanical signature
A three-point hull and three parasite grammars: clingers that grip a strand and let go as you close, swarmers that braid across the entire width of the water, and two-hit borers screwed into a strand that spit interceptable homing spores. The parent at the crown is always lockable and never shootable while its webbing lives — releasing at it returns the rest of the volley and answers with a webbing slap. Three brood waves each feed one sheet; clear a wave and its sheet withers, and each brood that reaches you costs a hull point. Bare, the parent takes two volleys through a mantle stage and a hold stage. When it dies the camera lets go of the rail entirely and falls back, and back, and back, the lens widening and the water clearing, until the whole animal is in frame for the first time with every strand glowing clean.

## What to read
- `src/benchmark-levels/strandline-os2b/timing.ts`
- `src/benchmark-levels/strandline-os2b/gameplay.ts`
- `src/benchmark-levels/strandline-os2b/parent.ts`
- `src/benchmark-levels/strandline-os2b/audio.ts`
- `src/benchmark-levels/strandline-os2b/visuals/index.ts`
- `src/benchmark-levels/strandline-os2b/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Strandline theme assignment. Verified headless: typecheck, build, benchmark scope, and the floor gate (simulation across all policies, target occlusion, performance) plus the audio trace. WSL2 cannot render WebGPU headless, so the real frame and the mix still need a human playtest. Check first that the bell reads as an animal rather than a backdrop when it fades in at bar 8, that violet parasites stay legible against green strands with the bloom slider at zero, and that the final pull-back lands as a release rather than a cut.
</content>
</invoke>
