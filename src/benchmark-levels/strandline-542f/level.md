# Strandline

A sixty-second flight inside the trailing forest of a moon-sized jellyfish. The rail banks between its living tentacles, swings wide for one clear view of the green bell, then dives back toward the infested crown. Violet parasites peel off the strands as the animal's green-gold pulse slowly returns.

## Visual language
Clear turquoise water falls into deep blue with distance. Thin procedural tentacles braid around the rail, their ganglia carrying visible green and gold pulses toward the crown. Sun shafts and drifting motes keep the water luminous without bloom. Parasites are the only sour color: dense violet clamps, blade rays, radial cysts, brood sacs, and a webbed parent. The final pullback frames the bell and every clean strand as one animal.

## Musical language
96 BPM and exactly 24 bars. A submerged E-dorian heartbeat begins almost alone; pearl tones, long filtered chords, and a traveling strand melody join as the jellyfish wakes. The parent contaminates the harmony with a narrow F-natural saw voice. Locks, volleys, hits, and kills snap to the live transport, and chained kills play written melodic lanes. Tearing the parent loose rises into a quiet G-major field for the pullback.

## Mechanical signature
Four broad motion grammars lead into a three-web boss: clamped latchers peel inward, skimmers cross the full screen, corkscrew drifters spiral through the rail, and two-lock cysts launch interceptable homing stingers. The parent cannot be targeted while a brood feeds its current web. Clear the orbiting brood, land two locks on the exposed body, and repeat until all three web layers die back.

## What to read
- `src/benchmark-levels/strandline-542f/timing.ts`
- `src/benchmark-levels/strandline-542f/gameplay.ts`
- `src/benchmark-levels/strandline-542f/audio.ts`
- `src/benchmark-levels/strandline-542f/visuals/index.ts`
- `src/benchmark-levels/strandline-542f/visuals/environment.ts`
- `src/benchmark-levels/strandline-542f/visuals/enemies.ts`

## Status & notes
Showcase build. Inspection markers: `moonReveal` (bar 6), `livingCurrent` (bar 11), `parent` (bar 16), and `release` (bar 22). A human WebGPU pass should first check tentacle depth with bloom disabled, the parent web's lockable windows, the green-moon reveal, and the boss-kill transition into the whole-animal pullback.
