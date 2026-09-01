# Strandline

Sixty seconds freeing a gigantic jellyfish from an infestation. The rail spirals up through the animal's trailing strands in sunlit water, swings wide once so the bell fills the view like a green moon, dives back under it, and ends at the crown where the strands root — where the Parent is dug in behind its own webbing. Tear it loose and the camera pulls back, and back, until the whole animal is in frame with every strand glowing clean.

## Visual language
Clear blue-green water shading to deep blue with distance, lit through from a soft light overhead: light shafts, drifting plankton, a translucent rim-lit bell with gold gonad lobes and bioluminescence running down radial canals, and about a hundred swaying strands merged into one shader that carries a green-gold pulse. The only sour note is the parasites' sickly violet: plum bodies under violet membranes with magenta cores. Every clamped parasite sits on a real host strand that turns violet around it and washes clean when it dies. Letters are colonies of glowing nodules on a membrane; the reticle is a ring with six cilia that light per lock; player fire is the animal's own green-gold light.

## Musical language
96 BPM in E major, 24 bars = exactly 60 seconds, and the arrangement is the animal coming back to life: the bell's slow sub pulse, one soft pad and a water bed at the start; a kick, water clicks and an arp in the forest; a swell and chime peal when the bell fills the view; the full groove for the dive. The crown act turns sour (Em9–Cmaj9–Fmaj7#11 under a drone) and each brood cleared gives a layer of the arrangement back; tearing the Parent loose resolves everything to E major at a whisper. Locks, shots, chips and kills snap to the transport, read the live chord, and kills walk hidden per-act melody lanes with a bubble popping out of each one.

## Mechanical signature
A 60-second run with a 3-point hull and five parasite grammars: ticks clamped to strands that let go on a beat and swim in; sinuous darters crossing the full frame; spinners corkscrewing down a strand and spitting interceptable spores; two-stage sacs whose burst membrane also spits; and the Parent's broods. The Parent (hitStages 3+3) can be locked from the start but its three fans of webbing catch every shot (the volley is denied with a web-flare and its own thread-pluck sound while the rest of the volley still fires); each web is fed by a three-broodling brood it pumps out on schedule or sooner once the last brood dies. Clearing all three bares it, the first stage tears half its legs loose and it flinches, the second tears it free. It has until bar 22, then burrows in and the animal drifts on still carrying it. Variable rail speed surges into the swing-wide, slows for the bell, and all but stops at the crown; the coda dollies straight back down the approach line to the vista the attract screen shows.

## What to read
- `src/benchmark-levels/strandline-be4y/timing.ts`
- `src/benchmark-levels/strandline-be4y/gameplay.ts`
- `src/benchmark-levels/strandline-be4y/parent.ts`
- `src/benchmark-levels/strandline-be4y/audio.ts`
- `src/benchmark-levels/strandline-be4y/audio-voices.ts`
- `src/benchmark-levels/strandline-be4y/visuals/index.ts`
- `src/benchmark-levels/strandline-be4y/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Strandline theme assignment. Inspection markers: `bell` (bar 8), `dive` (bar 10), `crown` (bar 16), `deadline` (bar 22). Typecheck, build, check:benchmark-scope, and check:floor verified headless; WSL2 cannot render WebGPU, so the frame and the mix need a human playtest. First things to check by eye: the bell filling the view around bar 9.8, host strands reading under the clamped ticks with bloom at zero, the three webs dying back one brood at a time, and the pull-back after the Parent dies landing on the whole animal.
