# Level authoring

`raild` treats each level as an independent module under `src/levels/<level-id>/`. For comparison tasks, a level uses the shared `createLockOnRunner` flow while owning its rail, spawns, enemy motion, visuals, environment, effects, and procedural audio.

Shared code lives in `src/engine/`:

- `lock-on-runner.ts` contains the START/RUN/REPLAY flow, pointer input, lock-on targeting, homing shots, scoring hooks, and HUD updates;
- `rail.ts` contains rail sampling helpers, not a level rail;
- `music.ts` contains small timing helpers for beat emission, tempo, MIDI conversion, and grid quantization;
- `spawn-patterns.ts` contains small helpers for eager spawn timeline construction;
- `hostile-shot.ts` contains shared homing steer, behind-camera despawn cull, and approach/impact timing for lockable enemy shots and hazards;
- `post.ts` contains the shared bloom/vignette renderer and the player-facing bloom setting.

## Adding a level

1. Create `src/levels/<id>/index.ts` that exports a `LevelDefinition`.
2. Implement `createAudio(bus)` in that level. The pause menu calls the returned volume, start, suspend, and dispose methods.
3. Implement `createRuntime(context)` in that level. It should create the level environment and visual event handlers, then call `createLockOnRunner`.
4. Add the level to `src/levels/index.ts`.

A level task should only touch `src/levels/<id>/` plus one registry line in `src/levels/index.ts`. Use `npm run check:scope -- <level-id>` to verify that boundary.

## Runner contract

Pass a `LockOnRunnerLevel` to `createLockOnRunner`:

- `duration`: run length in seconds.
- `createRail()`: returns the level's `CatmullRomCurve3`.
- `spawnTimeline`: ordered enemy entries. Entries may include `letter?: string`; the runner passes it to `createEnemyMesh`, exposes it on public enemies, and includes it in target events. Entries may also set `hitPoints` (default 1), `hitStages` (ordered HP stages; each stage must be between 1 and `MAX_LOCKS`), `lockable: false` (read live each frame, so a level may mutate it mid-run to gate a boss phase), and `countsTowardTotal: false` (excluded from the kills/missed/total stats while still scoring and emitting events — use for hazards like enemy projectiles). The current stage's remaining HP determines how many repeat locks the target can accept, capped by the global lock maximum and spaced by the game-wide repeat-lock delay.
- `updateEnemy(context)`: owns all enemy motion every frame. Position, rotation, and any per-frame mesh state are the level's responsibility. Return `true` to despawn that enemy as a miss; return `false` or nothing to keep it alive. The context also provides `railAnchor(lead)` for eased rail seating, `enemyState(init)` for lazily initialized mutable state scoped to that enemy instance, `spawnEnemy(entry)` to spawn enemies at runtime (returns the new enemy id; running state only), `damagePlayer(amount?)`, and the current `playerHealth`.

Optional overrides are `updateAttractCamera`, `easeRunProgress`, `playerHealth`, `scoreForKill`, `scoreForHit`, `scoreForVolley`, `validateRelease`, `rankForRun`, `detailsForRun`, `lockRadiusNdc`, `startWord`, `replayWord`, and `allowLockUndo`. `scoreForVolley` scores a released group after all members resolve, `scoreForHit` scores non-lethal hits on multi-hit enemies, `validateRelease` can reject a running-state release before shots are created or return the subset of released enemies allowed to fire, `detailsForRun` adds compact end-screen lines, `lockRadiusNdc` changes the screen-space lock threshold from the default, and `allowLockUndo` lets right-click remove the last lock; it is off by default. See `src/engine/lock-on-runner.ts` for exact types.

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

Every level must render legible procedural glyphs for at least the characters in its start/replay words. The defaults require S, T, A, R, E, P, L, and Y. A reader must be able to tell the letters apart at gameplay distance. `src/levels/crystal/visuals/letters.ts` shows the reference approach: 5×7 pixel-grid glyphs. Avoid 7-segment-style approximations; they cannot render R, T, and Y distinctly enough.

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

## Audio and visual inspection tools

Use the audio trace tool while building levels, the same way you use snapshots for visuals. It inspects procedural music structure without relying on human listening for every iteration:

```sh
npm run trace:audio -- --level crystal
npm run trace:audio -- --level prism
npm run trace:audio -- --level rezdle
npm run trace:audio -- --level helios
npm run trace:audio -- --level helios --verbose
npm run trace:audio -- --level crystal-debug --write test-fixtures/audio/crystal-debug.json
npm run trace:audio -- --level crystal-debug --compare test-fixtures/audio/crystal-debug.json
npm run trace:audio -- --level helios --graph
```

The default output is a compact semantic summary for level authoring. Use `--verbose` or `--compare` when characterizing a refactor. The semantic trace is not waveform-based: it captures scheduled musical events, beat events, sections, and important voice calls, not browser compressor output or final mix quality. It currently covers `crystal`, `crystal-debug`, `prism`, `rezdle`, and `helios`.

Use `--graph` to inspect the actual Web Audio graph that a level creates in Chrome via the DevTools Protocol. Graph capture can run for level modules that export `createAudio` from `src/levels/<module-folder>/audio.ts`; use the module folder name when it differs from the picker id. It captures node topology and node/parameter defaults; it does not capture every later parameter assignment in a stable authoring-friendly form.

Use the visual tools while building levels to inspect models and gameplay composition:

```sh
npm run snapshot -- --module src/levels/crystal/visuals/crystal.ts --export createCrystalNode
npm run snapshot:gameplay -- --level helios --time 12
npm run snapshot:gameplay -- --level helios --thumbnails 8
npm run snapshot:gameplay -- --level helios --sheet --times 4,12,24,48
```

Gameplay snapshots are immortal by default and hide projectiles by default. For options and details, see `docs/visual-tools.md`.
