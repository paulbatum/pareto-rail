# Tinker Ball

Tinker Ball is an eccentric rail shooter set across one oversized, cluttered wooden worktable illuminated by warm desk-lamp lighting. The player is a lively rolling ball sent to clean up the table, starting marble-sized among buttons, pins, beads, and paperclips before growing to tennis-ball scale and ultimately melon scale. Enemies are dark glue monsters built from stolen office and craft supplies surrounding glossy dark adhesive cores. Destroying cores scatters clean materials across the table floor; as the ball rolls through debris fields, the supplies cling to its surface, forming a growing, uneven shape that records every enemy dismantled.

## Visual language

A warm, tactile workshop atmosphere. A mahogany worktable with a dark-green cutting mat, grid lines, and road-like scratches forms the floor under a warm golden spotlight. Dark purple-black adhesive glue cores contrast against bright, saturated stationery items: cherry red buttons, sky blue thread spools, eraser pink blocks, and golden yellow rulers. Enemies have distinct silhouettes: skittering button beetles, swooping cardboard birds, and stepping pencil tripods. The boss is a central dark glue spill surrounded by orbiting ruler armor plates. As the ball rolls, collected debris attaches directly to its surface.

## Musical language

Bright, eccentric pop scored at 128 BPM. Features resonant mallet marimba/glockenspiel leads, clipped reed-organ chord stabs, a bouncy synth bass line, and workshop percussion including high ticks, woodblock taps, and handclaps. Gameplay actions land within a 4-bar pop chord progression (Cmaj7 - Fmaj7 - Am7 - G7). Chained volleys trigger melodic mallet runs from active chord scales, turning lock-on releases into improvised melodic solos.

## Mechanical signature

Scale transformation and physical debris collection. As run progress advances across three acts, the rolling ball grows from marble to tennis ball to melon scale. Defeated glue creatures burst into clean supply pieces that scatter onto the table floor; the rail arcing through these debris fields allows the ball to roll over and magnetically attach loose items, dynamically building up its visual geometry. The finale features a multi-stage glue spill boss whose breaking shell plates shower the route with rescued supplies.

## What to read

- `src/benchmark-levels/tinker-ball-xa2f/index.ts`: Level definition, post-processing, and camera/runtime orchestration.
- `src/benchmark-levels/tinker-ball-xa2f/gameplay.ts`: 60-second 128 BPM rail curve, 3-act spawn timeline, enemy AI, and scale progression.
- `src/benchmark-levels/tinker-ball-xa2f/audio.ts`: Beat-driven pop arrangement, chord progression, and melodic kill lanes.
- `src/benchmark-levels/tinker-ball-xa2f/visuals/index.ts`: Worktable environment, rolling ball mesh, debris attachment system, and reticle.

## Status & notes

Complete 60.0-second benchmark implementation. All procedural geometry, audio, and gameplay mechanics pass typecheck, build, benchmark scope check, and floor readiness gates.
