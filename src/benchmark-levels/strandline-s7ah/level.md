# Strandline

Sixty seconds inside the trailing tentacles of a gigantic jellyfish, freeing it from a parasite infestation. The rail banks and threads through a forest of glowing strands in sunlit water; at bar 10 the curve slings wide and the animal's bell fills the view like a green moon, then the dive back in leads up the strands to the crown — where the parent parasite hides behind a lattice of its own webbing, pumping out broods. Kill each brood and the web starves; tear the bared Matriarch loose and the camera pulls back, and back, and back, until the whole animal hangs in frame with every strand glowing clean.

## Visual language
Clear blue-green water shading into deep blue, lit by crossed sun shafts and drifting marine snow. The jellyfish is green-gold bioluminescence — a translucent bell with radial ribs, sixty-odd strand tubes with a travelling pulse, and a "cleanse" dial that turns the colony from sick teal to green-gold as the run burns the infestation off. Parasites are the only violet in the ocean: hanging cyst sacs on mucus threads, undulating ribbon lashers, spiked spitters with charge-lamp mouths, tadpole broods, and the crowned grip-armed Matriarch. Player light is white–green–gold: bead-colony letters with cilia fringes, a three-fin cleansing-lamp reticle, gold seed tracers, and buoyant spore bursts; parasite deaths leave sinking husks and spreading ink.

## Musical language
96 BPM in D dorian, 24 bars = 60 seconds, and the arrangement is the animal's vital signs: a filtered current bed, a lub-dub heartbeat, and one dark pad grow droplet arps, watery percussion, and wide glass pads section by section; the bell reveal lands on a struck gong, the crown strips everything to heartbeat, sub pulses, and a detuned dread motif over a Dm–Bb walk, and the release resolves to D major at a whisper. Locks, shots, chips, and kills snap to the transport and read the live chord; kills walk hidden per-act melody lanes; each brood kill plays a rising light-figure, and the Matriarch's death ducks the mix for a climbing major peal.

## Mechanical signature
A 60-second, three-point run with cysts that drop from strands and hang swaying, full-width lasher crossings, station-keeping spitters lobbing interceptable venom globs, and a two-wave brood-and-web boss gate: the Matriarch is lockable from the start but sheds every volley (with a violet web flare) until both brood waves are dead, then takes six locks across two stages with a convulsing flinch between them. Freeing the animal is the rank gate for S and A; the pull-back finale only plays if you earn it.

## What to read
- `src/benchmark-levels/strandline-s7ah/timing.ts`
- `src/benchmark-levels/strandline-s7ah/gameplay.ts`
- `src/benchmark-levels/strandline-s7ah/matriarch.ts`
- `src/benchmark-levels/strandline-s7ah/audio.ts`
- `src/benchmark-levels/strandline-s7ah/visuals/index.ts`
- `src/benchmark-levels/strandline-s7ah/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Strandline theme assignment. Verified headless: typecheck, build, benchmark scope, simulate (all policies, full event coverage; the only quiet stretch is the earned post-severance calm), occlusion, and perf gates. Inspection markers: `forest` (bar 4), `reveal` (bar 10; the bell fills the frame ~bar 11.75 on the gong), `thick` (bar 13), `crown` (bar 17), `release` (bar 22). WSL2 cannot render WebGPU, so the real frame and the mix need a human playtest — check first that the strafe-and-gong bell reveal lands as one moment, that violet parasites stay legible against the teal forest with bloom at zero, and that the post-kill pull-back frames the whole animal.
