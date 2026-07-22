# Speedsolve

Sixty seconds, one opponent: a colossal puzzle cube hanging in a pale, softly lit
void while the rail orbits it. Shooting the cube solves it — a handful of squares
glow wrong, and every one you destroy snaps a layer rotation that lands exactly on
the beat and leaves the face closer to a single color. Conquer a face and it falls
away in a shower of loose cubies, exposing a weakpoint in the white-and-grey
machinery underneath; six faces down, the naked core hangs in the open for the
finish. Small candy-colored polyhedra orbit the fight the whole way and shoot back.

## Visual language
Graphite plastic and six bright solve colors, and nothing else is allowed to use
them. The cube is twenty-six chamfered cubies carrying fifty-four sticker plates;
it holds a permanent twenty-two-degree yaw so it reads as an object with corners
rather than a nine-square poster, and it visibly swivels to keep the losing face
squared up to the rail. Conquered faces stay conquered on the sides of the
silhouette, showing pale machinery and a dead socket. Everything friendly —
tracers, reticle, lock brackets, START/REPLAY plates — is ink and bone, so it can
never be mistaken for a sticker; every effect is a square or a cube, and nothing
falls, because this is a void. Six tally lamps on the outer gantry ring keep score.

## Musical language
144 BPM in E minor; thirty-six bars is exactly sixty seconds and nothing swings.
The cube is the percussion section: `clack`, a pitched plastic knock, is written
into the drum pattern *and* played by the machine on every layer rotation, so a
player solving squares on the grid adds to the kit instead of talking over it.
Rotations are released on beat events and their knock is scheduled onto the next
quarter note of the same transport, so the picture and the sound land as one hit.
A motor hum gains a layer every time a face comes off — the track thickens with
the fight without a single extra written note. Locks, shots, chips, and kills are
transport-quantized and pitched from the live chord; kills walk a written
per-section lane so a chained volley is a melodic run. The core's death ducks the
room, throws the whole lead set at 32nds, and resolves to E major.

## Mechanical signature
A 60-second, three-hull run built from six identical five-bar face blocks:
quarter-turn, scramble, five solve pips, the cube's bow, the face falls, the
weakpoint is exposed for two bars, the socket shutters. Thirty solve moves and six
three-hit weakpoints on the cube; wheeling tetrahedra, diving octahedra, and
planted prisms that fire interceptable homing cubes around it. The finale unfolds
the shell into an exploded view and leaves a three-stage core whose gimbal cage
shuts between salvos — `lockable` stops new locks and `validateRelease` refuses
the stale ones, so a closed cage always means a closed cage. The summary reports
solve moves, faces cracked, shots knocked down, and whether the core came apart.

## What to read
- `src/benchmark-levels/speedsolve-zq4n/timing.ts`
- `src/benchmark-levels/speedsolve-zq4n/cube.ts`
- `src/benchmark-levels/speedsolve-zq4n/gameplay.ts`
- `src/benchmark-levels/speedsolve-zq4n/audio.ts`
- `src/benchmark-levels/speedsolve-zq4n/visuals/index.ts`

## Status & notes
Built to the standing brief from the Speedsolve theme assignment. Inspection
markers: `face1` (bar 1), `face3` (bar 11), `face5` (bar 21), and `core` (bar 31).
Verified headless — typecheck, build, scope, and the floor gate (simulation,
occlusion, performance) — but WSL2 cannot render WebGPU, so the real frame and the
mix still need a human playtest. Check first that the layer snaps feel locked to
the beat, that the wrong squares are obvious at a glance with bloom at zero, and
that the exploded finale leaves the core readable against the pale void.
