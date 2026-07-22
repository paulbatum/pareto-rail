# Speedsolve

A sixty-second continuous boss fight against a colossal six-sided puzzle machine. The rail dwells on one face at a time while any glowing square advances the solve; each completed pattern turns the cube into its own percussion instrument, ejects a face, and reveals another piece of the white-grey machinery beneath. Six faces leave a naked core and one final barrage.

## Visual language
The puzzle owns all saturated color: white, red, blue, orange, green, and yellow stickers against a pale shadowless void. The cube is built as six independent nine-cubie shells over graphite gimbals and pistons, with quarter-turn layer snaps, face-colored weakpoints, loose-cubie showers, and a final storm of more than two hundred tiny cubes. Tetrahedra, caged octahedra, and long hexagonal prisms carry the same candy palette; everything else stays matte white or machine grey. SOLVE and AGAIN use readable 5×7 cubie plaques.

## Musical language
128 BPM: exactly 32 bars and 60 seconds of dry, quantized mechanical electro. Every quarter carries a precise machine click, every solved square answers with a pitched layer snap, and each conquered face adds another rhythmic layer. Player locks, volleys, hits, and melodic kill lanes read the live harmony. The exposed core accelerates a filtered saw mechanism into a ten-note resolution while face breaks and core stages land as chordal machine impacts.

## Mechanical signature
Six four-bar face phrases, each with four order-independent solve squares and a machinery weakpoint, overlap waves of lateral tetra sweepers, elliptical octa orbiters, and head-on prism divers. All three fire interceptable color bolts at a five-point hull. Clearing the six weakpoints unlocks a nine-hit, three-stage core; full six-target clears earn a 1280-point solve bonus.

## What to read
- `src/benchmark-levels/speedsolve-wvdv/timing.ts`
- `src/benchmark-levels/speedsolve-wvdv/gameplay.ts`
- `src/benchmark-levels/speedsolve-wvdv/audio.ts`
- `src/benchmark-levels/speedsolve-wvdv/visuals/index.ts`
- `src/benchmark-levels/speedsolve-wvdv/visuals/models.ts`

## Status & notes
Built as a showcase benchmark level for the Speedsolve assignment. Inspection markers: `white`, `blue`, `green`, `shellOpen`, `core`, and `resolve`. A human WebGPU playtest should first check target contrast against the pale void with bloom disabled, the audible lock between layer snaps and the beat, and whether the final shell-to-confetti payoff stays legible at full motion.
