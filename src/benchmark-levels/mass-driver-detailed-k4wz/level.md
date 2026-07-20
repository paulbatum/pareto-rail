# Mass Driver

You are the payload chambered in an orbital railgun, riding the bore from breech to muzzle over exactly sixty seconds. The run is scored to a locked 128 BPM minimal-techno pulse in E minor, and the core conceit is geometric: the payload crosses one glowing accelerator ring on every quarter-note beat, so the ring tunnel *is* the transport grid. The gun fires on the downbeat of bar 28 whether or not you are ready; six jammed safety interlocks decide whether that shot throws you cleanly into silent open space or detonates the barrel around you.

## Visual language
Electric, not fire: near-black void, cold gunmetal rib walls, and one electrical heat ramp — arc blue → volt violet → blinding near-white — climbing the bore across 113 beat-spaced accelerator rings, four diagonal conductor rails, and camera-riding speed streaks. The player's kit (reticle, locks, ion-dart shots) stays ion-white and arc blue; hazard amber is strictly reserved for the six chevron-banded interlock clamps, and denial/detonation flush hazard red. Letters are stencil plates off the gun housing; the reticle is a six-segment breech charge gauge whose sixth segment lights ignition-white. Three full-frame overlays (flash, center-pooling charge, detonation) carry the whiteout, the building charge, and containment failure.

## Musical language
128 BPM, 32 bars = 60.000 s, Em–Em–C–D two bars per chord, Em–F Phrygian dread through the interlock bars, and a sustained E-major bloom after the shot — the whole run is minor, the release is major. Underneath everything a persistent detuned-saw hum climbs from E1 up a fourth by the middle, an octave by the interlocks, then accelerates into the charge peak and is cut dead by the shot. Locks walk the live lead, kills walk hidden per-section melodic lanes in five crossfaded timbres, each interlock kill plays a climbing confirmation one note longer than the last, and the sixth lands a ducked beat, an impact, and a conclusive descent.

## Mechanical signature
A 60-second, 3-point-hull run whose speed profile only ever rises, spiking roughly threefold on the bar-28 shot. Wall-riding coil sentries slide the bore rim and lunge to loose interceptable arc bolts, needle threaders corkscrew counter-rotating helices across the frame, two-stage capacitor banks shed their insulator staves, and six two-stage interlock clamps station-keep at the frame rim from bar 20 on a hard musical deadline: clear all six before the charge peaks for the muzzle exit, or the barrel detonates with you inside it. S rank requires the gun to have actually fired.

## What to read
- `src/benchmark-levels/mass-driver-detailed-k4wz/timing.ts`
- `src/benchmark-levels/mass-driver-detailed-k4wz/gameplay.ts`
- `src/benchmark-levels/mass-driver-detailed-k4wz/audio.ts`
- `src/benchmark-levels/mass-driver-detailed-k4wz/visuals/index.ts`
- `src/benchmark-levels/mass-driver-detailed-k4wz/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Mass Driver theme assignment. Verified headless: typecheck, build, check:benchmark-scope, check:floor (simulation, occlusion, distribution, perf), and trace:audio. WSL2 cannot render WebGPU, so the real frame and the mix need a human playtest — check first that ring crossings land audibly and visibly on the beat, that the bar-28 shot reads as the single biggest moment (speed spike, whiteout, FOV kick, hum cut, E-major bloom at once), and that the interlocks stay legible against the charge glow with bloom at zero.
