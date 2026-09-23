# Speedsolve

A sixty-second boss fight against a colossal puzzle cube hanging in a pale void. The rail orbits it face by face. Every glowing bracket marks a wrong row, and each hit on it snaps that slice a quarter turn, landing on the beat, pulling the face closer to one color. When a face is solved, its stickers fall off as a shower of loose cubies and a weakpoint rises out of the white machinery underneath. Destroy it and the rail swings you round the edge to the next face. After six faces the shell opens into a spinning halo, and the naked core takes your last barrage before it bursts into a storm of confetti cubes.

## Visual language
The void is pale and cool: a soft grey-white gradient, thin orrery rings, and drifting pale cubes for parallax. The cube's plastic is graphite. It owns the six solve colors: red, blue, yellow, green, orange, and pink. Solved faces leave bare white machinery plates, with hex hubs, corner bolts, and vent slots. These plates rotate onward with every later turn, so over the run the cube strips from candy to machine. The enemies are small candy tetrahedra, octahedra, and triangular prisms with ink edges. Enemy fire is glowing cubelets in the cube's own colors. The player's instruments are drawn in ink: a notched reticle that fills one notch per lock, diamond lock marks, and ink darts with white cores. The START/REPLAY letters are graphite tiles with 5×7 glyphs in raised candy cubelets, like stickers.

## Musical language
128 BPM in B minor, 32 bars in exactly 60 seconds. The cube is the percussion section. The hi-hat is the ratchet click, the snare is the plastic snap, and the kick is a hollow thock. A player's turn is scheduled on the same transport step the slice visually lands on. The first snap of a roll lands on the beat, and follow-ups roll on eighths, so a volley plays as a drum fill: detent clicks on 32nds while the slice spins, then a snap pitched up the chord as the face nears solved. The arrangement starts with kick, clicks, and a plucked bass. Each face that falls adds one layer from the next bar: backbeat snaps, then a mallet "gear" arpeggio, then offbeat stabs, then a driving sub, then glass bells. Locks climb the live chord, fire is a clean pluck, and kills play per-face melodic lanes. Under the naked core the harmony tips into G–A–Bm–Asus4 over a riser. The core's burst ducks the band and resolves to D major, with a falling glass peal over a thinning storm of confetti clicks.

## Mechanical signature
The solve is a real sticker-permutation puzzle. The plan was found by exhaustive offline search: every face ends single-colored using only stickers no earlier face consumed. Each face's wrong rows are parallel slices, so the turns commute and any target order solves it. A row that needs a half turn takes two hits. Hits per face climb 3, 4, 3, 3, 5, 5. If the player is too slow, the machine turns the remaining rows itself on sixteenths, and those brackets count as misses. Each weakpoint pays a speedsolve bonus for every second under eight, and the HUD posts every hand-solved face's time. Defenders come in three motion grammars: tetrahedron carousels that spiral out into elliptical orbits, octahedron gunners that pop from the cube's edges and fire interceptable cubelets, and prism trains that roll across the frame, including one that rides each swing. The hull has 4 points. The core has two six-lock stages and fires its own cubelets. It must fall by bar 30. After the run the camera backs off and the cube clicks back together, freshly scrambled, above the REPLAY letters.

## What to read
- `src/benchmark-levels/speedsolve-bnmf/gameplay.ts`
- `src/benchmark-levels/speedsolve-bnmf/solve.ts`
- `src/benchmark-levels/speedsolve-bnmf/cube-model.ts`
- `src/benchmark-levels/speedsolve-bnmf/audio.ts`
- `src/benchmark-levels/speedsolve-bnmf/audio-voices.ts`
- `src/benchmark-levels/speedsolve-bnmf/visuals/index.ts`
- `src/benchmark-levels/speedsolve-bnmf/visuals/cube.ts`

## Status & notes
Showcase build. Markers: `faceF` (bar 2), `faceR` (6), `faceU` (10), `faceB` (14), `faceL` (18), `faceD` (22), `core` (26), `confetti` (30). The camera is an authored orbit layered over a straight −Z rail, so the player's edge-look is preserved exactly and the finale pose hands over to REPLAY without a seam. The shared post sends `bloom.threshold` into BloomNode's radius slot and `bloom.radius` into its threshold slot, so this level sets them swapped on purpose to keep the pale void from blooming. The first human WebGPU pass should check three things: that snaps feel locked to the beat (audio and visuals meet through the learned beat clock), how the busy finale reads at bloom 0, and the mix balance between the kill melody and the percussion layers.
