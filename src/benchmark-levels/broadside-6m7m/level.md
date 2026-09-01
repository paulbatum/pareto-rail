# Broadside

A sixty-second sortie across a full fleet engagement. You catapult off the deck of your own flagship straight into kilometre-long cruisers slugging it out in no neat formation, fly the gaps through the crossfire — hard banks, one full barrel roll — run a friendly cruiser's flank as its broadside lights off overhead, drift through the quiet eye of the battle, rake the turrets on an enemy warship's belly, then take the enemy flagship apart: shield generators on its flank, escorts pouring in around the bow, and a trench dive to its power cores. When the last one blows the rail climbs away and swings around to frame the whole battle as the enemy line burns and scatters.

## Visual language
A magenta-and-gold nebula backlights everything, so every hull is a silhouette with a coloured rim. Sides read by colour: our fleet is ice-white with cyan engines and cyan fire; theirs is obsidian streaked with molten orange, firing crimson. Capital ships are merged low-poly hulls with window strips, engine discs, and broadside batteries that trade instanced tracer fire on the beat; distant swarm knots dogfight in the gaps. The player owns cyan — a naval gunsight reticle whose brackets close as locks stack, cyan darts, cyan lock diamonds. Signal-plaque letters spell LAUNCH and SORTIE. Effects are vacuum: straight-flying sparks, hull plates that tumble and cool to black, ring shockwaves, soft explosion discs.

## Musical language
112 BPM orchestral space opera in D minor, 28 bars to exactly 60 seconds: timpani and snare under horns and strings, trumpets on top. Timpani roll and fanfare for the launch, a horn theme through the gaps, the trumpets take it fortissimo over sixteenth-note strings for the flank run, then near silence in the eye (high strings, choir, harp), a low-brass rebuild under the belly, a Neapolitan march for the flagship, a rising sequence to the dominant in the trench, and D major for the pull-out — the victory fanfare if the flagship dies, its shadow if it survives. Locks are pizzicato climbing the live chord, releases are brass stabs on the root, and kills play a solo trumpet reading a per-movement melodic lane, so a chained volley performs a run.

## Mechanical signature
A 4-point hull and a rail authored as timed knots, so every set piece sits where the camera is on its bar. Darts cross the screen in knots, wasps corkscrew in camera-relative helixes (they follow you through banks and the barrel roll), two-hit hunters hold station and lunge to fire interceptable crimson bolts, and two-hit turrets slide past rooted to the warship's keel. The flagship boss is four two-hit shield generators with point defense, then three three-hit cores in the trench; cores can be locked at any time but a live shield swats their shots (the rest of the volley still fires). All four generators must fall for the cores to be killable; a full six-kill volley is a 600-point broadside.

## What to read
- `src/benchmark-levels/broadside-6m7m/timing.ts`
- `src/benchmark-levels/broadside-6m7m/rail.ts`
- `src/benchmark-levels/broadside-6m7m/gameplay.ts`
- `src/benchmark-levels/broadside-6m7m/audio.ts`
- `src/benchmark-levels/broadside-6m7m/visuals/index.ts`
- `src/benchmark-levels/broadside-6m7m/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Broadside theme assignment. Inspection markers: `roll` (bar 6), `flank` (bar 8), `eye` (bar 12), `belly` (bar 14), `flagship` (bar 18), `trench` (bar 22.5), `pullout` (bar 25.5). Headless checks cover typecheck, build, scope, simulation, occlusion, perf, and the audio trace; WSL2 cannot render WebGPU, so the nebula rim lighting, bloom-zero legibility of obsidian craft against the nebula, the barrel roll, and the orchestral mix need a human playtest first.
