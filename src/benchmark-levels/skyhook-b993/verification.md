# Skyhook verification

The authored run is 60 seconds at 120 BPM. The perfect policy destroyed all 48 counted enemies, preserved both hulls and docked. The seeded imperfect policy also destroyed all 48, took one pilot hit and docked. The no-fire policy lost the climber at 20.6 seconds. All core gameplay events were exercised.

- TypeScript and production build: passed.
- Level floor: passed, with no target-occlusion, performance, audio-configuration, spatial-spread or destruction-distance warnings.
- Audio trace: five section boundaries at 0, 14, 28, 36 and 52 seconds. Air/percussion events drop from 42 in the weather to seven in sunlight and zero above it. The final eight seconds contain two backing notes.
- Browser audio smoke check: lock, fire, hit, kill, reject, full volley and pilot damage played through real Web Audio without exceptions. Start, suspend, resume and dispose completed.
- Visual inspection: six gameplay stills from weather through docking and a bloom-zero letter placard. Captures use the repository's headless WebGL inspection backend; the level itself uses the shared WebGPU runtime.

The stock scope command cannot pass for this assignment: its default `main` ref is absent, and selecting `HEAD` reveals that it only accepts `src/levels/<id>/`. A direct Git path audit confirms that every added file is inside `src/benchmark-levels/skyhook-b993/`. No registry or shared-engine files changed. `npm run gallery` generated the Skyhook card; `gallery-card.md` preserves it here, and the shared gallery was restored to satisfy the directory-only contract.

A human run should check the stereo mix, the feel of six-lock volleys, pilot-shot interception, climber damage, and the boss's final approach on a WebGPU-capable browser. The quiet docking interval is intentional.
