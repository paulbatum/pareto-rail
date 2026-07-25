# Thermal Ink

One continuous 60-second boss fight with a giant mutant octopus wrapped around the wreckage of a drowned industrial harbor. The fight's rhythm is the ink: three times the creature blacks out the route, infrared snaps in, and the world flips from sodium-lamp murk to a stark charcoal display where flesh blazes white-hot and signal cores burn red. Sever all six arms, then put the core out through the final blackout as the harbor lamps return.

## Visual language
Tobacco-brown murk, rust hulls, dirty cream paint, and hard amber sodium lamps; the octopus is an oily mass on a capsized hull. Infrared is a material-swap plus screen grade: charcoal grayscale with scanlines, white-hot enemy silhouettes, red signal cores, and ink that stays cold black. Letters are stencil plates bolted to rust signage; the reticle is a sonar sweep.

## Musical language
96 BPM E natural minor (Em–Cmaj7–Am–Bm), 24 bars = 60 s. Slow industrial pulse, heavy bouncing filter bass, sparse anvil/chain percussion, and one haunting 8-bar lead. Under infrared the drums fall back to a sub pulse with sonar pings and the melody turns bright and focused. Kills walk per-mode melody lanes, locks climb the live chord, core chips ring an escalating anvil, and the killing blow lands a scheduled finale with a foghorn.

## Mechanical signature
A 3-hull run where the boss rides 30 units ahead the whole way. Six 2-HP arm targets sweep wide around the body in three pairs; skimmers cross the full screen, lurkers telegraph and spit interceptable homing ink globs, armored dredgers grind in. The core (stages 2+6) is only lockable once every arm is dead and the final blackout has begun, so the last volley always lands through ink.

## What to read
- `src/benchmark-levels/thermal-ink-yk97/gameplay.ts`
- `src/benchmark-levels/thermal-ink-yk97/octopus.ts`
- `src/benchmark-levels/thermal-ink-yk97/timing.ts`
- `src/benchmark-levels/thermal-ink-yk97/audio.ts`
- `src/benchmark-levels/thermal-ink-yk97/visuals/index.ts`
- `src/benchmark-levels/thermal-ink-yk97/visuals/post-fx.ts`

## What to study here
The ink/infrared mode system: one bar-aligned clock in `timing.ts` (ink windows, `inkAt`, `infraredAt`) drives gameplay staging, the arrangement's section turnovers, the material mode-swap registry (`visuals/moded.ts`), the fog/background atmosphere, and the TSL screen grade — so the blackout is simultaneously a musical turnover, a visual mode, and a boss gate. The core's lockability being gated on "all arms dead AND final blackout begun" guarantees the authored finale lands for every player.

## Status & notes
One-shot benchmark build. Verified headless: typecheck, build, simulate (perfect policy clears 54/54 at 60.0 s), occlusion, perf, and floor gates; SwiftShader stills reviewed for murk, blind-beat, infrared, and finale frames. Engine defaults (shot rhythm, lock radius, START!/REPLAY words, no validateRelease) are deliberate: 96 BPM suits the default grid-ramp, and boss gating runs through core lockability instead of release rules. Needs human WebGPU playtest: bloom level on the white-hot mantle under infrared, ink-blackout pacing feel, and the mix.
