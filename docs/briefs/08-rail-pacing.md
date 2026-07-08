# Brief 08: Rail-velocity pacing for high-speed enemy readability

## Context

Rush exposes a level-authoring problem: when the rail moves very fast, enemies enter and leave the useful lock-on view too quickly. The cause is structural. Every level today anchors combat targets at a fixed rail point via `railAnchor(lead)`, so an enemy has zero velocity along the rail and the closing speed *is* the camera speed. The readable window collapses to roughly `visibleDistance / cameraSpeed` — at Rush speeds, well under a second — and no amount of lead tuning can extend it: a larger lead just makes the enemy spawn beyond the fog and stay invisible longer. The window's ceiling is set by fog distance and local rail speed, neither of which a builder wants to bend for combat's sake.

The fix is to give enemies velocity along the rail. When a target paces the camera, closing speed becomes an authored quantity, decoupled from how fast the level moves. This is also the genre-correct answer — classic rail shooters keep targets readable at speed by having them fly with the player and then peel away — and it sells velocity rather than undermining it: a pod hovering motionless in a 200 u/s tunnel reads as wrong; a dart racing alongside and breaking away reads as fast.

## Goal

Add a reusable rail-pacing helper to `src/engine/` that lets a level author an enemy's engagement window directly, plus a simulation-based engagement report that measures actual readable windows for any level. Adopt pacing in Rush for ordinary combat targets. Leave existing levels untouched.

## Core semantics

Author enemy rail motion in the camera's reference frame as a distance-ahead curve `d(t)` with three phases:

1. **Enter** — the enemy appears at spawn distance (near the fog edge) and eases in toward the camera, decelerating to match speed. The ease matters for feel: an abrupt stop at the hold distance looks like hitting glass, and the approach gives the player a beat of "incoming" anticipation.
2. **Hold** — the enemy paces the camera at the engagement distance for `readableFor` seconds. This phase *is* the readability contract, satisfied by construction: a mid-hold speed surge does not shorten the window, because the enemy surges with the player.
3. **Exit** — the enemy breaks away (accelerates ahead, peels laterally, or drops behind — the level chooses). Once the exit completes plus any miss grace, the enemy is missed.

`readableFor` means the enemy holds at engagement distance for at least that long. Builders may deliberately choose short holds for frantic sections; the point is that the number is authored, not an accident of rail speed.

Conversion to world space is trivial because three.js `getPointAt` is already arc-length parameterized: the paced anchor is `anchorU(t) = easeRunProgress(t) + d(t) / railLength`. No solver, no iteration, no approximate geometric model.

A useful side effect: an enemy holding distance ahead follows the rail around bends and stays roughly centered on screen, where a fixed anchor swings across the frame as the camera banks toward it. Bends get more readable, not less.

## Non-goals

- Do not make high-speed sections automatically easy. Short holds in surge sections are a legitimate design choice.
- Do not build a placement solver or an approximate readability model. Pacing makes the window authored; the simulator (below) measures the truth.
- Do not introduce a shared spawn DSL or timeline builder. Levels keep their own authoring idioms (Rush's wave table, Crystal's wave helpers). The engine ships a calculator/helper, not a framework.
- Do not retrofit or retune existing levels. Fixed anchors via `railAnchor(lead)` remain fully supported and are not deprecated; they are the right tool at Crystal-like speeds and for set pieces, bosses, and choreographed waves.
- Do not replace each level's ownership of lateral enemy motion or visual language. Rush's gate/strafe/sink motions continue to apply as offsets around the paced anchor.
- Do not introduce WebGL fallbacks, assets, textures, fonts, or audio files.

## Suggested API shape

Exact names may change during implementation. Intended shape — an engine helper created once per level:

```ts
const pacer = createRailPacer({
  curve: createRushRail(),
  duration: RUSH_RUN_DURATION,
  runProgress: rushRunProgress,
  defaults: {
    spawnAheadUnits: RUSH_TUNING.fog.farUnits * 0.92,
    engageAheadUnits: 34,
    enterSeconds: 0.5,
    readableFor: RUSH_TIME.beats(2),
    exitSeconds: 0.45,
  },
});
```

Per-spawn overrides live in the level's own spawn data, exactly where `leadSeconds` lives today. A Rush wave row gains an optional engagement field instead of a hand-tuned lead:

```ts
{ bar: 19, beat: 2, kind: 'dart', motion: 'strafe', lanes: [-2, -1, 0, 1, 2, 0], row: 1, stepEvery: 1,
  engagement: { readableFor: RUSH_TIME.beats(1) } },
```

Section-scoped defaults are plain JavaScript — a local const spread into a group of wave rows — not a planner API.

Inside `updateEnemy`, the pacer is sampled where `railAnchor(data.leadSeconds)` is called today:

```ts
const paced = pacer.sample(enemy.entry.time, runTime, data.engagement);
// paced.anchorU  — rail progress for offsetFromRail
// paced.phase    — 'enter' | 'hold' | 'exit' (levels may key motion/telegraph off this)
// paced.done     — exit complete; level applies its miss-grace and returns true to despawn
```

The output feeds ordinary `LockOnSpawnEntry` values and the existing `offsetFromRail` path; the runner's spawn contract does not change.

Edge behavior the helper must handle: clamp `anchorU` to `[0, 1]`, and expose enough (for example, the time the exit completes) for the timeline builder or diagnostics to reject spawns whose enter + hold + exit cannot fit before the rail ends.

## Engagement report (diagnostics)

Do not build a new readability model. `scripts/simulation-cli.ts` already runs the real runner headlessly — real rail, real camera including bank from `updateCameraEffects`, real per-frame `updateEnemy` motion, real NDC projection. Extend `npm run simulate` with an engagement report (for example `--engagement`) that runs policy `none` (nothing gets killed, so every enemy lives out its full window) and reports per timeline entry:

- first frame the enemy is on-screen and lock-eligible (projects within NDC bounds, `lockable !== false`);
- last such frame before its `miss` event;
- total lockable seconds;
- the active `readableFor` contract, if the level declares one, and PASS/FAIL against it with a small global tolerance (~0.08 s) owned by the checker.

This measurement is exact — it captures strafe sweep-in, rail bends, camera bank, and fog-distance spawn-in that any geometric estimate would approximate. It is deterministic and CI-suitable.

The report must also work for levels with no contracts (fixed-anchor levels): it simply reports measured windows. That makes it a regression check for Crystal and every other existing level with zero gameplay changes.

Contract plumbing: the report needs to know each entry's expected `readableFor`. Keep this simple — for example, an optional level-exported engagement manifest or a well-known field on spawn `data` that the CLI reads. Do not route it through the runner.

Example output:

```text
rush 30.9s dart lane -2
  contract: readableFor=0.71s (hold)
  measured lockable: 1.18s (enter 0.42s + hold 0.71s + exit 0.05s)
  result: OK

rush 33.5s heavy lane 0
  contract: readableFor=1.41s (hold)
  measured lockable: 1.02s
  result: FAIL, short by 0.39s — exit clipped by rail end; spawn earlier or shorten hold
```

Note the distinction the report should make explicit: the *contract* is the hold duration; the *measured* window includes whatever portion of enter/exit is actually lockable on screen. The contract passes when measured lockable time from hold start onward meets `readableFor`; eased enter time is a readability bonus, not a substitute.

## Rush adoption

Convert Rush's ordinary combat targets (pod, dart, heavy waves) from hand-tuned `leadSeconds` to paced engagements with a level default around `RUSH_TIME.beats(2)`, shortened deliberately in surge sections. Remove or repurpose `RUSH_TUNING.enemies.defaultLeadSeconds`; keep `missGraceSeconds` as the post-exit forgiveness.

Two knock-on effects to tune, using the existing simulate pressure metrics:

- **Concurrency rises.** Enemies visible for authored durations stay on screen longer than fog-collapsed ones did; overlapping holds in fast sections can stack past what a 6-lock volley can service. Expect to thin or re-space some waves. `impossibleMoments` in the pressure summary is the guard.
- **Enter/exit are feel parameters.** Tune the enter ease so approach reads as incoming rather than teleport-and-stop, and choose exit styles per kind (darts peel hard, heavies fall behind).

Rush should still sell speed through environment, traffic, strobing, FOV pulls, and motion blur. Pacing makes combat readability a separate authored channel, which is the point.

## Existing levels

Crystal, Helios, Deluge, and Prism are consumers of the engagement report only. No source changes to any of them. Their fixed-anchor placement is not "legacy" — at their speeds it already produces generous windows, and the report now proves it with numbers instead of feel.

## Documentation

Update `docs/level-authoring.md` in the same change:

- what rail pacing is and when to use it versus a fixed `railAnchor(lead)`;
- what `readableFor` means (hold duration; contract is a minimum);
- enter/hold/exit semantics and the feel notes above;
- how to run the engagement report and read its output.

## Verification

```sh
npm run typecheck
npm run build
npm run simulate -- --level rush --engagement
npm run simulate -- --level crystal --engagement
```

Include both engagement reports in the handoff. `src/levels/crystal/` (and all other non-Rush levels) must show no diff — this work touches `src/engine/`, `scripts/`, `src/levels/rush/`, and docs only. (`npm run check:scope` does not apply: it permits changes to a single level directory, and this task is deliberately engine + one level.)

Visual verification still requires a human playtest — WSL2 headless Chrome cannot render the WebGPU game. The playtest should specifically check that Rush still feels fast, that enemies pacing the camera read as racing alongside rather than floating, and that enter/exit motion looks intentional at surge speeds.
