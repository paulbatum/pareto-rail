Implemented the complete 60-second “Thermal Ink” benchmark level in [thermal-ink-sxom](/tmp/pareto-rail-run-v3sxomzehc/src/benchmark-levels/thermal-ink-sxom/index.ts).

Highlights:

- Continuous eight-arm octopus boss fight with scavengers, cable-eels, boiler spawn, four ink blackouts, and a twelve-hit final core.
- Infrared toggle via `E`, `I`, right-click, or double-click, changing materials, fog, lighting, post-processing, reticle feedback, and orchestration.
- Procedural 96 BPM industrial score with six sections and transport-quantized combat audio.
- Generated and inspected [hero](/tmp/pareto-rail-run-v3sxomzehc/public/level-content/thermal-ink-sxom/hero.avif), [overview](/tmp/pareto-rail-run-v3sxomzehc/public/level-content/thermal-ink-sxom/overview.avif), and [start](/tmp/pareto-rail-run-v3sxomzehc/public/level-content/thermal-ink-sxom/start.avif) AVIFs.

Verification passed:

- `npm run typecheck`
- `npm run build`
- `npm run check:floor -- --level thermal-ink-sxom` — zero warnings or failures
- Audio trace: 60 seconds, 96 BPM, 466 events, six sections
- Manual footprint audit: all 17 files are confined to the two permitted output roots

The official scope launcher could not start because the checkout lacks its imported `scripts/benchmark/protocol.mjs`; no shared infrastructure was modified. Final contrast, infrared mix balance, and boss-collapse feel still merit a human WebGPU/audio playtest.