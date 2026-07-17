# Crystal Corridor

The flagship landing level: a neon crystal corridor that now shoots back, polished through many human playtests. It moves from a readable corridor warm-up through lancers and homing shard bolts into the Crystal Warden finale.

## Visual language
Cyan and magenta crystal forms, translucent cell-grid letters, hot wire edges, shard bursts, and a boss lattice with shield plates and core callouts.

## Musical language
126 BPM, three acts, minor harmony, transport-quantized player sounds, a hidden kill-melody lane, and act-specific lock, fire, hit, and kill timbres.

## Mechanical signature
A 45-second run with a 3-point hull, node, drifter, orbiter, and lancer waves, interceptable homing bolts, and a staged Crystal Warden boss.

## What to read
- `src/levels/crystal/index.ts`
- `src/levels/crystal/gameplay.ts`
- `src/levels/crystal/audio.ts`
- `src/levels/crystal/audio-voices.ts`
- `src/levels/crystal/visuals/index.ts`
- `src/levels/crystal/warden.ts`

## What to study here
Crystal is the strongest built-in for musical experience: melodic kill lines that play per enemy hit, so a chained volley performs a real run. Read its `audio.ts` and `audio-voices.ts`. It also has the richest ordinary enemies — a procedural multi-component system that assembles each target from shared hex rings, spokes, and shards with per-kind and random variation, in `visuals/crystal.ts` (driven by `visuals/crystal-template.json`).

The Crystal Warden boss carries a strong mechanical idea: one phase requires all three targets locked in a single volley.

Crystal is not a one-shot build. It reached this polish through many rounds of human-guided iteration, so treat it as the ceiling for musicality and enemy detail rather than a one-shot baseline.

Weaker ground: the Warden's visual design is overly simple, and the level is thin on storytelling. Don't calibrate boss visuals or narrative arc against Crystal.

## Status & notes
Inspection captures: `bossEntrance` (warden entrance, bar 16:2.36), `drive` (densest act-2, bar 8).
