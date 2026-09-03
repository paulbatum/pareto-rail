# Broadside

Broadside launches a tiny strike craft from the white deck of a friendly flagship and throws it into the impossible gaps of a fleet battle. Ice-white cruisers and cyan engine fire burn along one side of a magenta-and-gold nebula while obsidian enemy hulls answer in orange and crimson; the flight banks through the crossfire, scrapes the enemy flagship's shield skin, then dives through its glowing belly.

## Visual language
The palette is a deliberate side-of-war read: cool ice, cyan, and white for the home fleet; near-black metal, molten orange, and signal crimson for the enemy. Kilometer-long procedural cruisers sit at the rail's edges with layered armor, bridges, engines, turrets, and thin broadside beams. Small enemy silhouettes stay sharper than the capital ships: triangular skiffs cross the whole screen, winged corsairs bank in place, ringed interceptors corkscrew, and point-defense nests telegraph their crimson bolts. The enemy flagship is a long asymmetric slab with an orange shield ring, four flank generators, and a three-lamp trench core. Sparks, lock rings, muzzle flashes, and six-segment reticle geometry keep the action readable with bloom disabled.

## Musical language
120 BPM space opera in D minor and open fifths. Strings and a low engine pulse establish the launch, brass joins as the second fleet appears, and timpani turns the crossfire into a rolling quarter-note keel. The friendly broadside adds bright choir and string color; the flagship entrance ducks the mix for a two-note brass warning, the shield break answers with a rising fanfare, and the trench strips the score toward low brass and exposed voices. Locks, fire, hits, and misses are notes quantized to the transport and voiced from the live chord. Kills walk authored melodic lanes, while generator and core kills climb into the victory figure.

## Mechanical signature
The 60-second run is divided into launch, skirmish, broadside, crossfire, approach, shield run, shield break, and trench. Skiffs, corsairs, interceptors, and point-defense nests use four different motion grammars and fill the screen's width and height. Point defense launches interceptable homing bolts. The flagship's four shield generators each need an armor hit and a final kill; when all four fall, escort fighters flood the lane and the three gated power cores become lockable. Each core has an armor stage and a lethal stage. Clearing the last core pulls the camera through a gold-white rupture and lets the fleet burn behind the victory theme.

## What to read
- `src/benchmark-levels/broadside-61z2/index.ts`
- `src/benchmark-levels/broadside-61z2/gameplay.ts`
- `src/benchmark-levels/broadside-61z2/audio.ts`
- `src/benchmark-levels/broadside-61z2/audio-voices.ts`
- `src/benchmark-levels/broadside-61z2/visuals/index.ts`
- `src/benchmark-levels/broadside-61z2/visuals/environment.ts`

## Status & notes
Showcase benchmark build. The directory-only contract is intentional: no registry edit is required. Human WebGPU playtest should first check the fleet reads as two colors at a glance, that the flagship's shield ring and belly trench remain targetable at bloom zero, and that the shield-break drop gives the escorts enough contrast before the victory pull-out. Inspection moments are the friendly broadside around bar 9, the crossfire around bar 14, the shield run around bar 21, and the trench around bar 28.
