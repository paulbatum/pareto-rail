# Helios

A 120-second dive into a dying star, built around named set pieces: approach, shattered Dyson gate, furnace road, corona plunge, burning sea, and the Suneater. It is the current quality bar for one-shot builds.

## Visual language
Solar reds, golds, black space, wreckage, gates, corona whiteout, photosphere skim, flares, fangs, and a heart-centered Suneater boss.

## Musical language
172 BPM, four movements, drop-timed speed changes, live harmony for player actions, and boss escalation tied to the Suneater fight.

## Mechanical signature
Variable rail speed, 4-point hull, cinders, motes, scorchers, pyres, flares, hostile bolts, and a staged Suneater with fangs and heart exposure.

## What to read
- `src/levels/helios/index.ts`
- `src/levels/helios/gameplay.ts`
- `src/levels/helios/audio.ts`
- `src/levels/helios/audio-voices.ts`
- `src/levels/helios/visuals/index.ts`
- `src/levels/helios/suneater.ts`

## What to study here
Helios is the proof that a one-shot result can be large, detailed, and highly playable. It runs long, tells a real story across distinct sections, and demonstrates how far a single build can reach: an elaborate boss with genuine visual design (`suneater.ts`), interesting postprocessing effects (`visuals/post-fx.ts`), a strong sense of speed in places, and background music that varies to match the pace of each section. It also shows sophisticated, dynamic camera control instead of a plain flight down a fixed path — read `index.ts` and `gameplay.ts` for the camera work.

Weaker ground: the melodic kill line is not especially compelling (Crystal is the reference for that). Some sections lose visual clarity — bright white projectiles over the bright yellow sun read poorly — and the boss's ambitious design leaves parts of its body awkwardly arranged. Study Helios for scope, story, and camera; go elsewhere for musical action and for boss-body legibility.

## Status & notes
Inspection captures: `gate` (drop 1 gate entrance, bar 16), `corona` (drop 2 corona plunge, bar 40), `bossEntrance` (Suneater reveal, bar 60).
