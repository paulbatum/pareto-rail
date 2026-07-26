# Benchmark level assignment

Build a complete level according to `docs/level-brief.md`. Read `AGENTS.md` and `docs/level-authoring.md` as directed there. All repository instructions and the standing brief apply.

## Level identity

- Level id: `tinker-ball-q1ci`
- Display title: `Tinker Ball`

Use this identity consistently in the level directory, descriptor, metadata, and generated gallery card. This benchmark protocol uses the directory-only output contract: the level directory must be exactly `src/benchmark-levels/tinker-ball-q1ci/`; do not use a shortened module-folder name, edit `src/levels/index.ts`, or add a benchmark registry entry. Start with `npm run scaffold -- --mode benchmark --id tinker-ball-q1ci --title 'Tinker Ball'`.

## Environment

Your shell runs in a filesystem sandbox: only your checkout and standard tooling are readable, and your checkout is the only writable root, regardless of what any harness preamble says about broader read access. Paths outside it do not exist. `/tmp` is discarded after every command — stage scratch files in the repository's gitignored `tmp/` directory instead.

## Benchmark additions

Aim for a **60-second playable run**. A duration from **55 to 65 seconds** is acceptable when needed to end on a natural musical phrase. This covers active gameplay after START and before the run summary; attract mode and REPLAY are outside it.

Demonstrate your attention to detail and creativity through this work. The expected standard is a polished showcase level, not merely a gate-passing implementation.

## Assigned theme

# Tinker Ball

Build a level across one oversized, cluttered worktable. You are a rolling ball sent to clean it up, beginning no bigger than a marble among buttons, pins, beads, and paperclips. Scratches become roads under warm desk-lamp shadows. You only shoot; the ball follows its own lively route around the table.

Enemies are many dark glue monsters that have stolen ordinary supplies and built temporary bodies around visible black adhesive cores. Rulers and pencils become legs, buttons and spools form beetles, cardboard and clothespins fold into snapping birds. You are defeating glue creatures and rescuing clean materials. Shoot a core and its body breaks into individual pieces that scatter and remain on the floor. The ball deliberately arcs from the larger route through each fresh debris field, keeping the pieces directly ahead of camera. As it rolls over them, they visibly stick to its surface. Its uneven shape records every enemy dismantled.

The action never leaves the worktable, but changing scale transforms it. Marble-sized, the ball gathers buttons, pins, beads, and paperclips. At tennis-ball scale it takes thread spools, erasers, paint pots, and small wooden blocks. By the finale it is melon-sized, collecting long rulers, jars, and cardboard structures. Score it as bright, eccentric pop: bell-like mallets, clipped reed-organ stabs, a bouncy synth bass, handclaps, and tiny workshop percussion.

Boss: a central glue spill swallows the table's materials, recycling loose objects into new layers around its dark cores. Crack those cores one by one; each broken shell showers the route with rescued pieces, gathered across sweeping turns. The ball grows rougher and heavier until it can roll through the heart of the spill. The last glue snaps clean, freed supplies cling to the ball, and it coasts across a spotless patch of table, level ends.

