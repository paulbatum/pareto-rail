# Tooling brief 04: snapshots at musical moments, bloom-zero pairs

Part 4 of the wishlist sequence. Best after brief 01 (it consumes musical positions) but can land first using per-level BPM to convert bars to seconds. Read `AGENTS.md`, `docs/visual-tools.md`, and the snapshot tool source before starting. Tool-only; level changes are limited to `level.md` notes.

## Problem

`snapshot:gameplay` addresses time in seconds, but the moments worth inspecting are musical: the drop, a section boundary, the bar where a boss enters. An author checking "does the drop look like a drop" first converts bars to seconds by hand. Separately, the floor requires full playability and legibility with the player's bloom slider at zero, and there is no way to check that without a human dragging the slider — the single most mechanical check in the whole floor list.

## Deliverable 1: musical addressing

Extend `snapshot:gameplay`:

- `--at <bar[:beat]>` (repeatable, and a `--ats 4,8:2,16` list form) — converted through the level's BPM; after brief 01, prefer the level's marker/section table so `--at warden` also works.
- `--sections` — one capture at each section boundary of the level's arrangement (source the boundaries from the audio trace or the level's marker table; say which in the report). This is the "phrase-boundary contact sheet" that shows whether section changes mean anything on screen.

Existing `--time/--times` stay; musical flags are additive.

## Deliverable 2: bloom-zero pairs

A `--bloom-pair` mode that renders every requested capture twice — player bloom at default and at zero — and composes them side by side in one image, labelled. The engine already guarantees the slider multiplies level bloom (`src/engine/post.ts`); the tool needs to drive that setting per render. If the snapshot tool's WebGL fallback path (`full`, `postless`, `flat`) makes "bloom at zero" degenerate in some mode, document which modes produce a meaningful pair rather than silently emitting identical halves.

## Level updates

For **crystal, helios, prism** (and optionally **rezdle**): capture a `--sections --bloom-pair` sheet, look at it, and add a short "inspection captures" line to each `level.md` naming the two or three musical moments most worth re-checking after future edits (e.g. crystal: warden entrance bar, densest act-2 bar). Fix nothing visual — if a bloom-zero half looks illegible, record it in the report as a finding for a future quality pass.

## Verification

Tool: run against all covered levels in each fallback mode it supports; snapshots land under `snapshots/gameplay/` with names that encode the musical position and bloom state. `npm run typecheck`, `npm run build`. Levels: `check:scope` for any `level.md` touch.

## Out of scope

- Deluge (tracked in `docs/briefs/deluge-followups.md`).
- Fixing anything the bloom-zero pairs reveal.
- Video or animated capture.
