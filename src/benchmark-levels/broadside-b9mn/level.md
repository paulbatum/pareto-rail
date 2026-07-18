# Broadside

Sixty seconds across a full fleet engagement: catapult off your own flagship's deck, bank through the crossfire between kilometer-long cruisers, run a friendly cruiser's flank while its broadside fires over your canopy, coast through the dead eye of the battle, rake an enemy keel's turret line — then take the enemy flagship apart in two passes, shield generators first, power cores in the trench second, and pull out with the whole burning line in frame.

## Visual language
A magenta-and-gold nebula backlights everything, so every hull reads as a silhouette rimmed in colored light and the sides read by signal color: the fleet is ice-white with cyan engine glow and cyan fire; the enemy is obsidian streaked with molten orange, firing crimson. Capital tracer lanes cross the sky with chase pulses, distant flak flickers through the battle volume, wreckage drifts in the eye, and the flagship carries a visible magenta shield film whose collapse is phase one's payoff. Locks charge cyan to cold white; letters are flight-deck plates with cyan light strips.

## Musical language
144 BPM in D minor, 36 bars = exactly 60 seconds, scored like space opera: timpani and iron snare drive a low-string ostinato under horn swells; the broadside run is the brass-and-trumpet peak; the eye strips to strings and one glass bell; the flagship acts turn dark and martial and the trench hammers toward the deadline. Locks, shots, chips, and kills are transport-quantized notes from the live chord with per-act kill-melody lanes; killing the last core ducks the orchestra and lands the victory theme in D major.

## Mechanical signature
A 60-second, 3-hull run with variable rail speed (catapult surge, broadside sprint, near-stop in the eye, trench dive): crescent darts cross the full frame in corkscrewing packs, forked lancers swoop to posts and fire interceptable crimson bolts, two-stage keel turrets deploy overhead, and hex-frame escorts corkscrew in around the rail. The flagship is fought in two passes — four shield generators under point defense, then three two-stage power cores in the trench; a clean generator sweep is the player's shield kill, and the last core decides victory. A full six-kill release pays a broadside bonus.

## What to read
- `src/benchmark-levels/broadside-b9mn/timing.ts`
- `src/benchmark-levels/broadside-b9mn/gameplay.ts`
- `src/benchmark-levels/broadside-b9mn/flagship.ts`
- `src/benchmark-levels/broadside-b9mn/audio.ts`
- `src/benchmark-levels/broadside-b9mn/visuals/index.ts`
- `src/benchmark-levels/broadside-b9mn/visuals/environment.ts`

## Status & notes
Built to the standing brief from the Broadside theme assignment. Verified headless: typecheck, build, benchmark scope, and the floor gate (simulation, occlusion, perf). WSL2 cannot render WebGPU, so the real frame and the mix need a human playtest — check first that the launch catapult reads, that the friendly broadside firing overhead lands at bar 11, that silhouetted hulls stay legible with bloom at zero, and that the last-core kill's duck into the D-major victory theme feels like the win.
