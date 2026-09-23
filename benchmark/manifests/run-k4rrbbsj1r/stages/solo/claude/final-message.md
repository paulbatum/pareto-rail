Broadside is built in `src/benchmark-levels/broadside-hmvp/` and passes every gate. The one thing I couldn't check is a real WebGPU playthrough with sound: this WSL2 environment can't render WebGPU, so I only saw headless SwiftShader snapshots and never heard the orchestra play in context.

**Checks run:**
- `npm run typecheck` and `npm run build`: pass.
- `npm run check:floor -- --level broadside-hmvp`: **ACCEPT**, with zero occlusion, performance, audio-config and distance/centerness warnings.
- `npm run check:benchmark-scope -- --level broadside-hmvp --base HEAD`: valid. The only other change is the regenerated `docs/level-gallery.md`.
- **Length:** exactly 60 s (34 bars at 136 BPM).
- **Simulation:** 8 enemy kinds spawn, and every gameplay event fires. The "perfect" bot scores rank A, knocks out 4/4 shield generators and 3/3 power cores, and gets the victory ending. The weaker "imperfect" bot lived to the end in 4 of 5 seeds; the fifth died at 44 s.
- **Audio trace:** the song structure and the unresolved ending you get if the flagship escapes both trace correctly. I also rendered all 22 synthesized instruments offline in headless Chrome: no errors or bad samples. I used those renders to raise the kill-note melody and the snare.
- **Snapshots:** I went through the whole run with and without post-processing. That caught overexposure, hulls that should read black showing as pink-grey, and blasts filling the screen; all three are fixed.

**What's in it:**
- **The route:** the path is generated from authored speed, heading and climb per bar, so the ships sit exactly where the music puts you. You catapult off your carrier's deck on the bar-1 downbeat, corkscrew twice between two passing cruisers, and run down VALIANT's flank while her guns fire overhead on every beat. Then you drift through a quiet stretch of wreckage, crawl under an enemy warship's belly, pass close along the enemy flagship's side, bank hard around its stern and drop into its trench.
- **The finish:** the camera pulls back past the breaking flagship with both fleets in frame. The REARM replay letters appear in that final view.
- **Enemies:** darts that stream across the screen in lines, ring-shaped fighters that circle each other, lancers that overtake you from behind and fire interceptable shots on the beat, three-hit torpedo bombers going for VALIANT, belly turrets, four two-stage shield generators, and three two-stage power cores. A full six-target volley counts as a "full broadside", and the friendly fleet answers with a salvo.
- **Music:** a synthesized orchestra in D minor with strings, horns, brass, timpani, choir and harp. Locks pluck up the current chord, each shot of a volley is a horn note, and kills play a melody line that changes per section. It goes near-silent in the wreckage, the shield breaks on an orchestral hit, and the ending plays a D-major victory theme if you win, or trails off unresolved if the flagship escapes.

**Changes from your brief:**
- Start and replay words are SORTIE and REARM, not START and REPLAY.
- The player hull has 5 hit points.
- Airspeeds are lower than a literal "high-speed run": the engine's shots fly at about 82 units/s, so at faster speeds shots chased targets for over a second and missed. Speed now comes from flying 20 units off the hulls.

**What a playtester should check first:**
1. **VALIANT's salvos.** They're timed to the audio beat and fall back to game time if audio isn't running. Snapshots never show them because the tool sends no beats, so they're entirely unseen.
2. **Hull contrast with bloom at zero.** Ship bodies were tuned under SwiftShader; on real GPUs the dark enemy hulls or pale friendly hulls may need adjusting.
3. **The mix.** Whether the kill melody rides clearly over a busy section, the balance of the cannons, and whether the victory theme lands as the camera pulls out.
4. **Boss difficulty.** Whether an ordinary player can take out all four generators and all three cores in their windows; the simulator is a poor stand-in here.

Nothing is committed.