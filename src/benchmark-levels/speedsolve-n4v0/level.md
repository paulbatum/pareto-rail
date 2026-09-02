# Speedsolve

A sixty-second boss fight against a colossal twisting puzzle cube hanging in a pale void while the rail orbits it. Each four-bar window presents one face; a flurry of layer snaps scrambles a handful of wrong stickers into targets, and every kill snaps a layer back on the eighth-note grid until the face is one colour and falls away in a shower of loose cubies, exposing the gear hub underneath. Six faces down and the shell blows off around the naked core.

## Visual language
The cube owns the six candy solve colours — red, orange, yellow, green, blue, violet — on grey rounded cubies with dark seams; everything else stays out of their way. A pale, softly lit void with a white gantry ring and drifting motes; white-and-grey machinery under every fallen face (frames, gear rings, axle hubs) and a white-hot core in a wire cage. Letters are words spelled in graphite cubies; the reticle is a sticker outline; the player's light is hot white. The swarm — tetrahedra, octahedra, triangular prisms — wears the cube's colours and fires loose cubies back.

## Musical language
120 BPM, exactly 30 bars: a locked, mechanical kit built from clicks and tuned thocks so the drums and the cube's snaps are one instrument. Every layer rotation the player causes lands on the transport's eighth grid via a shared snap clock; kills walk per-section melody lanes over a rising C major progression, locks tick a pentatonic climb, and each hub destroyed adds a layer to the arrangement on the next bar. The finale sits on a dominant pedal that only resolves — sub drop, C major bloom, confetti chimes — when the core bursts.

## Mechanical signature
A 3-point hull and an orbiting camera whose look is authored around the cube. Wrong stickers are one-lock targets that ride the face as it turns; hubs take three locks and pay a speed bonus for early solves; the core is a staged target (armour from any unsolved faces, then a four-hit cage, then a six-hit heart) whose death ends the run on the cadence. Darts sweep, orbiters ring the face, gunners lunge and shoot interceptable homing cubies.

## What to read
- `src/benchmark-levels/speedsolve-n4v0/timing.ts`
- `src/benchmark-levels/speedsolve-n4v0/cube.ts`
- `src/benchmark-levels/speedsolve-n4v0/gameplay.ts`
- `src/benchmark-levels/speedsolve-n4v0/orbit.ts`
- `src/benchmark-levels/speedsolve-n4v0/audio.ts`
- `src/benchmark-levels/speedsolve-n4v0/visuals/index.ts`
- `src/benchmark-levels/speedsolve-n4v0/visuals/cube-mesh.ts`

## Status & notes
Built to the standing brief from the Speedsolve theme assignment. Verified headless: typecheck, build, check:benchmark-scope, check:floor (simulation, occlusion, perf, audio config), trace:audio, and SwiftShader gameplay stills. Inspection markers: `face1`…`face6` (bars 0, 4, 8, 12, 16, 20), `finale` (bar 24), `lastStretch` (bar 28). The bloom config compensates for the shared post pass handing `threshold`/`radius` to three's `bloom()` in swapped order; if that engine call is ever corrected, swap the two values in `index.ts`. WSL2 cannot render WebGPU, so a human playtest should first confirm the layer snaps land audibly on the eighth grid with the click track, that armed stickers and their white frames read against the pale void with bloom at zero, and that the shell blow at bar 24 and the core burst land with enough weight.
