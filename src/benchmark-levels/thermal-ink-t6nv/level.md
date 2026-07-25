# Thermal Ink

A 60-second rail shooter level built around one continuous boss battle against a giant mutant octopus in a drowned industrial harbor. As dense clouds of oil-black ink swallow normal vision, the player engages infrared thermal vision to reveal white-hot enemy silhouettes and blazing red signal cores inside the dark ink murk.

## Visual language

Sodium-harbor murk in normal vision: tobacco brown water, dirty cream pipes, rust-red ship hulls, snapped dangling steel cables, and hard sodium industrial lamps burning through grit. Dense ink clouds obscure the camera path. In Infrared vision, the TSL post-processing pipeline converts the environment into a stark charcoal grid, turning the octopus and scavenger spawn into white-hot thermal silhouettes with glowing red signal cores on vulnerable targets.

## Musical language

Scored at 116 BPM with a slow industrial pulse, heavy bouncing synth bass, and sparse metallic percussion beneath a haunting minor-key synth melody. When entering Infrared vision, low-end noise drops back and the lead melody filter opens up into a bright, crystalline, razor-sharp focus. Action sounds (locks, fires, hits, kills) are quantized to transport steps and pitched from the D minor score scale.

## Mechanical signature

Central boss fight featuring multi-stage target nodes on writhing giant tentacles, fast twitchy scavenger drones, bio-electric cable mines, and an exposed central core finale. Dynamic Infrared vision mode auto-engages during ink blackout clouds (and can be manually toggled via Space / Right-Click), providing a tactical vision mode shift essential to surviving and striking through the darkness.

## What to read

- `src/benchmark-levels/thermal-ink-t6nv/index.ts` — LevelDefinition, input handlers, post-processing, and IR state sync.
- `src/benchmark-levels/thermal-ink-t6nv/gameplay.ts` — 60-second spawn timeline, 3D harbor rail curve, enemy motion, and rank ladder.
- `src/benchmark-levels/thermal-ink-t6nv/audio.ts` — Procedural Web Audio industrial soundtrack, haunted lead, and quantized action audio.
- `src/benchmark-levels/thermal-ink-t6nv/visuals/index.ts` — Environment, boss octopus model, enemy meshes, letters, and TSL shader uniforms.
- `src/benchmark-levels/thermal-ink-t6nv/visuals/post-fx.ts` — Custom TSL post-processing pass for Infrared thermal vision and Ink cloud obscurity.

## Status & notes

Passed typecheck, build, benchmark scope check (`check:benchmark-scope`), simulation check (`simulate`), and floor readiness check (`check:floor`).
