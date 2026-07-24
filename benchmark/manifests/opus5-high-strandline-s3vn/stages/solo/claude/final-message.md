**Strandline** is built at `src/benchmark-levels/strandline-s3vn/`.

## What it is

A 60.000-second run (112 BPM × 28 bars) through the trailing strands of a jellyfish the size of a cathedral, cutting a violet infestation off it. Six sections: Drift → Swarm → Open (the bank into open water, the bell arrives) → Dive → Crown (the parent) → Clear (the animal comes back to life and swims off).

**Key design decisions**
- The animal is one object built in its own frame and *swims ahead of you* on an authored gap curve (400 → 70 units). This is what makes the bell arrive as a green moon at bar 9 instead of being a distant dot — and it's the only way an animal this size fits a 500-unit camera far plane.
- Strands are alpha-blended jelly (they fog into deep blue correctly); everything luminous is additive with fog off and carries its own distance falloff, because additive + scene fog *adds* the fog colour and flattens the frame into a mint wash. Nothing the animal owns can occlude a target — occlusion check: 0 warnings across 79 targets.
- **Life**: every parasite you cut off raises a global level that brightens the strands, burns the violet rot off them, and opens a shimmer bed in the mix. The last minute is literally brighter because of what the player did.
- The bell contracts every half bar off the transport and a light wave runs tip-to-crown behind it — the animal's pulse *is* the music's pulse.
- Boss: three webbing panels, three broods. Shots on the parent bounce (`validateRelease` → `shielded`) while a brood feeds it; clear the brood and that third of the lattice withers, opening a two-hit window. Miss the deadline and the rail leaves with the colony still on the animal.
- Five parasite grammars plus broods: clamped clings that let go and pulse at you, full-width crossing larvae, two-shell borers, spore-spitting stingers, interceptable spores.

## Verified headless
`typecheck`, `build`, `check:benchmark-scope` (17 paths), `check:floor` — all pass with zero warnings: 7 enemy kinds, full event coverage, 0 occlusion warnings, 0 perf gate failures, 0 audio-config failures, 0 spawn distance/centerness warnings (avg destruction 42.7 m, well-spread heatmap). Simulation: perfect 73/78 → rank S, imperfect 60/78 → A, no-fire 0/72 → D. `trace:audio` shows the six sections landing on their bars with layers accumulating and never dropping.

## Needs human eyes
WSL2 can't render WebGPU, so all stills above came from the SwiftShader fallback — the real frame and the entire mix are unconfirmed. Check first:
1. **The bell through bars 9–14** — it should read as a translucent green moon, not a light source. Its brightness is driven by apparent size, and that curve is the most likely thing to need a nudge on real hardware.
2. **Violet against green with the bloom slider at zero** — parasites carry pale chitin edges for exactly this, but it's untested.
3. **The bead pulse landing on the beat**, and whether the crown convergence point reads as a destination or as glare.
4. **The mix** — particularly whether the half-bar contraction's duck pumps pleasantly or distractingly, and whether kill-lane notes cut through the pad.

One thing I'd flag as still weak: the parent's webbing reads a little like a radar grid rather than webbing at close range, and the parent-death frame briefly whites out. Both are cosmetic and localized.