# Spillway

A 127-second chase down a granite gorge on a clear morning, after a four-legged salvage walker that is heading for the dam to tear its gates out. You ride low over the river through rapids and a cascade, pass under the walker's belly, break it apart on the dam crest, and ride the flood down the spillway into a sunlit valley.

## Visual language
A lit scene rather than an emissive one: AgX tone mapping, a gradient sky baked into image-based lighting, a sun with shadows and god rays through the rim. Granite gorge walls, pines, cold green water with foam that follows the current, a drawn-down reservoir with a bathtub ring, and a concrete arch dam. The machines are worn yellow paint over bare steel with hazard chevrons and amber lamps; the player's colour is signal red.

## Musical language
132 BPM in D minor with a dorian colour, scored for synthesised hand drums, low strings and Karplus-Strong plucked strings, with no synth leads. Kills play plucked runs from per-section lanes, the music drops out at the breach, and the full theme returns on the spillway. A filtered-noise river bed follows the sections under the score.

## Mechanical signature
A 4-point hull, a pursuit target on screen for most of the run, and variable rail speed with kicks on the cascade and the spillway. Hydrofoil skiffs, rotor spotter flocks, winch pods that fire lockable rivets, and cables held by clamp buoys that cost hull if left uncut. The walker boss has four legs with hit stages, thrown concrete slabs, and a core; the gates burst on the music whether or not it falls.

## What to read
- `src/levels/spillway/index.ts`
- `src/levels/spillway/timing.ts`
- `src/levels/spillway/rail.ts`
- `src/levels/spillway/route.ts`
- `src/levels/spillway/gameplay.ts`
- `src/levels/spillway/enemies.ts`
- `src/levels/spillway/boss.ts`
- `src/levels/spillway/walker.ts`
- `src/levels/spillway/audio.ts`
- `src/levels/spillway/visuals/index.ts`
- `src/levels/spillway/visuals/walker.ts`
- `src/levels/spillway/visuals/water.ts`

## What to study here
Spillway is the reference for building a real outdoor place. It shows terrain, water, sky, sunlight, mist and trees in a lit scene that stays readable, using the lighting, haze, particle, post-stage and authored rail-frame modules in `src/engine/`. Start with `visuals/water.ts` for flowing water and foam, `world.ts` and `visuals/gorge.ts` for canyon walls lofted along the river from cross-sections, and `rail.ts` for banking, dives and look targets that turn the camera toward set pieces.

It is also the reference for a pursuit target and a boss built as one machine. The walker's pose, including two-bone leg IK, is a function of run time plus a damage record (`walker.ts`), so gameplay and visuals always agree; its body is built from shared machine parts, with hydraulic rams that stretch between their mounts as the joints move (`visuals/walker.ts`). Read `boss.ts` for a fight whose stages stay on the music: the breach always lands on its bar.

For acoustic-sounding synthesis, read `audio-pluck.ts` (Karplus-Strong strings rendered into cached buffers) and `audio-voices.ts` (hand drums and bowed strings).

Its lesson on load time applies to any detailed level: shader compile cost is dominated by inline procedural noise and by the number of distinct instanced meshes. `visuals/noise.ts` bakes noise into a texture once, and scenery is grouped into a few large instanced meshes.

## Status & notes
Needs a human playtest for the mix (whether the strings read as acoustic, whether kill runs sit above the whitewater and boss textures), game feel on hit-stop against the music, and boss difficulty. The walker is hidden by the canyon bend for a few seconds around 20–24 s.
