Committed with everything green. **Broadside** is complete.

## What I built

`src/benchmark-levels/broadside-ob4d/` — a 60.0-second (33 bars @ 132 BPM) fleet-action level in nine movements: catapult launch → crossfire → cruiser flank → raking an enemy keel → one bar of silence in the eye of the battle → the enemy flagship's shield emitters → escort breach → trench dive → victory pull-out.

**The idea that ties it together:** the nebula is the only light source, so nothing is lit and everything is backlit. Every hull — swarm dart to dreadnought — is near-black wearing a magenta rim on its upper chine and gold underneath. The fleets are told apart by *signal colour alone*: yours cyan, theirs molten orange firing crimson. Any crimson on screen is shooting at you.

**Boss mechanic I'm happiest with:** the flagship's six shield emitters open on steps 2, 6, and 14 of every bar — and the score plays accents on exactly those steps from the moment the flagship arrives. The rhythm you must shoot on is in your ear before you consciously see it. Four of six collapses the shield; only then are the trench's reactor couplings targetable.

## Verified headless

`typecheck`, `build`, `check:benchmark-scope` (19 paths), and `check:floor` — all pass. Simulation: perfect policy **rank S** with the flagship destroyed; imperfect survives at rank B with 1 hull hit; full event coverage. Target occlusion is clean at **zero** warnings.

## Things worth knowing

Two bugs the gates caught that I'd have missed by eye:

- **Enemy meshes were never disposed on kill.** Each hostile builds per-instance geometry and the run spawns 137 of them, so geometry count climbed to 7.66× and tripped the perf gate. Now disposed on record removal, with lock-bracket and wreck geometry shared across the run.
- **Hostile shells were badly miscalibrated.** My first fix for "shells can't catch a camera doing 80 units/second" was to make them very fast — which made them *unavoidable*. Both reference levels take zero hull hits on the imperfect policy; mine was killing it at 46s. They're now slower with a ~2-second visible approach, so answering one is a decision rather than a tax.

One remaining advisory warning: average destruction distance is 52m against a 45m soft threshold — a consequence of the fast rail and long leads, not a gate failure.

**Needs a human WebGPU playtest** — WSL2 can't render it, so I have not seen this level run. Check first: whether the rim strips separate hulls from the nebula with bloom at zero; whether the bar-20 silence lands; and whether the victory pull-out actually frames the breaking flagship rather than rising into empty space. By ear, the brass ostinato vs. the player's kill melody is the one place the orchestra could bury the soloist.