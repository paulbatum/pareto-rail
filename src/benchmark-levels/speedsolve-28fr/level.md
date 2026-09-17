# Speedsolve

A 60-second boss encounter where a colossal nine-square puzzle cube hangs in a pale void, its rows ratcheting a quarter turn on the beat while you orbit it on a 120 BPM rail. Shoot glowing squares to solve faces, peel the armor, and silence the machinery.

## Visual language
Six bright solve colors (rose, azure, tangerine, jade, lemon, porcelain) against a pale void; white-and-grey octahedral machinery inside, candy-polyhedra enemies with steel outline edges, geometric START/REPLAY letter plaques, and a final confetti storm of tiny cubes.

## Musical language
120 BPM dry mechanical electronica. Ratchet ticks gain bass, rim snaps, counterweight clicks, escapement accents, and clockwork bells across six eight-second phrases. The harmony cycles Cmaj7, Am7, F, and G. Player actions snap to the transport, kills play a written melodic lane, and tile kills add quarter-note snaps. Conquering a face advances the arrangement's layer count; destroying the core resolves into a C-major bell cascade.

## Mechanical signature
A 5-hull, exactly sixty-second run. Each face has three active squares; destroying any one queues a beat-snapped row turn and solves that row. Three solved rows peel away to expose a one-hit axle. Destroying the axle starts the camera swing toward the next face; an eight-second phrase deadline advances the rail if the face remains incomplete. Tetrahedra circle, octahedra weave, and triangular prisms strafe around the cube, with selected enemies launching interceptable candy-colored bolts. All six axles must be destroyed to unlock the 18-hit, three-stage core at 54 seconds. Six-lock volleys earn a 600-point precision bonus.

## What to read
- `src/benchmark-levels/speedsolve-28fr/index.ts`
- `src/benchmark-levels/speedsolve-28fr/gameplay.ts`
- `src/benchmark-levels/speedsolve-28fr/audio.ts`
- `src/benchmark-levels/speedsolve-28fr/visuals/index.ts`

## Status & notes
Built to the standing brief from the Speedsolve theme assignment. Automated verification covers typecheck, production build, benchmark scope, simulation, audio trace, and the floor gate's occlusion, performance, audio configuration, and target-distribution checks. Snapshot captures are best-effort inspection, not a human WebGPU playtest. Check first that beat-snapped row turns feel synchronized, the axle windows are readable, candy colors remain distinct with bloom disabled, and the last six-second barrage and confetti resolution land clearly.
