# Broadside

A sixty-second crossing of a full fleet engagement at 140 BPM — catapulted off your own flagship's deck, through the melee between kilometer-class hulls, flat out down a friendly cruiser's flank while her guns go off overhead on the downbeats, through the becalmed eye at the heart of the battle, along an enemy warship's belly raking its turrets, and into the enemy flagship: shield generators under point defense, then a trench dive to its naked power cores. Kill the last one and the line breaks behind you.

## Visual language
One huge magenta-and-gold nebula backlights everything, so every hull reads as a silhouette rimmed in colored light. Sides read by color: your fleet is ice-white with cyan engine glow and cyan fire, the enemy obsidian streaked with molten orange, firing crimson. Crossfire tracers stream both directions through the middle distance the whole run. The player's optics — reticle, locks, shots — are the coldest cyan-white in the scene. Letters are ice-faced deck plaques with cyan rims; kills shatter into wreckage that tumbles and cools to black (no gravity out here).

## Musical language
Space opera at 140 BPM in D minor, 35 bars = exactly 60 seconds: brass and strings over timpani, with the launch fanfare returning as the full broadside theme beside the cruiser, near silence with one horn in the eye, staccato low strings under the enemy keel, and a climbing brass line in the trench. The timpani doubles as the fleet's guns. Locks are pizzicato plucks off the live chord, kills walk hidden per-act melody lanes so a chained volley performs a fanfare run, and the flagship's death ducks the whole orchestra for a scheduled D-major victory peal.

## Mechanical signature
A 60-second run with a 3-point hull. Darts cross the screen in corkscrewing squadron files, skiffs hold wheeling pickets, raptors weave and lunge with interceptable crimson bolts, and keel turrets are three-lock, two-stage mounts firing heavy flak. The boss is the enemy flagship in two passes: four two-lock shield generators under point defense fire, then three power cores in the trench that stay caged (unlockable) unless every generator died — clear them all and the run ends on the victory theme. START/REPLAY are ENGAGE/SORTIE.

## What to read
- `src/benchmark-levels/broadside-b4kd/timing.ts`
- `src/benchmark-levels/broadside-b4kd/gameplay.ts`
- `src/benchmark-levels/broadside-b4kd/flagship.ts`
- `src/benchmark-levels/broadside-b4kd/audio.ts`
- `src/benchmark-levels/broadside-b4kd/audio-voices.ts`
- `src/benchmark-levels/broadside-b4kd/visuals/index.ts`
- `src/benchmark-levels/broadside-b4kd/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Broadside theme assignment. Verified headless: typecheck, build, check:benchmark-scope, and check:floor (simulation, occlusion, perf). WSL2 cannot render WebGPU, so the frame and the mix need a human playtest — check first that the broadside salvos land on the downbeats beside the cruiser, that the eye's near-silence reads as a held breath, and that the shield-fall and victory peal land with enough contrast.
