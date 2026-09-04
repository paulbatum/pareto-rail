# Strandline

A sixty-second rescue inside the trailing strands of an immense jellyfish. Violet parasites loosen their grip as the player approaches; each kill sends green-gold light back into the animal. The rail curls into open water for a brief view of the bell, dives back between the tentacles, and climbs to the infested crown. Free the parent organism from its brood-fed webbing, tear it loose, and watch the whole jellyfish emerge during a long, serene pullback.

## Visual language
Clear turquoise water falls into deep ocean blue. A scalloped translucent bell, forty radial nerves, four internal organs, eight frilled oral arms, and fifty-two swaying tentacles form one continuous animal. Green-gold light belongs to the jellyfish and player; sour violet shells and pale pink organs identify parasites. Locks gather golden rings, volleys leave luminous threads, and kills dissolve into rising motes. START and REPLAY grow as bright five-by-seven glyphs inside hanging leaf membranes.

## Musical language
96 BPM, twenty-four bars, exactly sixty seconds. A quiet half-time water pulse and soft chord clouds gain brushed percussion and glass tones as the animal recovers. The wide bell reveal opens the harmony; the crown introduces a denser heartbeat. Locks, releases, and impacts snap to the transport and follow the live chord, while kills walk written melodic lanes. The parent's death ducks the pulse and resolves D minor into a suspended D-major coda with a descending glass figure.

## Mechanical signature
Five hull points and three ordinary parasite motions: hooked lice detach and lunge diagonally, ribbon parasites undulate across the current, and two-hit spiny cysts rise in pulses before closing. Three successive broods sustain three web sectors at the crown. Each sector dies only when all three parasites feeding it are killed; missing targets cannot open the parent. The exposed parent has two three-hit stages, and must be removed before 52.5 seconds to leave room for the final rescue view. Six-target clears earn a 750-point current-of-light bonus. Right-click undoes a lock.

## What to read
- `src/benchmark-levels/strandline-b4d3/index.ts`
- `src/benchmark-levels/strandline-b4d3/gameplay.ts`
- `src/benchmark-levels/strandline-b4d3/world.ts`
- `src/benchmark-levels/strandline-b4d3/audio.ts`
- `src/benchmark-levels/strandline-b4d3/visuals/index.ts`
- `src/benchmark-levels/strandline-b4d3/visuals/environment.ts`
- `src/benchmark-levels/strandline-b4d3/visuals/models.ts`

## Status & notes
Showcase build for the directory-only benchmark contract. Inspection markers: firstLight, greenMoon, returnToTheStrands, crown, lastBrood, release, and drifting. Human WebGPU review should first check strand-threading and bank comfort, parasite contrast with bloom disabled, whether the three broods clearly feed separate web sections, and the balance between player melody and the underwater pulse.

Automated review covers the sixty-second duration, all gameplay events, target spread, occlusion, performance, and score configuration. The perfect simulation clears 55/55 targets; the seeded imperfect simulation clears 54/55. Two browser-driven runs complete with matching scores and a successful rescue. The audio trace contains 96 beats; a rendered mix stress check peaked at approximately -3.3 dBFS with no clipped samples. Gameplay captures and bloom-zero inspection use the visual tools' WebGL fallback; native WebGPU motion and the final sound balance still require a human playtest.

Public images use seed 424242 and full postprocessing: hero at 17.5 seconds, overview at 2/24.8/44.8/57.5 seconds, and the attract screen at 0.8 seconds.
