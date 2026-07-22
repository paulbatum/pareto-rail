Implemented the complete 60-second “Hull Run” showcase level and made it the default picker entry.

Highlights:

- Three distinct drone classes, interceptable shells, four-point hull, and full-screen choreography.
- Waking gunmetal deck with running lights, hatches, bulkhead ridges, and close-passing masts.
- Three-stage bow turret with volley/vent vulnerability cycles.
- Procedural 144 BPM martial-industrial score with live harmony and melodic kill lanes.
- Custom LAUNCH/REARM glyphs and responses for every gameplay event.
- Final turret wreckage phrase followed by flight into open space.

Key files: [index.ts](/tmp/raild-run-x58xikqvx62i/src/levels/hull-run-cvs3/index.ts), [gameplay.ts](/tmp/raild-run-x58xikqvx62i/src/levels/hull-run-cvs3/gameplay.ts), [audio.ts](/tmp/raild-run-x58xikqvx62i/src/levels/hull-run-cvs3/audio.ts), [visuals](/tmp/raild-run-x58xikqvx62i/src/levels/hull-run-cvs3/visuals/index.ts), and [level.md](/tmp/raild-run-x58xikqvx62i/src/levels/hull-run-cvs3/level.md).

Verified:

- `npm run typecheck`
- `npm run build`
- `npm run check:floor -- --level hull-run-cvs3`
- Scope check against the current workspace baseline
- Perfect simulation: 60/60 kills, turret destroyed
- Spawn and audio traces
- Model and four-point gameplay captures

The floor gate passes with no occlusion, performance, audio, or event-coverage failures. It retains advisory warnings for average destruction distance and center concentration. WebGPU visuals and the final audio mix still merit a human playtest.