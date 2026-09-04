# Tinker Ball

One warm, oversized worktable, a teal marble, and a very sticky infestation. Button beetles, pencil skaters and folding cardboard birds carry stolen supplies around exposed black glue cores. Break them apart and sweep up the pieces: the ball wears the history of your run.

## Visual language
Honey-colored scored wood, enamel teal, coral buttons, mustard rulers and cream paper. A desk lamp, notebook and paint pots establish a persistent tabletop. Glue has glossy dark centers, expressive eyes and golden target rims. START and REPLAY are punched block letters on little cream supply tags. Physical pieces scatter, settle and attach to the rotating ball; expanding rings mark locks, volleys and collection without requiring bloom.

## Musical language
128 BPM eccentric workshop pop in C major, with A minor, F and G turns. Bell mallets answer clipped reed-organ chords over octave-jumping bass, handclaps and tiny pitched ticks. Five sections span 32 bars, exactly 60 seconds. Locks follow the live chord; kills perform authored melody lanes, and the spill's final break releases a falling tonic figure.

## Mechanical signature
Three ordinary silhouettes use scuttling, weaving and flapping motion. Phrase-based waves spread across the viewport. The final glue core rebuilds through three HP stages of 3, 4 and 5 hits, shedding a layer each time. Collection detours steer the ball into fresh debris fields. Six-lock volleys earn a 600-point bonus. There is no hull damage: the challenge is rescuing the whole table in one run.

## What to read
- `src/benchmark-levels/tinker-ball-034d/gameplay.ts` — sixty-second score grid, wave choreography, camera and enemy motion.
- `src/benchmark-levels/tinker-ball-034d/audio.ts` — arrangement and transport-anchored player instruments.
- `src/benchmark-levels/tinker-ball-034d/visuals/index.ts` — table, monsters, debris, collection and event choreography.
- `src/benchmark-levels/tinker-ball-034d/visuals/objects.ts` — procedural supply construction.

## What to study here
The same supply geometry serves three roles: stolen body parts, freed floor debris and the ball's growing collection. An enemy break changes the world and the player's silhouette. Musical sections introduce scale and motion changes without leaving the table.

## Status & notes
Designed for a full 60-second active run. The shared tempo-adaptive shot timing and action snap are intentional; they make chained dismantling sound like a mallet phrase. No external assets or cross-level imports. Automated verification and reduced-fidelity visual inspection are supplemented by a required human WebGPU and audio playtest.

Verification: TypeScript, the production build pipeline, the floor gate and the audio trace pass. Simulation clears all 51 targets in 60 seconds. A browser firing pass collected 339 individual pieces by the finale. Full-fidelity inspection-tool captures cover START and eight gameplay moments; public images use 46 seconds for the hero and 11.25, 26.25, 33.75 and 46 seconds for the overview. These captures use the tooling's software renderer, not a hardware WebGPU playtest.

The supplied benchmark scope command cannot load its missing `scripts/benchmark/protocol.mjs` dependency. An independent Git diff audit verifies that all changed files belong to this level directory or its public content directory. npm's launcher attempted a blocked registry request, so verification ran the package scripts' local Node entrypoints directly. Human review should first check the collection detours and the soundtrack balance during a six-lock volley.
