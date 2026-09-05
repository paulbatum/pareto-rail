# Speedsolve

A sixty-second, continuous boss fight against a colossal puzzle cube in a pale arena. The camera orbits its six faces, then swings over and beneath it as the player shoots the colored skin away. Every destroyed target queues a quarter-turn; the layer snaps into place on the beat. Six bare faces reveal a spinning mechanical core for the last barrage and a storm of tiny colored cubes.

## Visual language
Six candy colors on rounded puzzle tiles, tetrahedra, octahedra, prisms, and hostile shots. Porcelain and grey machinery sit inside a dark-edged cube, suspended above a softly shaded dial in a pale void. Glowing squares carry solid white and graphite brackets so targeting remains readable with bloom disabled. START and REPLAY are pixel-cut porcelain keycaps. A six-color face counter and solve timer frame the arena.

## Musical language
128 BPM, exactly 32 bars. A dry mechanical score starts with detent knocks and a clock resonator. Each conquered face adds a part: offbeat clicks, tight hats, a syncopated bass, wooden counterpoint, snare snaps, and final-core accents. Player locks and volleys follow the transport and live harmony; chained kills perform written melodic lanes. The physical turns use the same resonator as the clock. Face completions answer with a short ascending figure, and the core resolves into a clean D-major cadence.

## Mechanical signature
A five-point hull and six sequential face fights. Each face presents two banks of three squares; all six targets advance the solve in any order. Six beat-timed turns unify its nine tiles, then the entire face falls away and exposes a two-hit spindle. Breaking it swings the rail to the next face. Tumbling tetrahedra, looping octahedra, and strafing triangular prisms spread around the puzzle and launch interceptable shots. The exposed core takes three escalating barrages. Full six-target clears earn a formation bonus; right-click undoes a lock.

## What to read
- `src/benchmark-levels/speedsolve-kv7m/index.ts`
- `src/benchmark-levels/speedsolve-kv7m/gameplay.ts`
- `src/benchmark-levels/speedsolve-kv7m/timing.ts`
- `src/benchmark-levels/speedsolve-kv7m/audio.ts`
- `src/benchmark-levels/speedsolve-kv7m/audio-voices.ts`
- `src/benchmark-levels/speedsolve-kv7m/visuals/index.ts`
- `src/benchmark-levels/speedsolve-kv7m/visuals/models.ts`

## Status & notes
Inspection markers: `firstTurn`, `orange`, `yellow`, `green`, `blue`, `violet`, `nakedCore`, and `lastBarrage`. The solve is an action-driven progression, not a Rubik's Cube algorithm: every target advances it. A human WebGPU run should check the audible detent against the visible quarter-turn, the view changes onto the upper and lower faces, incoming-shot contrast, and the balance between the dry backing and player melody.

For reproducible captures of the full fight, pass `--debug-value showcase` to `snapshot:gameplay`. This level-local inspection driver uses normal pointer input and the normal fight rules; ordinary play stays manual. Public images use seed `424242` and the snapshot tool's full postprocessing over its inspection renderer.
