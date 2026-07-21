# Mass Driver

An exactly sixty-second ride as the payload inside an orbital railgun. A blue-black breech accelerates through violet conductor light toward a white firing charge, one accelerator ring per quarter-note, until six hazard-striped interlocks jam the bore and the gun fires on bar 28.

## Visual language
Near-black void, cold gunmetal facets, four diagonal arc-blue conductors, and 112 beat-spaced accelerator rings climbing from blue through violet to ion white. Thin electric edges and small hot cores keep coils, counter-rotating threaders, staged capacitor banks, unstable arc bolts, and the six amber-only interlocks readable with bloom disabled. The shot hard-cuts the barrel to a deep starfield and a distant white beacon.

## Musical language
128 BPM minimal techno in E minor, locked to 32 bars and the ring grid. Injection grows into four-on-floor, sixteenth hats, claps, octave bass, and a resonant acid line; the interlock section switches to Em–F Phrygian dread with klaxons, alarms, and a final-bar roll. A detuned saw-and-sine gun hum climbs across the entire run and cuts in 18 milliseconds at the shot, where an E-major pad blooms into a sparse, quiet muzzle coda. Locks, volleys, chips, kills, and interlock confirmations are transport-quantized notes from live harmony.

## Mechanical signature
Three hull points; wall-riding coil ranks, full-frame double-helix threaders, four-hit two-stage capacitors, dynamically spawned interceptable arc bolts, and six three-hit station-keeping interlocks. Two clamps shoot back. Any clamp alive on bar 28 detonates the bore; clearing all six fires the gun and reserves S rank for a near-complete clean launch. Full six-target volleys earn an ignition-scale bonus.

## What to read
- `src/benchmark-levels/mass-driver-detailed-uk78/timing.ts`
- `src/benchmark-levels/mass-driver-detailed-uk78/gameplay.ts`
- `src/benchmark-levels/mass-driver-detailed-uk78/audio.ts`
- `src/benchmark-levels/mass-driver-detailed-uk78/visuals/index.ts`
- `src/benchmark-levels/mass-driver-detailed-uk78/visuals/environment.ts`
- `src/benchmark-levels/mass-driver-detailed-uk78/visuals/models.ts`

## Status & notes
Showcase benchmark build. Inspection markers: `injection` (bar 0), `stage1` (bar 4), `stage2` (bar 12), `warning` (bar 19), `interlocks` (bar 20), `shot` (bar 28), and `muzzle` (just after the shot). A human WebGPU playtest should first check beat-perfect ring crossings, bloom-zero interlock contrast against the charge disc, and whether the shot lands as one simultaneous speed/FOV/whiteout/hum-cut event.
