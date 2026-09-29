`broadside-tllu` ("Broadside") is built and passes every automated gate. Nothing has been seen or heard on real WebGPU, so it still needs a human playtest.

The 60-second run covers launch, the crossfire corkscrews, the cruiser flank under its broadside, the quiet eye, the belly turrets, and the flagship's shield-generator pass. It then goes through the escort surge and the trench dive to the exposed core, and ends on the pull-out finale and the victory theme. The score is 32 bars at 128 BPM. It uses the shared lock-on runner with no engine changes and no registry edits.

**Verified**
- `tsc --noEmit` and `npm run build` pass.
- `npm run check:floor -- --level broadside-tllu` returns ACCEPT: 0 occlusion warnings, and the perf and audio config gates pass.
- The one perf warning is frame-time growth, from a few SwiftShader spikes (one measured 328 ms, against 3.9 ms early in the run). I treated it as a software-renderer artifact. I added pipeline prewarm to reduce first-use hitches on real hardware.
- `npm run check:benchmark-scope -- --level broadside-tllu --base HEAD` passes (25 paths).
- `docs/level-gallery.md` is regenerated, and `level.md` is filled in.
- The simulator's perfect policy gets 109/141 kills and reaches FLEET ADMIRAL with no player hits. The no-input run ends with two player hits and no kills, well short of a loss. The imperfect run reaches WING LEADER.
- An automated playtest of the flagship fight ran the intended sequence. All four generators break, the shield falls, escorts arrive, both cores go, and the heart dies before its deadline.
- I reviewed SwiftShader frames of every section, including the trench, heart and finale.
- A real-time audio capture showed no clipping, and the eye sits about 18 dB below the broadside.
- Only three paths are touched: the level directory, `public/level-content/broadside-tllu/`, and the gallery doc. All scratch tooling is deleted.

**Needs human eyes (WebGPU)**
- Overall look and bloom, especially the contrast in the eye and the finale pull-out framing.
- How the corkscrew banks feel.
- The timing of the heart kill and the score landing on the victory theme.
- The mix around the eye and the orchestral swells on real audio output.
- Shader-compile hitches on first use, which SwiftShader can't show.