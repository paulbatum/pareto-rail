# Mass Driver

You are the payload chambered in an orbital railgun, riding the bore from breech to muzzle over exactly sixty seconds. The gun is the instrument: a locked 128 BPM minimal-techno pulse in E minor, one glowing accelerator ring crossed on every quarter-note beat, and a bass hum that climbs from E2 to the firing charge across the whole run. Two-thirds in, a klaxon announces six jammed safety interlocks; destroy all of them before the bar-28 downbeat and the shot throws you out of the muzzle into silent open space — fail, and the barrel detonates with you inside it.

## Visual language
Electric, not fire: near-black void, cold gunmetal, and an electrical heat ramp (arc blue → volt violet → blinding near-white) climbing down the bore. 113 beat-spaced accelerator rings with downbeat lugs, four conductor rails at the diagonals, gunmetal rib panels, camera-riding speed streaks, and a growing charge glow parked at the muzzle. Hazard amber is strictly reserved for the interlocks and the charge warnings; denial is hazard red. Letters are stencil plates with arc-blue routed edges; the reticle is a six-segment breech charge gauge that lights one segment per lock up the same heat ramp.

## Musical language
128 BPM, 32 bars = exactly 60 seconds. Main loop Em–Em–C–D (two bars per chord), Em–F Phrygian dread through the interlock bars, and a sustained E-major bloom after the shot — the whole run is minor, the release is major. A persistent detuned-saw hum climbs a fourth by the middle, an octave by the interlocks, then accelerates into the charge and cuts dead on the shot. Locks, fire, hits, and kills are transport-quantized and pitched from the live harmony with per-section timbres; kills walk hidden per-section melodic lanes; each interlock kill plays a climbing confirmation one note longer than the last.

## Mechanical signature
A 60-second, 3-hull run on a strictly accelerating speed profile that surges roughly threefold on the bar-28 shot. Wall-riding coil sentries slide around the bore rim in clock-position ranks, threader drones corkscrew across the frame as counter-rotating helices, two-stage capacitor banks shear their staves, interceptable arc bolts home on the hull, and six station-keeping interlocks (cowl, then core) hold the frame rim on a hard musical deadline. S rank requires the gun to have actually fired. START/REPLAY are CHARGE/RELOAD.

## What to read
- `src/benchmark-levels/mass-driver-detailed-m6vt/timing.ts`
- `src/benchmark-levels/mass-driver-detailed-m6vt/gameplay.ts`
- `src/benchmark-levels/mass-driver-detailed-m6vt/audio.ts`
- `src/benchmark-levels/mass-driver-detailed-m6vt/audio-voices.ts`
- `src/benchmark-levels/mass-driver-detailed-m6vt/visuals/index.ts`
- `src/benchmark-levels/mass-driver-detailed-m6vt/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Mass Driver theme assignment. Verified headless: typecheck, build, benchmark scope, simulation (perfect and imperfect policies clear the interlocks and fire the gun; no-fire runs detonate on schedule), occlusion, perf, and audio-config gates. WSL2 cannot render WebGPU, so ring-crossing feel, bloom discipline, and the mix need a human playtest. Check first: rings landing on the beat, the bar-28 shot moment (speed spike + whiteout + hum cut + E-major bloom), and interlock legibility against the charge glow.
