# Broadside

Launch off your flagship's deck into the middle of a full fleet engagement — kilometer-long cruisers slugging it out under a magenta-and-gold nebula, swarms knotted through the gaps. Thread the cruiser line, run a friendly broadside flank, rake an enemy warship's belly, then break the enemy flagship in two passes. Recognizable at a glance by its backlit capital-ship silhouettes and cyan-vs-crimson battery fire; by ear by its space-opera orchestra over timpani that drops to near silence in the eye of the battle.

## Visual language
Backlit silhouettes: ice-white friendly hulls with cyan engine glow and cyan fire against obsidian enemy hulls streaked with molten orange and firing crimson. Magenta-and-gold nebula dome with glow sprites, ice starfield, pooled broadside beam slugs exchanged between the lines, gold gunner's-sight reticle, ice-plate START/REPLAY lettering that flares gold on lock.

## Musical language
D minor space opera (Dm–Bb–F–C) for brass, strings, and timpani across seven arrangement sections; the eye (bars 13–17) falls to low strings and a lone horn before the flagship slams back in. Kills play a hidden 32-step lane over the live harmony; locks climb D minor; core chips ring a ship's-bell that grows with damage; the killing blow ducks the orchestra for a D-major victory peal.

## Mechanical signature
Three swarm motions (weaving darts, lumbering twin-hull gunships, corkscrewing weavers) plus homing point-defense flak and a 3-point hull. Flagship in two phases: three 2-HP shield generators wheeling around a locked core (volleys at the core/trench are eaten by the shield plate until they fall), escort waves on the turn, then a trench dive into three 2-HP power nodes and a two-stage core. Finale camera pull-out past the breaking flagship.

## What to read
- `src/benchmark-levels/broadside-amr2/index.ts`
- `src/benchmark-levels/broadside-amr2/gameplay.ts`
- `src/benchmark-levels/broadside-amr2/audio.ts`
- `src/benchmark-levels/broadside-amr2/visuals/index.ts`

## Status & notes
Complete benchmark entrant. Headless WebGPU unavailable in WSL2 — needs human playtest for visual/audio quality, lock feel, and boss pacing.
