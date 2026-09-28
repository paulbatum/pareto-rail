# Broadside

A sixty-second fighter run through a full fleet engagement: launch off the deck of your own flagship into the middle of a battle between kilometer-long cruisers, fly the gaps, run a friendly cruiser's flank as its guns light off overhead, rake an enemy warship's belly, then break the enemy flagship's shield, loop over its shoulder, and dive its trench to the reactor. When the last core blows the camera pulls out over both fleets while the enemy line burns and scatters. Everything is silhouetted against one enormous magenta-and-gold nebula.

## Visual language
Backlight is the whole idea: every hull is near-black on the face that looks at you and rimmed in nebula gold and magenta on the faces that turn away. The fleet is ice-white with cyan engines and cyan fire; the enemy is obsidian streaked with molten orange and fires crimson; the player's reticle, locks, and shots are cold cyan-white so they can never be lost against the warm enemy palette. Nineteen procedural capital ships (baked-light vertex-color hulls with stepped decks, gun batteries, plating, and lit windows) are static world geometry; the rail threads their gaps. Ship-to-ship tracers, hull impacts, dust streaks, and dogfighting swarms are instanced. The flagship wears an energy shield that visibly collapses, a dorsal trench of buttressed machinery, and splits in two when destroyed. Letters are flight-deck signal plates (ENGAGE / REARM). Everything stays readable with bloom at zero.

## Musical language
128 BPM, 32 bars, exactly 60 seconds: space opera for brass, strings, and timpani, C minor turning to C major. Theme A (G-G-C-Eb) rises through the crossfire; the broadside is a big open theme over Ab-Eb-Bb; the eye of the battle drops the orchestra 18 dB to a solo horn, a sparse harp, and a heartbeat; the belly is a minor-second menace under a snare that wakes bar by bar; the flagship is a dread march; the trench strips to a climbing timpani roll; and the victory theme is Theme A in the major over a gong and choir. Locks pluck glass-harp arpeggios up the live chord, a full volley lands like a brass stab with timpani and cymbal, kills play a written bell lane per section in the current harmony, generator and core kills hit in tutti, and the reactor's death ducks the orchestra for a breath before the finale lands on the next downbeat.

## Mechanical signature
Four hull pips and eight target kinds with distinct silhouettes and motion: needle darts that strafe and weave, ring-winged rakers that corkscrew, lumbering wasp bombers that lob interceptable crimson plasma, hull-rooted belly and point-defense guns that track you, shutter-caged shield generators that unseal one at a time, trench reactor cores, and a two-stage reactor heart. Plasma bolts converge on the cockpit and brake there; shoot them down or take the hit. The rail is a monotone-spline speed curve hitting authored boundaries: a slow launch, a fast flank, a held breath in the eye, a swooping loop over the flagship's shoulder, and a decelerating dive to the reactor. Break all four generators to drop the shield; the flagship's escorts pour out as the rail comes around; the reactor falls to the fleet's fire at bar 29 if you have not finished it, and the run always ends in victory unless you die first.

## What to read
- `src/benchmark-levels/broadside-tllu/index.ts`
- `src/benchmark-levels/broadside-tllu/battlefield.ts`
- `src/benchmark-levels/broadside-tllu/gameplay.ts`
- `src/benchmark-levels/broadside-tllu/audio.ts`
- `src/benchmark-levels/broadside-tllu/camera.ts`
- `src/benchmark-levels/broadside-tllu/visuals/index.ts`

## Status & notes
Showcase build. Inspection markers: `launch` (bar 0), `crossfire` (bar 2), `broadside` (bar 9), `eye` (bar 15), `belly` (bar 17.5), `flagship` (bar 21), `escorts` (bar 24), `trench` (bar 26), `victory` (bar 29). Automated checks cover simulation, target occlusion, headless performance, and audio configuration; visuals were inspected through the SwiftShader fallback only. A human WebGPU playtest should first check the heart-to-finale timing, the camera bank through the corkscrew, bloom-zero enemy contrast, and the mix around the eye.
