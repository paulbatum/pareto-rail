# Tinker Ball

One minute across an oversized, lamp-lit worktable: a self-rolling cleanup ball cracks glossy glue monsters, follows the scattered supplies, and grows from tidy marble to gloriously uneven melon. Warm wood, toy-box color, black adhesive cores, and a springy workshop-pop score make every rescued button readable at a glance and audible as part of the tune.

## Visual language
Honey-colored wood and cream paper sit under an amber desk lamp, with coral, cyan, yellow, mint, blue, and violet supplies providing the pop. Scratches form the rail's roads. Button-and-paperclip beetles skitter low, pencil walkers stride, clothespin-and-card birds flap overhead, thread-spool crabs orbit, and block golems lumber. Every broken body becomes persistent physical debris that arcs into the player ball and sticks to its surface; the silhouette itself is the run's progress meter. The finale combines four black glue cores with rulers, jars, cardboard, pencils, and an irregular tabletop spill.

## Musical language
128 BPM eccentric pop in D: FM-like mallets, clipped reed-organ chords, a rubbery square-and-triangle bass, handclaps, wood taps, pin clicks, and filtered glue pulses. The arrangement changes density at the three scale shifts and turns dark for the spill before opening into a two-bar clean-sweep coda. Locks climb the live chord, fire snaps are pitched from its root, and kills reveal authored two-bar melodic lanes so a volley performs the lead line.

## Mechanical signature
A 60-second, 32-bar run with five ordinary enemy families and a sequential four-core boss. The first three spill shells each need a two-lock crack; the heart finishes with two two-lock stages. Broad low/high formations turn screen-wide sweeps into musical gestures, while each kill leaves a debris field that the camera and growing ball deliberately collect.

## What to read
- `src/benchmark-levels/tinker-ball-q1ci/index.ts`
- `src/benchmark-levels/tinker-ball-q1ci/gameplay.ts`
- `src/benchmark-levels/tinker-ball-q1ci/timing.ts`
- `src/benchmark-levels/tinker-ball-q1ci/audio.ts`
- `src/benchmark-levels/tinker-ball-q1ci/audio-voices.ts`
- `src/benchmark-levels/tinker-ball-q1ci/visuals/index.ts`
- `src/benchmark-levels/tinker-ball-q1ci/visuals/models.ts`
- `src/benchmark-levels/tinker-ball-q1ci/visuals/environment.ts`
- `src/benchmark-levels/tinker-ball-q1ci/visuals/effects.ts`

## What to study here
The collection ball is both story and feedback: enemy pieces remain in the world, sweep toward the approaching rail, and become a persistent rough shell rather than vanishing in a generic explosion. The score treats the same event as melodic material, so the visible accumulation and the kill lane advance together. The boss uses an off-route, non-counted controller plus the runner's dynamic-spawn contract to reveal one recycled core at a time without changing shared engine code.

## Status & notes
Authored as a benchmark-directory-only level. Snapshot imagery is deterministic at seed 424242; final WebGPU lighting, mix balance, and the apparent density of the collected silhouette still merit a hardware playtest.
