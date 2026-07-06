# Level authoring

`raild` treats each level as an independent module under `src/levels/<level-id>/`. For comparison tasks, a level uses the shared `createLockOnRunner` flow while owning its rail, spawns, enemy motion, visuals, environment, effects, and procedural audio.

Shared code lives in `src/engine/`:

- `lock-on-runner.ts` contains the START/RUN/REPLAY flow, pointer input, lock-on targeting, homing shots, scoring hooks, and HUD updates;
- `rail.ts` contains rail sampling helpers, not a level rail;
- `music.ts` contains small timing helpers for beat emission, tempo, MIDI conversion, and grid quantization;
- `audio-kit.ts` contains Web Audio primitives plus the shared mix bus and instrument registry;
- `audio-trace.ts` contains semantic audio trace sinks and the reusable trace harness;
- `score.ts` contains the shared musical-position helper for epoch anchoring, harmony, sections, action quantization, and kill lanes;
- `arrangement.ts` contains the thin section/pattern/function/one-shot DSL for musical scheduling;
- `spawn-patterns.ts` contains small helpers for eager spawn timeline construction;
- `glyphs.ts` contains neutral 5×7 glyph grid data and accessors, not rendering;
- `hostile-shot.ts` contains shared homing steer, behind-camera despawn cull, and approach/impact timing for lockable enemy shots and hazards;
- `visual-kit.ts` contains lifecycle helpers for visual bookkeeping: pending mesh-to-event records, transient effect pools, additive material setup, and attached adornment slots. It owns no look or timing decisions; levels still supply every mesh, color, number, and update rule;
- `post.ts` contains the shared bloom/vignette renderer and the player-facing bloom setting.

## Module layout: spine and leaves

Default to a spine/leaf split. The **spine** holds decisions: `index.ts` for wiring, `gameplay.ts` for the spawn timeline, enemy motion, and tuning constants, the audio score for arrangement, harmony, and section structure, and `visuals/index.ts` for palette and event choreography. **Leaves** hold construction: mesh factories, environment geometry, and synth voice construction. Leaves take parameters; they decide nothing.

The hard rule is that timelines, tuning constants, and palettes never live in leaf files. The payoff is lower reading cost: a reader calibrating against a level reads its spine only.

This is a default, not a law. Rezdle legitimately decomposes differently, and `check:scope` does not police this convention.

## Adding a level

1. Create `src/levels/<id>/index.ts` that exports a `LevelDefinition`.
2. Declare one authoritative BPM constant for the level. Reference it from both the `LevelDefinition` and the runner config; audio should import the same constant instead of repeating the number.
3. Implement `createAudio(bus)` in that level. The pause menu calls the returned volume, start, suspend, and dispose methods. For beat-driven levels, the expected audio spine uses `createMixBus`, `createScore`, `defineInstruments`, `createArrangement`, and `createAudioTraceHarness`; raw `audio-kit` primitives remain available when a level needs custom synthesis or routing.
4. Implement `createRuntime(context)` in that level. It should create the level environment and visual event handlers, then call `createLockOnRunner`.
5. Add the level to `src/levels/index.ts`.

A level task should only touch `src/levels/<id>/` plus one registry line in `src/levels/index.ts`. Use `npm run check:scope -- <level-id>` to verify that boundary.

## Runner contract

Pass a `LockOnRunnerLevel` to `createLockOnRunner`:

- `duration`: run length in seconds.
- `bpm`: the level tempo. The runner uses it for beat reconstruction and musical shot timing.
- `createRail()`: returns the level's `CatmullRomCurve3`.
- `spawnTimeline`: ordered enemy entries. Entries may include `letter?: string`; the runner passes it to `createEnemyMesh`, exposes it on public enemies, and includes it in target events. Entries may also set `hitPoints` (default 1), `hitStages` (ordered HP stages; each stage must be between 1 and `MAX_LOCKS`), `lockable: false` (read live each frame, so a level may mutate it mid-run to gate a boss phase), and `countsTowardTotal: false` (excluded from the kills/missed/total stats while still scoring and emitting events — use for hazards like enemy projectiles). The current stage's remaining HP determines how many repeat locks the target can accept, capped by the global lock maximum and spaced by the game-wide repeat-lock delay.
- `updateEnemy(context)`: owns all enemy motion every frame. Position, rotation, and any per-frame mesh state are the level's responsibility. Return `true` to despawn that enemy as a miss; return `false` or nothing to keep it alive. The context also provides `railAnchor(lead)` for eased rail seating, `enemyState(init)` for lazily initialized mutable state scoped to that enemy instance, `spawnEnemy(entry)` to spawn enemies at runtime (returns the new enemy id; running state only), `damagePlayer(amount?)`, and the current `playerHealth`.

Optional overrides are `updateAttractCamera`, `easeRunProgress`, `playerHealth`, `scoreForKill`, `scoreForHit`, `scoreForVolley`, `validateRelease`, `rankForRun`, `detailsForRun`, `lockRadiusNdc`, `startWord`, `replayWord`, `allowLockUndo`, and `timing`. `scoreForVolley` scores a released group after all members resolve, `scoreForHit` scores non-lethal hits on multi-hit enemies, `validateRelease` can reject a running-state release before shots are created or return the subset of released enemies allowed to fire, `detailsForRun` adds compact end-screen lines, `lockRadiusNdc` changes the screen-space lock threshold from the default, and `allowLockUndo` lets right-click remove the last lock; it is off by default. Levels inherit the default quantization profile: tempo-adaptive grid-ramp shot timing, with the coarsest grid capped in absolute time, plus 32nd-note action-SFX snap at the level tempo. Declare `timing` only to override or opt out; Rezdle only opts out of SFX snapping. Shot gap values are counts of 32nd notes, not seconds. See `src/engine/lock-on-runner-types.ts` for exact types.

Setting `playerHealth` enables the hull system: `damagePlayer` calls take a point off (with a short invulnerability window between hits), the HUD shows hull pips and a red damage flash, and reaching zero ends the run with `died: true` in the summary and a forced `—` rank. Related events: `playerhit` fires on accepted damage, `hit` carries `lethal`, total `hitPointsRemaining`, and current-stage fields, `stage` fires when a non-lethal stage is completed, and `runend` carries `died`.

For lockable enemy shots and hazards, prefer `steerHomingShot`, `shotBehindCamera`, and `updateHostileShotImpact` from `src/engine/hostile-shot.ts` for shared flight bookkeeping, despawn culling, and close-range impact timing. Impact timing gives levels common defaults for hit distance, impact brake, damage distance, and intercept grace, while allowing per-level overrides for feel. Levels still own tuning, launch motion, visuals, audio, and when to call `damagePlayer`.

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

A level can use `composeOutput` to add a small TSL screen-space effect while leaving the shared pipeline in `src/engine/post.ts`. Keep effect uniforms at module scope, write them from the level runtime, and sample the raw scene with `scenePass.getTextureNode().sample(customUv)`. The hook receives `base`, which is already `scenePass.add(bloomPass)`, and the engine applies the shared vignette after the hook returns.

```ts
import { mix, uniform, vec2, vec4 } from 'three/tsl';
import type { LevelPostConfig } from '../../engine/types';

const speedBlur = uniform(0);
const flash = uniform(0);

export const post: LevelPostConfig = {
  composeOutput({ base, scenePass, screenUV }) {
    const sceneTexture = scenePass.getTextureNode();
    const centerPull = vec2(0.5).sub(screenUV).mul(speedBlur);
    const tap1 = sceneTexture.sample(screenUV.add(centerPull.mul(0.20)));
    const tap2 = sceneTexture.sample(screenUV.add(centerPull.mul(0.45)));
    const tap3 = sceneTexture.sample(screenUV.add(centerPull.mul(0.70)));
    const blurred = base.add(tap1).add(tap2).add(tap3).mul(0.25);

    return mix(base, blurred, speedBlur).add(vec4(1, 0.7, 0.35, 0).mul(flash));
  },
};
```

The bloom slider goes to 0. A level must stay playable and legible with bloom fully off. Do not rely on bloom alone to make targets, letters, or the reticle visible; HDR colors control how hard things glow when bloom is on, but base geometry and color must carry readability when it is off.

## Musical action audio

Crystal (`src/levels/crystal/audio.ts`) is the reference for integrating gameplay sounds into the level's music, Rez-style: player actions are notes in the score, not sound effects layered over it. New beat-driven levels should build their audio spine from the shared path: `createMixBus` for routing, `createScore` for transport-anchored musical position, `defineInstruments` for traced voices, `createArrangement` for sections/patterns/one-shots, and `createAudioTraceHarness` for `trace:audio` coverage. Raw `audio-kit` primitives remain the escape hatch when a level needs custom synthesis or routing.

These lessons came out of A/B playtesting and apply to any level with a beat-driven soundtrack:

- **Quantize to the transport's actual grid, not the audio clock.** Use `createScore().setEpoch()` when the step transport starts, then schedule lock and fire through `score.quantizePlayerAction()`. This keeps the timing panel's action-SFX snap on the real transport grid instead of clock zero.
- **Pitch player sounds from the live harmony.** Ask the score for `chordAt()` / `leadSetAt()` at the scheduled position, so an action at any moment is consonant and the player's instrument retunes as the progression moves.
- **Make kills melodic, not just consonant.** Author per-section kill lanes in the score; each kill should play the written lane note for its grid step, so a chained volley performs a real melodic run. Leave register space for this: during runs the backing arrangement stays out of the register the player's melody owns.
- **Change player timbres only with cover.** Use score sections and blend helpers to crossfade over a couple of bars when the arrangement does not change. A hard switch is fine only when the music turns over at the same moment (a boss entrance, a drop).
- **Tune gains by perceived loudness, not by matching numbers.** At equal gain a square or sawtooth sounds far louder than a sine or triangle. Crossfading between waveforms with equal gain values lets the brighter voice take over halfway through the blend; each voice needs its own gain tuned by ear.
- **Give a boss its own escalating voice.** Repeated hits on a boss should audibly grow with damage dealt — gain, brightness, a climbing pitch element — and the killing blow deserves a scheduled finale: duck the music for a breath and land a conclusive figure on the grid.

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

In dev builds, a collapsed Debug panel is available on every level. Levels opt in to target-specific debug modes by declaring `debugSelector`; Crystal's debug mode holds the chosen enemy or the full Warden group in front of the camera with inflated health through `?debugEnemy=<target>`.

The panel also includes timing controls. It reads the selected level's BPM and effective runner timing baseline, including inherited defaults or level overrides. To make its action SFX snap control affect a level, honor `getActionSfxQuantization()` when scheduling `lock` and `fire` one-shots — preferably on the level transport's epoch-anchored grid as in crystal's `quantizePlayerAction` (see "Musical action audio" above), or through `quantizeActionSfxTime(time, thirtysecondSeconds)` if the level has no step transport. Do not route music, ambient, hit, or kill sounds through that control.

Use `--graph` to inspect the actual Web Audio graph that a level creates in Chrome via the DevTools Protocol. Graph capture can run for level modules that export `createAudio` from `src/levels/<module-folder>/audio.ts`; use the module folder name when it differs from the picker id. It captures node topology and node/parameter defaults; it does not capture every later parameter assignment in a stable authoring-friendly form.

Use the visual tools while building levels to inspect models and gameplay composition:

```sh
npm run snapshot -- --module src/levels/crystal/visuals/crystal.ts --export createCrystalNode
npm run snapshot:gameplay -- --level helios --time 12
npm run snapshot:gameplay -- --level helios --thumbnails 8
npm run snapshot:gameplay -- --level helios --sheet --times 4,12,24,48
```

Gameplay snapshots are immortal by default and hide projectiles by default. For options and details, see `docs/visual-tools.md`.
