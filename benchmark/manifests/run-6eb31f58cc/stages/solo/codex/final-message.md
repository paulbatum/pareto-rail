Implemented `Thermal Ink` as a complete 60-second benchmark level.

- Added procedural boss gameplay, harbor environment, ink blackouts, infrared mode, enemies, effects, music, and scoring.
- Added descriptor and showcase assets:
  - [level.json](/tmp/pareto-rail-run-6eb31f58cc/src/benchmark-levels/thermal-ink-8448/level.json)
  - [level.md](/tmp/pareto-rail-run-6eb31f58cc/src/benchmark-levels/thermal-ink-8448/level.md)
  - `public/level-content/thermal-ink-8448/{hero,overview,start}.avif`
- No registry or shared files were modified.

Verification passed: typecheck, production build, floor gate, spawn trace, audio trace, and manual scope audit. The formal scope command could not run because `scripts/benchmark/protocol.mjs` is missing from the checkout.