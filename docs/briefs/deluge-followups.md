# Deluge follow-ups

The single tracking doc for pending Deluge work. The level shipped from `src/levels/deluge/original-brief.md` (historical, not maintained) and its `level.md` status is honest: known buggy and below the bar. Do the tasks in order — each is its own task and commit, and the refactor steps must not change behavior, because the compare tools are what make the later quality pass safe to review.

## 1. Audio trace coverage

Register Deluge in the `trace:audio` tool (it currently covers crystal, prism, rezdle, helios). No level behavior change; this is the prerequisite that makes task 2 gateable. While here, capture and stash a baseline for task 2.

## 2. Audio retrofit onto the shared kit

Move `src/levels/deluge/audio.ts` (~505 lines, pre-kit style) onto the current authoring path: `createBeatLevelAudio`, `createMixBus`, `createScore`, `defineInstruments`, `createArrangement`, `createAudioTraceHarness`, with a voices leaf per the spine/leaf convention. Follow the shape of `src/levels/crystal/audio.ts` and `src/levels/helios/audio.ts`. Gate: `npm run trace:audio -- --level deluge --compare` exact match.

## 3. Speed-profile retrofit

`src/levels/deluge/gameplay.ts` hand-rolls the piecewise speed-key ease table that now lives in `src/engine/speed-profile.ts`. Retrofit it onto `createSpeedProfile`, keeping the keys in the level. Gate: numeric equivalence sampling of the old and new speed/progress functions, `trace:spawns --compare`, and matching `snapshot:gameplay` thumbnail sheets.

## 4. Visuals decomposition

`src/levels/deluge/visuals.ts` (~1,700 lines) is a monolith. Decompose along the spine/leaf convention: decisions (palette, event choreography, tuning) in the spine; mesh and environment construction in leaf files. Gates: `trace:spawns --compare` where gameplay files move, before/after `snapshot:gameplay -- --thumbnails 8` sheets must match, and update `level.md` "what to read" pointers.

## 5. Quality and bug pass

Deferred until the refactors above land so the compare tools stay meaningful. Fix the known bugs and bring the level up to the gallery bar; this task, unlike the others, is *supposed* to change behavior. Re-verify with a human playtest and refresh `level.md`'s status notes.
