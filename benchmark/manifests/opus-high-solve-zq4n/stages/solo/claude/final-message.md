**Speedsolve** (`src/benchmark-levels/speedsolve-zq4n/`) is built — ~4,600 lines across timing, cube, gameplay, audio, and visuals.

## What it is

Sixty seconds (144 BPM, exactly 36 bars), one opponent: a colossal graphite puzzle cube in a pale studio void while the rail orbits it. Six identical five-bar face blocks — quarter-turn → scramble → five solve pips → the cube's bow → the face falls in a shower of cubies → weakpoint exposed → socket shutters — then bars 31–36 unfold the shell into an exploded view around a three-stage core whose gimbal cage shuts between salvos. Candy tetrahedra/octahedra/prisms orbit the whole fight and throw interceptable homing cubes.

**The cube is a real cube.** 26 cubies, 54 sticker plates, integer lattice, exact quarter turns. Presentation turns are pre-multiplied in the *camera's* frame; the front normal, the face's screen axes, and the twist axis are all derived from that turn stack rather than tabulated. Twists only ever grab the front layer, the back layer, or both caps — the one family under which a front sticker stays a front sticker and no center piece ever leaves its axis.

**The cube is the percussion section.** `clack` is written into the drum pattern *and* played by the machine on every layer rotation. Rotations release on `beat` events; audio schedules the knock on the next quarter note of the same transport. A motor hum gains a layer per conquered face. Kills walk per-section lanes over live harmony.

## Bugs I hit and fixed (all were live defects, not polish)

1. **Camera/clock lived in visuals** — the simulator drives `gameplay.ts` directly, so the face clock and look-at never ran headless. Moved both into gameplay; the cube is now a headless model with a view bolted on.
2. **Dropped stickers migrated onto later faces**, gutting them — face 5 lost all five pips. Fixed by tracking conquered *faces*, not dead plates, and banning slice moves.
3. **The cube model never reset between runs** — REPLAY would have started on a half-eaten machine.
4. **The core boss and the START/REPLAY plates never scaled in** from their 0.001 spawn scale — both were invisible.
5. Enemy/projectile geometries were never disposed (~350 leaked per run).

## Verified headless

`typecheck`, `build`, `check:benchmark-scope` (19 paths — level dir, its `public/level-content/`, regenerated gallery), and `check:floor`: 7 enemy kinds, full event coverage, **0 occlusion warnings, 0 perf failures, 0 centerness/distance warnings**, 183 peak draw calls. Perfect sim: 66/72, 101 locks, rank A, core destroyed, avg destruction distance 32.5 m, 0% off-screen, well spread. `trace:audio` shows 144 beats, five sections, 136 clacks.

## What needs human eyes

WSL2 can't render WebGPU — everything above is SwiftShader. Check first:
- **Do the layer snaps feel locked to the beat?** That's the whole level; it's the one thing I could only verify in code.
- **Bloom at zero** — the pale void has almost no headroom, so I ran bloom strength at 0.42 with an effective threshold of 0.92. Wrong squares should still be obvious.
- **Point-blank bolts.** The shared impact model brakes them to ~0.65 m; I shrank the halo twice and it still smears the frame briefly.
- **The exploded finale is monochrome** by design (naked machinery), and it's the dimmest part of the run.