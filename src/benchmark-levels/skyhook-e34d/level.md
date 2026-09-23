# Skyhook

Ride a climber car up a space elevator, from a storm-lashed launch pad to the docking throat of the station at the top, and keep the car in one piece. The camera rides the car looking up the tether, so the whole climb is one continuous shot: rain and grey scud whip down past the ribbon, the car punches through the cloud deck into blue sunlight, the sky thins to indigo and then black, stars come out above and the planet curves away below. The score loses a layer every time the air does, until the only drum left is the Descender's grip clanking down the tether toward you.

## Visual language
The sky does the coloring. A camera-centred dome carries the arc through storm grey with lightning, the cloud-deck whiteout, a sunlit blue with the cloud sea below, indigo, and black with a blue atmospheric limb. Every lit surface reads the same sky-driven ambient and sun, so the storm greys everything and vacuum turns the light hard. Player-owned hardware is utilitarian: white paneling, graphite, and hazard-orange chevrons on the climber's drive head, the tether's marker bands and guide lamps, the launch gantries, and the station. Hostiles share dark slate, bone, and frost armor with one restrained storm-violet glow. Locks are hazard-orange corner brackets, shots are white-hot tracers with orange wakes, and kill debris obeys the air: whipped away and down in the weather, drifting in vacuum. START/REPLAY are 5×7 panel-cell glyphs on graphite placards with hazard frames.

## Musical language
128 BPM in D minor, 32 bars and a ring-out, scored to air density. The weather is wide and wet: detuned pads, rain plucked from the chord, half-time toms, and thunder on the same grid steps as the lightning. The deck punch opens into a full B♭-lydian band with bells, kick, and bass. The thin air drops the kick, snare, and thirds. In vacuum there is only a sub pulse, a thin drone, and the Descender's grips as iron clanks conducted up the tether, louder and brighter as it gets closer. The dock resolves to D major as the bay pressurizes. Player sounds are quantized and pitched from the live chord: locks climb the lead set, kills walk authored per-section lanes, and the player's timbres thin with the air until vacuum is dry sine tones over a hull thump.

## Mechanical signature
A 62-second run with a 5-point hull that the car and the gunner share. Enemies: kites ride gusts in banking flocks along authored screen-space paths (loops, sweeps, a vortex, an updraft). Grapplers perch, telegraph with a violet line and a proximity alarm, dive onto the drive head, and bite. Ticks lurch down the ribbon on the beat in two-stage armor. Sentinels rise past the car and fire interceptable bolts. The Descender latches onto the tether at bar 20 and climbs down one grip per beat, getting visibly bigger. Shooting out each of its four claws makes it slip back up the line. Its maw opens when the claws are gone or at bar 26. At bar 28¾ it lunges, and if it reaches the drive head the climber is torn apart. Car saves, especially late ones, pay a bonus.

## What to read
- `src/benchmark-levels/skyhook-e34d/index.ts`
- `src/benchmark-levels/skyhook-e34d/timing.ts`
- `src/benchmark-levels/skyhook-e34d/world.ts`
- `src/benchmark-levels/skyhook-e34d/gameplay.ts`
- `src/benchmark-levels/skyhook-e34d/descender.ts`
- `src/benchmark-levels/skyhook-e34d/audio.ts`
- `src/benchmark-levels/skyhook-e34d/visuals/index.ts`
- `src/benchmark-levels/skyhook-e34d/visuals/palette.ts`

## Status & notes
Built headless. Typecheck, build, and the floor gate (simulation, occlusion, performance, audio config) pass. The visuals were checked through SwiftShader snapshots and an auto-play capture harness, and the score was metered per bar in headless Chrome (no AudioParam errors, peaks under 0 dBFS). How it sounds and how it looks on real WebGPU still need a human playtest. The level owns the camera's lean in `updateCameraEffects` and keeps the player's edge-look on top of it. It widens the camera far plane to 4000 while loaded and restores it on dispose. Engine shot timing and lock radius stay at their defaults on purpose: the grid-ramp lands volley impacts on the 128 BPM sixteenth grid. Inspection: `?skyhookDebug=skip-descender` previews the dock without the boss, and `visuals/index.ts` exports `createGlyphSampler` and `createDescenderSampler` for `npm run snapshot`.
