# Strandline

Identity: `strandline-si7k` (benchmark output, directory-only contract). Not registered in `src/levels/index.ts`.

A 60-second underwater rail-shooter through the trailing tentacles of a bioluminescent jellyfish. The world is a forest of glowing green-gold strands in sunlit blue-green water, with deep blue fading into the distance. The only sour note: sickly violet parasites clamped to the strands, detaching to defend their colony.

Music is slow at the start (96 BPM, minor harmony), gaining layers and brightness as more of the animal comes back to life. Player actions — locks, volleys, kills — snap to the transport grid and play notes drawn from the live chord progression. Kills walk a hidden melodic lane so chained volleys sound like a real run.

Enemies: `clamp` (clamped to strand), `larva` (swimming, arcing), `brood` (fresh spawn), `web` (boss lattice), `parent` (boss at crown). The boss hides behind webbing that must be destroyed to expose it; each web piece killed unlocks the parent further. When the parent dies, the level resolves into a serene pulse and the jellyfish drifts on.

Visual language: procedural 5×7 letter glyphs (START = STRAND, REPLAY = DRIFT), glowing strand environment, HDR violet parasites with sick green accents, cyan-white projectiles, gold-green reticle. Works at bloom zero.

Status: built to the benchmark brief. Headless checks (typecheck, build, scope) pass. WebGPU playtest needed for final mix and visual confirmation.

Read: `gameplay.ts`, `audio.ts`, `visuals/index.ts`. For musical action patterns, compare `src/levels/crystal/audio.ts`.

Inspection markers: ambient opening (`bar 0`), first larva (`bar 2`), build (`bar 6`), boss entrance (`bar 14`), finale (`bar 21`).

Human playtest should check: strand readability with bloom at zero, parasite silhouette distinction, boss web lattice legibility, and whether the kill melody reads as a real melodic run.
