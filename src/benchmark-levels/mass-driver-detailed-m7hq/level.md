# Mass Driver

You are the payload chambered inside a sixty-second orbital railgun. Every accelerator ring crosses the cockpit on a 128 BPM quarter note while widening physical gaps reveal the acceleration, six jammed safety clamps turn the final phrase into a hard deadline, and bar 28 either fires the payload into empty space or detonates the bore around it.

## Visual language
Near-black steel ribs, four diagonal conductor rails, and 112 accelerator rings carry a strict electrical heat ramp from arc blue through volt violet to ignition white. Thin luminous seams and small hot cores preserve target contrast at bloom zero. Coils cling to the wall, needle Threaders braid double helices through the frame, ribbed Capacitors break open in two armor stages, and six hazard-amber X-clamps brood at the rim against a capped muzzle charge. The shot exchanges the bore for a blue-violet starfield and one ion-white beacon.

## Musical language
Minimal techno at 128 BPM: Em–Em–C–D under a persistent saw-and-sub rail hum that climbs from 41 Hz through an octave and races to 185 Hz before cutting dead on the shot. Injection grows into four-on-floor stage 1, sixteenth hats, claps, octave bass and a procedural acid line in stage 2, then Em–F Phrygian interlock dread with klaxon, alarms, bar-risers and a final snare lattice. Bar 28 hits once and blooms into sustained E major, sparse glass delays, and near-silence. Locks, volleys, armor chips, kills, rejects, hull alarms, and escalating interlock confirmations are transport-quantized and pitched from live harmony.

## Mechanical signature
A three-hull, five-hostile roster uses distinct motion grammars: circumference-sliding Coils that can fire interceptable Arc bolts, full-width corkscrewing Threaders, four-hit two-stage Capacitors, unstable homing Arcs, and six three-hit station-keeping Interlocks. The spawn score alternates two-bar calls and responses before compressing into a mixed boss volley. A perfect six-kill release earns a large clean-volley bonus; S rank requires the gun to fire as well as a high score and clear rate. The summary reports hull, interlocks, arc interceptions, and the binary containment verdict.

## What to read
- `src/benchmark-levels/mass-driver-detailed-m7hq/timing.ts`
- `src/benchmark-levels/mass-driver-detailed-m7hq/gameplay.ts`
- `src/benchmark-levels/mass-driver-detailed-m7hq/audio.ts`
- `src/benchmark-levels/mass-driver-detailed-m7hq/audio-voices.ts`
- `src/benchmark-levels/mass-driver-detailed-m7hq/visuals/environment.ts`
- `src/benchmark-levels/mass-driver-detailed-m7hq/visuals/models.ts`
- `src/benchmark-levels/mass-driver-detailed-m7hq/visuals/effects.ts`
- `src/benchmark-levels/mass-driver-detailed-m7hq/visuals/index.ts`

## Status & notes
Authored inspection markers: `stage1` (bar 4), `stage2` (bar 12), `warning` (bar 19), `interlock` (bar 20), `critical` (bar 27), `shot` (bar 28), and `muzzle` (bar 30). Automated checks cover exact duration, score/audio structure, deterministic simulation, occlusion, target distribution, performance, type safety, production build, and benchmark scope. Human WebGPU playtest should first verify beat-ring sync, bloom-zero clamp legibility against the late charge disc, arc-bolt tells, the bar-28 speed/whiteout/hum-cut impact, and the contrast of the empty E-major muzzle coast.
