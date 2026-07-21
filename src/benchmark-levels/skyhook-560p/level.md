# Skyhook

Sixty seconds riding a climber car up a space-elevator tether, from a storm deck
at nine kilometres to a docking station in vacuum. The camera flies straight up:
the ribbon recedes to a vanishing point dead ahead and everything else — rain,
cloud, shed ice, hostiles — falls past the frame. The hardware is all white
paneling and hazard orange, and the sky does the colouring: storm grey, sunlit
blue, indigo, black. Recognisable at a glance by the tether streaming past on
the left, and by ear because the mix visibly runs out of air as the car climbs.

## Visual language
White panel, grey structure and hazard-orange stripe for everything people
built; instrument cyan for everything the player owns — reticle, lock brackets,
tracers, and the cold tint a target takes the moment it is locked. Fog density
is literally air density, so the world clears as the car rises. The climber's
own cowl frames the bottom of the frame with clamp arms holding the ribbon, and
letters are hazard placards bolted to the tether with the character stencilled
through white panel.

## Musical language
160 BPM in A minor, 40 bars = exactly 60 seconds. One idea: the arrangement
loses a layer of air at every altitude. A wind bed and a wet four-note pad in
the weather; a bright sunlit drop at the cloud deck; layers and reverb draining
away through the thin section; a dry, structure-borne vacuum mix for the boss
where a tether toll subdivides from quarters to sixteenths as the Descender
closes; four near-silent bars at the dock. The player's instrument rides the
same curve, from a bell in a cathedral to a dry click, and kills walk hidden
per-section melody lanes so a chained volley performs a written phrase.

## Mechanical signature
A 5-point climber hull and six enemy kinds: wind-riding kites, ballast pods,
vacuum sentries that fire interceptable homing slugs, falling shards, and
latchers — which ignore the player entirely, clamp onto the car's cowl at the
bottom of the frame and cut into the hull until they are pried off. The boss,
The Descender, grips the tether above and hauls itself down for the whole fight:
four clamp arms hold it on, every arm torn off makes it slip back up, and the
exposed core has to die before it reaches the car. Then the station swallows the
climber, the camera finally looks back down the tether, and everything stops.

## What to read
- `src/benchmark-levels/skyhook-560p/timing.ts`
- `src/benchmark-levels/skyhook-560p/gameplay.ts`
- `src/benchmark-levels/skyhook-560p/descender.ts`
- `src/benchmark-levels/skyhook-560p/audio.ts`
- `src/benchmark-levels/skyhook-560p/visuals/index.ts`

## Status & notes
Built headless: typecheck, build, simulation, occlusion, performance and audio
config all pass. WebGPU cannot render in this environment, so the look and the
mix still need a human playtest — start with the cloud-deck punch at bar 8, the
Descender's approach through bars 24–35, and the docking sweep at bar 38.
