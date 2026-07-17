# Rush

Rush is a night flight down a city street canyon built to test how fast this engine can feel. The speed rig is still the point, but the velocity now reads through asphalt lane dashes, tower faces, streetlights, gantries, traffic, FOV pulls, and the shared depth-reprojection blur.

## Visual language
Near-black low-poly city geometry with flat-shaded road, curbs, sidewalks, and skyscraper walls. Small cyan windows, cyan-white headlights, amber streetlights, taillights, and beat-strobing gantries provide the hot accents without turning bloom into a whiteout.

## Musical language
170 BPM and deliberately blunt: a relentless kick, closed hat, and one distorted bass figure. Player actions answer with terse zaps, ticks, and rejects inside the same harsh electronic palette.

## Mechanical signature
A 30-second speed-feel testbed with a long rail, authored speed surges, simple pods, strafing darts, and heavier armored targets. Scenery cars are non-interactive speed cues: same-direction traffic gets overtaken fast, while oncoming headlights close at absurd speed.

## What to read
- `src/levels/rush/tuning.ts`
- `src/levels/rush/gameplay.ts`
- `src/levels/rush/visuals/index.ts`
- `src/levels/rush/post-fx.ts`
- `src/levels/rush/audio.ts`

## What to study here
Rush is a technical showcase of the engine tools that keep enemies readable when player speed is high — `createRailPacer` (`src/engine/rail-pacer.ts`) and `createSpeedProfile` (`src/engine/speed-profile.ts`), exercised in `gameplay.ts`. Read it only if your level runs fast enough that fixed rail anchors fall outside the fog at spawn. It is not a reference for visuals, music, or overall level design.

## Status & notes
Technical test fixture; excluded from the level picker.
