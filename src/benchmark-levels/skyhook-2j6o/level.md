# Skyhook

A 60-second climb up a space-elevator tether, riding a climber car from the storm at the anchor to the station at the top. The sky does the colouring — storm grey, sunlit blue, indigo, black — and the hardware stays utilitarian: white paneling, hazard orange, red hostile marker lights, nothing neon. Speed is the world falling away: rain, the cloud deck, debris, the planet's limb curving off below. The car can take damage, so the enemies that go for the deck matter as much as the ones that shoot at the turret.

## Visual language
A straight rail pitched twenty degrees up beside a white tether with orange collars whipping past. A camera-centred sky dome and a backdrop disc carry the four sky phases; a real cloud deck gets punched through at bar 8 with a white-out. Charcoal wind-riders with red lights in the weather, bare-metal vacuum hardware up top, and the Tetherjack: a hexagonal salvage crawler with a caged red core, three hook claws on the tether, and a spine of segments climbing away. Player instruments are pale cyan-white: gunsight reticle with six charge arcs, bracket locks, tracer darts. Letters are stencil-cut white placards with orange rims.

## Musical language
128 BPM, D major, 32 bars = 60 s, scored like the air: wide down low (rain and wind beds, soft four-on-the-floor, brushed snare, detuned saw pad, sub bass, sixteenth plucks) and losing a layer at every station — rain cuts at the deck, snare goes at the thinning, kick and pad width go at vacuum — until the dock is a sine pedal, a clock tick and a bell. Player actions are transport-quantised notes on the live chord; kills walk a hidden two-bar lane per section; the Tetherjack's lurches are the downbeat thuds and its drone rises with proximity.

## Mechanical signature
Five-point hull. Kites slalom on the wind, squalls and sentinels shoot interceptable bolts, limpets dive for clamp slots on the deck and chew the hull until pried off, mites dash in rigid vacuum lines. The Tetherjack latches far above at bar 18.5 and climbs down one lurch per downbeat; its claws are lockable inside range, killing them exposes the two-stage core, and if it reaches the deck it tears the climber apart. Once it is dead the last stretch is clear: the station iris opens, the car decelerates into the bay, and it docks at bar 32.

## What to read
- `src/benchmark-levels/skyhook-2j6o/index.ts`
- `src/benchmark-levels/skyhook-2j6o/gameplay.ts`
- `src/benchmark-levels/skyhook-2j6o/boss.ts`
- `src/benchmark-levels/skyhook-2j6o/timing.ts`
- `src/benchmark-levels/skyhook-2j6o/audio.ts`
- `src/benchmark-levels/skyhook-2j6o/visuals/index.ts`
- `src/benchmark-levels/skyhook-2j6o/visuals/environment.ts`

## Status & notes
Benchmark entrant built to the standing brief. Verified headlessly: typecheck, build, simulation (perfect policy clears all 75 targets and the Tetherjack; imperfect policy survives at rank A), occlusion, performance, and audio-config gates. Visual and audio quality still need a human WebGPU playtest: check the storm murk and lightning first, the deck punch-through white-out at bar 8, the Tetherjack's size and lurches from bar 20, and the mix thinning to the dock bells. Inspection captures: `deck` (cloud deck punch-through, bar 8), `latch` (Tetherjack contact, bar 18.5), `vacuum` (black sky, boss lurching, bar 22), `dock` (station bay, bar 29).
