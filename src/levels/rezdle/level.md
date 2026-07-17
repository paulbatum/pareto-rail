# Rezdle

A word-game-shaped lock-on level set in a midnight press room: loose type drifts into fixed screen slots, and valid words go to print.

## Visual language
Ink black, bone, brass, smoke, and vermillion; movable-type plates, ledger rules, dust motes, ghost glyphs, ink splats, printed letters, and brass pressure waves.

## Musical language
84 BPM with a swung score; Rezdle opts out of action-SFX snapping so typewriter-like actions stay immediate.

## Mechanical signature
A 60-second run where vowels, consonants, and rare-letter bonuses must be released as valid words. It enables right-click lock undo and scores word length bonuses.

## What to read
- `src/levels/rezdle/index.ts`
- `src/levels/rezdle/gameplay.ts`
- `src/levels/rezdle/audio.ts`
- `src/levels/rezdle/glyphs.ts`
- `src/levels/rezdle/words.ts`

## What to study here
Rezdle is the example of a highly novel mechanic built entirely on the shared runner. The whole word game — loose type that must be released as valid words — is level-local: the dictionary and matching logic live in `words.ts` and `word-data.ts`, and validation rides the runner's `validateRelease` hook rather than any engine change. It also opts into `allowLockUndo` for right-click un-locking and supplies its own `scoreForVolley`, `rankForRun`, and `detailsForRun`. Read Rezdle to see how far a mechanic can depart from "sweep and fire a volley" without a bespoke runtime or touching the engine.

## Status & notes
Rezdle legitimately deviates from the standard spine/leaf decomposition.
Inspection captures: `carriage-8` (word combos, bar 8), `carriage-16` (midnight finale, bar 16).
