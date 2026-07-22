Implemented the complete `mass-driver-7rkv` showcase level.

Highlights:

- Exact 60-second run: 36 bars at 144 BPM.
- 144 accelerator rings positioned from the acceleration curve—one crossing per beat.
- Skimmers, helical weavers, armored clamps, and six staged safety interlocks.
- Successful launch and fatal containment-failure outcomes.
- Procedural rising railgun hum, hypnotic pulse, live harmony, and kill-melody lanes.
- Full event effects, procedural glyphs, custom reticle, camera feedback, metadata, registry entry, and gallery card.

Key files: [index.ts](/tmp/raild-run-qsgvgteqxgn0/src/levels/mass-driver-7rkv/index.ts), [gameplay.ts](/tmp/raild-run-qsgvgteqxgn0/src/levels/mass-driver-7rkv/gameplay.ts), [audio.ts](/tmp/raild-run-qsgvgteqxgn0/src/levels/mass-driver-7rkv/audio.ts), [visuals/index.ts](/tmp/raild-run-qsgvgteqxgn0/src/levels/mass-driver-7rkv/visuals/index.ts).

Verified:

- `npm run typecheck`
- `npm run build`
- `npm run check:floor -- --level mass-driver-7rkv`
- `npm run simulate -- --level mass-driver-7rkv --heatmap`
- `npm run trace:audio -- --level mass-driver-7rkv`
- Scope check against the starting `HEAD`
- Perfect simulation: 73/73 kills, no dead air, no occlusion or performance failures

Visual contact sheet: [mass-driver-7rkv-thumbnails-4-8s-to-55s-full.png](/tmp/raild-run-qsgvgteqxgn0/snapshots/gameplay/mass-driver-7rkv-thumbnails-4-8s-to-55s-full.png).

The default `main`-based scope check detects unrelated pre-existing benchmark branch changes; the level’s own diff is correctly scoped. Human playtesting should focus on ring/beat synchronization, rising-hum balance, bloom-zero readability, and the final silence after launch.