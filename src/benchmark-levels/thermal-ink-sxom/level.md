# Thermal Ink

A one-minute duel with a harbor-sized mutant octopus already fused to a drowned slipway. Sodium lamps, tobacco water, cream-painted wreckage, trailing chains, and moving ink fronts make the arena readable in normal optics; infrared cuts to charcoal, turns every living silhouette white-hot, and isolates vulnerable anatomy in signal red.

## Visual language
Normal vision is dirty industrial color: muddy ochre fog, rust-red steel, oily brown flesh, sediment, pipe forests, hull ribs, cable knots, and hard cream lamps. Four physical ink clouds overtake the camera and consume that palette. The player can switch senses with E, I, right-click, or double-click; infrared removes ambient color and lamp authority, opens the fog into a stark charcoal field, renders the octopus and its machinery-spawn as white thermal forms, and reserves red for nerves, eyes, and the exposed core.

## Musical language
96 BPM, exactly 24 bars and 60 seconds. A slow pitched kick, bouncing filtered synth bass, sparse struck-metal noise, submerged sub tones, and one 32-step haunting melody score the circuit. Lock, fire, hit, stage, and kill sounds quantize to the live transport and follow its harmony; every hit opens the next note of a per-section kill lane. In infrared the percussion and low noise retreat, bass loses weight, and the melody jumps an octave into a bright focused square-wave voice. Core destruction ducks the mix and answers with a descending four-note extinction figure.

## Mechanical signature
One continuous boss fight across two tightening rail circuits and a final close approach. Eight four-hit arm targets arrive in paired phases while scavenger crabs cross the full screen, cable-eels climb opposite edges, and armored boiler spawn lunge out of broken machinery. Four timed ink fronts create the sight-switch rhythm. Resolving every arm opens a twelve-hit central core during the last blackout; the octopus then folds into the wreck as normal harbor light returns.

## What to read
- `src/benchmark-levels/thermal-ink-sxom/timing.ts`
- `src/benchmark-levels/thermal-ink-sxom/gameplay.ts`
- `src/benchmark-levels/thermal-ink-sxom/audio.ts`
- `src/benchmark-levels/thermal-ink-sxom/thermal-state.ts`
- `src/benchmark-levels/thermal-ink-sxom/post.ts`
- `src/benchmark-levels/thermal-ink-sxom/visuals/index.ts`
- `src/benchmark-levels/thermal-ink-sxom/visuals/environment.ts`
- `src/benchmark-levels/thermal-ink-sxom/visuals/models.ts`
- `src/benchmark-levels/thermal-ink-sxom/visuals/effects.ts`

## What to study here
The sense switch is deliberately cross-system: it changes procedural materials, fog, scene lighting, ink opacity, screen-space contrast, reticle signaling, and the active orchestration from one shared level-local state. The boss remains a fixed piece of harbor geography while the runner circles it; its targetable arms turn toward the live camera basis, which keeps the octopus reaching into the screen without moving the central wreck.

## Status & notes
Authored as a benchmark entrant under the directory-only protocol. Snapshot rendering is a reduced-fidelity fallback; final contrast between physical ink, white-hot targets, and red cores, plus the normal/infrared mix balance, still requires a human WebGPU playtest.
