# Skyhook

Sixty seconds up a space elevator, defending the climber car from the storm anchor to the station: launch in grey weather, punch the cloud deck on the drop, watch the sky thin from sunlit blue to indigo to starfield black while the planet curves away below — then something huge takes the tether overhead and starts climbing down toward the car.

## Visual language
The sky does all the coloring: storm grey, sunlit blue, indigo, vacuum black, with a curving cloud-swirled planet falling away below and stars arriving on schedule. The hardware stays utilitarian — white paneling and hazard orange for the tether, climber car, letters, reticle, and station; hostiles are gunmetal silhouettes with pale worklight edges and signal-red slits. Rain, cloud wisps, and falling debris streak downward past the camera the whole way up; the Lamprey boss is a segmented gripper the size of a house, its iris of plates opening over an orange core once its claws are cut.

## Musical language
128 BPM in A minor, 32 bars = 60 seconds, and the arrangement is an altimeter: wide wind-bedded pads and four-on-the-floor in the storm, a brighter drop through the cloud deck, then the kit strips as the air thins — half-time pulse and glass bells in the stratosphere, and near-vacuum for the boss (sub pulses, hull ticks, a low two-saw dread motif over Am–Bb–Am–E). The dock resolves to A major at a whisper with a mechanical latch. Locks, shots, chips, and kills snap to the transport, read the live chord, and kills walk hidden per-act melody lanes.

## Mechanical signature
A 60-second run with a 3-point hull that is the car itself: sappers dive past you, latch onto the climber, and drill on a visible lamp timer unless pried off; a two-stage breaker crawls down the tether; storm gliders and updraft sprites own the weather while thruster-hopping spikers throw interceptable railgun bolts up top. The Lamprey latches at bar 19 and hauls itself down the tether for nine bars — three grip claws gate its staged core, and if it reaches the car it tears a hull point off every two seconds until killed. Variable rail speed surges through the cloud punch and decelerates hard into the docking collar.

## What to read
- `src/levels/skyhook-snxd/timing.ts`
- `src/levels/skyhook-snxd/gameplay.ts`
- `src/levels/skyhook-snxd/lamprey.ts`
- `src/levels/skyhook-snxd/audio.ts`
- `src/levels/skyhook-snxd/audio-voices.ts`
- `src/levels/skyhook-snxd/visuals/index.ts`
- `src/levels/skyhook-snxd/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Skyhook theme assignment. Typecheck, build, check:scope, and check:floor verified headless; WebGPU visuals and the final mix need a human playtest (WSL2 cannot render WebGPU). First things to check by eye: the cloud-deck punch at bar 8, tether/car readability with bloom at zero, and the Lamprey's descent reading clearly as "it is getting closer".
