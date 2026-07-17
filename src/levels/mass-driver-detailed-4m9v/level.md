# Mass Driver

You are the payload chambered in an orbital railgun, riding the bore from breech to muzzle in exactly sixty seconds. One glowing accelerator ring crosses the camera on every quarter-note beat of a locked 128 BPM pulse, the gun's own hum climbs in pitch underneath the whole run, and the firing charge builds whether or not you are ready: six safety interlocks jam across the bore at bar 20, and the gun fires on the downbeat of bar 28 — clear all six and the shot throws you out of the muzzle into silent open space; fail and the barrel detonates with you inside it.

## Visual language

Electric, not fire: a near-black void, cold gunmetal structure, and an electrical heat ramp — arc blue through volt violet toward blinding white — carried by 112 beat-spaced accelerator rings, four conductor rails at the diagonals, and camera-riding ion streaks. Hazard amber is strictly reserved for the jammed interlocks, the charge warnings, and denial. All five hostiles are machined from the same gunmetal facet vocabulary with thin electric edges and small hot cores; letters are stencil plates with arc-blue routed edges; the reticle is a six-segment breech charge gauge whose sixth segment is ignition-white. Effects are vacuum-electrical: straight splinter sparks, thin shockwave rings, jagged flickering arc lightning, and flash discs for the shot and the detonation.

## Musical language

128 BPM locked minimal techno in E minor; 32 bars is exactly 60 seconds. Main loop Em–Em–C–D two bars per chord; the interlock bars turn to Em–F phrygian dread; the muzzle resolves to a sustained E-major bloom. A persistent detuned-saw hum — the gun spooling up — climbs from E1 by a fourth, then an octave, then accelerates into the charge peak, cut dead by the bar-28 shot. Locks, shots, chips, and kills are transport-quantized and pitched from the live harmony with per-section timbres; kills walk hidden per-section melodic lanes; each interlock kill plays a climbing confirmation one note longer than the last, capped with a clamp-release clank that drops in pitch.

## Mechanical signature

A 60-second run on a strictly accelerating rail that surges roughly threefold on the bar-28 shot. 3-point hull; CHARGE/RELOAD start words. Wall-riding coil sentries slide around the bore rim and lunge inward to loose interceptable arc bolts, needle threaders corkscrew across the frame in counter-rotating pairs, two-stage capacitor banks shear their staves, and six two-stage interlock clamps station-keep at frame-rim clock positions on a hard musical deadline. S rank requires the gun to have actually fired.

## What to read

- `src/levels/mass-driver-detailed-4m9v/timing.ts`
- `src/levels/mass-driver-detailed-4m9v/gameplay.ts`
- `src/levels/mass-driver-detailed-4m9v/audio.ts`
- `src/levels/mass-driver-detailed-4m9v/audio-voices.ts`
- `src/levels/mass-driver-detailed-4m9v/visuals/index.ts`
- `src/levels/mass-driver-detailed-4m9v/visuals/environment.ts`

## Status & notes

Built to the standing brief from the Mass Driver theme assignment. Verified headless: typecheck, build, check:scope, check:floor (simulation, occlusion, distance, perf), and trace:audio. WSL2 cannot render WebGPU, so the frame and the mix need a human playtest — check first that ring crossings land on the beat, that the bar-28 shot reads as the biggest moment in the game, and that the interlocks stay legible against the growing charge glow.
