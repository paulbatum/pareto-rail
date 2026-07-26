# Tinker Ball

A 60-second lap of one oversized worktable under a desk lamp. You escort a rolling cleaning ball — marble-sized among the buttons and pins — while glue monsters wearing stolen stationery scuttle, stride, and swoop along the scratched-in road. Every kill breaks a body back into bright supplies that bounce on the wood, then chase the ball down and stick, so its lumpy silhouette records the whole run. The lap ends at a glue spill under the lamp: crack three shelled cores, expose the heart, and coast across the one spotless patch of table.

## Visual language
Warm desk-lamp wood, cream lamplight pools, and craft-bright supplies (button red, cobalt, mustard, teal) against matte charcoal glue with a hot violet core glint. The player owns cream and amber: an embroidery-hoop reticle, pin-headed lock rings, and warm dart shots. Letters are toy building blocks. The rolling ball grows from marble to melon and wears every rescued piece.

## Musical language
128 BPM workshop pop in C major — bell mallets, tick-tock woodblocks, clipped reed-organ offbeats, handclaps, and a bouncy octave bass. Kills read a hidden two-bar melody lane (music box → toy piano → metallic peals), locks climb a pentatonic, fire is a rubber-band pluck on the live chord root. The spill flips the progression to the relative minor; the heart's death lands a major rescue fanfare and the coast resolves on C.

## Mechanical signature
A 32-bar / 60-second run with a 4-point hull. Button beetles scuttle the tabletop, pencil striders walk tall, clothespin snappers swoop and lob interceptable glue globs. The spill boss holds three gated 4-hit cores that pace the camera, then a 6-hit heart — a full six-lock volley moment — before the clean-patch coast.

## What to read
- `src/benchmark-levels/tinker-ball-6fh9/gameplay.ts` — rail, timeline, spill fight
- `src/benchmark-levels/tinker-ball-6fh9/audio.ts` — score, lanes, arrangement
- `src/benchmark-levels/tinker-ball-6fh9/visuals/index.ts` — event choreography
- `src/benchmark-levels/tinker-ball-6fh9/visuals/ball.ts` — the piece-collecting ball

## Status & notes
One-shot benchmark build. The rescued-piece loop (scatter → bounce → magnet → stick) and the growing ball are the signature; verify them first in a human playtest, then the spill collapse and clean-patch finale.
