# Escapement

A planet-sized clock has seized. The rail flies out of its mainspring barrel, rides three great wheels, crosses an orrery in open black, passes the hour bell as the hammer falls, climbs the pendulum in its swinging frame, and holds in front of the escapement while the player breaks its pallet jewels and puts out the arbor. Twelve landed hits ring the bell up a scale; the twelfth strikes the hour and the wheels spin up for a free run out through the dial at XII.

## Visual language
Lamp-lit brass, steel blue, black void, and warm lamp white on the lamp only; every environment surface is lit, never emissive, under a PMREM sky bake and AgX tone mapping. Targets carry verdigris or ruby plus one solid white-hot spark. The camera is cold: the reticle is a clock face, locks and shots are cold blue. God rays come through the barrel lid, the orrery sun gets a lens flare, the bell strike ripples every surface and kicks chromatic aberration, and the gears carry per-object velocity blur.

## Musical language
120 BPM, one tick per beat. D minor inside the works with FM celesta and marimba figures and ratchet percussion; D Lydian pads and harp across the orrery; an additive bell and the first kick at the strike; swung half time on the pendulum; the boss doubles the tick and distorts the bass, and every boss hit rings the bell one scale degree higher. The free run glissandos every pitched part up an octave into the final strike.

## Mechanical signature
Authored rail frame with roll through the barrel spiral, a pitch-up look along the wheel rims, and a bob-frame section that swings the camera with the pendulum. Six enemy kinds with distinct motion: motes drift, burrs tumble across, ticks walk down then pause and leap, ratchets step on the beat in three armour stages, wasps ride and fire lockable ruby bolts, chimes hang and sway. A 4-point hull. The boss is gated by geometry: a pallet jewel is lockable only while its side of the swing lifts it off the wheel, and the arbor only at the bottom of the swing.

## What to read
- `src/levels/escapement/index.ts`
- `src/levels/escapement/gameplay.ts`
- `src/levels/escapement/choreography.ts`
- `src/levels/escapement/boss-logic.ts`
- `src/levels/escapement/audio.ts`
- `src/levels/escapement/visuals/index.ts`
- `src/levels/escapement/visuals/environment/index.ts`

## What to study here
Escapement is built on the engine's flagship features: real lighting with a baked environment and tone mapping, declarative post stages, GPU compute dust, an instanced swarm, ribbon trails, hit-stop, and an authored rail frame whose pendulum section rides a moving body. Read `gameplay.ts` for how the rail is authored as legs with their own speed shapes so every set piece lands on its bar, and how every enemy is placed in the camera's rail frame at a fixed approach distance so the same choreography reads at any rail speed. Read `boss-logic.ts` for a boss whose lockability comes from the swing rather than a timer, and `choreography.ts` for a beat-authored spawn table with a plausible-player simulation next to it.

Weaker ground: the escapement body sits far above the pendulum bob, so the camera station is above the pivot rather than on the bob, and the swing the player feels is the top of the rod's, not the bob's. Enemies hold a fixed distance from the camera in most sections, so the sense of passing is weaker than in Helios.

## Status & notes
Inspection captures: `barrel` (roll through the spiral, 0:05), `train` (rim ride, 0:20), `orrery` (sun and arms, 0:40), `strike` (bell ripple, 0:53), `pendulum` (climb in the bob frame, 1:05), `boss` (jewels lifted, 1:30), `arbor` (arbor exposed, 1:45), `freeRun` (dial approach, 1:55).
