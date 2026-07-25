**Speedsolve** is built at `src/benchmark-levels/speedsolve-p4tn/`. It's one continuous boss fight against a colossal twisting cube.

## What it is

A 60.000-second run (144 BPM, exactly 36 bars). The rail corkscrews around a colossal 3×3×3 puzzle cube hanging in a pale, softly lit hall, and the world rolls 60° at each of six face swings — a full turn over the run.

Per face (5 bars): a three-quarter-bar swing rolls the world, quarter-turns the cube, and riffles the incoming face into its scramble. Four squares arrive wrong and glow. Destroying any of them snaps a real quarter turn of that layer **on the next beat** — order never matters — and after four the face is one colour, blows its nine caps off in a shower of loose cubies, and lifts a two-stage weakpoint piston out of the socket underneath. At bar 32 the 26-cubie shell blooms open into a ring and the naked core takes the last barrage, bursting into confetti.

The cube is real: 26 cubie bodies on a lattice with 54 colour caps, and a layer turn rotates nine cubies 90° and bakes the result back, so caps ride their cubie the way stickers ride a real cube. `cube.ts` is pure state (no meshes) so the headless simulator sees exactly the target positions a player does.

**Musically**, one `snap` voice is both the track's backbeat and the sound of a layer landing — rotations are scheduled onto the next quarter note, so a snap you cause is indistinguishable from one the arrangement was going to play. Locks climb the live chord, kills walk a hidden two-bar melodic lane, and each face *actually conquered* buys an extra counter-melody on top of the per-section layering.

## Verified headless

`typecheck`, `build`, `validate:level-catalog`, `check:benchmark-scope` (19 paths, in scope), `trace:audio` (144 beats in 60 s, layers entering on schedule), and `check:floor` — all pass. 7 enemy kinds, full event coverage, no dead-air gaps, **0** occlusion warnings, **0** centerness/distance warnings, all perf gates green (217 peak draw calls of 500). Rank ladder: perfect 78/78 → S, imperfect 58/78 → B, no-fire → D.

Three things I want to flag from the build: the engine forwards `post.bloom.threshold`/`radius` to three's `bloom()` in swapped order (harmless on dark levels, a total whiteout on a pale one — `index.ts` has a comment and I saved a memory); the headless `perfect` policy locks each target once and stalls on any unlockable target near screen centre, so dormant weakpoints are parked out of frame; and I disposed per-spawn enemy/projectile geometry, which cut geometry growth from +427 to +14.

## Needs a human WebGPU playtest

WSL2 can't render WebGPU, so I used the SwiftShader snapshot path — good enough to catch and fix a full-frame whiteout, oversized bolts, and unreadable letters, not good enough to judge feel or mix. First things to check by hand:

1. Does a layer snap read as landing **on** the beat?
2. Do the four wrong squares stay legible against the white cubie bodies with the bloom slider at zero?
3. Does the 60° roll read as swinging *around* the cube, or as the camera tipping over?
4. Does a conquered face blowing off its caps land as a payoff, and does the confetti finish? — these two moments are the only things no headless capture could show me, since the snapshot tool never fires a shot.

Gallery images are at `public/level-content/speedsolve-p4tn/` (hero, start, overview) and `docs/level-gallery.md` is regenerated.