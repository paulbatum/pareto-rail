# Strandline

A sunlit underwater world of glowing green-gold jellyfish tentacles in deep blue water, where sickly violet parasites latch onto the strands. The rail winds through the animal's body; bright curves reveal the full bell like a green moon, then dive back into the forest of strands.

## Visual language
Deep blue water fading to black distance; glowing green-gold strands (procedural tubes) winding through the scene; sickly violet parasite targets (spiked spheres, sharp darts, clustered broods, and a large crown lattice at the finale); green-gold player reticle and projectiles; bloom-driven glow on thin lines and small cores.

## Musical language
108 BPM, slow start with gentle pulse, rising through four acts to a bright peak at the crown, then resolving into a serene clean pulse. Lock, fire, hit, and kill notes are quantized to the transport and pitched from the live harmony; kills play a hidden melodic lane so chained volleys form a real run. The boss finale ducks the mix briefly before a conclusive figure.

## Mechanical signature
60-second rail with three parasite kinds (clinger, dart, brood) plus the crown boss. A 3-point hull. Waves spread across full screen width; the crown enters at bar 40 with three webbing stages (each 2 hits) before exposing the parent core (6 hits). Variable rail motion through winding curves.

## What to read
- `src/benchmark-levels/strandline-de7d/index.ts`
- `src/benchmark-levels/strandline-de7d/gameplay.ts`
- `src/benchmark-levels/strandline-de7d/audio.ts`
- `src/benchmark-levels/strandline-de7d/visuals/index.ts`

## Status & notes
Built to the standing brief. Type-checked and built. Headless WebGPU unavailable in WSL2 — visual mix (strand glow contrast, violet target legibility against green-gold strands, crown webbing readability at distance) and audio balance need a human playtest. First checks: bloom-zero target contrast, crown stage visibility, and whether the music's rising brightness matches the gameplay arc.
