# Tinker Ball

A marble rolls across a warm, cluttered worktable, rescuing supplies from black glue creatures. Button beetles, pencil striders, and snapping peg birds break into loose pieces that the ball collects. Each pickup adds a visible lump to its surface. A bright mallet-pop score accompanies the journey from sewing notions to a three-shell glue-spill finale.

## Visual language
Honey-colored wood grain, cream paper, teal thread, coral buttons, brass clips, and glossy charcoal adhesive. Creatures have exposed dark cores, pale eyes, and recognizable supply bodies. Lock rings and pin projectiles remain visible without bloom. START and REPLAY use riveted wooden letter tiles with procedural 5×7 glyphs.

## Musical language
128 BPM; 32 bars, exactly 60 seconds. Bell-like mallets answer clipped reed-organ chords, a bouncing triangle bass, handclaps, and workshop ticks. Four arrangement sections change density at the enemy phrase boundaries. Player actions quantize to the transport and follow the current harmony; chained kills play ascending and descending written melody lanes. Boss stage breaks duck the backing and add high mallet figures.

## Mechanical signature
Hold, sweep, and release up to six locks. Three ordinary creature kinds use scuttling, swaying, and flapping motion. Three spill cores each require three two-hit stages. Broken shells scatter persistent supplies onto the table. The ball steers through nearby fresh debris fields and retains the collected objects on its rolling surface. Score rewards volleys; the summary reports rescued supplies and dismantled shells. This is a cleanup challenge without hull damage.

## What to read
- `src/benchmark-levels/tinker-ball-x9a0/index.ts` — runtime wiring and postprocessing.
- `src/benchmark-levels/tinker-ball-x9a0/gameplay.ts` — tabletop rail, musical spawn phrases, motion, scoring.
- `src/benchmark-levels/tinker-ball-x9a0/audio.ts` — arrangement, synthesis, transport-bound player instruments.
- `src/benchmark-levels/tinker-ball-x9a0/visuals/index.ts` — table, ball, collection, event responses.
- `src/benchmark-levels/tinker-ball-x9a0/visuals/models.ts` — supply and creature construction.

## What to study here
The collected objects are the same meshes that scatter from defeated enemies. They land before collection, and the ball steers toward the next reachable debris field. This ties the growing silhouette to successful shots rather than a timer. Procedural supply meshes appear in scenery, creature shells, debris, and the ball, so each material remains recognizable through the cleanup cycle.

## Status & notes
Directory-only benchmark entry. Uses the shared runner and no other level modules. Verified: `typecheck`, `build`, `check:floor` (occlusion 0 warnings, performance gates 0 failures, audio configuration 0 failures), seeded simulation 56/56 kills with no impossible moments and no dead air before the 51.5s coda, audio trace 972 scheduled events across four sections, and a scripted headless run confirming 101 debris pickups with ball growth to 1.7 radius. `check:benchmark-scope` cannot execute in this checkout because its companion `scripts/benchmark/protocol.mjs` was scrubbed from the entrant baseline; the working tree contains only the level directory and `public/level-content/tinker-ball-x9a0/`, which is the footprint that checker enforces.

Headless capture here renders on SwiftShader/WebGL, so the WebGPU bloom pass, motion blur, and audio mix remain unverified. A human playtest should check first: the collection arc's steering against the camera route, the three-stage boss shells' readability during the 40–50s window, and mix balance of mallet kills against the claps and bass. The runtime deliberately uses the shared shot-rhythm and action-snap defaults. Uncollected debris expires after 18 seconds to bound the active scene; pickups remain on the ball with a capped detail budget.
