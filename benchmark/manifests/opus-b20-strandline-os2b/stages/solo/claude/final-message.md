**Strandline** is built and committed at `src/benchmark-levels/strandline-os2b/`.

## What it is

A 60-second swim (96 BPM, 24 bars exactly) through the trailing strands of a jellyfish the size of a cathedral, taking parasites off it. Three enemy grammars — **clingers** that grip a strand and let go as you close, **swarmers** that braid across the full width of the water, and two-hit **borers** screwed into a strand spitting interceptable homing spores — plus a **parent organism** at the crown behind three sheets of its own webbing.

The boss idea from the theme is mechanical, not decorative: the parent is always lockable and never shootable while webbing lives. Releasing at it fires the rest of your volley and answers with a webbing slap (`validateRelease` returns the subset; a `shielded` event drives the visual/audio/callout). Three brood waves each feed one sheet; clear a wave and its sheet withers. Each brood that reaches you costs a hull point.

## Two authored camera moments

- **Bar 8–10**: a three-second hole is punched in the spawn timeline and the camera hands the frame to the animal — the bell fills the view.
- **On the killing blow**: the camera lets go of the rail entirely and falls back ~300 units with the lens widening and the fog lifting, until the whole animal is in frame for the first time.

## Verified headless

`typecheck`, `build`, `check:benchmark-scope` (18 paths, vs the pre-task baseline), and `check:floor` all pass with **zero warnings** — occlusion 0, perf gates 0 failures, centerness 0 warnings, full event coverage. `trace:audio` confirms the arrangement structure lands on its bars (swell at 20.1s, groan at 37.6s, bass entry at 10.1s). Simulation: perfect → S, seeded imperfect → B, no-fire → death at 45.8s.

## Things I fixed that are worth knowing about

- Strand cores are **additive** rather than solid. That's both the right look for translucent glowing tissue and why the forest never occludes a target.
- A real bug: `Object3D.lookAt` points **+Z** at the target, cameras point **−Z**. Both authored camera moments were aiming 180° wrong until the look dummy became a `PerspectiveCamera`. Worth remembering if you write similar code.

## What still needs human eyes

WSL2 can't render WebGPU, so all stills above are the SwiftShader/WebGL fallback — colour, bloom, and the entire mix are unconfirmed. Check first:

1. **Bloom at zero** — violet parasites against green strands. This is the readability risk; the palette deliberately reserves violet as the only wrong colour, but I couldn't verify contrast on real hardware.
2. **The bell's white core.** I trimmed rim and halo opacity twice and it still reads hot in the fallback renderer. It may want another pass down.
3. **The coda's 12-second quiet tail.** The simulator flags it as a gap. I believe it's the point of the ending, but a playtester may disagree.

One thing I chose not to chase: draw-call growth passes at 1.63× (+59.25 against a +64 allowance) after cutting strands 30→22. It's inside the gate but not comfortably — if the environment grows, that's the budget that breaks first.