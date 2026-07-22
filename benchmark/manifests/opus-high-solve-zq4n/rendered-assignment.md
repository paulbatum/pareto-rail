# Benchmark level assignment

Build a complete level according to `docs/level-brief.md`. Read `AGENTS.md` and `docs/level-authoring.md` as directed there. All repository instructions and the standing brief apply.

## Level identity

- Level id: `speedsolve-zq4n`
- Display title: `Speedsolve`

Use this identity consistently in the level directory, descriptor, metadata, and generated gallery card. This benchmark protocol uses the directory-only output contract: the level directory must be exactly `src/benchmark-levels/speedsolve-zq4n/`; do not use a shortened module-folder name, edit `src/levels/index.ts`, or add a benchmark registry entry. Start with `npm run scaffold -- --mode benchmark --id speedsolve-zq4n --title 'Speedsolve'`.

## Environment

Your shell runs in a filesystem sandbox: only your checkout and standard tooling are readable, and your checkout is the only writable root, regardless of what any harness preamble says about broader read access. Paths outside it do not exist. `/tmp` is discarded after every command — stage scratch files in the repository's gitignored `tmp/` directory instead.

## Benchmark additions

Aim for a **60-second playable run**. A duration from **55 to 65 seconds** is acceptable when needed to end on a natural musical phrase. This covers active gameplay after START and before the run summary; attract mode and REPLAY are outside it.

Demonstrate your attention to detail and creativity through this work. The expected standard is a polished showcase level, not merely a gate-passing implementation.

## Assigned theme

# Speedsolve

Build a level that is one continuous boss fight against a colossal twisting puzzle cube - six faces of nine colored squares, hanging in the middle of the arena while the rail orbits it. Shooting it solves it: a handful of squares glow as active targets, and destroying one snaps a layer rotation that leaves the face closer to a single color - order doesn't matter, any target advances the solve. Every rotation lands exactly on the beat; the cube is the percussion section, and the music should be built so that clicks, snaps, and rotations read as one instrument. Keep the score precise and mechanical - tight, quantized, all clean attacks - gaining a layer each time a face is conquered. When a face reaches a single color, the whole face falls away in a shower of loose cubies, exposing a weakpoint in the machinery underneath; destroy it and the rail swings you around to the next face. Six faces down and the core hangs fully exposed for the finish.

You're never left alone with the puzzle: small colorful polyhedra - tetrahedra, octahedra, prisms in the same candy colors - spawn in orbiting waves and shoot back, forcing you to defend yourself mid-solve.

Palette: the cube owns the six bright solve colors, and everything else stays out of their way - a pale, softly lit void, white-and-grey machinery inside the cube, enemy fire in the cube's own colors. Ending: the naked core spins up, takes your last barrage, and bursts into a confetti storm of tiny cubes as the music resolves - level ends.

