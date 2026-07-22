**Broadside is complete: all gates pass** — typecheck, production build, benchmark scope (19 paths, all inside the allowed footprint), and the full floor check (7 enemy kinds, complete event coverage, zero occlusion warnings, zero performance failures, valid audio config). The perfect-policy simulation clears all 95 targets, destroys the flagship, and earns the S rank at exactly 60.0 seconds.

## What was built

A 60-second crossing of a fleet engagement at 140 BPM (35 bars = exactly 60s), under `src/benchmark-levels/broadside-b4kd/`:

**The run**: catapult slam off your flagship's deck → hard S-banks through the melee → a surging straight down a friendly cruiser's flank while her broadside fires overhead on the downbeats → a near-stall through the silent eye of the battle → under an enemy warship's keel raking its two-stage turrets → the enemy flagship's shield generators under point-defense fire → escort swarm as the rail banks around the bow → trench dive to three power cores, with a victory peal and a climb away when the last one blows. Words are ENGAGE/SORTIE; hull is 3 points.

**The boss contract**: four 2-lock generators must *all* die or the trench cores stay caged (`lockable` flips live when the shield falls, with `bossphase` events driving audio, visuals, and callouts). The run summary reports how far you got.

**The music**: synthesized orchestra — brass/strings over timpani in D minor, the launch fanfare returning as the full broadside theme, one horn alone in the eye, staccato cellos under the keel, a climbing brass line in the trench. Timpani doubles as the fleet's guns. Locks are pizzicato plucks off the live chord, kills walk six per-act hidden melody lanes, boss chips ring an escalating anvil, and the flagship's death ducks everything for a scheduled D-major fanfare.

**The look**: a camera-riding magenta-and-gold nebula dome backlights every hull as a rimmed silhouette; sides read by color (ice/cyan vs obsidian/molten/crimson); 110 tracer lanes stream both directions the whole run; kills shatter into wreckage that tumbles and cools to black (no gravity).

## Iteration that mattered

- Destruction distance/center-spread tuning: leads cut from ~4.5s to ~2.5s and formations widened (64.6m avg → 45m, center 60.6% → 45.7%, mid-pack vs. other entrants; Crystal sits at 19%).
- Fixed a real GPU leak (runner doesn't dispose meshes; at this density it tripped the geometry-growth gate 9×).
- Point defense retuned so shells can actually catch a 25 u/s camera (hull threat was silently dead).
- Visual debugging via SwiftShader snapshots: sky was silently far-plane-clipped (now a camera-riding dome), the flagship's 300m additive seam and shield-collapse beams were whiting out frames, escort darts clipped through trench walls.

## What still needs human eyes (WSL2 can't render WebGPU)

1. **Broadside salvos on the downbeats** beside the cruiser — beams fire off `beat` events, which headless snapshots can't exercise.
2. **The eye's near-silence** landing as a held breath, and the shield-fall → trench-dive → victory-peal chain having enough contrast.
3. **Bloom-at-zero legibility** of locked targets and the ENGAGE/SORTIE plaques, and the final mix balance (reverb depth, timpani-as-cannon weight).

Gallery card, `level.md`, and self-produced hero/overview/start images are in place; `docs/level-gallery.md` regenerated.