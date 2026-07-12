# Level authoring

`raild` treats each level as an independent module under `src/levels/<level-id>/`. For comparison tasks, a level uses the shared `createLockOnRunner` flow while owning its rail, spawns, enemy motion, visuals, environment, effects, and procedural audio.

Shared code lives in `src/engine/`:

- `lock-on-runner.ts` contains the START/RUN/REPLAY flow, pointer input, lock-on targeting, homing shots, scoring hooks, and HUD updates;
- `rail.ts` contains rail sampling helpers, not a level rail;
- `rail-pacer.ts` contains an opt-in helper for high-speed levels that need enemies to pace the camera for an authored readable window;
- `music.ts` contains small timing helpers for beat emission, tempo, MIDI conversion, and grid quantization;
- `music-time.ts` converts authored bars, beats, steps, and named markers into the seconds consumed by gameplay systems;
- `audio-kit.ts` contains Web Audio primitives plus the shared mix bus and instrument registry;
- `audio-voices.ts` contains the declarative voice-spec layer that compiles compact timbre specs to the audio-kit primitives;
- `audio-trace.ts` contains semantic audio trace sinks and the reusable trace harness;
- `score.ts` contains the shared musical-position helper for epoch anchoring, harmony, sections, action quantization, and kill lanes;
- `arrangement.ts` contains the thin section/pattern/function/one-shot DSL for musical scheduling;
- `spawn-patterns.ts` contains small helpers for eager spawn timeline construction;
- `speed-profile.ts` contains piecewise-linear speed factors and normalized-integral run-progress easing for authored speed curves;
- `glyphs.ts` contains neutral 5×7 glyph grid data and accessors, not rendering;
- `hostile-shot.ts` contains shared homing steer, behind-camera despawn cull, and approach/impact timing for lockable enemy shots and hazards;
- `visual-kit.ts` contains lifecycle helpers for visual bookkeeping: pending mesh-to-event records, transient effect pools, additive material setup, and attached adornment slots. It owns no look or timing decisions; levels still supply every mesh, color, number, and update rule;
- `environment-kit.ts` contains lifecycle helpers for rail-relative scenery fields and atmosphere ramps. It owns placement/recycling bookkeeping and interpolation; levels still supply every mesh, color, count, distribution, and keyframe;
- `camera-feel.ts` contains opt-in FOV kick/offset and trauma-shake primitives with no default bindings; levels decide every trigger and magnitude;
- `post.ts` contains the shared bloom/vignette renderer and the player-facing bloom setting.

## Module layout: spine and leaves

Default to a spine/leaf split. The **spine** holds decisions: `index.ts` for wiring, `gameplay.ts` for the spawn timeline, enemy motion, and tuning constants, the audio score for arrangement, harmony, and section structure, and `visuals/index.ts` for palette and event choreography. **Leaves** hold construction: mesh factories, environment geometry, and synth voice construction. Leaves take parameters; they decide nothing.

The hard rule is that timelines, tuning constants, and palettes never live in leaf files. The payoff is lower reading cost: a reader calibrating against a level reads its spine only.

This is a default, not a law. Rezdle legitimately decomposes differently, and `check:scope` does not police this convention.

## Adding a level

1. Create `src/levels/<id>/index.ts` that exports a `LevelDefinition`.
2. Declare one authoritative BPM constant for the level. Reference it from both the `LevelDefinition` and the runner config; audio should import the same constant instead of repeating the number.
3. Implement `createAudio(bus)` in that level. The pause menu calls the returned volume, start, suspend, and dispose methods. For beat-driven levels, the expected audio spine uses `createBeatLevelAudio` to compose the mix bus, score epoch, transport, beat emission, and trace run; levels still supply `createScore`, `defineInstruments`, `createArrangement`, and all musical data. Raw `audio-kit` primitives remain available when a level needs custom synthesis or routing.
4. Implement `createRuntime(context)` in that level. It should create the level environment and visual event handlers, then call `createLockOnRunner`.
5. Add the level to `src/levels/index.ts`.

A built-in level task should only touch `src/levels/<id>/`, one registry line in `src/levels/index.ts`, and the regenerated `docs/level-gallery.md`. Use `npm run check:scope -- <level-id>` to verify that boundary.

### Authoring a benchmark output

Future benchmark entrants use the directory-only protocol. Start with:

```sh
npm run scaffold -- --mode benchmark --id <id> --title '<Title>'
```

This creates `src/benchmark-levels/<id>/`, including `index.ts`, `gameplay.ts`, `audio.ts`, `visuals/index.ts`, `level.json`, and `level.md`. The descriptor is controller-free authored input, but discovery validates its id and title against the loaded `LevelDefinition`; do not treat it as a second gameplay identity or edit shared registry code. The benchmark scope gate permits only the assigned directory and explicitly permitted derived gallery output:

```sh
npm run check:benchmark-scope -- --version v2 --level <id> --base <entrant-baseline-ref>
```

Benchmark levels are discovered automatically by the permanent catalog and appear in the normal development picker, simulation, floor checks, and gameplay snapshots. Do not add them to `src/levels/index.ts`.

### Promoting a benchmark output

Benchmark outputs use the separate `src/benchmark-levels/<id>/` domain. Add a `level.json` descriptor with the public `id` and `title`, an `index.ts` exporting exactly one `LevelDefinition`, and a `level.md` identity card. The permanent discovery module associates the matching direct-child files automatically; do not add benchmark outputs to `src/levels/index.ts`. The descriptor id must equal its directory name, and the loaded definition must use the descriptor's id and title. Test-only benchmark fixtures belong under `src/benchmark-levels/test-fixtures/`; they are intentionally excluded from discovery and the gallery.

## Handoff checks

Before handing off a level change, run the general project checks and the level floor gate:

```sh
npm run typecheck
npm run build
npm run check:scope -- <level-id>
npm run check:floor -- --level <level-id>
```

`check:floor` includes score/audio configuration validation, simulation, target occlusion, and headless performance gates. Use focused tools such as `simulate`, `snapshot:gameplay`, `trace:audio`, and `check:perf` while investigating a specific problem, but `check:floor` is the level readiness gate.

## Runner contract

Pass a `LockOnRunnerLevel` to `createLockOnRunner`:

- `duration`: run length in seconds, usually produced from `createMusicTime` for beat-driven levels.
- `bpm`: the level tempo. The runner uses it for beat reconstruction and musical shot timing.
- `createRail()`: returns the level's `CatmullRomCurve3`.
- `spawnTimeline`: ordered enemy entries. Beat-driven levels should author entry times as bars, beats, steps, or named markers through `createMusicTime`; the runner still receives seconds. Entries may include `letter?: string`; the runner passes it to `createEnemyMesh`, exposes it on public enemies, and includes it in target events. Entries may also set `hitPoints` (default 1), `hitStages` (ordered HP stages; each stage must be between 1 and `MAX_LOCKS`), `lockable: false` (read live each frame, so a level may mutate it mid-run to gate a boss phase), and `countsTowardTotal: false` (excluded from the kills/missed/total stats while still scoring and emitting events — use for hazards like enemy projectiles). The current stage's remaining HP determines how many repeat locks the target can accept, capped by the global lock maximum and spaced by the game-wide repeat-lock delay.
- `updateEnemy(context)`: owns all enemy motion every frame. Position, rotation, and any per-frame mesh state are the level's responsibility. Return `true` to despawn that enemy as a miss; return `false` or nothing to keep it alive. The context also provides `railAnchor(lead)` for eased rail seating, `enemyState(init)` for lazily initialized mutable state scoped to that enemy instance, `spawnEnemy(entry)` to spawn enemies at runtime (returns the new enemy id; running state only), `damagePlayer(amount?)`, and the current `playerHealth`.

Optional overrides fall into two groups. The first group shapes the level's identity — how scoring, release rules, pacing, and timing feel:

- `scoreForKill`, `scoreForHit`, `scoreForVolley`: `scoreForVolley` scores a released group after all members resolve; `scoreForHit` scores non-lethal hits on multi-hit enemies.
- `validateRelease`: rejects a running-state release before shots are created, or returns the subset of released enemies allowed to fire.
- `rankForRun`: the level's own rank ladder.
- `easeRunProgress`: authored variable rail speed; use `createSpeedProfile` and pass its `runProgress` through.
- `timing`: the level's shot-rhythm and action-SFX-snap profile (see below).
- `playerHealth`, `allowLockUndo`, `lockRadiusNdc`: the hull system, right-click undo-lock (off by default), and the screen-space lock threshold.

The second group is utilities: `updateAttractCamera`, `updateCameraEffects`, `detailsForRun` (compact end-screen lines), `startWord`, and `replayWord`.

`timing` is a choice the level owns whether or not it writes any code for it. The engine's default profile — tempo-adaptive grid-ramp shot timing with the coarsest grid capped in absolute time, plus 32nd-note action-SFX snap at the level tempo — is one valid answer, and inheriting it is fine when it suits the level's pace. Fast levels usually lower `maxGridSeconds`; Rezdle opts out of SFX snapping. The simulator prints an "Engine defaults" section showing exactly which timing fields, lock radius, and identity hooks a level inherits: read it and confirm each inherited default is something the level wants, not something it never considered. Shot gap values are counts of 32nd notes, not seconds. See `src/engine/lock-on-runner-types.ts` for exact types.

Setting `playerHealth` enables the hull system: `damagePlayer` calls take a point off (with a short invulnerability window between hits), the HUD shows hull pips and a red damage flash, and reaching zero ends the run with `died: true` in the summary and a forced `—` rank. Related events: `playerhit` fires on accepted damage, `hit` carries `lethal`, total `hitPointsRemaining`, and current-stage fields, `stage` fires when a non-lethal stage is completed, and `runend` carries `died`.

For lockable enemy shots and hazards, prefer `steerHomingShot`, `shotBehindCamera`, and `updateHostileShotImpact` from `src/engine/hostile-shot.ts` for shared flight bookkeeping, despawn culling, and close-range impact timing. Impact timing gives levels shared safety defaults, with `hitDistance`, `impactBrake`, and `damageDistance` overridable per level for feel — the overridable surface is deliberately just the fields that change how incoming danger reads. Levels still own tuning, launch motion, visuals, audio, and when to call `damagePlayer`.

## Rail pacing for high-speed combat

A fixed-anchor target authored with `railAnchor(lead)` means one thing: the camera overtakes the target `lead` seconds after it spawns, so `lead` is the target's time on screen. That authoring works at Crystal- or Helios-class speeds (leads around 4–5 s) because the camera covers less ground during the lead than the level can show. When the camera is fast enough that a fixed anchor would sit beyond the fog at spawn, the window collapses and no lead value can fix it.

`createRailPacer` from `src/engine/rail-pacer.ts` keeps the same authoring and compensates for speed automatically. A lead still means "overtaken `lead` seconds after spawn"; the pacer checks how far ahead the fixed anchor would be at spawn, and if that exceeds the level's visibility budget (`spawnAheadUnits`, usually just inside the fog wall), it scales the target's distance-ahead profile down so the target spawns exactly at the visibility edge and closes on the camera proportionally. The overtake time is unchanged, so the on-screen window equals the lead by construction. When the fixed anchor fits, the scale is 1 and the result is identical to `railAnchor(lead)` — so leads are authored in the same ballpark of seconds regardless of level speed, and a fast level just runs slightly shorter values.

The compensated target has real velocity along the rail: it races with the player, closes at a fraction of camera speed, surges when the camera surges, and exits by being overtaken — the same exit fixed-anchor targets have. Do not add hover, hold, or scripted break-away phases on top; being passed is the natural exit at any speed.

Create one pacer per level with `curve`, `duration`, the level's `runProgress` easing, `spawnAheadUnits`, and `defaultLeadSeconds`. Resolve each spawn's lead at timeline-build time with `pacer.resolve(entryTime, leadSeconds?)` and store the returned `RailLead` on the spawn's `data.engagement`; in `updateEnemy`, feed `pacer.sample(entryTime, runTime, data.engagement).anchorU` into the same `offsetFromRail` path used by fixed anchors, and count the target as missed after `passTime` plus the level's miss grace. The engagement report reads the authored `leadSeconds` off `data.engagement` as the contract; when `windowSeconds` (the lead clamped to the rail end) comes back smaller than the lead, the spawn cannot fit its window before the run ends and the report fails it with a rail-end note.

Fixed anchors remain the right choice for set pieces, bosses, and choreographed formations, and for whole levels at moderate speeds.

Example diagnostics:

```sh
npm run simulate -- --level rush --engagement
npm run simulate -- --level crystal --engagement
```

The engagement report runs a no-fire, immortal simulation and measures the real camera projection each frame. For entries with a `data.engagement.leadSeconds` contract, `OK` means the target was lockable for at least the authored lead, minus a checker-owned tolerance (a small flat term plus a fraction of the window covering the moment near the pass where the target leaves the lock frustum). Entries with no contract are reported as measured-only, which is useful for checking fixed-anchor levels without changing their source. Pressure numbers under the no-fire policy overstate stacking — nothing dies — so compare them against a known-good level (Helios) rather than reading them as absolutes.

## Visual factories

Pass `VisualFactories` to `createLockOnRunner`:

- `createEnemyMesh(kind, letter?)`: returns a target mesh. The runner also calls this with `kind === 'letter'` for START/REPLAY targets.
- `setEnemyLocked(mesh, locked)`: applies and clears locked visuals.
- `setEnemyDenied(mesh)`: applies level-specific feedback for a rejected release. This is required because START/REPLAY words and level-specific release rules share the same rejection mechanism.
- `createProjectileMesh()`: returns a homing shot mesh.
- `createReticle()`: returns the reticle object.
- `setReticleActive(reticle, active, lockCount)`: updates reticle state each frame.

Levels that opt into right-click undo-lock should advertise it only in their own start tip.

Every level must render legible procedural glyphs for at least the characters in its start/replay words. The defaults require S, T, A, R, E, P, L, and Y. A reader must be able to tell the letters apart at gameplay distance. `src/levels/crystal/visuals/letters.ts` shows the reference approach: 5×7 pixel-grid glyphs. Levels may use `src/engine/glyphs.ts` for neutral grid data, but rendering and style stay with the level. Avoid 7-segment-style approximations; they cannot render R, T, and Y distinctly enough.

Every level must also express rejected releases in its own visual and audio language. The runner emits `reject` when a release fails, including incomplete START/REPLAY words and any level-specific `validateRelease` rule. Visuals receive `setEnemyDenied` for released targets and any required targets that were missing. Levels that need additional context, such as a boss shield plate blocking a shot, may emit and handle their own richer event as well.

## Post-processing

`LevelDefinition.post` is optional. Most levels only tune the shared bloom and vignette:

```ts
post?: {
  clearColor?: number;
  bloom?: { strength?: number; threshold?: number; radius?: number };
  vignette?: { inner?: number; outer?: number; strength?: number } | false;
  composeOutput?: (input: LevelPostComposeInput) => LevelPostColorNode;
};
```

Omitting it preserves the shared default frame. The engine always multiplies the level bloom strength by the player's bloom slider, so levels cannot bypass the pause-menu bloom setting.

The pause menu also exposes a player motion-blur slider. Motion blur is engine-owned in `src/engine/post.ts`: the shared pass uses depth reprojection against the previous camera matrix, applies the same shutter model to every level, and scales it by the player's setting. Levels should create speed through rail motion, nearby geometry, moving objects, FOV, shake, and authored set pieces; do not add level-specific motion blur or speed-blur strength knobs.

A level can use `composeOutput` to add a small TSL screen-space effect while leaving the shared pipeline in `src/engine/post.ts`. Keep effect uniforms at module scope and write them from the level runtime. The hook receives `base`, which is already global motion blur plus bloom, and the engine applies the shared vignette after the hook returns. Prefer adding flashes, tints, heat shimmer, or glitch over `base`; if an effect samples `scenePass.getTextureNode('output')` directly, it is bypassing the engine-composited frame for that part of the image and should be deliberate.

```ts
import { uniform, vec4 } from 'three/tsl';
import type { LevelPostConfig } from '../../engine/types';

const flash = uniform(0);

export const post: LevelPostConfig = {
  composeOutput({ base }) {
    return base.add(vec4(1, 0.7, 0.35, 0).mul(flash));
  },
};
```

The bloom slider goes to 0. A level must stay playable and legible with bloom fully off. Do not rely on bloom alone to make targets, letters, or the reticle visible; HDR colors control how hard things glow when bloom is on, but base geometry and color must carry readability when it is off.

## Musical action audio

Crystal (`src/levels/crystal/audio.ts`) is the reference for integrating gameplay sounds into the level's music, Rez-style: player actions are notes in the score, not sound effects layered over it. New beat-driven levels should build their audio spine from the shared path: `createBeatLevelAudio` for mix-bus/transport/beat/trace-run wiring, `createScore` for transport-anchored musical position, `defineInstruments` for traced voices, and `createArrangement` for sections/patterns/one-shots. Use the `audio-voices.ts` spec layer as the default way to author player-instrument timbres, with raw `audio-kit` primitives as the escape hatch when a level needs custom synthesis or routing.

These lessons came out of A/B playtesting and apply to any level with a beat-driven soundtrack:

- **Quantize to the transport's actual grid, not the audio clock.** Use `createScore().setEpoch()` when the step transport starts, then schedule lock and fire through `score.quantizePlayerAction()`. This keeps the timing panel's action-SFX snap on the real transport grid instead of clock zero.
- **Pitch player sounds from the live harmony.** Ask the score for `chordAt()` / `leadSetAt()` at the scheduled position, so an action at any moment is consonant and the player's instrument retunes as the progression moves.
- **Make kills melodic, not just consonant.** Author per-section kill lanes in the score; each kill should play the written lane note for its grid step, so a chained volley performs a real melodic run. Leave register space for this: during runs the backing arrangement stays out of the register the player's melody owns.
- **Change player timbres only with cover.** Use score sections and blend helpers to crossfade over a couple of bars when the arrangement does not change. A hard switch is fine only when the music turns over at the same moment (a boss entrance, a drop).
- **Tune gains by perceived loudness, not by matching numbers.** At equal gain a square or sawtooth sounds far louder than a sine or triangle. Crossfading between waveforms with equal gain values lets the brighter voice take over halfway through the blend; each voice needs its own gain tuned by ear.
- **Give a boss its own escalating voice.** Repeated hits on a boss should audibly grow with damage dealt — gain, brightness, a climbing pitch element — and the killing blow deserves a scheduled finale: duck the music for a breath and land a conclusive figure on the grid.

## Headless gameplay checks

Use the run simulator while building levels to catch mechanical issues before asking for a human playtest:

```sh
npm run simulate -- --level <level-id>
```

The default simulation runs no-fire, perfect, and seeded imperfect player policies. It summarizes outcome, spawned enemy kinds, pressure, dead-air gaps, player hull events, and unexercised gameplay events. Pass `--heatmap` to print an ASCII screen heatmap of enemy destructions relative to the player camera, along with destruction distance statistics and distribution histograms. Broad screen-space sweeping makes for a significantly better player experience, so the floor check requires enemies to be distributed throughout the viewport rather than clustering in the center or being destroyed too far away.

The output opens with an "Engine defaults" section (also printed by `check:floor`) listing which engine-default timing fields, lock radius, and optional runner hooks the level inherits versus declares. It is informational, never a gate: inheriting a default is a valid choice, but it should be a considered one — the section exists so the author sees the inherited list instead of never knowing it was there.

## Audio and visual inspection tools

Use the audio trace tool while building levels, the same way you use snapshots for visuals. It inspects procedural music structure without relying on human listening for every iteration:

```sh
npm run trace:audio -- --level crystal
npm run trace:audio -- --level prism
npm run trace:audio -- --level rezdle
npm run trace:audio -- --level helios
npm run trace:audio -- --level helios --verbose
npm run trace:audio -- --level helios --graph
```

The default output is a compact semantic summary for level authoring. Use `--verbose` or `--compare` when characterizing a refactor. The semantic trace is not waveform-based: it captures scheduled musical events, beat events, sections, and important voice calls, not browser compressor output or final mix quality. It currently covers `crystal`, `prism`, `rezdle`, and `helios`.

Use `--graph` to inspect the actual Web Audio graph that a level creates in Chrome via the DevTools Protocol. Graph capture can run for level modules that export `createAudio` from `src/levels/<module-folder>/audio.ts`; use the module folder name when it differs from the picker id. It captures node topology and node/parameter defaults; it does not capture every later parameter assignment in a stable authoring-friendly form.

Use the visual tools while building levels to inspect models and gameplay composition:

```sh
npm run snapshot -- --module src/levels/crystal/visuals/crystal.ts --export createCrystalNode
npm run snapshot:gameplay -- --level helios --time 12
npm run snapshot:gameplay -- --level helios --thumbnails 8
npm run snapshot:gameplay -- --level helios --sheet --times 4,12,24,48
```

Gameplay snapshots are immortal by default and hide projectiles by default. For options and details, see `docs/visual-tools.md`.

For performance investigations, use `npm run check:perf -- --level <level-id>` for headless growth and budget gates, and add `?perf=1` in a real browser to record a hardware playtest report. See `docs/perf-tools.md`.
