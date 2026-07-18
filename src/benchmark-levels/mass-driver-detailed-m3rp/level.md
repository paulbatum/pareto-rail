# Mass Driver

You are the payload chambered in an orbital railgun, riding the bore from breech to muzzle in exactly sixty seconds of locked 128 BPM minimal techno. One glowing accelerator ring crosses the cockpit on every beat — the beat grid is the level's unit of distance as well as time — the run only ever accelerates, and the gun fires on the downbeat of bar 28 whether or not you are ready. Two-thirds in, a klaxon announces that the six safety interlocks have jammed across the bore: clear them all before the charge peaks and the shot throws you into silent open space; fail, and the barrel detonates with you inside it.

## Visual language
Electric, not fire: a near-black void, cold gunmetal structure, and one heat ramp — arc blue → volt violet → blinding white — that the 112 beat-spaced rings, four conductor rails, and closing hostiles all climb as the run accelerates. Hazard amber is reserved for the jammed interlocks, charge warnings, and detonation; the player's reticle (a six-segment breech charge gauge), locks, and ion darts stay ion white and arc blue. Letters are stencil plates off the gun housing; camera-riding speed streaks and a capped muzzle charge glow carry the acceleration; past the muzzle, a starfield, star-streaks, and one distant beacon in vacuum black.

## Musical language
128 BPM minimal techno in E minor, 32 bars = 60 seconds: Em–Em–C–D two bars per chord, Em–F Phrygian dread under the boss bars, and a lone E major bloom after the shot. A persistent bass hum — the gun spooling up — climbs from E1 across the whole run and is cut dead by the shot. A struck-coil tick lands on every ring crossing; locks, shots, chips, and kills are transport-quantized, pitched from the live harmony, and walk hidden per-section melodic lanes; each interlock kill plays a climbing confirmation one note longer than the last.

## Mechanical signature
A 60-second, 3-hull run on a strictly accelerating speed profile that surges ~3× on the bar-28 shot. Wall-riding coil sentries lob telegraphed interceptable arc bolts, needle threaders corkscrew across the frame as counter-rotating helices, two-stage capacitor banks shed their six staves, and six station-keeping interlock clamps brood at the frame rim on a hard musical deadline — any clamp still standing at the shot detonates the barrel. S rank requires the gun to actually fire. START is CHARGE; REPLAY is RELOAD.

## What to read
- `src/benchmark-levels/mass-driver-detailed-m3rp/timing.ts`
- `src/benchmark-levels/mass-driver-detailed-m3rp/gameplay.ts`
- `src/benchmark-levels/mass-driver-detailed-m3rp/audio.ts`
- `src/benchmark-levels/mass-driver-detailed-m3rp/audio-voices.ts`
- `src/benchmark-levels/mass-driver-detailed-m3rp/visuals/index.ts`
- `src/benchmark-levels/mass-driver-detailed-m3rp/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Mass Driver theme assignment. Verified headless: typecheck, build, benchmark scope, floor (simulation, occlusion, perf), and audio trace. WSL2 cannot render WebGPU, so ring-crossing feel, bloom discipline, and the final mix need a human playtest — check first that ring passes land on the beat, that the bar-28 shot reads as the run's biggest moment, and that the interlocks stay legible against the charge glow.
