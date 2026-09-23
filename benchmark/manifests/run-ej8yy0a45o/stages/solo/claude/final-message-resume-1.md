Tinker Ball is built in `src/benchmark-levels/tinker-ball-hh5u/`, with gallery images in `public/level-content/tinker-ball-hh5u/`. Typecheck, build, the catalog validator and `check:floor` all pass, including zero occlusion warnings, performance, audio config, and spread and distance (37.9 average kill distance). Nothing is committed.

**How it plays**
- **Length:** exactly 60 seconds, 32 bars at 128 BPM, one size tier per act:
  - marble among buttons and pins;
  - tennis ball among spools, erasers and paint pots;
  - melon among rulers, jars and cardboard;
  - then the spill;
  - then a 2-bar coast.
- **The ball and camera:** the ball's position, size and chase camera all live in gameplay, so the simulator measures the same framing a player sees. The ball swerves off its route through each fresh debris field, and the camera swings to keep the pieces ahead of it.
- **Monsters:** beetles, stilt walkers and snapping birds, each rebuilt from the current tier's supplies. Beetles dash on the beat and hop on downbeats, striders take one step per beat, and birds snap their clothespin beaks on the beat. Some heavier ones take two hits and drop a piece on each.
- **Kills:** the same pieces fly off clean, land on the road ahead and stick to the ball, which keeps them all. Loose supplies on the route get rolled up too.
- **The spill boss:** three glue cores rise out of the lake one after another, each wrapped in two layers rebuilt from swallowed supplies. They spit glue globs at the screen, and there's a 4-point hull. Then the heart takes two full six-lock volleys. Killing it clears the glue, and the ball rolls through the middle onto a polished clean patch.
- **Music:**
  - The key rises a whole step at each size-up (C, D, E), shifts to E minor for the spill and resolves to E major.
  - Kills play a hidden melody on an instrument that grows with the ball: glockenspiel, marimba, vibraphone, tubular bells, then music box.
  - Every piece that sticks adds a quiet music-box tick timed to the beat.
- **START/REPLAY:** pegboard tiles whose pegs burst into beads the ball rolls up as the run begins.

**Caveats**
- **Occlusion flag:** each monster's body is drawn outside its target in the scene graph, so the occlusion check can't tell a monster's own button shell from scenery. I first fixed the real problems (cores now sit visibly on top; tall clutter and props moved out of the lanes). I then flagged that one bank of body and debris pieces as non-scenery for the check. This is noted in `level.md`.
- **Scope gate:** `check:benchmark-scope` crashes because `scripts/benchmark/protocol.mjs` is missing from this checkout. I checked with git instead: only my level directory and its `public/level-content/` folder differ from the baseline.

**What a human WebGPU playtest should check first**
Headless Chrome here can't run WebGPU, so I reviewed visuals through fallback snapshots, including a throwaway copy of the snapshot harness (in the ignored `tmp/`) that actually fires. I never heard the audio; I only confirmed through the audio trace that everything is scheduled.
1. **Mix:** whether the kill bells sit above the reed-organ stabs and bass. I balanced the gains on paper only.
2. **Pickup ticks:** whether the ticks in big debris fields (spill layers, the heart's death) sparkle or clutter.
3. **Brightness:** the lamp pool around the spill and the spotless patch can still run warm and bright.
4. **Ball size on screen:** late in the run, the lumpy ball takes up a lot of the lower frame.