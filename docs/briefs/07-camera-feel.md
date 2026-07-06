# Engine brief 07: camera-feel primitives

Part 7 of the wishlist sequence. Independent of the others; smallest of the set. Read `AGENTS.md` and `docs/level-authoring.md` first. Standing rules apply with extra force here: **feel is judged, so the engine ships primitives with no default bindings** — nothing shakes or punches unless a level asks. Retrofits are behavior-preserving.

## Problem

Camera feel — the FOV breathing with the beat, a kick on a full volley, a shudder on taking a hit — is where "volleys land with weight" lives, and every level hand-rolls it. Crystal drives a beat-energy FOV punch through module-level state in its visuals spine; the decay math, base-FOV bookkeeping, and clamping are plumbing, and hand-rolled shake is exactly where naive implementations go wrong (jitter that never settles, drift that never returns to center).

## Deliverable: a camera-feel rig

A helper in `src/engine/` (suggest `camera-feel.ts`) a level creates in its runtime and updates each frame:

```ts
const feel = createCameraFeel(camera);   // captures base fov/orientation once
feel.kickFov(1.6, { decay: 4.2 });       // additive degrees, exponential decay
feel.shake(0.5);                          // trauma model: accumulates, decays, clamped;
                                          // applied as smoothed noise rotation, never position
feel.update(dt);                          // composes with the runner's camera control, then restores
```

Requirements:

- Trauma-model shake (accumulate on events, decay continuously, effect scales with trauma², smoothed noise so it never strobes) with hard clamps, applied as small rotation offsets after the runner positions the camera so it cannot fight the rail.
- FOV offsets are additive to a captured base and always decay to zero; the rig owns `updateProjectionMatrix` and base-FOV restoration on dispose/run end.
- All magnitudes, decay rates, and which events trigger anything remain level decisions. No bus subscriptions inside the engine.
- Must coexist with a level that also writes FOV directly during migration, or the retrofit ports that writing entirely — don't leave two owners of `camera.fov`.

## Retrofits

- **crystal** — port the beat-energy FOV punch (beat, downbeat, playerhit weights) onto the rig with identical response. Gate: numeric equivalence — script the old and new FOV curves over a synthetic beat/playerhit sequence and compare within float tolerance; then a human playtest for feel.
- **helios**, **prism** — survey for hand-rolled camera feel (`updateCameraEffects`, FOV writes, shake-like offsets); port what exists mechanically. If a level has none, add nothing — adopting the rig with new effects is future creative work, not this brief.
- **rezdle** — optional, same survey rule.

Per level: `trace:spawns --compare` and `trace:audio --compare` untouched, typecheck, build, `check:scope`. Snapshot sheets are a weak gate for motion — say so in the report and lean on the numeric comparison plus playtest.

## Docs

Add the module to `docs/level-authoring.md`'s shared-code inventory with one sentence making the no-default-bindings rule explicit.

## Out of scope

- Deluge (tracked in `docs/briefs/deluge-followups.md`).
- Any new camera effect in any level; intensity retuning.
- Screen-space post effects (levels already have `composeOutput` for those).
