# Broadside

Sixty seconds thrown off your own flagship's bow catapult into the middle of a fleet action. Two battle lines are already in contact, kilometre-long hulls slugging it out in no formation at all, and you fly the gaps between them: hard banks through the crossfire, a high-speed run down a friendly cruiser's flank while its broadside fires over your canopy, then along an enemy warship's keel with its turrets tracking you the whole way. The whole engagement is backlit by a magenta-and-gold nebula, so every hull in the level is a black silhouette wearing two lines of coloured light — and the run carries you across the entire battle to the enemy flagship on the far side.

## Visual language
The nebula is the only light source, so nothing is lit and everything is backlit: each hull is near-black with a magenta rim along its upper chine and a gold rim underneath, from the swarm darts up to the dreadnoughts. The two fleets are told apart by signal colour alone — yours is ice-white with cyan engines, cyan running lights, and cyan fire; theirs is obsidian streaked with molten orange, firing crimson. Any crimson on screen is something shooting at you. Crossfire streaks between the lines continuously and capital-ship salvos land on downbeats. The four ships you fly against are built from plating seated on rail frames, so their hulls follow the flight path rather than cutting through it. LAUNCH and REARM are hangar-door signage off your own flagship — deck lamps in an armour plate wearing the same two rim strips.

## Musical language
132 BPM in D minor, 33 bars, full orchestra: brass whose filters open as they are pushed, detuned string sections, tremolo, choir, and timpani. Nine movements track the battle — a catapult hit and a horn call, martial ostinato as the lines close, a six-bar brass theme over the flank whose downbeats are the cruiser's guns, a low grinding raking pass, then one bar of near-silence in the eye of the battle. The flagship arrives on an E-flat major against the D tonic — the Neapolitan — and puts accents on steps 2, 6, and 14 of every bar, which are exactly the steps its shield domes drop on. The trench takes the harmony to one chord per bar; the last bar is D major. Locks are pizzicato climbing the live chord, volleys are brass stabs, and kills walk per-act melody lanes with a brass double from the third kill in a chain.

## Mechanical signature
A 60-second, five-point run with seven hostile kinds across four motion grammars: crossing swarm darts that bank and corkscrew, twin-boom wasps that spiral inward, rooted hull batteries that track and throw interceptable crimson shells, and heavy escorts that arrive stacked and fan to full width. The enemy flagship is fought in two passes. Six shield emitters ride its dorsal surface, each holding a hard-light dome up while its battery charges and dropping it for the back of every bar to fire — a rhythm, not a puzzle, staggered in thirds so the openings sweep past you. Four of six collapses the shield envelope; only then are the trench's four reactor couplings targetable, two armour stages deep on a hard deadline. Volleys fired entirely into one flank of the screen score a **broadside** bonus, which is the level's name and the reason to sweep one side clean rather than pick.

## What to read
- `src/benchmark-levels/broadside-ob4d/timing.ts`
- `src/benchmark-levels/broadside-ob4d/gameplay.ts`
- `src/benchmark-levels/broadside-ob4d/flagship.ts`
- `src/benchmark-levels/broadside-ob4d/audio.ts`
- `src/benchmark-levels/broadside-ob4d/visuals/index.ts`
- `src/benchmark-levels/broadside-ob4d/visuals/ships.ts`
- `src/benchmark-levels/broadside-ob4d/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Broadside theme assignment. Verified headless: typecheck, build, `check:benchmark-scope`, and `check:floor` (simulation across all policies, target occlusion clean at zero warnings, and every performance gate). Simulation lands the perfect policy at rank S with the flagship destroyed, and the imperfect policy survives the run taking no hull damage, matching the calibration of the existing showcase levels.

WSL2 cannot render WebGPU, so the real frame and the mix still need a human playtest. First things to check by eye: whether the magenta/gold rim strips separate hulls from the nebula with the bloom slider at zero; whether the catapult launch at bar 0 and the one-bar silence at bar 20 land as the two hard punctuation marks they are meant to be; whether the shield domes read as droppable on the beat rather than as random gating; and whether the victory pull-out at bar 32 actually frames the breaking flagship and both fleets rather than just rising into empty space. By ear: the balance between the brass ostinato and the player's kill melody, which is the one place the orchestra could bury the soloist.
