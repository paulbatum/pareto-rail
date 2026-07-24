**Speedsolve is built and passes every gate.** The level lives entirely in `src/benchmark-levels/speedsolve-q7ld/` (plus the regenerated `docs/level-gallery.md`), and `check:benchmark-scope` confirms the footprint is valid.

## What the level is

One continuous boss fight against a colossal corner-up puzzle cube in a softly lit pale void, at 128 BPM where 32 bars = exactly 60.0 seconds:

- **Six identical 4-bar face rituals** (bars 0–24): four glowing solve squares arm on the face; destroying one snaps a real layer rotation onto the next beat — the eight outer tiles physically ratchet 90° while changing tiles flip like reversi chips. The color states are generated *backwards from uniform*, so any kill order provably walks the face toward a single color. A solved face sheds all nine tiles in a shower; an unsolved one has its hatch forced at the beat-10 deadline. Either way a two-lock weakpoint emerges from the machinery, and the rail then snaps 90° around an edge in exactly two beats.
- **Waves** of candy tetrahedra (diving runs), octahedra (beat-quantized hop gunners firing interceptable bolts in the cube's own colors), and prisms (full-width strafers) keep pressure on a 3-point hull.
- **Finale** (bars 24–30): the six shells blast off, the naked core (3 hit stages, flinch gates) spins up inside a gyro ring cage, and killing it bursts 400+ six-color confetti cubes with a music-box resolution; failing, it seals itself away for a powered-down coda.
- **Music**: the cube *is* the percussion — every drum is a click, snap, or ratchet, and the arrangement adds one layer per face (clock → kick → hats/snap → sequencer → lead → full machine), turns minor for the core, and resolves conditionally. All player actions are transport-quantized notes on the live chord with per-section kill-melody lanes. Start word is `SOLVE!`, letters are sticker-cubie plates, one solve color per glyph.

## Verified headless

- `typecheck`, `build`, `check:scope` — pass.
- `check:floor` — **all gates green, zero warnings**: 7 enemy kinds, full event coverage, occlusion 0 warnings, perf gates clean, no centerness/distance warnings (avg kill distance 27 m, wide heatmap spread).
- `simulate` — perfect policy: 53/56 kills, 13 838 pts, **rank S**; imperfect: rank A; no-fire dies at 28.5 s. `trace:audio` confirms the per-face layer build and section structure.

Two notable bugs found and fixed along the way: face frames were originally derived from world-up, rotating tile grids ~45° off the cube's true edges (chassis corners physically poked through neighboring faces and occluded corner targets); and the original panel design camouflaged exactly onto the tile's own ink frame — it's now an unmistakable diamond designator with a white-hot lens.

## Needs human eyes (WSL2 can't render WebGPU)

1. **Ratchet feel** — kills should land their snap audibly *on* the next beat, with the tile rotation visually seating at the same instant.
2. **Payoff moments** — the face fall-away shower, the bar-24 shell blast, and the confetti finale + music resolution.
3. **Bloom-zero legibility** on the pale void (targets are ink/saturated by design, but the mix of HDR lenses and pale ground needs a real frame), and the overall music mix balance.