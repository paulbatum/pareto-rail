# Tinker Ball

A lively, eccentric pop cleanup across an oversized, cluttered worktable under warm desk-lamp shadows. You are a rolling ball sent to clean up dark glue monsters that have stolen ordinary craft supplies. Defeating enemies shatters their dark adhesive cores, showering clean buttons, pins, erasers, and rulers onto the table, which physically stick to the ball as it sweeps through the debris. As the ball grows from marble to tennis-ball to melon scale, it charges straight into the heart of the Great Glue Spill to restore the tabletop to a spotless finish.

## Visual language
Warm desk-lamp lighting casting soft golden spotlights and long shadows across an expansive wooden worktable, self-healing green grid cutting mats, towering wooden ruler ramps, glass button jars, and giant scissor monuments. Enemies are hand-crafted supply creatures (button beetles, paperclip skitterers, pencil-leg walkers, clothespin snapping birds, paint-pot mortars) bound together by dark bubbling adhesive cores. The rolling player ball dynamically accumulates 3D craft supplies on its surface, visibly recording every rescued piece.

## Musical language
128 BPM bright, eccentric pop featuring bell-like mallets, clipped reed-organ stabs, rubbery synth bass, crisp handclaps, and tiny workshop percussion (woodblock ticks, thimble taps, ruler twangs). Player actions are fully quantized to the musical transport and pitched from the live C-major and boss harmony; melodic kill lanes turn 6-lock volleys into joyful marimba runs.

## Mechanical signature
A 60.0-second 32-bar run with a 5-point hull, scale progression across 3 distinct acts (marble, tennis-ball, melon), lockable hazard bead projectiles, and a multi-core Great Glue Spill boss with orbiting supply armor shields and a grand heart finale.

## What to read
- `src/benchmark-levels/tinker-ball-7umh/index.ts`
- `src/benchmark-levels/tinker-ball-7umh/gameplay.ts`
- `src/benchmark-levels/tinker-ball-7umh/audio.ts`
- `src/benchmark-levels/tinker-ball-7umh/audio-voices.ts`
- `src/benchmark-levels/tinker-ball-7umh/visuals/index.ts`
- `src/benchmark-levels/tinker-ball-7umh/visuals/player-ball.ts`
- `src/benchmark-levels/tinker-ball-7umh/visuals/enemies.ts`
- `src/benchmark-levels/tinker-ball-7umh/visuals/table-environment.ts`

## What to study here
Tinker Ball demonstrates how Katamari-style object accumulation and physical scale progression can be seamlessly integrated into a high-speed Rez-like rail shooter. Notice how enemy destruction detaches physical 3D supplies that scatter ahead of the rail, allowing the rolling ball to physically sweep through and stick the debris to its rotating hull.

The audio architecture uses live chord progression tracking, transport-quantized action SFX, and distinct melodic kill lanes tailored to each scale phase so that every release volley composes a melodic phrase.

## Status & notes
Complete benchmark level entrant featuring 5 distinct enemy types, multi-stage boss encounter, dynamic growing rolling ball mesh, 128 BPM pop score, and warm desk-lamp post-processing.
