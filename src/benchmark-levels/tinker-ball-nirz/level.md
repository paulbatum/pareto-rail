# Tinker Ball

One oversized worktable under a desk lamp, and you are the marble sent to clean it up. Scratches in the wood are the roads; buttons, pins and paperclips are the landscape. Dark glue monsters have built temporary bodies out of stolen supplies, and shooting a body's black adhesive core scatters its pieces across the table ahead of you. Roll over them and they stick — by the finale the ball is melon-sized, lumpy with everything it has rescued, and heavy enough to roll straight through the glue spill at the centre of the desk.

## Visual language
Warm wood, lamp light and hard shadow, with saturated stationery for anything worth rescuing and one matte near-black for the glue. Every enemy is the same recipe — a visible adhesive core wearing a body of stolen supplies — so the thing you aim at is always the thing that dies. The player's ball is on screen the whole run: it grows with the rail's height, rolls at the right rate for its radius, and carries every piece it has picked up as instanced debris welded to its surface. Words are paper chips pinned to cardboard scraps.

## Musical language
132 BPM bright workshop pop in C: bell-like mallets, clipped reed-organ stabs, a bouncy synth bass with a pitch-blip attack, handclaps, and small percussion — pencil taps, bead shakers, a wooden block. Player actions are notes: kills read a hidden 32-step melody lane off the transport grid, locks climb a pentatonic, fire and every knock take their pitch from the live chord. Each kill also schedules a *pickup rattle* two and a half seconds later, quantized onto the grid, for the moment its pieces actually reach the ball.

## Mechanical signature
A 60-second run across three scales of ball — marble, tennis ball, melon — with a 3-point hull and six lockable enemy kinds plus thrown glue blobs to shoot down. Ground creatures scuttle, stride, roll and lumber along the table; cardboard birds swoop above it. The finale is a glue spill whose three crusts cover three cores, all of it releasable at any time but protected: a premature volley flashes whatever is still shielding the target and glazes the heart over for a beat. The bare heart only breaks under a volley carrying every lock it can hold.

## What to read
- `src/benchmark-levels/tinker-ball-nirz/gameplay.ts`
- `src/benchmark-levels/tinker-ball-nirz/spill.ts`
- `src/benchmark-levels/tinker-ball-nirz/audio.ts`
- `src/benchmark-levels/tinker-ball-nirz/visuals/pieces.ts`
- `src/benchmark-levels/tinker-ball-nirz/visuals/index.ts`

## What to study here
Two things are worth stealing. The first is `visuals/pieces.ts`: a level-owned feedback loop where kills leave physical debris on the table, loose pieces crawl into the lane the camera is following, and the ball welds them to its surface as instanced geometry. The player's whole run history is visible on screen at all times for six draw calls, and the audio answers it on the grid seconds later.

The second is the wave authoring in `gameplay.ts`. Waves are written in screen fractions, not world units, and `aheadUnits` converts them at build time using the level's own speed profile and rail length. Because the camera climbs and speeds up across the run, a fixed world offset would have drifted from filling the frame to hugging the middle; the fraction stays put. Ground creatures are additionally seated against the table rather than the rail, so the horizon line sinks through the frame as the ball grows — the scale story is carried by the composition instead of by a scale multiplier.

One trap to avoid, learned the hard way here: `MultiplyBlending` ignores `opacity`. A black quad set to 30% alpha still multiplies the frame to zero, and a handful of them stacked cut a hole clean through the table. Fake shadows have to carry their strength in the colour and stay well away from black.

Weaker ground: the level was built without a working WebGPU device, so the lamp-lit mix, the bloom balance and the ball's framing have never been seen at full fidelity. Calibrate lighting elsewhere. The three enemy silhouettes of the marble act also carry more of the run than they should — the tennis-ball act reuses them rather than introducing a wholly new shape language.

## Status & notes
Verified headless: `typecheck`, `build`, `check:floor` (occlusion worst case 1.0%, all performance gates green), `check:occlusion`, `check:perf`, `simulate` across all four policies with full event coverage, and `trace:audio`. The pick-up loop in `visuals/pieces.ts` was exercised directly with a scratch driver — a moving camera over a scattered debris field welds every non-stray piece to the ball — because no headless tool drives kills and renders at the same time.

Never rendered under WebGPU. A human playtest should look first at the ball's framing along the bottom of the frame, the readability of black glue cores against dark wood with the bloom slider at zero, whether the accumulated cargo on the ball reads as recognisable supplies rather than confetti, and whether the spill fight reads as three layers of armour.
