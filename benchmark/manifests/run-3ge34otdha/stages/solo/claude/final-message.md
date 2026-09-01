Broadside is complete and passes every headless gate. The level lives in `src/benchmark-levels/broadside-6m7m/` with the regenerated gallery as the only other change.

**What was built**

- **Rail and world.** The rail is authored as knots with bar times, so the camera is exactly at the deck lip, the cruiser flank, the warship belly, the flagship flank, and the trench on their beats. It catapults off our flagship's deck, banks through the crossfire with a full barrel roll on bars 6 and 7, runs the friendly cruiser's flank at 55 units per second under scripted broadsides, drifts through a quiet eye, runs the enemy warship's belly, passes the flagship flank, loops around its bow into a trench on the spine, then climbs out and swings around to frame the whole battle for the final second.
- **Enemies.** Darts cross the screen in knots, wasps corkscrew in camera-relative helixes that follow you through banks and the roll, two-hit hunters hold station and lunge to fire bolts, and two-hit turrets slide past rooted to the warship keel. Bolts fly ahead of the rail and drift into its path so they are readable and interceptable at this speed.
- **Boss.** Four two-hit shield generators on the flagship flank with point defense, then three three-hit cores in the trench. Cores are lockable at any time, but while the shield holds the release swats those shots away and the rest of the volley still fires. Killing all cores triggers the flagship break-up, the enemy line scattering, and the D major victory theme.
- **Visuals.** A nebula sphere backlights everything. Both fleets are merged low-poly hulls with a rim shader, window strips, engine discs, and instanced tracer duels fired on the beat. Signal-plaque letters spell LAUNCH and SORTIE.
- **Audio.** A 112 BPM procedural orchestra in seven movements. Locks are pizzicato on the live chord, releases are brass stabs, and kills play a solo trumpet reading a per-movement lane.

**Verification**

| Check | Result |
|---|---|
| typecheck, build | pass |
| check:floor | ACCEPT (one warning: 35.8% center concentration) |
| occlusion, perf, audio config | clean |
| scope vs HEAD | valid, 17 paths |
| simulate perfect / imperfect | S at 25236, A at 18784 |
| simulate no-fire | hull dies at 31 s, so bolts land |

**What needs human eyes**

WSL2 cannot render WebGPU, so I judged the look from SwiftShader snapshots and darkened the sky, rims, engines, and shield after the first pass came out overexposed. A playtester should check first: bloom-zero legibility of the obsidian craft against the nebula, whether the barrel roll is fun rather than disorienting, the shield-swat feedback on cores, the pull-out framing at bar 28, and the orchestral mix balance between timpani, tremolo strings, and the solo trumpet.