# Downpour

A hunted courier drone racing a rain-lashed neon megacity: down the storm-lit faces of its towers, through signage-lit avenue canyons and a sodium tube, along a flooded canal, and up the security citadel with the city's own gunship in pursuit.

## Visual language
Rain-grey black and blue-slate city geometry, lit by cyan/magenta signage, sodium-amber undercity light, and hazard-white security forces, with acid green reserved for the gunship alone. Recycling rain streaks read as the level's constant speed cue; two cloud decks (a storm ceiling and a break above it) bracket the run in lightning and, at the end, moonlight.

## Musical language
176 BPM drum & bass in D minor. Sparse pad and weather noise before the first plunge, a rolling break through the streets and the tube, a half-time drop into canal menace that escalates through the citadel hunt, and a near-silent moonlit outro. Locks, fire, hits, and kills are pitched from the live chord and section-tinted; kills walk a hidden melodic lane per movement.

## Mechanical signature
A 60-second run with a 3-point hull, four enemy kinds — thin swept-wing interceptors, bolted turret sentries that fire homing bolts, flat canal-skimming trawlers, and a 3-stage hunter-gunship boss — choreographed against two musical drops (the tower plunge and the undercity plunge) and a half-time-to-hunt escalation into the boss fight.

## What to read
- `src/levels/downpour-f2e6/index.ts`
- `src/levels/downpour-f2e6/gameplay.ts`
- `src/levels/downpour-f2e6/timing.ts`
- `src/levels/downpour-f2e6/audio.ts`
- `src/levels/downpour-f2e6/audio-voices.ts`
- `src/levels/downpour-f2e6/visuals/index.ts`
- `src/levels/downpour-f2e6/visuals/environment.ts`

## Status & notes
First pass, built from the standing brief and the Downpour theme assignment. Verified by typecheck, build, check:scope, check:floor (simulate, occlusion, perf), and trace:audio in this environment; WebGPU visuals and the music mix have not been confirmed by a human playtest — see handoff notes.
