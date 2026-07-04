# Level authoring

`raild` now treats a level as an independent module under `src/levels/<level-id>/`.

A level owns:

- its rail and spawn plan;
- enemy kinds and enemy motion;
- all meshes, environment, hit/lock/fire effects, and visual event handling;
- its procedural WebAudio arrangement and sound effects.

Shared code lives in `src/engine/`:

- `lock-on-runner.ts` contains the reusable START/RUN/REPLAY flow, pointer input, lock-on targeting, homing shots, scoring hooks, and HUD updates;
- `rail.ts` contains rail sampling helpers, not a level rail;
- `music.ts` contains small timing helpers for beat emission, MIDI conversion, and grid quantization;
- `post.ts` contains the shared bloom/vignette renderer and the player-facing bloom setting.

## Adding a level

1. Create `src/levels/<id>/index.ts` that exports a `LevelDefinition`.
2. Implement `createAudio(bus)` in that level. The pause menu calls the returned volume, start, suspend, and dispose methods.
3. Implement `createRuntime(context)` in that level. This should create the level environment and visual event handlers, then either use `createLockOnRunner` or provide its own runtime.
4. Add the level to `src/levels/index.ts`.

`createLockOnRunner` is a shared mechanic, not a creative template. If a level uses it, the level still defines its own target data, rail, spawn entries, enemy update function, visual factories, and audio. A level that needs a different play style can skip the runner and implement the `LevelRuntime` interface directly.

The current `/dev` enemy gallery is still specifically for `crystal-corridor`; it reads and writes `src/levels/crystal/visuals/crystal-template.json`.
