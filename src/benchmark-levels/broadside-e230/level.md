# Broadside

A sixty-second space-opera strike through a disordered fleet engagement. Launch from an ice-white flagship, slip between opposing cruisers, skim beneath a friendly broadside, and rake an enemy's belly before attacking the far flagship twice.

## Visual language
A vast magenta-and-gold nebula backlights eighteen procedural capital ships. Twin armored hulls, bridge towers, antennae, long service trenches, repeated rib plates, gun batteries, running lights, and engine bells establish naval scale. Friendly hulls carry cyan fire; obsidian enemies carry molten seams and crimson fire. Angular swarm craft and cyan targeting brackets stay legible without bloom. Fragment bursts, expanding impact rings, and restrained cockpit lines connect the combat to the fleet around it.

## Musical language
128 BPM, 32 bars. Synthesized orchestral brass, bowed-string ostinatos, timpani, cymbals, and a high player celesta move from launch to battle, drop almost silent in the eye, and return for the flagship. Live harmony tunes locks, fire, and impacts. Chained kills perform authored melodic lanes above the backing register. A destroyed flagship unlocks the D-major victory fanfare.

## Mechanical signature
Five hull points; banking interceptors, helical tri-wing fighters, heavy bobbing bombers, belly batteries, and interceptable crimson shells. Bombers and shells damage the player if allowed through. Three two-hit shield generators gate three four-hit power systems on the return trench pass. Six-target clears earn a formation bonus. Victory requires destroying all three power systems; surviving an incomplete strike reports the flagship still intact.

## What to read
- `src/benchmark-levels/broadside-e230/index.ts`
- `src/benchmark-levels/broadside-e230/gameplay.ts`
- `src/benchmark-levels/broadside-e230/audio.ts`
- `src/benchmark-levels/broadside-e230/visuals/index.ts`
- `src/benchmark-levels/broadside-e230/visuals/models.ts`

## Status & notes
Inspection markers: launch, crossfire, broadside, belly, eye, shields, escorts, trench, victory. The final pullback frames both fleets and the breaking flagship. Human WebGPU playtest should check the close hull passes, the bank and turn comfort, target contrast with bloom disabled, and the orchestral balance.
