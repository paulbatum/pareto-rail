# Strandline

Sixty seconds inside the trailing tentacles of a gigantic jellyfish, freeing it from an infestation. The rail banks and threads through a forest of glowing strands in sunlit water; at bar 8 it swings wide and the bell fills the view like a green moon, then dives back in toward the crown — where the parent parasite grips behind a lattice of her own webbing, and every brood you kill lets a curtain of it die back until she can be torn loose. When she goes, the camera pulls back, and back, and the whole animal drifts on, glowing clean.

## Visual language
Clear blue-green water shading to deep blue with distance, caustic light from somewhere above, god-ray shafts, marine snow, and a strand forest whose green-gold bioluminescent pulses brighten as the animal is cleansed. Parasites are the palette's one sour note: murk-dark chitin, sickly violet membranes, hot magenta feeding organs. The player's reticle, darts, and locks are warm sun-gold; letters are colonies of bioluminescent plankton on membrane discs; a denied release flushes them parasite-violet.

## Musical language
96 BPM in D dorian, 24 bars = exactly 60 s, scored as the jellyfish waking up: a slow pulse and pad gain plinks, ticks, bass, and bubble arps section by section; the reveal opens the pad wide; the crown strips to a two-saw undertow whose light layers only return as broods die; from bar 22 the harmony turns over into open D major. Locks climb a D pentatonic, kills walk hidden per-section melody lanes pitched from the live chord, cyst cracks climb the chord, and the Matriarch's chips ring an escalating gong that ends in a duck, a sub drop on D, and a rising major peal.

## Mechanical signature
A 60-second, 3-hull run: leeches that clamp strands and then swim across the view, jittery darting mites, station-keeping spitters lobbing slow interceptable venom bolts, two-hit armored cysts, and the crown fight — six larval broods gate the Matriarch's exposure, then a 3+3 staged kill with flinch recoveries on a closing approach. Full clean volleys pay a bonus; the S rank requires tearing her loose.

## What to read
- `src/benchmark-levels/strandline-s2bq/timing.ts`
- `src/benchmark-levels/strandline-s2bq/gameplay.ts`
- `src/benchmark-levels/strandline-s2bq/matriarch.ts`
- `src/benchmark-levels/strandline-s2bq/audio.ts`
- `src/benchmark-levels/strandline-s2bq/visuals/index.ts`
- `src/benchmark-levels/strandline-s2bq/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Strandline theme assignment. Verified headless: typecheck, build, check:benchmark-scope, simulate (perfect run clears all 54 targets and the Matriarch), trace:audio, occlusion, and perf gates. WSL2 cannot render WebGPU, so the real frame and mix need a human playtest — check first that the bar-8 bell reveal reads as a vista, that webbing curtains visibly die back per brood, and that the serene pull-back frames the whole animal.
