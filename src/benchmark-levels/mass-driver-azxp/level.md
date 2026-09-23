# Mass Driver

A 60-second ride on a payload down an orbital railgun: a lattice tunnel of accelerator coils hung over a night-side planet, one coil crossed on every beat. The coils spread further apart as the gun accelerates and glow hotter as they do, arc blue through violet to white, while the hum under the music climbs from D to A. At the end, six jammed safety interlocks tether the payload while the final charge builds. Blow them all and the gun fires you out of the muzzle into silent open space. Leave one standing and the barrel blows with you inside.

## Visual language
Dark slate coils wrapped in windings, with thin HDR lips and emitter nodes that charge up as you approach each one and fire as you pass. A light pulse races down four conductor rails on every beat. The gun's defense drones are magenta against the electric tunnel: tri-blade pickets, needle threaders with collars, C-clamp leeches on the coils, caltrop arc pylons, and jagged arc bolts. The safety interlocks are hazard-striped clamps with arcing tethers, and a sealed iris muzzle glows at the end of the barrel. START/REPLAY are dot-matrix coil-cell panels. Kills in a volley chain together with arc lightning. The launch is a whiteout and hyperspace streaks, then stillness as the sun rises over the planet's limb.

## Musical language
128 BPM, 32 bars. The kick drum is the coil pulse, tuned to a pumping bass hum. The hum's pedal only ever climbs: D minor through stage one, E minor through stage two, then a semitone every two bars (F#, G, G#, A). Above the player's melody, a charge whine glides continuously through those pitches while its tremolo speeds up. On the last beat every drum drops out and the hum surges an octave. At the peak, either a D-major launch chord followed by a few struck bells, or an overdriven collapse. Locks climb the live lead set, slugs chirp from the chord, kills walk per-section melodic lanes, and each safety you blow strikes the chord higher up.

## Mechanical signature
Fixed tempo, but a speed profile triples rail speed so ring spacing widens while every ring still lands on the beat. Rings are phase-locked to the heard beat, not the scheduler. Rail-paced drones get pinned while a slug is inbound. There is a 4-point hull and interceptable arc bolts. Leeches ride their coil in and make it misfire if left alive. The finale is a timed boss: six [2,2] interlocks latch in two waves, and the verdict falls on the last beat before the peak. Clearing them early pays a bonus per beat to spare. Launching is required for B rank or better.

## What to read
- `src/benchmark-levels/mass-driver-azxp/index.ts`
- `src/benchmark-levels/mass-driver-azxp/timing.ts`
- `src/benchmark-levels/mass-driver-azxp/gameplay.ts`
- `src/benchmark-levels/mass-driver-azxp/audio.ts`
- `src/benchmark-levels/mass-driver-azxp/visuals/index.ts`

## Status & notes
Built headless: typecheck, build, simulation, occlusion, and performance gates were verified, and all 100 rail-pacing engagement contracts pass. The world is built at 1/3 scale (`WORLD` in `gameplay.ts`). That keeps camera-pacing targets under the closing speed of the engine's homing slugs, so a locked shot always lands. Visuals were only checked through SwiftShader snapshots, and the audio has not been heard. Needs a human WebGPU playtest for mix balance, bloom intensity, and how well the ring crossings line up with the kick. Inspection: `?safeties=clear` in dev auto-clears the interlocks so the launch ending can be captured (`--debug-value clear`). Markers: `charge` (bar 20), `verdict` (bar 27:3), `muzzle` (bar 28).
