# Engine brief 06: environment scaffolding

Part 6 of the wishlist sequence. Independent of the others. Read `AGENTS.md`, `docs/level-authoring.md`, and `src/engine/visual-kit.ts` first — this brief extends visual-kit's philosophy to environments: **lifecycle and bookkeeping in the engine, every mesh, color, number, and distribution rule in the level.** Retrofits are behavior-preserving.

## Problem

Every level with a populated world re-implements "scenery that exists ahead of the camera and is recycled behind it": placement along the rail, a visibility/recycling window, respawning ahead, disposal. Crystal's environment leaf hand-rolls its debris field; other levels have their own variants of the same loop. None of that loop is a look decision. Atmosphere ramps (fog/background shifting across the run) are similarly re-derived wherever a level wants the world to darken into its finale.

## Deliverable 1: scatter-along-rail with recycling

A helper in `src/engine/` (suggest `environment-kit.ts`):

```ts
const field = scatterAlongRail(curve, {
  count: 140,
  place: (i, rng) => ({ u: ..., offset: new Vector3(...) }),  // level's distribution, rail-relative
  make: (i, rng) => Object3D,                                  // level's look, made once and pooled
  window: { behind: 20, ahead: 400 },                          // recycle outside this range
  seed: 7,
});
field.update(cameraRailU /* or camera position */);
field.dispose();
```

Requirements:

- Rail-relative placement through the existing `offsetFromRail`/`sampleRailFrame` helpers; recycled items get re-placed ahead via the level's `place` function, so distribution stays authored.
- Seeded RNG threaded through (crystal's `mulberry32` is the obvious candidate to lift into the engine as a shared utility — do that here, leaving levels' local copies to be replaced in the retrofit).
- Per-item update hooks stay in the level (crystal spins its debris in `updateVisuals`; the helper must expose iteration or accept an `onUpdate` so that keeps working unchanged).
- Disposal via visual-kit's `disposeObject3D`.

## Deliverable 2: atmosphere ramp

A small helper that drives fog color/density and background color through authored keyframes over run progress (and musical positions once brief 01 exists): `createAtmosphereRamp(points)(progress)` applying to scene fog/background. Levels keep every color and stop; the helper owns interpolation and application. Ambient/attract behavior (what happens outside a run) stays the level's call.

## Retrofits

- **crystal** — move the debris field onto `scatterAlongRail` and its RNG onto the shared seeded RNG. Survey whether it has an atmosphere ramp worth converting.
- **helios**, **prism** — survey their environment leaves for the same loops; convert what is mechanical, report what is genuinely bespoke and leave it.
- **rezdle** — optional.

Gates per level: before/after `npm run snapshot:gameplay -- --level <id> --thumbnails 8` sheets must match (same seed ⇒ same world), `trace:spawns --compare` untouched, typecheck, build, `check:scope`. If a level's current scatter is unseeded (`Math.random`), seed it with a fixed value as part of the retrofit and accept a one-time thumbnail change — call that out explicitly and get the new sheet eyeballed.

## Out of scope

- Deluge (tracked in `docs/briefs/deluge-followups.md`).
- Any new scenery, density change, or look adjustment.
- Sky/dome generators — levels that want one build it; nothing shared yet.
