**Mass Driver is complete** — a full showcase level at `src/levels/mass-driver-wo4m/`, registered in the picker, with every gate green: `typecheck`, `build`, `check:scope` (against the entrant baseline), `check:floor` (simulation, occlusion 0 warnings, perf, audio config, gallery), and `trace:audio`.

## What was built

**The core conceit is structural, not decorative.** 128 BPM × 32 bars = exactly 60 seconds, and the 112 accelerator rings are placed at `runProgress(beat × beatSeconds)` — so the camera crosses one ring per beat *by construction*, at any point on the strictly-accelerating speed profile. Rings space out in world units as you accelerate but never leave the grid, and each ring heat-shifts arc blue → violet → blinding white across the run.

**The gun is the instrument.** A persistent tonal drone climbs from E1 bar-by-bar, accelerating (t²) through the interlock bars into the firing charge, and cuts dead on the bar-28 shot. Under it: locked four-on-floor minimal techno in E minor (acid line from stage-2, Em–F phrygian dread in the boss), with all player actions transport-quantized and pitched from the live harmony — kills walk hidden per-section melodic lanes, each of the six interlock kills plays a climbing confirmation figure, and rejects are a cold breaker-trip clunk. After the shot, everything strips to a lone **E major** bloom in silent open space — the whole run is minor; the release is the light.

**The boss is a deadline, not a health bar.** Six hazard-amber safety interlocks clamp the bore in two ranks (bars 20/22), station-keeping ~1s ahead so they ring the frame. Clear all six before the charge peaks at bar 28 and the gun fires — whiteout, ~3× speed spike, star-streaked vacuum, "PAYLOAD AWAY". Any interlock alive at bar 28 detonates the barrel (99-damage hit, `died: true`, red containment-failure flash).

**Simulation results:** perfect policy 72/72 kills → S; seeded imperfect 66/72 → A (S requires the gun fired + 95% clear); no-fire dies at exactly 52.52s (the deadline). The only dead-air gap is the intentional post-shot silence.

## My refinements on the agents' output

Fixed an inverted arc-interception counter (it counted *every* kill), retuned the S-rank margin off the sim ceiling, made the detonation zero the hull line, clamped threader corkscrews inside the bore + moved the wall ribs out (occlusion 17 warnings → 0), shortened engagement leads (kill distance 45.8m → 40.1m, wider screen spread), pulled the interlocks from distant specks to frame-ringing clamps, and made the charge glow quadratic + distance-capped so the boss stays readable until the final beats.

## Needs human eyes (WSL2 can't render WebGPU headless)

Verified via snapshots: tunnel arc, bloom-off readability, interlock legibility against the charge, the whiteout, and the starfield exit. A playtester should first check **rings landing on the beat by feel**, the **bar-28 shot moment** (whiteout length, FOV kick), the **charge crescendo brightness** at their bloom setting, the six-segment reticle gauge during live play, and the music mix balance (hum vs. kick duck).