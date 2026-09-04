# Broadside

Launch from an ice-white flagship into a fleet engagement, thread a rolling dogfight, race beneath a friendly broadside, and rake an enemy cruiser's belly. A magenta-and-gold nebula backlights sixteen capital ships. On the far side of the battle, cut the enemy flagship's four shield generators, fight through its escorts, and dive into its open trench to destroy three power systems. The final camera pullback holds both fleets as the flagship splits and the enemy line scatters.

## Visual language
Ice-white friendly armor, cyan engines and fire, obsidian enemy hulls with molten-orange seams and crimson salvos. Procedural nebula clouds and stars fill the sky. Capital ships carry overlapping armor, recessed ports, twin gun barrels, running lights, offset command islands, engine banks, and deck markings; small craft wheel between them. Naval instrument plates carry legible START!/REPLAY glyphs. Cyan lock rings, six reticle cells, armor fragments, expanding shock rings, muzzle flashes, and core ruptures make actions visible without relying on bloom.

## Musical language
128 BPM, 32 bars, exactly 60 seconds. A procedural orchestral score uses detuned bowed strings, cello ostinati, layered brass, tuned timpani, orchestral snare, and cymbals. D minor moves through a darker flagship progression before a D-major victory theme. The two-bar eye of the battle falls to a whisper. Locks and shots snap to the transport and use its current harmony; chained kills perform written melodic lanes. Generator breaks and core hits add pitched impacts, while the final rupture ducks the orchestra for a breath before the victory cadence.

## Mechanical signature
A four-point hull; strafing Raptors, three-wing Helices that corkscrew, heavy Bombers with slow drift and interceptable shells, and belly batteries. Beat-authored formations span the viewport, with paced approaches during the fast rail sections. Four staged shield generators must be destroyed to expose the three staged reactor systems. A complete six-kill volley earns a 1200-point squadron bonus. Failure to destroy the power systems before the escape phrase ends the attack; successful play gets the full fleet pullback and an ADMIRAL, ACE, or VICTOR rank.

## What to read
- `src/benchmark-levels/broadside-63d6/index.ts`
- `src/benchmark-levels/broadside-63d6/timing.ts`
- `src/benchmark-levels/broadside-63d6/gameplay.ts`
- `src/benchmark-levels/broadside-63d6/audio.ts`
- `src/benchmark-levels/broadside-63d6/audio-voices.ts`
- `src/benchmark-levels/broadside-63d6/visuals/index.ts`
- `src/benchmark-levels/broadside-63d6/visuals/models.ts`
- `src/benchmark-levels/broadside-63d6/visuals/environment.ts`

## Status & notes
Authored inspection markers: launch, crossing, broadside, belly, eye, generators, escort, trench, and victory. The quiet eye and the final pullback deliberately leave breathing room between combat phrases. Headless simulation, visual captures, and audio traces support development; a human WebGPU playtest should confirm bank comfort, hull-scale speed, generator and trench readability at zero bloom, and the orchestra/player-instrument balance.
