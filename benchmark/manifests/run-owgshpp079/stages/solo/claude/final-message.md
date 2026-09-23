Mass Driver is built at `src/benchmark-levels/mass-driver-azxp/` and passes typecheck, build and `check:floor` (0 occlusion, performance, audio-config and centerness warnings). `check:scope` does not pass, because the script only knows `src/levels/<id>/`. This repo has no `main` branch, so I ran it against HEAD. It flags only the benchmark directory you told me to use; the only other change is the regenerated `docs/level-gallery.md`. Nothing is committed.

**What it plays like**
- **The ride:** a lattice tunnel of coils over a dark planet, 128 BPM, 32 bars = exactly 60 s. You cross one ring on every beat: ring *k* is beat *k*, and the 112th is the muzzle. Speed triples over the run, so the rings spread further apart while still landing on the beat. They heat from arc blue through violet to white.
- **The hum:** the kick is the coil firing, tuned to a pumping bass hum. The hum only climbs: D through stage one, E through stage two, then a semitone every two bars in the final charge. A charge whine glides continuously above the melody.
- **Enemies:** pickets (tri-blade spinners orbiting the bore), threaders (needles that dart across the bore on each beat), leeches (clamps that ride a coil in; a coil you cross with a live leech on it misfires), arc pylons that shoot interceptable bolts, and six safety interlocks.
- **The boss:** the interlocks latch on in two waves and tether you with live arcs while a sealed iris glows at the end of the barrel. The verdict falls on the last beat before the peak. If you clear them, the iris opens, the drums drop out on the final beat, and the gun fires: whiteout, hyperspace streaks, then silence and a sunrise over the planet's edge. If you don't, the barrel blows and the run ends in death.
- **Player sounds are notes:** locks climb the chord, kills play a melody line written per stage, and each interlock you blow strikes the chord higher. START/REPLAY are CHARGE/REFIRE.

**A design constraint you should know about:** the engine's homing shots can't catch anything moving away from them faster than about 20 world units per second. At full scale, shots on the boss and on fast targets missed forever, and even perfect simulated play blew the barrel. I rebuilt the whole level at 1/3 scale (a `WORLD` constant in `gameplay.ts`). On screen nothing changes, but targets now stay under that speed. The camera still leaves the barrel at up to 20 world units per second before the launch spike. Simulated perfect play now kills 119/119, launches, and gets rank S.

**Other simulator results:** the deliberately sloppy player launches with an A, and a player who never shoots dies to arc bolts around 24 s. All 100 targets stay lockable on screen for their intended time. Across four random seeds, the sloppy player cleared the boss in only one. I made it easier after that: 4 hull points, fewer bolts, 4 hits per interlock. After the change I re-ran only seed 1, which launched.

**What I couldn't verify:** this machine can't render WebGPU, so I've seen the level only through the software-rendered snapshot tool. I ran the audio in headless Chrome: no runtime errors, beats fire, and loudness rises through the run and drops to near silence after the shot. I haven't heard it.

**What a playtester should check first:**
1. Whether ring crossings land on the kick. Ring positions are corrected against the measured audio beat, but device output latency isn't accounted for.
2. The mix: whether kill melodies cut through the kick and hum, and whether the whine is too piercing.
3. Bloom in the white-hot final charge, and how bright a bolt looks as it hits the camera.
4. Whether the boss timing feels fair to a real first-time player.

In dev, `?safeties=clear` (or `--debug-value clear` in the snapshot tool) auto-clears the interlocks so you can see the launch ending.