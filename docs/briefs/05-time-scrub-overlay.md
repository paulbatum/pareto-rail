# Engine brief 05: run scrubbing and the transport overlay

Part 5 of the wishlist sequence. Best after brief 01 (bar-addressed scrubbing) but `?start=<seconds>` alone is already worth having. Read `AGENTS.md`, `docs/level-authoring.md`, and `src/engine/lock-on-runner.ts` first. This is engine + debug-panel work; levels change only if scrubbing exposes seek-unsafe state, and those fixes are behavior-preserving for normal runs.

## Problem

Iterating on a moment 35 seconds into a run costs 35 seconds of play per attempt, for the human playtester and for gameplay snapshot capture alike. Crystal's warden entrance is the current worst case. The debug panel also gives no live answer to "which bar is this?" — the author lines up what they hear against the arrangement table by counting.

## Deliverable 1: `?start=` scrub

A dev-mode URL parameter (`?start=35`, and `?start=bar:16` or `?start=warden` once brief 01's markers exist) that fast-forwards a freshly started run to that point:

- Runner: advance run time, consume timeline entries scheduled before the start point without spawning them (they count as neither kills nor misses — decide and document how they affect the end-screen totals), and seat the camera via `easeRunProgress` at the scrub time.
- Audio: the arrangement is a pure function of position, so seeking is epoch arithmetic — set the score epoch/arrangement start such that the transport's next step is the correct mid-arrangement position. Long one-shots that began before the seek point (risers, pads) may simply be absent; that is acceptable and worth a note in the doc.
- Scope it to dev builds and the gameplay snapshot tool; the tool should accept `--start` and use it so `--at bar:16` captures no longer replay the whole run (coordinate with brief 04 if it landed first).

The design constraint worth honoring everywhere this touches: seek works because timeline and score are functions of position, not accumulated state. Where you find accumulated state in the engine that breaks that (mode flips, kill-lane cursors), reset it from the seek position rather than special-casing.

## Deliverable 2: transport overlay

A line in the existing dev Debug panel: current `bar:beat`, section name (from the score when the level has one), alive/lockable enemy counts, and a short rolling ticker of the last few bus events. Read-only, dev-only, no per-level wiring required beyond what the score already exposes.

## Level updates

Scrub-test **crystal, helios, prism** (optionally **rezdle**) at two or three points each — mid-act, a section boundary, just before the boss/finale. Where a level's run-state (crystal's warden override and core ids, helios's heart ids) initializes wrongly under seek, fix the level's `onRunStart`/reset hooks so state derives from the seek position. Gates per touched level: `trace:audio --compare` and `trace:spawns --compare` (normal, non-scrubbed runs must be untouched), typecheck, build, `check:scope`, and a human playtest note per level: does a scrubbed run play correctly from the seek point?

## Out of scope

- Deluge (tracked in `docs/briefs/deluge-followups.md`).
- Rewind/scrubbing during play; this is start-offset only.
- Reconstructing mid-flight state (enemies that spawned before the seek point stay unspawned; bolts in flight don't exist).
- Any change observable in a normal, unscrubbed run.
