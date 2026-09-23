# Broadside

Catapulted off the deck of your own carrier into the middle of a fleet engagement: kilometer-long hulls slugging it out in no neat formation, swarms knotted through the gaps, the whole battle backlit by a vast magenta-and-gold nebula. Sixty seconds across the engagement — through the crossfire, down a friendly cruiser's flank as her broadside fires overhead, under an enemy warship's keel, and into the enemy flagship — scored like space opera.

## Visual language
Every hull is a silhouette rimmed in nebula light. Our fleet is ice-white with cyan engines and cyan fire; the enemy is obsidian veined with molten orange and fires crimson — cyan always means ours, crimson always means theirs. Capital ships are procedural lofted hulls (carrier flight deck with chase lights, gun-deck overhang, flat paneled keel, a trench-cut dreadnought with a Voronoi shield), distance-hazed into the nebula so their scale reads. Ambient battle: camera-scaled tracer crossfire, distant knotted dogfights, hull impacts, flak blooms, tumbling wreckage in the eye. Targets are obsidian craft outlined in molten edges (legible with bloom off); letters are gunmetal hull plates with cyan running-light edges; the reticle is a six-arc gunsight that fills per lock.

## Musical language
136 BPM, 34 bars in D minor for a synthesized orchestra — detuned-saw strings, horns, blatty trumpets, trombones, tuned timpani, gran cassa, cymbals, choir, harp. The catapult fires on the bar-1 downbeat with a crash; the theme (i–VII–VI–V) enters in the horns; the broadside run puts VALIANT's cannons on every beat, rippling like her batteries; the eye drops to a held harmonic and a far choir; the keel is Phrygian low brass; the shield collapses on an orchestral hit; the trench drives to a timpani roll; the victory theme lands in D major (or the score sags unresolved if the flagship escapes). The player is the soloist: locks pluck up the live chord, each shot of a volley is a horn blat on the next chord tone so a release ripples like a broadside, and kills play a per-section melody lane in a trumpet-over-bell voice (celesta in the eye, muted under the keel).

## Mechanical signature
A 60-second, five-hull run with a flown (integrated) rail that banks into turns and corkscrews twice through the gaps. Swarm craft: darts stream across the screen in echelon, ring-wings braid around drifting axes (and hold a world-fixed ring you sweep in a circle during the corkscrews), lancers overtake from behind and fire interceptable crimson bolts on the beat, torpedo bombers make three-hit runs at VALIANT's hull. Hull-mounted: belly turrets you rake as the keel passes overhead, four two-stage shield generators on the flagship's flank under point-defense fire, and three two-stage power cores in the trench. Volleys fire as a sixteenth-note ripple; a full six-kill volley is a "full broadside" and the fleet answers with a salvo. Destroy all three cores and the camera pulls out past the breaking flagship as the enemy line burns; miss one and the flagship escapes. START/REPLAY are SORTIE/REARM.

## What to read
- `src/benchmark-levels/broadside-hmvp/flight.ts`
- `src/benchmark-levels/broadside-hmvp/setpieces.ts`
- `src/benchmark-levels/broadside-hmvp/gameplay.ts`
- `src/benchmark-levels/broadside-hmvp/camera.ts`
- `src/benchmark-levels/broadside-hmvp/audio.ts`
- `src/benchmark-levels/broadside-hmvp/audio-voices.ts`
- `src/benchmark-levels/broadside-hmvp/visuals/index.ts`
- `src/benchmark-levels/broadside-hmvp/visuals/environment.ts`
- `src/benchmark-levels/broadside-hmvp/visuals/ships.ts`

## Status & notes
Built to the standing brief from the Broadside theme assignment. Inspection markers: `catapult` (bar 1), `broadside` (bar 8), `eye` (bar 14), `belly` (bar 16), `flagship` (bar 20), `shieldsDown` (bar 24), `trench` (bar 26), `victory` (bar 30). WSL2 cannot render WebGPU headless, so the frame and the orchestral mix need a human playtest — check first the silhouette/rim read of the hulls against the nebula with bloom at zero, the cannon-on-the-beat sync of VALIANT's salvos, and that the pull-out lands on the victory theme.
