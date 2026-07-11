# Developer Debug Panel

In dev builds, a collapsed Debug panel is available on every level.

## Target-Specific Debug Modes
Levels opt in to target-specific debug modes by declaring `debugSelector`; Crystal's debug mode holds the chosen enemy or the full Warden group in front of the camera with inflated health through `?debugEnemy=<target>`.

## Timing Controls
The panel also includes timing controls. It reads the selected level's BPM and effective runner timing baseline, including inherited defaults or level overrides. To make its action SFX snap control affect a level, honor `getActionSfxQuantization()` when scheduling `lock` and `fire` one-shots — preferably on the level transport's epoch-anchored grid as in crystal's `quantizePlayerAction`, or through `quantizeActionSfxTime(time, thirtysecondSeconds)` if the level has no step transport. Do not route music, ambient, hit, or kill sounds through that control.
