**Broadside is complete and committed** (`a94d1dd`), with a clean tree and every required check green.

## What was built

A 60.0-second run (144 BPM, 36 bars exactly) under `src/benchmark-levels/broadside-b9mn/`, following the theme's full arc:

- **Launch (bars 0–4)** — catapult off your flagship's deck: cyan chase lamps down the runway, a speed surge, flash, and FOV kick on the downbeat.
- **Gauntlet (4–11)** — crescent darts cross the full frame in corkscrewing packs while forked lancers swoop to posts and fire interceptable crimson homing bolts.
- **Broadside run (11–16)** — the fastest stretch, down a friendly cruiser's flank with its tracer lanes firing overhead; the score peaks with a trumpet theme.
- **The eye (16–18)** — near-silence, drifting wreckage, two dead-stick drifters, strings and one glass bell.
- **Belly run (18–22)** — two-stage turrets deploy from an enemy cruiser's keel overhead.
- **Flagship, two phases (22–34)** — four shield generators along the hull under point-defense fire (a clean sweep drops the magenta shield film; otherwise it overloads so phase two is always playable), then a trench dive to three two-stage power cores while escorts chase you between the walls.
- **Victory (34–36)** — the last core ducks the orchestra into a D-major fanfare, the flagship dies in chained secondaries, and the camera blends into a look-back at the burning line during the pull-out.

The world sells the theme: a TSL-noise magenta-and-gold nebula, ~10 procedural capital ships color-coded by side (ice-white/cyan vs obsidian/molten-orange), animated capital tracer exchanges whose intensity follows the run's sections, distant flak, and a 640-metre flagship whose trench is real geometry. Player actions are notes in the score — locks/fire/kills are transport-quantized to the live harmony with per-act kill-melody lanes, and boss chips escalate in pitch and brightness.

## Verified
`npm run typecheck`, `npm run build`, `check:benchmark-scope` (16 paths), and `check:floor` all pass — that includes simulation (all policies, all events fired, no dead air, perfect run earns S with the boss kill), zero occlusion warnings, and all perf gates. Two soft warnings remain (average kill distance 52m vs 45m ideal; center-screen kill concentration), both under the hard limits.

## Needs human eyes
WSL2 can't render WebGPU, so a playtest should check: the catapult moment, the overhead broadside read at bar 11, silhouette legibility with bloom at zero, trench claustrophobia vs readability, and whether the last-core duck into the victory theme lands. I ran over the budget getting occlusion to zero (the trench-mouth transition took three iterations), so the polish that remains — mix balance and enemy-motion feel — is exactly what the playtest notes in `level.md` point at.