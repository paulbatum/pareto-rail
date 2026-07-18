# Mass Driver

You are the payload in a colossal orbital railgun: sixty seconds, 128 beats per minute, and one accelerator ring crossing on every beat. The bore climbs from cold arc blue through violet charge-white as its bass hum rises with the acceleration; six jammed interlocks turn the last phrase into a hard launch-or-detonate deadline before the gun throws you into silent open space.

## Visual language
Near-black gunmetal structure, thin electric edges, four diagonal conductor rails, physically beat-spaced accelerator rings, and a strict electrical heat ramp from arc blue through volt violet to ion white. Coils, corkscrewing threaders, staged capacitors, unstable arc bolts, and heavy hazard-amber X-clamps share machined facets and small hot cores. The six-segment reticle doubles as a breech charge gauge; the bar-28 shot combines a threefold speed surge, FOV kick, muzzle flash, and whiteout before the tunnel drops away to stars.

## Musical language
Locked 128 BPM minimal techno in E minor, exactly 32 bars. A detuned saw-and-sub gun hum rises for the entire barrel run beneath an Em–Em–C–D cycle, quarter-note coil pulses, four-on-floor drive, acid-line overdrive, a two-bar klaxon, charge risers, and the final snare build. Locks, volleys, armor chips, and kills are transport-quantized from the live harmony; the sixth lock and each interlock release escalate musically. The shot cuts the hum dead and resolves the muzzle coda into a sparse E-major bloom.

## Mechanical signature
A 60-second, three-hull run with strictly rising rail speed and four combat grammars: wall-riding coil ranks, counter-rotating needle weaves, four-hit two-stage capacitor banks, and interceptable homing arc bolts. Six three-hit interlocks station-keep around the frame rim from bars 20–28 while chaff tightens between them. Clear all six to fire the gun and qualify for S rank; leave one standing and the bar-28 detonation erases the hull.

## What to read
- `src/benchmark-levels/mass-driver-detailed-m4gp/index.ts`
- `src/benchmark-levels/mass-driver-detailed-m4gp/gameplay.ts`
- `src/benchmark-levels/mass-driver-detailed-m4gp/audio.ts`
- `src/benchmark-levels/mass-driver-detailed-m4gp/audio-voices.ts`
- `src/benchmark-levels/mass-driver-detailed-m4gp/visuals/index.ts`
- `src/benchmark-levels/mass-driver-detailed-m4gp/visuals/environment.ts`
- `src/benchmark-levels/mass-driver-detailed-m4gp/visuals/enemies.ts`

## Status & notes
Showcase build. Authored inspection markers: `stage1` (bar 4), `stage2` (bar 12), `interlock` (bar 20), and `shot` (bar 28). Automated checks cover the 60-second duration, successful and failed deadline outcomes, event coverage, target spread, audio configuration, occlusion, performance, type safety, and production bundling. A human WebGPU playtest should first verify beat-perfect ring crossings, interlock contrast against the late charge glow, and the shot-to-silence transition.
