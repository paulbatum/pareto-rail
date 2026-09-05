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

Weaker ground: the camera rides the pendulum frame 35 units below the pivot and 120 in front of it, so the swing the player feels is mostly roll and the world turning, with 10 units of lateral travel. The pendulum plate fills the frame behind the escapement from that pose. Enemies hold a fixed distance from the camera in most sections, so the sense of passing is weaker than in Helios. The Free Run dives under the pendulum plate to reach the XII gateway; nothing but the plate and the dial passes on either side.

## Status & notes
Debug targets: `?level=escapement&debugEnemy=<mote|burr|tick|ratchet|wasp|chime|boss>` holds one enemy kind, or the boss with both jewels and the arbor, in front of the camera with inflated health. Snapshot the set pieces by run time: Barrel 0:05, Train 0:20, Orrery 0:40, Strike 0:50, Pendulum 1:05, boss jewels at the swing tops 1:29 and 1:31, arbor 1:45, release 1:53, gateway 1:58. Enemies are placed in the camera's view frame (`frameAt` in gameplay.ts), so a look target never moves a target off screen. `npm run snapshot:gameplay -- --level escapement --autoplay --time 100` captures a played run with the boss in its arbor stage. `npm run simulate -- --level escapement` should show the perfect player above 120/126 with the boss dead; the simulator's perfect policy aims at the nearest target to centre and does not read `lockable`, so it stalls on an engaged jewel for up to half a swing.
