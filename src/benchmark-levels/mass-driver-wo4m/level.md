# Mass Driver

A sixty-second ride down the barrel of an orbital railgun, where the music is the gun: the payload crosses one glowing accelerator ring on every beat of a locked 128 BPM pulse, the rings burn from arc blue through violet toward blinding white as the run accelerates, and the bass hum underneath climbs in pitch from breech to muzzle. The finale jams the gun's own safety interlocks in your face — clear all six before the charge peaks and the shot throws you out of the muzzle into silent open space.

## Visual language
Near-black void and gunmetal barrel structure; 112 beat-spaced accelerator rings on an electric heat ramp (arc blue → violet → blinding white), four HDR conductor rails, and camera-riding ion streaks. Hazard amber is reserved for the jammed interlocks, charge warnings, and denial. Letters are stencil plates off the gun housing; the reticle is a six-segment breech charge gauge that fills one segment per lock.

## Musical language
128 BPM locked minimal techno in E minor, 32 bars = exactly 60 seconds. The gun is the instrument: a persistent bass hum climbs from E1 across the whole run and accelerates into the firing charge through the interlock bars, cutting dead on the bar-28 shot. Locks, shots, hits, and kills are transport-quantized and pitched from the live harmony; kills walk hidden per-section melodic lanes; each interlock destroyed plays a climbing confirmation. After the shot, everything strips to a quiet E-major bloom in open space.

## Mechanical signature
A 60-second run with a 3-point hull and a strictly accelerating speed profile that spikes ~3× on the bar-28 shot. Wall-riding coil sentries that lob interceptable arc bolts, needle threaders corkscrewing through the bore, two-stage capacitor banks, and a six-interlock boss on a hard musical deadline: clear them before bar 28 and the gun fires you into space; fail and the barrel detonates with you in it.

## What to read
- `src/levels/mass-driver-wo4m/timing.ts`
- `src/levels/mass-driver-wo4m/gameplay.ts`
- `src/levels/mass-driver-wo4m/audio.ts`
- `src/levels/mass-driver-wo4m/visuals/index.ts`
- `src/levels/mass-driver-wo4m/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Mass Driver theme assignment. Verified by typecheck, build, check:scope, check:floor (simulation, occlusion, perf), and trace:audio; WSL2 cannot render WebGPU headless, so ring-pass feel, bloom discipline, and the music mix still need a human playtest. First things to check by hand: rings landing on the beat, the bar-28 shot moment, and interlock readability against the charge glow.
