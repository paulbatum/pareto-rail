The level is complete and all gates pass. Final summary:

## Mass Driver (`mass-driver-esvz`) — complete

**The design in one line:** 128 BPM × 32 bars = exactly 60.0 seconds, and accelerator ring *k* is placed at the precise rail point the camera reaches on beat *k* — so you cross one ring per beat by construction, ring spacing widens as you accelerate, and the speed and the music are literally the same object.

**The run:** Injection (bars 0–8, arc-blue coils, first drones) → Acceleration (8–16, four-on-the-floor locks in) → Overdrive (16–24, violet heat, twin sentinels) → Charge (24–30, six jammed interlock clamps ride the payload collar, six-bar riser, klaxon climbing a tone per bar) → bar 30: clear all six and the gun fires — flash, 3× speed slam out of the muzzle, and the first silence in the level as you coast among stars past a dim planet. Too slow, and the breach detonates with you in it (real death, `died: true`).

**Signature systems:**
- The gun is the instrument: a detuned bass hum climbs a full octave (E→F#→G→A→B→C→D→E′) across the run; a struck-coil chime sounds on every ring crossing; kills walk hidden melodic lanes whose register rises with the hum.
- Interlocks are two-stage (armor plate → exposed red jam light), so a full 6-lock volley cracks the whole collar at once and the next one kills it.
- Three drone grammars: weavers braid across the bore in phase-offset pairs, stators crawl the coil wall circumferentially, sentinels telegraph-lunge and throw interceptable arc bolts. START/REPLAY are **LAUNCH/RELOAD**.

**Verified here:** `typecheck`, `build`, `check:scope` (vs the branch baseline `HEAD` — the default `main` base flags pre-existing benchmark-infra files unrelated to this level), and `check:floor` (**all checks passed**: simulation, occlusion 0 warnings, perf gates, audio config, event coverage complete including `stage`/`reject`). Simulation: perfect clears 66/66; imperfect hits rank S; the no-fire run dies at 56.23s to the breach detonation, confirming the fail state; no dead air except the authored 4s launch silence.

**Needs human eyes (WSL2 can't render WebGPU headless):** ring-glow readability with bloom at zero, interlock collar legibility during the charge tint, the bar-30 slam-to-silence payoff, and overall music mix balance — the hum/klaxon/player-melody stack in the charge section is the most likely place to want gain tweaks.