# Strandline

A 60-second dive through a gigantic jellyfish to free it from a parasite infestation: bank through the glowing strand forest, swing wide for the green-moon bell, then climb to the crown and tear the parent organism out of its own webbing. When it dies the camera pulls back and back until the whole animal is in frame, every strand glowing clean.

## Visual language
Sunlit clear blue-green water shading into deep blue, a forest of green-gold bioluminescent strands with traveling light bands, the bell glowing through hundreds of metres of haze, marine snow drifting upward, god rays from the surface — and the one sour note: the sickly violet of the parasites clamped onto it. The player's own light is warm pearl-and-gold sunlight, so locks and shots never read as either water or infestation.

## Musical language
96 BPM, 24 bars = exactly 60 seconds. The score starts as slow sunlit drift — pads and glassy bells over the animal's own pulse — and gains brightness and layers as the jelly comes back to life: open water brings arps and the pulse forward, the dive back adds rhythm and stabs, the parent gets a dark minor theme with an A-major sting, and the clean-water resolution lands on a D major bloom. Locks, shots, hits, and kills all snap to the transport and read the live harmony; kills walk per-section melodic lanes so a chained volley performs a run.

## Mechanical signature
A 60-second run with a 4-point hull: claspers detach from their strands and swoop, drifters pulse across the view on two-hit bodies, skeins weave fast zigzag crossings, and the parent fight is a starvation siege — each web panel is fed by one brood wave, kill the wave and the panel withers into a tearable remnant, strip the lattice (three panels is enough) and the parent bares itself while panicking out fresh brood frenzies and nettle volleys. The kill triggers the pull-back: the blight washes out of every strand on screen as the camera falls away.

## What to read
- `src/benchmark-levels/strandline-o848/index.ts`
- `src/benchmark-levels/strandline-o848/gameplay.ts`
- `src/benchmark-levels/strandline-o848/parent.ts`
- `src/benchmark-levels/strandline-o848/audio.ts`
- `src/benchmark-levels/strandline-o848/audio-voices.ts`
- `src/benchmark-levels/strandline-o848/visuals/index.ts`
- `src/benchmark-levels/strandline-o848/visuals/environment.ts`

## What to study here
The level is built around one contrast: everything alive is green-gold and slow, everything parasitic is violet and twitchy, and the player is the sunlight in between. The bell deliberately ignores scene fog and fades by its own distance law so it glows through the water long before it resolves — the same law that makes the open-water swing land as a reveal rather than a pop-in. The boss never blocks you out: webbing starves rather than shields, so the fight always moves toward release, and the parent's exposure is the music turning over.

## Status & notes
Built as a one-shot benchmark entrant. Simulation: 60.0s run, 56 timeline enemies plus brood/nettle pressure, S rank reachable with the parent killed (verified via imperfect-policy simulation); occlusion, performance, and audio-configuration gates pass. Average destruction distance and screen-center concentration sit in the warning band — spawns could sit slightly closer and further off-axis. WebGPU rendering could not be exercised headless in this environment: a human playtest should confirm the bell reveal framing at bar 8, the strand pulse against the beat, the parent's legibility above the rail at the crown, and the serene pull-back after the kill.
