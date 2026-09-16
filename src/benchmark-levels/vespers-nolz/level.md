# Vespers

Fly through a midnight cathedral and return its stolen stained-glass light. Black, flat light-thieves detach from windows; each kill sends its colour back to its source. A procedural pipe-organ nocturne builds from a pedal through two contrapuntal manuals, falls silent in the empty nave, and reaches the dead rose window at the west end.

## Visual language
Black stone clustered piers, stacked arcades, clerestory lancets, ribbed vaults, and a candle floor far below the rail. Cobalt, blood red, bottle green, and gold are reserved for glass and stolen light. Restored windows stay lit. The boss is a twelve-petal black silhouette nested in an unlit rose; its death ignites all three concentric glass rings and raises the cathedral illumination.

## Musical language
80 BPM, twenty bars, exactly sixty seconds. D-minor material with a dominant A-major cadence. Additive sine ranks synthesize organ pipes, with a four-bar subject and a slower contrary-motion answer. Choir and bell voices join the swells. Bars twelve and thirteen contain one held pedal. The upper mixture register and D-major resolution are reserved for the boss kill. There are no drums or noise percussion. Locks, shots, hits, and kills use organ ranks quantized to the live transport; kills follow authored harmonic melody lanes.

## Mechanical signature
Moths flap and dart, shrouds drift vertically and laterally, and thuribles swing like suspended censers. Waves answer across both galleries and form six-target fans. The rose boss has three six-hit stages. Full volleys earn a bonus; right-click undoes a lock. The run uses score pressure rather than hull damage, so players can experience the complete musical arc even when they miss targets. Failure to kill the boss leaves the rose dark.

## What to read
- `src/benchmark-levels/vespers-nolz/gameplay.ts`: timing, rail, formations, and enemy motion.
- `src/benchmark-levels/vespers-nolz/audio.ts`: score, counterpoint, and player instruments.
- `src/benchmark-levels/vespers-nolz/organ.ts`: procedural pipe, choir, and bell construction.
- `src/benchmark-levels/vespers-nolz/visuals/index.ts`: window restoration, event responses, and effects.
- `src/benchmark-levels/vespers-nolz/visuals/architecture.ts`: cathedral and rose construction.
- `src/benchmark-levels/vespers-nolz/visuals/models.ts`: silhouettes and stained-glass letters.

## What to study here
Each enemy carries a source-window index. The visual layer dims that window on spawn and restores it on kill, with returning shards that show the connection. The environment retains this state through the run. The score leaves the upper register for the player's kill melody and withholds its highest organ rank until the rose breaks.

## Status & notes
The intentional empty span follows the central swell. The engine's tempo-adaptive volley rhythm and 32nd-note action snap are retained for the slow organ pulse. The reticle uses a wider 0.15 NDC lock radius to accommodate moving silhouettes. Final WebGPU composition, organ balance, and boss pacing need a human playtest; headless checks do not establish audiovisual quality.
