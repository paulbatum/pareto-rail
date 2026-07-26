**Tinker Ball is built and passing every gate.** The complete level lives in `src/benchmark-levels/tinker-ball-6fh9/` — nothing outside that directory was touched — and it's a 60.0-second run (32 bars at 128 BPM, ending exactly on the phrase).

## What the level is

You escort a rolling cleaning ball on one lap of an oversized worktable under a desk lamp, with the route drawn as pale scratches in the wood. Three glue-monster kinds with distinct silhouettes and motion: **button beetles** that scuttle and skitter on the tabletop, **pencil striders** that walk tall on stilt legs with a heavy gait bob, and **clothespin snappers** that swoop in figure-eights and lob interceptable glue globs at the 4-point hull. The signature loop: every kill breaks the body into bright craft pieces that bounce on the wood, rest, then chase the ball down and stick to it — the ball grows from marble to melon and wears the whole run. The finale is the **Glue Spill** under the lamp: three gated 4-hit shelled cores that pace the camera (shell supplies pop off per hit), then a 6-hit heart — a full six-lock volley moment — then the coast across the one clean patch of table.

The music is workshop pop in C major: bell mallets, tick-tock woodblocks, reed-organ offbeat stabs, handclaps, bouncy octave bass. Kills read hidden two-bar melody lanes (music box → toy piano → metallic peals per act), locks climb a pentatonic, fire is a chord-rooted rubber-band pluck, the spill flips to the relative minor, and the heart's death lands a ducked major rescue fanfare resolving to C for the coast. Letters are toy building blocks; the reticle is an embroidery hoop.

## Verified

- `npm run typecheck`, `npm run build`, and `npm run check:floor` all pass — occlusion 0 warnings, perf 0 failures (130 peak draw calls vs 500 budget, geometry growth fixed by disposing baked creature geometry), audio config clean, `level.md` card done.
- Simulator: perfect policy survives to a B rank (59/71), seeded imperfect earns A (68/71, one hull hit); S requires beating the heart plus a near-perfect clear. Beat and reject events covered; `trace:audio` and `trace:spawns` both clean.
- Snapshot review (SwiftShader fallback) across attract/acts/boss/coast/REPLAY caught and fixed several real issues: START! sinking below the table, the ball overtaking the camera at the rail end, glue globs blooming into a frame-filling sphere on final approach, a dust mote crossing the lens, and scenery grazing sightlines on the route's S-curves (placement now checks clearance against the whole route polyline).
- One accepted soft warning: 42% of sim kills land within the center 0.25 NDC radius (hard gate is 70%) — an artifact of the robot locking targets at long range.

## Needs human eyes (WebGPU playtest — headless can't render it)

1. **The rescue loop**: scatter → bounce → magnet → stick, and the ball's growing lumpy silhouette — snapshots can't fire, so this never appeared in a capture.
2. **Mix and musicality**: kill-lane melodies under chained volleys, the minor turn at the spill, the heart fanfare, and whether the reed-organ/bell balance sits right.
3. The spill collapse on the killing blow, camera shake/FOV feel, and overall brightness (SwiftShader renders hotter than WebGPU, so the warm haze may look different in the real renderer).