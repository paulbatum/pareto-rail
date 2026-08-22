# Speedsolve

A 60-second, one-continuous boss fight against a colossal twisting puzzle cube hanging in a pale void. The rail is a long helix around the cube's flight axis, so the camera genuinely revolves around the puzzle while it solves it: shoot the glowing cells to snap layer rotations on the beat, drop each single-color face into a shower of loose cubies, kill the machinery weakpoint beneath, and the rail swings you around to the next face. Six faces down, the shell falls away entirely and the naked core spins up for the final barrage — bursting into a confetti storm of tiny cubes as the music resolves on the last phrase boundary.

## Visual language
The cube owns all six solve colours — red, orange, yellow, green, blue, violet — and everything else stays out of their way: a pale, softly lit void, white-and-grey machinery inside the shell (dark interior box, white struts, a heart glow that brightens as faces open), guide rings strung along the rail selling the helical orbit, weightless dust, and candy-tinted hazards — enemy fire wears the cube's own colours. START/REPLAY letters are built from the same white tiles with one solve-colour bracket per corner; locks charge from white through warm to the active face's colour.

## Musical language
128 BPM in A minor, 32 bars = exactly 60 seconds. Precise and mechanical: soft kick, cross-stick snare, an 8th-note clock tick that never stops, woodblock snaps as the backbeat, round sub bass, detuned-saw pads, machine-pluck arpeggios. Every solved cell plays a rising ratchet snap quantized to the transport grid — kills are notes drawn from per-section kill lanes over Am9–Fmaj9–Cmaj9–Em7. Each conquered face adds a groove layer (arp at two, hats at three, shakers at four, off-beat bass at five). The core finale strips to pulse and a spin-up riser, then ducks for a breath and resolves with swells, bells, and a cascading lead run.

## Mechanical signature
Six 3.5-bar solve windows, each with escalating cell counts (3–5) on deterministic scramble slots, spiral-in tetrahedra that fire interceptable homing bolts, fast-lapping octahedra, and prism strafing runs crossing the full frame. Clearing a face drops its nine tiles as loose cubies and exposes a two-lock weakpoint; killing it swings the cube to the next face immediately (early conquests compress the schedule). At bar 23 everything falls away: the core — a spinning gyro assembly in grey steel and candy tips — spins up, takes a six-hit barrage across three stages, and bursts. A 4-point hull; ranks from SCRAMBLED to WORLD RECORD based on faces solved, clear rate, and score.

## What to read
- `src/benchmark-levels/speedsolve-nfof/timing.ts`
- `src/benchmark-levels/speedsolve-nfof/solve-state.ts`
- `src/benchmark-levels/speedsolve-nfof/gameplay.ts`
- `src/benchmark-levels/speedsolve-nfof/audio.ts`
- `src/benchmark-levels/speedsolve-nfof/visuals/index.ts`
- `src/benchmark-levels/speedsolve-nfof/visuals/cube.ts`

## Status & notes
Built to the standing brief and the Speedsolve theme assignment as a one-shot showcase. Verified headless: typecheck, build, check:scope, simulate (all policies), occlusion, perf, and audio-config gates. WSL2 cannot render WebGPU, so the real frame and mix need a human playtest — check first that solved-cell snaps land on the beat, that face drops and swings read as one motion, and that the core burst lines up with the musical resolution at bar 30.
