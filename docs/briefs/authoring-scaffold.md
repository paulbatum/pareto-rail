# Tooling brief: level authoring scaffold, gallery, and reading-cost cuts

Read `AGENTS.md`, `docs/level-authoring.md`, and `docs/level-brief.md` first. This is tooling and docs work, not a level task.

## Motivation

Building a level to the standing brief currently forces an agent to read 100k+ tokens of existing level source to learn (a) the wiring contracts and (b) what its level must not resemble. This brief moves both onto cheaper paths: a scaffold generator embodies the wiring, per-level identity cards replace source-reading for distinctiveness, and the docs point contract reading at types instead of implementation. Guiding rule for every deliverable: **scaffolding encodes the contract, never an answer.** Nothing generated may contain an example enemy, spawn pattern, sound, palette, or motion that could survive into a shipped level.

## Deliverables

### 1. Spine/leaf convention (docs)

Add a "Module layout: spine and leaves" section to `docs/level-authoring.md`, before "Adding a level". The convention, which crystal and helios already mostly follow:

- The **spine** holds decisions: `index.ts` (wiring), `gameplay.ts` (spawn timeline, enemy motion, tuning constants), the audio score (arrangement, harmony, section structure), and `visuals/index.ts` (palette, event choreography).
- **Leaves** hold construction: mesh factories, environment geometry, synth voice construction. Leaves take parameters; they decide nothing.
- The one hard rule: **timelines, tuning constants, and palettes never live in leaf files.**
- State the payoff explicitly: a reader calibrating against a level reads its spine only.
- This is a default, not a law — rezdle legitimately decomposes differently. `check:scope` does not police it.

### 2. Runner types extraction

Move the exported types in `src/engine/lock-on-runner.ts` (the `LockOnSpawnEntry` … `LockOnRunnerOptions` block, with their doc comments) into a new `src/engine/lock-on-runner-types.ts`. `lock-on-runner.ts` re-exports them so **no existing import changes**. Zero behavior change. Update the "See `src/engine/lock-on-runner.ts` for exact types" line in `docs/level-authoring.md` to point at the types file.

### 3. Glyph grids in the engine

New `src/engine/glyphs.ts`: 5×7 glyph grid data for A–Z and 0–9, as neutral data in the same spirit as `spawn-patterns.ts`. Match the grid encoding style used by `src/levels/crystal/visuals/letters.ts` (the documented reference), and use its letterforms where it has them. Export the grid record plus a small accessor (e.g. rows for a character, or on-cell coordinates). **No rendering code, no materials, no geometry** — style stays with levels. Do not retrofit existing levels; they keep their own copies. Mention the module in the glyph paragraph of `docs/level-authoring.md` (levels may use it for grid data; rendering remains theirs; the legibility requirement is unchanged).

### 4. Scaffold generator

`scripts/scaffold-level.mjs`, wired as `npm run scaffold -- --id <id> [--title <Title>] [--bpm <n>]`. Refuses an id that already exists. Emits `src/levels/<id>/` with:

- `index.ts` — complete `LevelDefinition` wiring in the shape of deluge/helios: post config, `createAudio`, `createRuntime` calling `createLockOnRunner` with the visual factories. This file should be close to final as generated.
- `gameplay.ts` — the authoritative BPM constant, a `createRail` returning a plain placeholder curve marked TODO, an **empty** spawn timeline, and an `updateEnemy` stub. No example entries, no example motion.
- `audio.ts` — a minimal `createAudio` built on `createLevelAudioKit`/`createStepTransport` that satisfies the contract and emits `beat` events, but plays **silence**. Header comment: keep arrangement decisions here; move voice construction to leaf files as it grows (see the convention).
- `visuals/index.ts` — the six visual factories returning deliberately unshippable placeholders: flat saturated magenta, basic primitives. Letter meshes may consume `src/engine/glyphs.ts` grid data with flat magenta cells. Empty environment. Header comment mirroring the audio one (decisions here, mesh construction to leaves).
- `level.md` — the identity-card template (see deliverable 5).
- Appends a registry entry at the **end** of `src/levels/index.ts` (crystal stays first).

A freshly scaffolded id must pass `npm run typecheck`, `npm run build`, and `npm run check:scope -- <id>`, and must boot to the START screen. Verify by scaffolding a temp id, running those checks, then deleting the temp level and its registry line.

### 5. Per-level identity cards and the gallery

Each level owns `src/levels/<id>/level.md`. Template (keep cards short — they are read in bulk):

```markdown
# <Title>

<One paragraph: world, mood, what makes this level recognizable at a glance and by ear.>

## Visual language
## Musical language
## Mechanical signature
## What to read
<Spine file pointers for an agent calibrating against this level.>
## Status & notes
<Owner notes, known issues. Maintained by humans as much as agents — preserve on regeneration.>
```

`scripts/collect-gallery.mjs`, wired as `npm run gallery`, concatenates all `src/levels/*/level.md` in registry order into `docs/level-gallery.md` with a header marking it generated ("edit `src/levels/<id>/level.md`, then re-run `npm run gallery`"). Run it and commit the generated file as part of this task's diff (pi: leave it in the working tree; do not commit).

Draft `level.md` for all five existing levels — **factual, from their source and docs, invented nothing**:

- `crystal` — the flagship landing level, polished through many human playtests.
- `helios` — the current quality bar for one-shot builds.
- `deluge` — status must say: known buggy, below the bar, pending a quality pass (owner will detail the bugs).
- `prism` — a minimal early proof-out, not a showcase.
- `rezdle` — note it is word-game-shaped and deviates from the standard decomposition.

Adding `level.md` files is the **only** change permitted inside existing level directories.

### 6. Standing-brief and AGENTS.md updates

- `docs/level-brief.md`: replace "Study the existing levels and the engine before you start" with a reading protocol: start from `npm run scaffold`; read `docs/level-authoring.md`, `src/engine/lock-on-runner-types.ts`, and `docs/level-gallery.md`; for quality calibration read the **spine** of the level the gallery identifies as the current bar — full-source reading of other levels is optional depth, not a requirement. Distinctiveness ("what not to resemble") is now checked against the gallery. Add to the floor: the level ships with its `level.md` filled in, and the gallery regenerated.
- `AGENTS.md`: add one-liners for `npm run scaffold` and `npm run gallery` where the other tools are listed, and a one-line pointer to the spine/leaf convention. Keep it terse; the authoring doc carries the detail.

## Hard constraints

- Do not change any behavior of `lock-on-runner.ts` or any existing level. Existing level directories gain only `level.md`.
- `npm run typecheck` and `npm run build` must pass on the final tree.
- Docs stay tight: no duplication between `AGENTS.md`, `level-authoring.md`, and `level-brief.md`; each fact lives in one place.
- Do not commit.

## Verification report

Report: the scaffold smoke-test results (temp id created, checks passed, removed), that `npm run gallery` produced the gallery from the five cards, and final typecheck/build status.
