# Level authoring

`raild` treats each level as an independent module under `src/levels/<level-id>/`. For comparison tasks, a level uses the shared `createLockOnRunner` flow while owning its rail, spawns, enemy motion, visuals, environment, effects, and procedural audio.

Shared code lives in `src/engine/`:

- `lock-on-runner.ts` contains the START/RUN/REPLAY flow, pointer input, lock-on targeting, homing shots, scoring hooks, and HUD updates;
- `rail.ts` contains rail sampling helpers, not a level rail;
- `music.ts` contains small timing helpers for beat emission, MIDI conversion, and grid quantization;
- `hostile-shot.ts` contains shared approach/impact timing for lockable enemy shots and hazards;
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
- `updateEnemy(context)`: owns all enemy motion every frame. Position, rotation, and any per-frame mesh state are the level's responsibility. Return `true` to despawn that enemy as a miss; return `false` or nothing to keep it alive. The context also provides `spawnEnemy(entry)` to spawn enemies at runtime (returns the new enemy id; running state only), `damagePlayer(amount?)`, and the current `playerHealth`.

Optional overrides are `updateAttractCamera`, `easeRunProgress`, `playerHealth`, `scoreForKill`, `scoreForHit`, `scoreForVolley`, `validateRelease`, `rankForRun`, `detailsForRun`, `lockRadiusNdc`, `startWord`, and `replayWord`. `scoreForVolley` scores a released group after all members resolve, `scoreForHit` scores non-lethal hits on multi-hit enemies, `validateRelease` can reject a running-state release before shots are created, `detailsForRun` adds compact end-screen lines, and `lockRadiusNdc` changes the screen-space lock threshold from the default. See `src/engine/lock-on-runner.ts` for exact types.

Setting `playerHealth` enables the hull system: `damagePlayer` calls take a point off (with a short invulnerability window between hits), the HUD shows hull pips and a red damage flash, and reaching zero ends the run with `died: true` in the summary and a forced `—` rank. Related events: `playerhit` fires on accepted damage, `hit` carries `lethal`, total `hitPointsRemaining`, and current-stage fields, `stage` fires when a non-lethal stage is completed, and `runend` carries `died`.

For lockable enemy shots and hazards, prefer `updateHostileShotImpact` from `src/engine/hostile-shot.ts` once a projectile is close enough to threaten the player. It gives levels common defaults for hit distance, impact brake, damage distance, and intercept grace, while allowing per-level overrides for feel. Levels still own launch motion, visuals, audio, and when to call `damagePlayer`.

## Visual factories

Pass `VisualFactories` to `createLockOnRunner`:

- `createEnemyMesh(kind, letter?)`: returns a target mesh. The runner also calls this with `kind === 'letter'` for START/REPLAY targets.
- `setEnemyLocked(mesh, locked)`: applies and clears locked visuals.
- `setEnemyDenied(mesh)`: applies level-specific feedback for a rejected release. This is required because START/REPLAY words and level-specific release rules share the same rejection mechanism.
- `createProjectileMesh()`: returns a homing shot mesh.
- `createReticle()`: returns the reticle object.
- `setReticleActive(reticle, active, lockCount)`: updates reticle state each frame.

The runner includes right-click undo-lock on fine-pointer devices; it removes the most recent lock and emits normal unlock feedback.

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

## Visual inspection tools

These tools exist to help level authors inspect procedural visuals when a full WebGPU playtest is not available. They use headless Chrome with SwiftShader/WebGL fallbacks where possible. Do not constrain level design around these fallbacks: the game remains WebGPU-only, and the tools own any reduced-fidelity rendering.

### Procedural model snapshots

Use the model snapshot tool for isolated enemy, prop, glyph, or environment pieces that can be returned from a factory as a Three `Object3D`:

```sh
npm run snapshot -- --module src/levels/crystal/visuals/crystal.ts --export createCrystalNode
```

Useful options:

```sh
--args '["drifter"]'   # JSON array passed to the exported factory
--angles 8             # number of orbit views
--size 1024            # square PNG size
--bloom 0              # disable shared bloom for inspection
--out snapshots/foo
```

Outputs are written under `snapshots/` by default. The tool normalizes and frames the returned object, captures orbit angles, and reports average luminance to catch black frames.

### Gameplay snapshots

Use the gameplay snapshot tool to inspect the actual level runtime from the rail camera:

```sh
npm run snapshot:gameplay -- --level helios --time 12
```

Defaults are chosen for visual review:

- immortal player mode is enabled;
- projectiles are hidden, because volleys can cover the composition;
- fidelity is `auto`, which tries `full`, then `postless`, then `flat`;
- render size is `1280x720`.

Useful options:

```sh
--width 1920 --height 1080  # raw gameplay render size for still captures
--fidelity full             # or postless, flat, auto
--mortal                    # allow the player to die normally
--projectiles               # include homing shot meshes
--debug-value <value>        # pass a level debug selector value
--out snapshots/gameplay
```

Single-frame outputs are named with the level, timestamp, fidelity, and any non-default modes such as `-projectiles` or `-mortal`.

### Gameplay thumbnail sheets

Use thumbnail sheets to scan an entire run quickly:

```sh
npm run snapshot:gameplay -- --level helios --thumbnails 8
```

When no times are specified, `--thumbnails <count>` reads the level run duration and samples evenly through the playthrough. The sample points are centered in each interval, so 8 thumbnails on a 120-second level capture 7.5s, 22.5s, 37.5s, and so on.

Use exact timings when you want to inspect known beats or boss moments:

```sh
npm run snapshot:gameplay -- --level helios --sheet --times 4,12,24,48
```

Sheet resolution is controlled by the thumbnail layout, not by the raw render size alone:

```sh
--thumb-width 480  # width of each thumbnail in the contact sheet
--columns 4        # fixed column count; default is roughly square
--width 1920 --height 1080  # aspect ratio and source render size
```

For example, the default 4-thumbnail sheet is `664x432`: two 320-pixel-wide thumbnails per row, 180-pixel thumbnail height from the 16:9 render aspect, a 24-pixel label strip, and 8-pixel gutters.

### Crystal enemy tuning gallery

The current `/dev` enemy gallery is specifically for `crystal-corridor`; it reads and writes `src/levels/crystal/visuals/crystal-template.json`.
