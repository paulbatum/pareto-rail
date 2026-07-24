# Broadside

Sixty seconds across a fleet engagement. You launch off your own flagship's catapult deck into the gap between two battle lines, thread the crossfire in hard banks and one full corkscrew, run flat out down a friendly cruiser's flank while its main battery empties over your head, drop under an enemy warship and rake its turret line, and finish on the enemy flagship — six shield generators along its spine, then a trench dive to the exposed cores. Every hull is a silhouette rimmed in colored light against a magenta-and-gold nebula, and the sides read by color: ice-white and cyan is yours, obsidian and molten orange is theirs.

## Visual language
Backlit silhouettes. A vertex-coloured nebula shell (magenta low, gold high) sits behind twenty capital ships hung at deliberately wrong angles — the fleets are fighting, not parading. Your side is ice-white plate with cyan engine bells and cyan gunfire; the enemy is obsidian with molten seams, crimson optics and crimson gunfire. The signature image is the gunnery: kilometre-long tracers fired between hulls on the beat, muzzle bloom at one end and impact bloom at the other. Four structures are built by walking the rail itself, so they hug the flight path exactly — your launch trough, the enemy warship's ventral hull overhead, the flagship's dorsal spine below, and the trenchwork cut into it. Debris in vacuum never falls; a kill leaves an expanding shell of cooling plate. START/REPLAY are LAUNCH/AGAIN in recessed cyan deck lamps on ice-white armour plate.

## Musical language
144 BPM in D minor; 36 bars is exactly 60 seconds. A full synthesised orchestra — detuned saw string sections, a brass stack with a filter blat and a pitch scoop, tuned timpani, gran cassa, field drum, tam-tam, choir and cymbal swells. The dynamic arc is the story: one horn over timpani at launch, the whole band in the crossfire, the widest tutti on the flank run, then near silence under the enemy warship at bar 18 before it rebuilds; a Neapolitan flat second stalks the shield pass, the breach is the drop, and the last two bars land in D major. Locks, volleys, armour chips and kills are transport-quantised and pitched from the live chord, and each kill plays the written note for its step from a per-act horn lane — so a chained volley performs a melodic run that the orchestra's own horns begin doubling from the third kill.

## Mechanical signature
A 60-second, four-point-hull run with five hostile grammars: full-width slashing lances, corkscrewing wasps, two-hit picket gunboats that glide and shell you, rooted two-hit hull turrets you rake as the warship passes, and interceptable crimson flak. The enemy flagship is a two-phase boss on a musical deadline: six two-hit shield generators on a zigzag of pylons up its spine (bars 23–28), then three two-stage power cores in the trench (bars 30–34). The cores stay lockable throughout — but until every generator is gone the shield eats those shots, flares violet, and the volley is wasted. A clean six-kill release scores a 700-point broadside bonus. Rail geometry, camera roll and speed are all generated from the same score, including a full 360° corkscrew flown in the one deliberately empty window of the timeline.

## What to read
- `src/benchmark-levels/broadside-b7tm/timing.ts`
- `src/benchmark-levels/broadside-b7tm/gameplay.ts`
- `src/benchmark-levels/broadside-b7tm/flagship.ts`
- `src/benchmark-levels/broadside-b7tm/audio.ts`
- `src/benchmark-levels/broadside-b7tm/visuals/index.ts`
- `src/benchmark-levels/broadside-b7tm/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Broadside theme assignment. Inspection markers: `crossfire` (bar 4), `flank` (bar 12), `belly` (bar 18), `shields` (bar 23), `breach` (bar 28), `trench` (bar 30) and `victory` (bar 34). Verified headless: typecheck, build, benchmark scope, and the floor gate (simulation across all policies, target occlusion, headless performance, audio configuration). WSL2 cannot render WebGPU, so the real frame and the mix still need a human playtest — check first that the bar-12 corkscrew reads as a roll rather than a glitch, that the friendly broadside overhead lands on the downbeat, that the bar-18 drop to near silence under the warship belly feels like the eye of the battle, and that the violet shield block is unmistakably different from an ordinary rejection.
