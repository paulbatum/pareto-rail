# Benchmark level assignment

Build a complete level according to `docs/level-brief.md`. Read `AGENTS.md` and `docs/level-authoring.md` as directed there. All repository instructions and the standing brief apply.

## Level identity

- Level id: `strandline-s5cx`
- Display title: `Strandline`

Use this identity consistently in the level directory, descriptor, metadata, and generated gallery card. This benchmark protocol uses the directory-only output contract: the level directory must be exactly `src/benchmark-levels/strandline-s5cx/`; do not use a shortened module-folder name, edit `src/levels/index.ts`, or add a benchmark registry entry. Start with `npm run scaffold -- --mode benchmark --id strandline-s5cx --title 'Strandline'`.

## Benchmark additions

Aim for a **60-second playable run**. A duration from **55 to 65 seconds** is acceptable when needed to end on a natural musical phrase. This covers active gameplay after START and before the run summary; attract mode and REPLAY are outside it.

Demonstrate your attention to detail and creativity through this work. The expected standard is a polished showcase level, not merely a gate-passing implementation.

## Assigned theme

# Strandline

Build a level where you're freeing a gigantic jellyfish from an infestation. The rail winds through its trailing tentacles and you're in the strands - banking around them, threading between them. Most of the time the world is a forest of glowing strands in sunlit water, then a curve swings you wide and for a few seconds you can see much more of the animal, the bell filling the view like a green moon, before the rail dives back in. The water is clear blue/green shading into deep blue with distance, lit through from somewhere above, and the jelly's own bioluminescence layers green-gold on top of it; the only sour note is the sickly violet of the parasites clamped onto it. The music is slow at start, gaining brightness and layers as more of it comes back to life.

Enemies are the parasites, latched onto the strands ahead and detaching to defend the colony as you close in.

Boss: the parent organism, dug in at the crown where the strands root into the bell. It hides behind a lattice of its own webbing and pumps out fresh broods; kill each brood and the webbing it fed dies back, until the parent is bare and you can tear it loose. When it dies the camera pulls back, and back, and back - the whole animal in frame for the first time, every strand glowing clean - the pulse resolves into something serene, the jellyfish drifts on, level ends.

