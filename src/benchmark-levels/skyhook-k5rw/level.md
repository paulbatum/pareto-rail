# Skyhook

Sixty seconds riding a climber car up a space elevator, gunning for the station at the top. The rail is the tether itself, so the level is vertical: you start down in a storm with rain on the canopy and wind-riders crossing the frame, punch through the cloud deck on a downbeat, and watch the sky run from grey to sunlit blue to indigo to black while the hazard bands on the cable whip past underneath you. The car has a hull, and half the things up here are going for the car rather than for you.

## Visual language
Utilitarian hardware and nothing neon: white paneling, hazard orange, dark slate plate with cold pale rim lines. Locking an enemy paints it hazard orange — the same paint the climber wears — so the lock state is the only colour change in the level. The whole sky is one keyframe table on altitude: horizon, zenith, fog, star brightness, cloud opacity, streak length and the planet's angular size all ramp together, with stars living inside the sky shader and the planet drawn as a camera-anchored proxy so it can be far larger than the engine's 500-unit far plane. Enemies are silhouette-first: a wide flat kite, a long tumbling spar, a narrow forward-swept shrike, a squat clamp limpet, and the Descender as architecture.

## Musical language
128 BPM in D minor, 32 bars, roots that literally climb (D1–F1–A1–C2). The arrangement loses a layer at every section boundary because the air does: a wind bed and a wide reverb wash down low, a shorter room and a struck-panel snare above the deck, no reverb at all in vacuum — just a dry kick, a winch pulse and a drone — and finally one sine beacon that decelerates to silence as the clamps close. The player's instrument follows the same arc: a lush bell in the storm, a hard dry square in the fight, a bare sine at the top. Locks, shots, armour chips and kills all snap to the transport and read the live harmony; kills walk a hidden two-bar lane per section, so a chained volley plays a written phrase.

## Mechanical signature
A 60-second run on a 5-point climber hull with a variable rail speed that kicks through the cloud deck and brakes hard into the dock. Wind-riding kites and falling tether debris throughout; shrikes that pace the car and then commit to a ram; vacuum-hardened limpets that spiral onto the cable, spit an interceptable slug at the gunner and then grind through the tether unless killed. The boss, the Descender, latches on at bar 14 a very long way up and is visible for the rest of the run as it walks down the cable toward you — four grapnels have to be broken before its core is lockable, and if it reaches the car at bar 25.5 it takes two hull points with it. Once it is off the cable the tether is clear, the station opens overhead, and the camera tips over to look back down at the world before the throat swallows the climber.

## What to read
- `src/benchmark-levels/skyhook-k5rw/index.ts`
- `src/benchmark-levels/skyhook-k5rw/timing.ts`
- `src/benchmark-levels/skyhook-k5rw/gameplay.ts`
- `src/benchmark-levels/skyhook-k5rw/descender.ts`
- `src/benchmark-levels/skyhook-k5rw/audio.ts`
- `src/benchmark-levels/skyhook-k5rw/visuals/index.ts`

## Status & notes
Built to the standing level brief. Verified headless: typecheck, build, simulation suite, target occlusion, headless performance, and the floor gate. WebGPU cannot render in this environment, so the look and the mix still need a human playtest — start with the cloud-deck punch-through at 15s, the Descender's approach from 26s to 48s, and the docking look-back at ~54s.
