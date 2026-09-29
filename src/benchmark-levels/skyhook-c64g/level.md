# Skyhook

A 60-second climb up a space elevator, from a storm-swept anchor platform to the station at the top of the cable. The sky does all the colouring — storm grey, whiteout, sunlit blue, indigo, black with stars and the planet curving away below — while the hardware stays utilitarian: white paneling and hazard orange. Wind-riders hunt you in the weather, vacuum-hardened sentries take over as the air gives out, and some of them go for the car instead of you. Then something huge latches onto the tether far above and starts climbing down.

## Visual language
White-panel hardware and hazard orange over a sky that is the level's colour script: a dark storm with rain and lightning, a whiteout punch through the cloud deck, sunlit blue over a sea of cloud, thinning indigo, then stars, a hard sun and a glowing planet limb. The tether is a slim white ribbon with orange edge strips and light dashes, caged by four guy cables and X-frame pylons whose beacons flash on the beat. The car is the frame you look out of: a deck, two struts and the mounting plates limpets clamp onto; the side under attack strobes orange. Wind-riders are dark swept deltas and rays with orange outlines; sentries, torpedoes and hooks are white-panel and squared-off; the Ripper is a gunmetal barrel with a shredder maw and four IK legs gripping the cables. Debris obeys the sky: it falls and drags in air, and flies straight and tumbling in vacuum. Letters are gantry signage — white plates with dark keylines and orange rivets.

## Musical language
96 BPM, 24 bars, scored as the way the air behaves. Down low it is wide and full: a big D-minor pad, soft kick, rolling plucks, wind, rain and thunder that lands on the lightning. The cloud deck is a change of mode (D minor to D major) and a drop with everything at once; then the score loses layers bar by bar — hats, clap, kick, bass, pad, arp — until the top is nearly bare. The Ripper is scored by the cable itself: a grip slam on every stride (beats one and three), a ping that climbs as it nears, a heartbeat once its core is exposed. Player actions are notes in the score: quantized to the transport, pitched from the live chord, kills walking a written lane so a chained volley is a melodic run, with a player timbre that thins with the air (chime, pluck, pure sine, struck metal, soft).

## Mechanical signature
A 60-second run on an 8-point hull that hostiles chew on from two directions. Wind-riders (kites, mantas) and vacuum-hardened sentries (RCS-hopping, firing homing bolts) go for you; limpets clamp onto the car and gnaw through it, and torpedoes and boss hooks strike its flanks — the side under attack strobes on the frame. Hostiles are placed in screen space relative to the climb view, so they pace the car while the world falls away; a wheel of six kites orbiting the view is the level's signature full-volley sweep. The Ripper falls out of the sky, strikes the cable and descends hand over hand toward the car: shoot its four clamps (each knocks it back up the cable), then its two-stage core before it reaches you — or it tears the climber apart. Kill it and the last stretch is clear: the station opens overhead, swallows the car, everything decelerates, docked. If it is somehow still alive when the car reaches the bay door, the dock clamps shear it off the cable.

## What to read
- `src/benchmark-levels/skyhook-c64g/index.ts`
- `src/benchmark-levels/skyhook-c64g/gameplay.ts`
- `src/benchmark-levels/skyhook-c64g/boss.ts`
- `src/benchmark-levels/skyhook-c64g/space.ts`
- `src/benchmark-levels/skyhook-c64g/audio.ts`
- `src/benchmark-levels/skyhook-c64g/visuals/index.ts`

## Status & notes
Benchmark build. Verified headlessly (typecheck, build, floor gate, simulation, gameplay stills); the look, feel and mix have not been confirmed on real WebGPU hardware or by ear. A playtester should look first at the cloud-deck punch-through (about 15 s), the Ripper's approach and the docking bay, and listen for the layer-by-layer thinning of the score.
Inspection captures: `deck` (bar 6, punch-through), `latch` (bar 14, the Ripper strikes the cable), `dock` (bar 21, the station opens). Note for tuners: the shared post pipeline passes a level's bloom `threshold` to the bloom node's radius slot and its `radius` to the luminance-threshold slot; `index.ts` sets both accordingly.
