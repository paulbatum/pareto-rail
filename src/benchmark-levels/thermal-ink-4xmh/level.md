# Thermal Ink

Sixty seconds in a drowned industrial harbour, spent entirely inside one boss fight. A giant mutant octopus is already wrapped around the wreck when the run starts, dragging cables through tobacco-brown water and shaking scavengers loose from broken machinery. Three times across the run it fires a cloud of oil-black ink over the rail and takes your eyes away — and the trigger you were already holding turns out to be an infrared imager. The level is recognisable in a single frame either way: sodium murk and rust, or a stark charcoal display where the creature blazes white and its soft points burn red.

## Visual language
Two complete palettes on one shared uniform. Normal sight is sodium-harbour murk — tobacco water, ochre grit, rust-red steel, dirty cream paint, hard lamps burning through the haze, and the octopus as an oily mass with sodium sheen along its edges. Infrared is charcoal: creature and spawn go white-hot, vulnerable points burn as red signal cores, everything people built goes cold, and the drifting ink stays a black void. Every surface declares both colours, so the mode switch repaints the harbour instead of tinting it.

## Musical language
96 BPM, twenty-four bars, exactly 60 seconds. A slow industrial pulse under heavy bouncing synth bass and sparse metallic percussion, with one simple haunting melody sitting in the lower half of the lead set. Kills read a hidden two-bar lane in the octave above the tune, so a chained volley solos over it. Raising the imager is a mix move: the grit bus falls back, the melody's filter opens, and the player's kill voice snaps bright.

## Mechanical signature
One continuous boss fight with a 4-point hull. Four arms, each severed over two volleys, then a beak that only opens inside the ink — a release aimed at the core in clear water is turned away. Scuttlers rake the frame edges, hatchlings jet in pulses, vent pods wallow in on two hit points, and the creature spits homing ink bolts that can be shot down. Infrared engages only inside a cloud, only while the trigger is held, and lingers just long enough to watch a blind volley land.

## What to read
- `src/benchmark-levels/thermal-ink-4xmh/timing.ts`
- `src/benchmark-levels/thermal-ink-4xmh/vision.ts`
- `src/benchmark-levels/thermal-ink-4xmh/gameplay.ts`
- `src/benchmark-levels/thermal-ink-4xmh/octopus.ts`
- `src/benchmark-levels/thermal-ink-4xmh/audio.ts`
- `src/benchmark-levels/thermal-ink-4xmh/visuals/index.ts`
- `src/benchmark-levels/thermal-ink-4xmh/visuals/materials.ts`

## What to study here
The second sense. `visuals/materials.ts` gives every surface a murk colour and an infrared colour behind one `thermalUniform`, so a level-wide sensory switch costs one ramp instead of a material swap. The ink clouds are real transparent geometry whose opacity drops when the imager comes up, which means "seeing through the cloud" is literally true rather than a screen trick. The whole mechanic rides on the one hold signal the engine exposes to a level — the `active` flag passed to `setReticleActive` — so it needs no new input and works on touch.

Also worth reading: `octopus.ts` keeps the boss as a pose rather than an object, and each arm target owns the instanced limb running back to the mantle. That is what stops an arm from occluding its own lock point, and it means severing an arm takes its geometry with it.

Weaker ground: the creature's mantle is a low-detail silhouette that reads better in infrared than in murk, and the harbour scenery is honest set dressing rather than a place with a layout. Calibrate boss-body detail elsewhere.

## Status & notes
Built and verified headlessly. WebGPU cannot render in this environment, so every still came from the SwiftShader/WebGL fallback and the audio was never heard. A human playtest should check, in order: whether the first blackout at bar 6 reads as a teachable moment, whether the infrared image is bright enough at gameplay distance, and whether the grit-bus duck under the imager is audible rather than merely measurable.
