**Vespers is built and passes every gate.** The level lives entirely in `src/benchmark-levels/vespers-t5xw/` — a 60.0-second run (18 bars at 72 BPM, ending exactly on the final bar line) through a night cathedral where killing a light-thief streams its stolen color back into a real window that stays lit for the rest of the run.

## What was built

- **World** (`visuals/environment.ts`): a straight gothic nave ~590m long — instanced piers, arcade/gallery arches and ribbed vaults as one merged line pass, a candle sea on the floor, and ~140 stained-glass windows (all panes are a single InstancedMesh, glows another, floor light-pools a third). Every window starts dark; each thief is assigned the nearest dark window at spawn and burns with exactly its color. Misses leave that window dead all run — the end-state cathedral is a visible scoreboard. The dead rose window at the west end ignites sector-by-sector as boss petals die, then all at once, cascading light back down the nave through every window the player couldn't save.
- **Enemies**: wisps (shrouds sinking toward the candles), moths (crossing the nave on flapping wings), gargoyles (perched, telegraphed pounce, interceptable gloom bolts), censers (2-HP pendulums swinging on chains), and the Vigil — six glass petals shielding a two-stage heart whose seal runs through `validateRelease` (blocked volleys flash "shielded" gold), with three echo petals summoned at the stage break.
- **Music** (`audio.ts`): organ counterpoint in D minor over a held pedal, no percussion — voices enter one at a time, choir and bells join at the plenum, the nave drops to a single flute for the quiet span (bars 11–13), a walking pedal underscores the boss, and the finale ducks the mix, turns the third major, and finally releases the en-chamade trumpet held back all night. Kills play per-section melody lanes from the live harmony; locks climb a flute scale; fire is a chord-rooted chiff; everything quantizes to the transport.

## Verified

- `npm run typecheck` and `npm run build` pass; `npm run check:floor` passes with **zero warnings** (occlusion, perf, audio config, centerness, reticle all clean).
- Simulation: perfect policy 63/64 kills, rank S with the Vigil down; imperfect seed 1 ranks S; the only dead-air gap (39–43.5s) is the authored quiet span; all gameplay events fire. I fixed a real boss deadlock the simulator exposed (an unlockable centered heart starved target selection) by moving the seal into `validateRelease`.
- Headless SwiftShader snapshots (in `snapshots/gameplay/`) confirm bloom-off legibility, letter readability, and the boss composition. Scope: git shows the level directory is the only repository change (`check:benchmark-scope` couldn't run — its `scripts/benchmark/` module is absent from this scrubbed baseline).

## Needs human eyes

WSL2 can't render WebGPU, so a real playtest should check: the lit-vs-dark window contrast when kills actually land (no-fire snapshots can't show ignition), the organ mix balance in the plenum and how hard the trumpet finale hits, bolt read-and-intercept feel, and whether the rose-window ignition cascade lands as the run's biggest moment.