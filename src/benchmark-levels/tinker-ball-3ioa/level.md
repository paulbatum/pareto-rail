# Tinker Ball

A sixty-second roll across one oversized, cluttered worktable under a warm desk lamp. You are a marble sent to clean it up: black glue creatures have stolen the supplies and built temporary bodies around their cores, and every one you break drops its buttons, pins, spools, and pencils on the scratched road ahead, where the ball rolls over them and keeps them. The ball grows from marble to tennis ball to melon while the same table shrinks around it, ending in a spreading glue spill with three cores to crack and a spotless patch of wood to coast across.

## Visual language
Lamp-lit wood, candy-colored supplies, glossy black glue, and cool mint for everything the player owns. The camera's height above the table rises with the ball, so buttons that towered over a marble become grit under a melon. Enemies are beetles (spool and buttons on pin legs), striders (a core on pencil or ruler stilts), and snappers (folded cardboard wings with a clothespin beak); kills scatter their real parts as instanced physics pieces that stick to the ball's surface. START and REPLAY are spelled in buttons.

## Musical language
128 BPM bright pop in D major (D – Bm – G – A), 32 bars for the exact run: bell mallets, clipped reed-organ stabs, a bouncy synth bass, handclaps, and tiny workshop percussion (woodblock ticks, pen clicks, pin tinks, shaker). The Spill turns minor-side (Bm – G – Em – A) with a gurgle under the beat; the last two bars resolve to a clean D. Locks and kills are mallet notes from the live chord, kills walk a hidden two-bar lane per act, boss chips are glue squelches that open with damage, and every rescued supply that sticks to the ball is a click, tick, or tink on the 32nd grid.

## Mechanical signature
Three growth acts with per-act enemy scale and lead, a 3-point "shine" hull gummed by lockable glue globs spat by snappers and the Spill, creatures that are unlockable for the first 0.75 s while they assemble, and a three-core boss that raises one core at a time (left, right, then the heart) from an invisible puddle driver, each core's shell stages showering the road with pieces. Killing the heart freezes the spill, snaps it away, and reveals a clean patch the ball rolls through.

## What to read
- `src/benchmark-levels/tinker-ball-3ioa/gameplay.ts`
- `src/benchmark-levels/tinker-ball-3ioa/spill.ts`
- `src/benchmark-levels/tinker-ball-3ioa/audio.ts`
- `src/benchmark-levels/tinker-ball-3ioa/visuals/index.ts`
- `src/benchmark-levels/tinker-ball-3ioa/visuals/pieces.ts`
- `src/benchmark-levels/tinker-ball-3ioa/visuals/enemies.ts`

## What to study here
The scale change is done without scaling anything: the rail's height and the ball's radius follow one profile, and each act's enemies and clutter are simply built bigger. The rescued-pieces system (`visuals/pieces.ts`) is worth reading for how kill debris becomes persistent, collectible physics without extra draw calls — one instanced mesh per supply type, with a per-instance tint fed through a TSL node so baked details (button holes, pencil tips) stay their own color.

## Status & notes
One-shot benchmark build. Headless WebGPU is unavailable in the build environment, so lighting balance, bloom levels, and the audio mix were tuned from SwiftShader snapshots and the simulation/trace tools rather than a WebGPU playtest. Plain gameplay snapshots never fire, so the `debugTinker=debris` selector scatters a copy of every creature's parts on spawn to exercise the piece system; the content images use it. Inspection captures: `spill` (boss entrance, bar 21), `melon` (bar 17), `marble` (bar 4).
