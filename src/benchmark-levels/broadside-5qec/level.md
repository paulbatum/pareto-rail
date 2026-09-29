# Broadside

Sixty seconds across a chaotic fleet battle, launched off your own flagship into cyan and crimson crossfire against a magenta-and-gold nebula. Bank between kilometer-long cruisers, skim a friendly broadside, rake an enemy belly, then break the far flagship's shields and dive through its armored trench. Victory pulls the camera back until the whole engagement fits in the frame.

## Visual language
Ice-white friendly hulls and cyan engines oppose obsidian enemy armor, molten-orange seams, and crimson fire. Procedural faceted cruisers carry bridges, hangars, engine banks, broadside batteries, running lights, and panel seams. Instanced fittings keep the fleet affordable. A vertex-colored spherical nebula backlights the battle in all directions. Naval instrument plaques carry 5×7 START/REPLAY lamps, acquisition brackets mark locks, six reticle arcs count the volley, and kills burst into metal fragments and expanding shock fronts. Every target and instrument remains geometric at bloom zero.

## Musical language
128 BPM, 32 bars, exactly 60 seconds. An original D-minor space-opera march uses synthesized bowed strings, filtered horn and brass choirs, tuned timpani, orchestral snare, and cymbal swells in a procedural hall. Crossfire gains fast string ostinati; the cruiser pass carries the fullest brass statement; the eye of the battle drops to a whisper before the shield assault. The trench doubles the strings and percussion, and a successful flagship break resolves the fleet panorama to D major. Actions snap to the transport, locks retune to live harmony, staged core hits intensify, and chained kills play written high-register melodic lanes above the orchestra.

## Mechanical signature
Five hull points; fast lateral darts, rotating helical fighters, slow bobbing twin-engine bombers, and rooted belly turrets have different silhouettes and movement. Bombers, batteries, and shield generators launch interceptable converging crimson bolts. Four three-lock shield generators are physically seated along the flagship's side; destroying all four unlocks three power systems in its trench, each with two two-hit stages. Six-target clean volleys earn a formation bonus. Destroying the power systems breaks the flagship and scatters its escorts; a failed strike ends in withdrawal with explicit objective counts.

## What to read
- `src/benchmark-levels/broadside-5qec/index.ts`
- `src/benchmark-levels/broadside-5qec/gameplay.ts`
- `src/benchmark-levels/broadside-5qec/audio.ts`
- `src/benchmark-levels/broadside-5qec/audio-voices.ts`
- `src/benchmark-levels/broadside-5qec/visuals/index.ts`
- `src/benchmark-levels/broadside-5qec/visuals/environment.ts`
- `src/benchmark-levels/broadside-5qec/visuals/models.ts`

## Status & notes
Showcase build. Typecheck, production build, simulation, audio tracing, target occlusion, performance, and the floor gate pass. Public hero, overview, and START captures are wired through the descriptor; bloom-zero gameplay captures were also reviewed. Inspection moments: launch 2s, crossfire 8s, broadside 16s, belly 23s, eye 30s, shields 37s, trench 49s, panorama 58s. Human WebGPU review should first check the bank/corkscrew feel, target contrast against the nebula at bloom zero, shield-generator acquisition windows, and orchestral mix balance. Snapshot fallbacks and semantic audio tracing support self-review but cannot confirm the hardware mix and final motion quality.
