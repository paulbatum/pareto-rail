# Mass Driver

A 60-second launch down the barrel of an orbital railgun. The tunnel is 120 accelerator rings and the payload crosses exactly one on every beat — ring spacing widens as the launch accelerates, so the speed and the music are the same thing. The gun's safety interlocks are jammed, the firing charge builds anyway, and the run ends either shot into open space at muzzle velocity or scattered across it.

## Visual language
Electric heat, not fire: the ring tunnel charges arc blue through violet toward blinding white across the run, with gunmetal coil housings, six ionized conduit rails, and hexagonal geometry everywhere (coils, shockwaves, the reticle, the charge collar). Defense drones carry magenta signal light; the player's reticle, locks, and tracers are kinetic amber. Lightning arcs — jagged, strobing — are the level's signature effect, and the muzzle exit breaks the fog wall into starfield, planet limb, and silence.

## Musical language
128 BPM electro; 32 bars is exactly 60 seconds. The gun is the instrument: a persistent hum (sub sine plus resonant coil whine) climbs a two-octave E-minor ladder one rung every two bars, the harmony riding it, and a ring-crossing tick plays every beat because a ring passes every beat. Stage drops land on bars 4 and 12, the interlock alarm strips the track to the naked hum, the charge window stacks risers, and the firing cuts everything to a weightless shimmer. Locks, shots, and kills are pitched from the live rung; kills walk hidden melodic lanes; interlock kills are escalating metal clangs.

## Mechanical signature
A 3-point hull and a monotonically accelerating rail (rail-paced spawns): weavers are tri-blade spinners wheeling around the full tunnel clock, sliders grind the conduit rails with surging approaches, armored sentinels telegraph interceptable arc bolts. At bar 22 the jammed charge collar arrives — six hex-mounted interlocks, two casings deep — and all six must be cleared before bar 30 or the barrel detonates with the player in it. Clear them and the gun fires you out of the muzzle at ~3× peak speed for a silent two-bar coda.

## What to read
- `src/levels/mass-driver-vyxj/timing.ts`
- `src/levels/mass-driver-vyxj/gameplay.ts`
- `src/levels/mass-driver-vyxj/audio.ts`
- `src/levels/mass-driver-vyxj/visuals/index.ts`
- `src/levels/mass-driver-vyxj/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Mass Driver theme assignment. Verified headless (typecheck, build, scope, floor: simulate/occlusion/perf, audio trace); WebGPU visuals and the mix need a human playtest — check first that ring crossings feel beat-locked and that the muzzle exit reads as a release.
