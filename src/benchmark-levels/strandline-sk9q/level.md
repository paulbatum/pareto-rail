# Strandline

A sixty-second flight through the trailing tentacles of a gigantic jellyfish. The rail banks between glowing strands in sunlit blue-green water, swings wide twice to show you the bell hanging in the distance like a green moon, then closes on the crown where a violet parent organism is dug in behind its own webbing, pumping out broods. Kill each brood and the web it fed dies back; tear the parent loose and the camera falls away while the whole animal glows clean. START is CLEANSE, REPLAY is RETURN.

## Visual language
Sunlit water: blue-green shallows shading into deep blue, god rays, marine snow. The animal is jade-and-gold bioluminescence — hero strands running the length of the corridor, wild filaments for near-field threading, a vast translucent bell with a gold organ cluster, a rooted crown. The parasites are the only sour note: sickly violet latchers clamped to their perches, sea-spider skitters dashing between strands, armored husk cysts, tube-worm spitters lobbing interceptable spores, and tetra-pod broodlings swarming the parent. The parent's veined sac, brood sacs, and web lattice deflate and shrivel as it loses its colony. Letters are beads of living light inside membrane rings. Everything stays legible with bloom at zero.

## Musical language
112 BPM, 28 bars is exactly 60 seconds. The jelly's own pulse is the kick drum, slow at first and gaining layers — sub bass, glass bells, distant animal calls, shimmer — as the water brightens. The sour B♭ drone only lives under the boss. Locks are droplets pitched from the live harmony, volleys are plucks, and kills walk authored per-section bell lanes so a chained volley plays a melodic run. Web deaths tear a wail that a clean bell answers; the killing blow ducks the mix into a serene A-major swell.

## Mechanical signature
A 4-hull run with two threat grammars: center-lane latchers detach and strike unless shot, and spitter/broodling spores home in and must be intercepted. Skitters dash laterally, husks soak three locks behind cracked shells, and the parent is a three-stage boss gated by its broods — the web blocks the shot, not the lock, so a shielded parent locked into a volley is visibly denied while the rest of the volley flies. Escaped broodlings are re-brooded until the bar-25.5 deadline; miss the deadline and the parent burrows, ending the run unresolved. Full-clear volleys score quadratically.

## What to read
- `src/benchmark-levels/strandline-sk9q/index.ts`
- `src/benchmark-levels/strandline-sk9q/gameplay.ts`
- `src/benchmark-levels/strandline-sk9q/audio.ts`
- `src/benchmark-levels/strandline-sk9q/audio-voices.ts`
- `src/benchmark-levels/strandline-sk9q/visuals/index.ts`
- `src/benchmark-levels/strandline-sk9q/visuals/environment.ts`
- `src/benchmark-levels/strandline-sk9q/visuals/enemies.ts`
- `src/benchmark-levels/strandline-sk9q/visuals/parent.ts`

## Status & notes
Showcase build. Inspection markers: `reveal1` (green-moon swing, bar 8), `reveal2` (crown approach, bar 16), `parent` (boss entrance, bar 19), `deadline` (bar 25.5), `release` (serene coda, bar 26). Verified headless: typecheck, build, check:benchmark-scope, check:floor (simulation, occlusion, perf), trace:audio, and SwiftShader gameplay snapshots across the whole run including bloom-off legibility. WebGPU visuals and the mix need a human playtest — check first the mix balance of the kill-bell lanes against the pulse, the aggro-latcher detach telegraph, the web-denied absorb feedback, and the coda pull-back framing on real hardware.
