# Skyhook

A 64-second climb up a space-elevator tether, escorting a climber car from a storm at the base to the orbital station at the top of the sky. The sky does the coloring — storm grey, sunlit blue, indigo, black — while the score sheds layers with the thinning air, and a huge grinder-machine latches onto the tether above and hauls itself down toward the car.

## Visual language
Utilitarian white paneling and hazard orange against a sky that climbs from storm grey through sunlit blue and indigo to starfield black; gunmetal enemies with signal-red and amber cores, wind-angled rain, a punched cloud deck, a curving planet limb, debris streaking down, cargo-stencil letters, and a station aperture that swallows the car.

## Musical language
112 BPM in airy E-flat lydian; wide wet pads and a full kit in the storm, a hopeful lift above the cloud deck, then the arrangement strips to rim ticks and a lone bell as the air thins. The Lamprey brings groan-bass menace under the emptiness; docking resolves to heartbeat, airlock hiss, and one warm swell. Locks, volleys, and kills are pitched from the live harmony, with per-section kill-melody lanes.

## Mechanical signature
A 64-second run with a 4-point hull that is the climber car itself: squall kites, strafing darts, tether leeches that latch on and chew the car, vacuum wasps with interceptable bolts, a three-stage Lamprey boss descending the tether on a hard deadline, and a final six-lock sweep that lights the docking ring.

## What to read
- `src/levels/skyhook-lkor/timing.ts`
- `src/levels/skyhook-lkor/gameplay.ts`
- `src/levels/skyhook-lkor/lamprey.ts`
- `src/levels/skyhook-lkor/audio.ts`
- `src/levels/skyhook-lkor/visuals/index.ts`
- `src/levels/skyhook-lkor/visuals/environment.ts`

## Status & notes
Built to the standing brief and the Skyhook theme assignment as a one-shot showcase. Verified headless: typecheck, build, check:scope, simulate (all policies), trace:audio, occlusion, and perf gates. WSL2 cannot render WebGPU, so the real frame and the mix need a human playtest — check first that the cloud punch reads at bar 8, that the Lamprey's descent is legible dead-ahead on the tether, and that the docking-ring finale lands.
