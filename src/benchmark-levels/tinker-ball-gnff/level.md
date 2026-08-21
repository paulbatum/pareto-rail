# Tinker Ball

A rolling ball sent to clean an oversized, cluttered worktable. You begin no bigger than a marble among buttons, pins, and paperclips, sweep a lock-on volley across dark glue monsters that have stolen the desk's supplies, and watch every broken body scatter into pieces the ball gathers as it rolls through. Three scale acts — marble, tennis ball, melon — end at the Spill: a glue puddle that swallows the table's materials and must be cracked open layer by layer.

## Visual language
Warm walnut under desk-lamp pools: scratches as roads, scattered oversized supplies that track the acts (buttons and pins early, spools and paint pots mid-table, rulers and jars at the end), dust motes in lamplight, and enemies built from those same materials around glossy black adhesive cores. The ball itself is the anchor — cream with a red toy-band, visibly collecting a stuck piece per kill and growing rougher and heavier until it coasts across a spotless patch of table.

## Musical language
112 BPM bright, eccentric desk-pop: bell-like mallets, clipped reed-organ stabs, a bouncy synth bass, handclaps, and tiny workshop percussion (woodblock ticks, jar pings). Kills play a hidden two-bar mallet lane that changes character each act — skipping bounce, syncopated leaps, descending peals — so a chained volley performs a real melodic run. Locks are pitched woodblock ticks; the Spill's core chips ring a deep wood anvil that grows with damage.

## Mechanical signature
A 60-second run with a 4-point hull: scuttling button beetles, swooping cardboard snappers, and pencil-legged stalkers that telegraph a lunge and throw homing glue globs (interceptable). The Spill boss cracks in three layers — six orbiting rescued objects, a linked three-node shell that demands one full volley, then a two-stage core whose breaks shower the route with collectible pieces.

## What to read
- `src/benchmark-levels/tinker-ball-gnff/index.ts`
- `src/benchmark-levels/tinker-ball-gnff/gameplay.ts`
- `src/benchmark-levels/tinker-ball-gnff/spill.ts`
- `src/benchmark-levels/tinker-ball-gnff/audio.ts`
- `src/benchmark-levels/tinker-ball-gnff/visuals/ball.ts`
- `src/benchmark-levels/tinker-ball-gnff/visuals/index.ts`

## Status & notes
One-shot benchmark build. The ball's collection (fly-in pieces, act growth, girth per kill) is the signature system; the spotless-patch finale and act callouts are wired through the runtime. Verified via typecheck, build, floor checks, and headless simulation; visual polish and the audio mix still need a human WebGPU playtest, with the boss-phase glob pressure and the table-shader lamp pools as the first things to check.
