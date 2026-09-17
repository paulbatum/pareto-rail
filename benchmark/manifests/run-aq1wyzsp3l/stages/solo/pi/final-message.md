Implemented **Vespers** in `src/benchmark-levels/vespers-nolz/`.

- Exactly 60 seconds, with three thief types and a staged rose-window boss.
- Persistent window restoration, cathedral architecture, candle floor, and procedural glyphs.
- Organ counterpoint, quantized player notes, quiet passage, and major-key victory finale.
- Hero, overview, and start-screen AVIFs included.

**Verified:** typecheck, build, floor check, simulation, audio trace, and gameplay snapshots. Both tested firing policies cleared all 44 targets.

**Scope gate blocked:** the repository is missing `scripts/benchmark/protocol.mjs`. A manual audit found all 12 added files within the two allowed directories.

Human WebGPU playtesting remains necessary for audio balance, boss feel, bloom-zero readability, and victory lighting.