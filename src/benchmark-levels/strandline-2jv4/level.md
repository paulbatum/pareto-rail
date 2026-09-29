# Strandline

A sixty-second swim through the trailing forest of a gigantic jellyfish. Violet parasites unhook themselves from its living strands as you close in. A wide turn reveals its bell like a green moon; return through the glowing skirt, clear the crown's broods, and tear the parent loose before the camera pulls back to show the entire clean animal drifting on.

## Visual language
Clear teal water recedes into deep blue. Scalloped translucent bell tissue, gold radial canals, curling oral arms, beaded green tentacles, sun shafts and drifting plankton form a single procedural organism. Parasites alone carry sour violet: hooked clamps, leaf-shaped skates, spiny spores, and crown larvae. Locks gather pale gold light and kills send green recovery ripples through the forest. Pearl-cell 5×7 START! and REPLAY glyphs stay legible without bloom.

## Musical language
96 BPM, 24 bars, D Dorian moving into a suspended D-major resolution. A low heartbeat and soft submerged chord bed gain breath percussion, round bass, and brighter flowing bells as the jelly returns to life. The wide bell reveal opens a two-bar space in the arrangement. Player locks and fire snap to the transport; kills perform written per-section melody lanes in the live harmony. The parent's chips grow in register and brightness, and its removal ducks the pulse for an ascending resolving figure.

## Mechanical signature
Four-point hull; attached clamps that unhook and lunge, banking skates that sweep sideways, and spores that circle and tumble. Broad off-center formations culminate in two four-larva broods at the crown. Each destroyed larva starves its web; missed larvae regrow rather than opening the shield. Only eight brood kills expose the two-stage, six-hit parent. Full six-kill volleys earn a musical flourish and formation bonus. Right click removes a lock.

## What to read
- `src/benchmark-levels/strandline-2jv4/index.ts`
- `src/benchmark-levels/strandline-2jv4/gameplay.ts`
- `src/benchmark-levels/strandline-2jv4/audio.ts`
- `src/benchmark-levels/strandline-2jv4/visuals/index.ts`
- `src/benchmark-levels/strandline-2jv4/visuals/environment.ts`
- `src/benchmark-levels/strandline-2jv4/visuals/models.ts`

## Status & notes
Inspection markers: forest (5s), moon (22s), return (28s), crown (40s), release (54s). Built to the directory-only benchmark contract. Verified typecheck, production build, benchmark scope, floor gates, simulation, and semantic audio trace. The perfect policy clears all 50 targets; the imperfect policy finishes with the parent removed. Gameplay captures include bloom-zero START, the crown, and a successful REPLAY frame. Headless captures use the tools' reduced renderer; final WebGPU appearance and audio balance require a human run, especially strand clearance, brood-to-parent timing, and the long final pullback. Public content images are procedural gameplay captures with seed 424242.
