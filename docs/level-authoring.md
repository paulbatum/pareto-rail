# Level authoring

`raild` treats each level as an independent module under `src/levels/<level-id>/`. For comparison tasks, a level uses the shared `createLockOnRunner` flow while owning its rail, spawns, enemy motion, visuals, environment, effects, and procedural audio.

Shared code lives in `src/engine/`:

- `lock-on-runner.ts` contains the START/RUN/REPLAY flow, pointer input, lock-on targeting, homing shots, scoring hooks, and HUD updates;
- `rail.ts` contains rail sampling helpers, not a level rail;
- `music.ts` contains small timing helpers for beat emission, MIDI conversion, and grid quantization;
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
- `spawnTimeline`: ordered enemy entries. Its length is the run's `totalEnemies`. Entries may include `letter?: string`; the runner passes it to `createEnemyMesh`, exposes it on public enemies, and includes it in target events.
- `updateEnemy(context)`: owns all enemy motion every frame. Position, rotation, and any per-frame mesh state are the level's responsibility. Return `true` to despawn that enemy as a miss; return `false` or nothing to keep it alive.

Optional overrides are `updateAttractCamera`, `easeRunProgress`, `scoreForKill`, `scoreForVolley`, `validateRelease`, `rankForRun`, `detailsForRun`, `lockRadiusNdc`, `startWord`, and `replayWord`. `scoreForVolley` scores a released group after all members resolve, `validateRelease` can reject a running-state release before shots are created, `detailsForRun` adds compact end-screen lines, and `lockRadiusNdc` changes the screen-space lock threshold from the default. See `src/engine/lock-on-runner.ts` for exact types.

## Visual factories

Pass `VisualFactories` to `createLockOnRunner`:

- `createEnemyMesh(kind, letter?)`: returns a target mesh. The runner also calls this with `kind === 'letter'` for START/REPLAY targets.
- `setEnemyLocked(mesh, locked)`: applies and clears locked visuals.
- `setEnemyDenied(mesh)`: optional feedback for a rejected release.
- `createProjectileMesh()`: returns a homing shot mesh.
- `createReticle()`: returns the reticle object.
- `setReticleActive(reticle, active, lockCount)`: updates reticle state each frame.

The runner includes right-click undo-lock on fine-pointer devices; it removes the most recent lock and emits normal unlock feedback.

Every level must render legible procedural glyphs for at least the characters in its start/replay words. The defaults require S, T, A, R, E, P, L, and Y. A reader must be able to tell the letters apart at gameplay distance. `src/levels/crystal/visuals/letters.ts` shows the reference approach: 5×7 pixel-grid glyphs. Avoid 7-segment-style approximations; they cannot render R, T, and Y distinctly enough.

## Post-processing

`LevelDefinition.post` is optional and declarative:

```ts
post?: {
  clearColor?: number;
  bloom?: { strength?: number; threshold?: number; radius?: number };
  vignette?: { inner?: number; outer?: number; strength?: number } | false;
};
```

Omitting it preserves the shared default frame. The engine always multiplies the level bloom strength by the player's bloom slider, so levels cannot bypass the pause-menu bloom setting.

The bloom slider goes to 0. A level must stay playable and legible with bloom fully off. Do not rely on bloom alone to make targets, letters, or the reticle visible; HDR colors control how hard things glow when bloom is on, but base geometry and color must carry readability when it is off.

The current `/dev` enemy gallery is specifically for `crystal-corridor`; it reads and writes `src/levels/crystal/visuals/crystal-template.json`.
