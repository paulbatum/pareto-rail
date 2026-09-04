# Strandline

A sixty-second rescue inside the trailing tentacles of a gigantic jellyfish. Bank through its luminous strand forest, swing wide beneath a green moon of living membrane, then climb into the infected crown. Clear three broods to dissolve the parent's webbing and tear it loose; the camera retreats until the whole restored animal drifts through open water.

## Visual language
Clear teal water shades into deep blue. Forty-eight winding tentacles, eight ruffled oral arms, a translucent ribbed bell, four internal organs, suspended plankton, and thin shafts of sunlight establish the animal's scale. Healthy tissue glows green-gold; dark violet parasites have pink organs and turn warm gold under lock. START and REPLAY use readable 5×7 pearl glyphs in thin oval membranes. Translucent tissue preserves target visibility with bloom disabled.

## Musical language
96 BPM, twenty-four bars, exactly sixty seconds. A quiet double heartbeat, velvet sine pads, and low bass gradually gain water percussion and pearl-like notes as the animal recovers. Locks and shots snap to the transport and use the current harmony; kills walk four authored melodic lanes above the accompaniment. Parent hits climb in pitch and brightness. Its death ducks the music, resolves E minor into E major, and leaves a sparse, reverberant coda.

## Mechanical signature
Clasp parasites peel off their strands and bob forward; ribbon parasites weave laterally with flexing fins; two-hit urchins turn through elliptical orbits. Three crown broods arrive on musical phrase boundaries, each feeding one visible web layer. Broods remain available until cleared. Only destroying all nine exposes the six-hit, two-stage parent. A clean six-kill volley earns a formation bonus. This is a score-and-rescue run without hull attrition; failure leaves the crown visibly infected and records the unfinished broods.

## What to read
- `src/benchmark-levels/strandline-8839/index.ts`
- `src/benchmark-levels/strandline-8839/gameplay.ts`
- `src/benchmark-levels/strandline-8839/audio.ts`
- `src/benchmark-levels/strandline-8839/visuals/index.ts`
- `src/benchmark-levels/strandline-8839/visuals/environment.ts`
- `src/benchmark-levels/strandline-8839/visuals/models.ts`

## Status & notes
Inspection markers: `strands` at 5s, `greenMoon` at 23s, `return` at 30s, `crown` at 40s, and `release` at 55s. The standard no-fire snapshot keeps the crown infected; a successful playthrough is required to see the final pullback. The automated perfect run clears all 49 targets; the seeded imperfect run clears 48 and still frees the animal. Human WebGPU review should first check close-strand depth, parasite contrast with bloom at zero, the web-to-brood relationship, and the final chord and pullback together. Headless captures use the repository's WebGL inspection fallback; the playable level uses WebGPU.
