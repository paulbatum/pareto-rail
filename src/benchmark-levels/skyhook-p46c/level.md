# Skyhook

A 60-second climb up a space elevator: start in the storm, punch the cloud deck, watch the sky run grey → sunlit blue → indigo → black while the music loses layers with the air, and cut the Tetherjack off the cable before the station irises open and swallows the car. Utilitarian hardware — white paneling, hazard orange, signal-green nav lights — against a sky that does all the coloring.

## Visual language
An altitude-driven sky dome (storm murk, sunlit horizon, thinning limb, starfield), cloud decks the car physically punches through, rain that thins into falling orange debris, a straight tether with white collars and beat-synced strobes whipping past, a white climber deck with hazard chevrons at the bottom of frame, and a station that irises open overhead at the end. Hostiles are storm-grey chitin with pale cores; the player owns desaturated signal green; only hardware (and the beast that eats it) wears hazard orange. Letters are white service panels with orange rims.

## Musical language
128 BPM, 32 bars = exactly 60 s, A minor leaning airy (Am9–Fmaj7–Cadd9–Gsus). The arrangement is scored the way the air behaves: wide wind bed, breathy pads, and a loose breakbeat in the storm, then each 8-bar phrase strips layers until the vacuum act is a heartbeat kick, a sub pulse, and glass bells — the player's kill-melody lane owns the top of the register. Docking (bars 28–32) decays to a pad, a chime figure, and one soft final clamp thump. Thunder one-shots share authored bars with the lightning flashes.

## Mechanical signature
A 4-point hull that is the climber car itself: grapplers swing up from below the deck, latch onto visible pylons at the bottom of the screen, and bite the hull until shot off. Kites ride gusty crosswinds, vane rotors wheel in formations, darts strafe in hard three-phase dashes, armored bulwarks close in with shearable panel cages. The Tetherjack latches onto the tether 260 m overhead at bar 18 and climbs down hand-over-hand, one lurch per bar, hurling collar rivets — kill it through two carapace stages before it reaches the car or it rides the hull and tears pieces off. Variable climb speed: cloud-break and thin-air surges, hard deceleration into the dock.

## What to read
- `src/benchmark-levels/skyhook-p46c/gameplay.ts`
- `src/benchmark-levels/skyhook-p46c/ripper.ts`
- `src/benchmark-levels/skyhook-p46c/audio.ts`
- `src/benchmark-levels/skyhook-p46c/timing.ts`
- `src/benchmark-levels/skyhook-p46c/visuals/index.ts`
- `src/benchmark-levels/skyhook-p46c/visuals/environment.ts`

## Status & notes
Benchmark submission built to the standing brief. Passes typecheck, build, and the floor gate headlessly; WebGPU rendering could not be verified in this environment — a human playtest should check the sky-dome arc, the cloud-break punch at bar 8, boss legibility during its descent, and the docking decel. The climb is a straight axis pitched 62°; all "down" cues (rain, debris, cloud decks, horizon) use the axis, so it reads as vertical.
