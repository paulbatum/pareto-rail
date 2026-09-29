# Skyhook

A sixty-second ascent aboard a space-elevator climber. Storm clouds whip downward, sunlight breaks across white enamel and hazard paint, and blue thins into black. Protect both yourself and the car, stop a building-sized tether crawler descending toward you, then ride the clear last stretch into station U9.

## Visual language
Utilitarian white paneling, carbon radiators, exposed steel, and hazard orange. A twin-strip tether stays in sight beside the climbing car. Layered procedural cloud puffs give way to stars and a blue planetary limb. The station has radial trusses, solar wings, split capture doors and a deep docking throat. Riveted 5×7 stencil plates carry START and REPLAY. White metal chips, expanding pressure rings, orange target brackets and six reticle pips make volleys tactile without relying on bloom.

## Musical language
120 BPM, thirty bars, D-major/add9 harmony. Broad stereo sine-and-triangle cushions, brushed noise, low motor pulses and gentle bass down low; the arrangement removes percussion, bass and inner voices as the atmosphere thins. Dry tuned metal answers in vacuum. Locks and shots follow the transport and live harmony; kills perform authored melodic lanes. Boss damage climbs in register and brightness, its death rings a resolving figure, and docking leaves a quiet final chime.

## Mechanical signature
A 60-second run with a five-point player hull and separate 100% climber integrity. Wind kites weave, skiffs strafe and launch interceptable shots, orange limpets dive into the car, and vacuum machines orbit while closing. Six-target weather fans turn into sparse armored encounters. A thirty-hit, five-stage tether-eater advances continuously for sixteen seconds, exposing successive radiator banks during its descent: failure to stop it destroys the car. The last waves precede the boss, leaving a clear docking approach. A full six-lock volley earns a completion bonus.

## What to read
- `src/benchmark-levels/skyhook-u9lg/index.ts`
- `src/benchmark-levels/skyhook-u9lg/gameplay.ts`
- `src/benchmark-levels/skyhook-u9lg/audio.ts`
- `src/benchmark-levels/skyhook-u9lg/visuals/index.ts`

## Status & notes
Benchmark directory-only module; discovered through its level.json descriptor. Inspection markers: weather 4s, cloudbreak 14s, blue 20s, thinning 28s, contact 36s, approach 50s, docking 56s. Player hull and car integrity reset for replay. Human playtest should confirm atmosphere transitions, boss scale and deadline, car-impact readability, docking deceleration and the thinning audio mix.

Verification: `npm run typecheck`, `npm run build`, and `npm run check:floor -- --level skyhook-u9lg` pass. The floor reports zero occlusion warnings, performance failures, audio configuration failures and spawn-distribution warnings; all gameplay events are covered. Both perfect and seeded imperfect simulations reach the 60-second summary with 42/42 kills. Browser Web Audio scheduling and action voices produced no errors. The score trace records the five section changes at 0, 14, 24, 36 and 54 seconds. Headless gameplay stills, an ascent sheet, and a bloom-zero gameplay capture and R glyph were inspected. These captures use the tool-owned WebGL backend; a hardware WebGPU playtest and listening pass remain necessary.

The stock scope script has no `main` base in this checkout and, with `HEAD` supplied, accepts only `src/levels/` paths. A direct Git path audit confirms that every changed file is inside `src/benchmark-levels/skyhook-u9lg/`. The gallery was regenerated and its Skyhook section retained as `gallery-card.md`; the shared gallery and registry stay outside this directory-only submission.
