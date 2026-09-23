# Tinker Ball

A toy rubber ball rolls across one enormous honey-oak worktable under a warm architect's lamp, cleaning up an infestation of glue monsters: black adhesive cores that have stolen buttons, pins, spools, pencils, rulers, jars, and cardboard and built bodies out of them. Shoot a core and the body falls apart into clean supplies that land on the road ahead; the ball swerves through every fresh debris field and rolls the pieces up, so by the end it is a lumpy, melon-sized record of every monster you took apart. Bright, eccentric workshop pop — mallets, reed-organ stabs, a bouncy bass, handclaps, and a table-thump kick — lifts a whole step every time the ball grows.

## Visual language
Warm honey oak with procedural planks, grain, and stains; the route is a pale scratch worn into the varnish that widens as the ball grows. Real-size clutter (buttons and pins at marble scale, spools and paint pots that loom like buildings, rulers and jars later), a giant architect's lamp over the spill, soft lamp-side contact shadows. Monsters are built from the same supplies smeared with glossy black glue around an oily violet-teal core; locked cores ring solvent-yellow inside a rubber-band loop. The reticle is a brass washer, shots are beads of citrus solvent, and START/REPLAY are pegboard tiles whose pegs burst into beads the ball rolls up on its way out.

## Musical language
128 BPM, exactly 32 bars. C major for the marble, D for the tennis ball, E for the melon, E minor for the spill, E major for the coda — every size-up is a key change on a phrase boundary with a tape-measure zip and a rubbery swell. The band is a table-thump kick, handclaps, needle ticks, a screw-tin shaker, wood blocks, ruler twangs, a scooping synth bass, and clipped reed-organ stabs. The player is the lead: kills walk a hidden two-bar melody lane on an instrument that grows with the ball (glockenspiel → marimba → vibraphone → the spill's tubular bells → a music box), locks climb the section's pentatonic as struck ticks, releases are a solvent spritz on the chord root, and every piece that sticks to the ball adds a quantized music-box tick from the live chord, so rolling through a debris field glitters. The heart's shell tolls a tubular bell that climbs with damage; its death ducks the band for a gong, an E-major organ bloom, and a glockenspiel run while the table applauds.

## Mechanical signature
A 60-second run with a 4-point "stickiness" hull. Three families rebuilt at three scales — stop-and-go beetles that dash on the beat and hop on downbeats, stilt striders stepping one stride per beat on pins/pencils/rulers, and snappers whose clothespin beaks snap on the beat — plus heavy two-lock haulers that shed a piece per hit. The ball director arcs the ball off its route through each fresh debris field and swings the chase camera onto it. The spill boss: three cores that surface out of a glue lake wrapped in two recycled shell layers (each cracked layer showers the route with pieces) and spit lockable glue globs at the lens, then the heart — two full six-lock layers — before the ball rolls through the spill's clean centre and coasts across a spotless patch.

## What to read
- `src/benchmark-levels/tinker-ball-hh5u/index.ts`
- `src/benchmark-levels/tinker-ball-hh5u/gameplay.ts`
- `src/benchmark-levels/tinker-ball-hh5u/ball.ts`
- `src/benchmark-levels/tinker-ball-hh5u/route.ts`
- `src/benchmark-levels/tinker-ball-hh5u/spill.ts`
- `src/benchmark-levels/tinker-ball-hh5u/audio.ts`
- `src/benchmark-levels/tinker-ball-hh5u/audio-voices.ts`
- `src/benchmark-levels/tinker-ball-hh5u/visuals/index.ts`
- `src/benchmark-levels/tinker-ball-hh5u/visuals/recipes.ts`
- `src/benchmark-levels/tinker-ball-hh5u/visuals/pieces.ts`

## What to study here
The camera is owned by gameplay, not visuals: `ball.ts` places a chase camera behind a ball whose size, lateral arc, and focus all live in one director, and `updateCameraEffects` recovers the player's edge-look rotation from the runner's rail pose so the override doesn't eat it. Because it lives in gameplay, the headless simulator measures the same framing the player sees. Enemy lanes are authored in screen terms (normalized column, screen row for fliers), converted through the chase-camera geometry, so one choreography survives a camera that pulls back almost threefold between the marble and the melon.

Every supply in the level — on a monster, flying as debris, lying on the table, or stuck to the ball — is one instanced piece library with per-instance tint and a "grime" channel, so a kill is a hand-off rather than a swap: the same instances fly clean onto the route and are re-parented to the ball.

Weaker ground: the monsters' bodies are instanced outside their target roots, so the occlusion check can't attribute them to their own core and that bank is flagged as non-scenery. The glue lake reads more as a mound than a lake from the chase angle, and the lamp pool can run warm and bright around the spill.

## Status & notes
Built headless: WebGPU can't render in this WSL2 environment, so visuals were reviewed through SwiftShader snapshots and audio only through the semantic trace. A human WebGPU playtest should check the mix balance between the kill bells and the band, pickup-tick density in big debris fields, and the lamp pool's brightness around the spill.
Inspection markers: `growTennis` (bar 9), `growMelon` (bar 19), `spillReveal` (bar 21), `heart` (bar 27), `coda` (bar 30).
