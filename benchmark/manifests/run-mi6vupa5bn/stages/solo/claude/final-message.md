Speedsolve is built in `src/benchmark-levels/speedsolve-bnmf/` and passes every gate: typecheck, build, the benchmark scope check, and `check:floor` (verdict ACCEPT, zero occlusion, perf, audio or spread warnings). I haven't committed anything. I could not see it in WebGPU or hear it, so how it looks and sounds still needs a human playtest.

**What the level does**
- **The fight:** a real 3×3 sticker puzzle. I found the solve plan with an exhaustive offline search, so every face can end single-colored using only stickers no earlier face used up. On each face the wrong rows are parallel slices, so they can be solved in any order.
- **Solving a face:** each glowing bracket marks a wrong row. Every hit turns that slice a quarter turn, and the first turn lands on the next beat. Any turns queued behind it follow on eighth notes, so a full volley plays like a drum fill. Hits per face go 3, 4, 3, 3, 5, 5.
- **Timing and turns:** if you're too slow, the cube finishes the rows itself and those brackets count as misses. The HUD shows each hand-solved face's time, and weakpoint kills pay a bonus for speed.
- **The cube strips as you go:** a solved face's stickers fall off as a shower of small cubes and leave bare white machinery plates. A weakpoint rises from the face; destroying it (or its deadline passing) swings the camera round to the next face. By the sixth face the cube is almost all machinery.
- **Finale:** the shell spreads into a spinning ring of cubes around the bare core, which has two six-lock stages. When it dies it bursts into confetti and the music resolves to D major. The run is exactly 60 s (32 bars at 128 BPM). After the run, the camera pulls back and the cube clicks back together, freshly scrambled, above the REPLAY letters.
- **Enemies:** tetrahedra that fly in circles around the face, octahedra that pop out from the cube's edges and fire colored cubes at you (you can shoot these down), and prism trains that cross the screen, including one during each swing between faces.
- **Music:** the drum kit is made of the cube's own sounds: the hi-hat is a ratchet click, the snare a plastic snap, the kick a hollow thock. Every turn you cause plays on that same kit, and each face that falls adds one layer to the arrangement. Locks, shots and kills are pitched to the current chord, and each face has its own kill melody.

**What I checked headlessly**
- **Simulator:** a perfect player clears 135/135 at rank S with all 6 weakpoints. A clumsy player survives the full minute at rank B or C.
- **Real audio in headless Chrome:** I drove the actual game logic and audio with a scripted player and measured the output.
  - Each visible turn lands 2–25 ms after its sound, which is within one frame.
  - The mix runs about −18.6 dB with peaks at −0.9 dB. Before tuning it peaked at +5.7 dB and clipped.
  - Sound effects sit about 7.6 dB under the music, close to Crystal's balance.
- **Full lifecycle:** starting via the letters, dying, the REPLAY screen and restarting through REPLAY all run with no errors.
- **Stills:** I reviewed snapshot frames throughout the run in the SwiftShader fallback.

**Things you should know**
- **Engine bloom bug:** `src/engine/post.ts` passes `bloom.threshold` into the bloom's radius and `bloom.radius` into its threshold. Dark levels never show this, but on this pale background it washed out the whole frame. I didn't touch the engine; this level sets the two values swapped on purpose, and the reason is written in `index.ts` and `level.md`.
- **Camera:** the rail is a straight line and the level overrides the camera to orbit the cube. The player's edge-look still works exactly, and the end of the run hands over to REPLAY without a jump.
- **The last face starts bare:** because the cube strips as it goes, the sixth face begins entirely as white machinery. You pull the last pink rows onto it rather than unscrambling it.

**What a playtester should check first**
1. Whether the snaps feel locked to the beat on real audio hardware, where output latency adds a little delay.
2. How the finale reads with bloom at zero: the core, the ring of cubes, defenders and enemy fire are all on screen at once.
3. Whether kill notes cut through the percussion once all layers are playing.
4. Whether the 3.5-second window to solve each face feels fair for a first-time player.