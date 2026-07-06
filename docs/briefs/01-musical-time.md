# Engine brief 01: musical time for gameplay timelines

Part 1 of the wishlist sequence (`docs/level-api-wishlist.md` records what remains outside these briefs). Read `AGENTS.md` and `docs/level-authoring.md` first. Standing rule: **the engine encodes contracts, never answers** — every bar number, spawn position, and speed value stays in the level. All retrofits in this brief are behavior-preserving.

## Problem

A level's music is authored in bars and steps (`createScore`, `createArrangement`), but its spawn timeline, speed-profile keys, boss entrance, and run duration are authored in seconds. The two clocks are kept in agreement by hand: crystal carries comments like "Act 2 gameplay begins ~bar 5" and a `BOSS_TIME = 31.6` constant that must silently agree with the arrangement's bar-16 fill. Re-arranging the music means re-deriving spawn seconds manually, which is exactly the iteration the brief's "musicality" criterion demands be cheap.

## Deliverable 1: a musical timebase helper

A small module (suggest `src/engine/music-time.ts`, or extend `src/engine/music.ts` if it stays tiny) that converts musical positions to the seconds the runner already consumes. No runner changes — the timeline it receives is still `time: number` in seconds.

Sketch, not a prescription:

```ts
const mt = createMusicTime(CRYSTAL_BPM, { stepsPerBar: 16 });
mt.beats(2.52)            // seconds for a continuous beat count
mt.bar(16)                // seconds at the start of bar 16
mt.bar(16, 2.5)           // bar + beat-in-bar
mt.markers({ act2: 5, warden: 16 })  // named bars — the level's single source of truth
// markers.warden → seconds; the same constants feed the arrangement's section bars
```

Requirements:

- Continuous (fractional) beats must be first-class, not just integer grid positions. Existing timelines are not on-grid (crystal's first wave is at 1.2 s = 2.52 beats at 126 BPM) and this brief must not move them.
- Named markers exist so a level defines "the drop is bar 16" **once** and both the arrangement's section table and the spawn timeline reference it. Getting crystal's arrangement and gameplay to share those constants (they live in different files today; mind the spine/leaf rule) is part of the retrofit.
- Keep a plain-seconds escape hatch. If a converted value differs from the old literal by floating-point ulps and trips an exact `--compare`, prefer authoring that entry as exact seconds over weakening the compare tool.

## Deliverable 2: the sync report

With spawn times expressible in musical positions, a merged view of both timelines becomes nearly free. Extend `trace:spawns` (e.g. `--bars`) or add a small report script so one table shows, per bar: the audio arrangement's section name and the spawns that land there, with a flag for long spawn-free gaps. Section names can come from the audio trace (`trace:audio` already records them) or from the level's marker table. This is the tool that makes "choreographed against the soundtrack" checkable without playing.

## Retrofits

Convert spawn timelines, speed-profile keys, boss/act constants, and run durations to musical authoring in:

- **crystal** — the three acts and `BOSS_TIME`; unify the act bars with the arrangement's section table.
- **helios** — timeline plus its speed-profile keys (`createSpeedProfile` keys stay in the level, expressed via the timebase).
- **prism** — survey first; it predates the score/arrangement shape, so convert what is mechanical and report what is not rather than forcing it.
- **rezdle** — optional; it decomposes differently and opts out of parts of the timing profile. Convert only if it falls out naturally.

Every retrofit gate: `npm run trace:spawns -- --level <id> --compare` must match, `npm run typecheck`, `npm run build`, `npm run check:scope -- <id>` per touched level. Capture baselines before editing.

## Docs

Add the module to the shared-code inventory in `docs/level-authoring.md`, and update the spawn-timeline sentence in the runner-contract section to name musical authoring as the default for beat-driven levels. Update the scaffold template if it stamps a seconds-based timeline.

## Out of scope

- Deluge (tracked in `docs/briefs/deluge-followups.md`).
- Snapping any existing spawn to the grid, or any audible/visible change.
- Runner or transport changes; tempo maps.
