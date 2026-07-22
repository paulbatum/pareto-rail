Implemented the complete Hull Run showcase level.

Highlights:

- 63.3-second, 38-bar run at 144 BPM.
- 97 authored targets across skimmers, sentries, interceptors, mines, hostile shells, and a three-stage bow turret.
- Procedural warship hull, plates, hatches, bulkheads, antenna masts, progressive running lights, and bow drop-off.
- Martial industrial score with escalating percussion, machinery bass, klaxons, transport-quantized actions, and melodic kill lanes.
- Full event feedback, procedural LAUNCH/REARM glyphs, four-point hull, callouts, scoring, ranks, and run details.
- Registered level and regenerated gallery documentation.

Key files: [index.ts](/tmp/raild-run-rah3o96wxqcw/src/levels/hull-run-ns5n/index.ts), [gameplay.ts](/tmp/raild-run-rah3o96wxqcw/src/levels/hull-run-ns5n/gameplay.ts), [audio.ts](/tmp/raild-run-rah3o96wxqcw/src/levels/hull-run-ns5n/audio.ts), [visuals/index.ts](/tmp/raild-run-rah3o96wxqcw/src/levels/hull-run-ns5n/visuals/index.ts).

Verified:

- `npm run typecheck`
- `npm run build`
- `npm run check:scope -- hull-run-ns5n HEAD`
- `npm run check:floor -- --level hull-run-ns5n`
- `npm run simulate -- --level hull-run-ns5n`
- `npm run trace:audio -- --level hull-run-ns5n`
- Zero occlusion, performance, audio-configuration, or event-coverage failures.

A human WebGPU playtest remains necessary to assess the final percussion/klaxon mix, bloom-zero contrast, low-deck speed sensation, and turret vent readability.