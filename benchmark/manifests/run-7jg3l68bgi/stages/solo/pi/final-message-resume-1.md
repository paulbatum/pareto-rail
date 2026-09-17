Implemented **Speedsolve** in `src/benchmark-levels/speedsolve-28fr/`.

- 60-second cube boss fight with beat-snapped row solves, face peeling, weakpoints, and an 18-hit core finale.
- Three distinct polyhedral enemies and interceptable hostile shots.
- Procedural mechanical soundtrack with quantized player audio.
- Gallery card and hero, overview, and start images included.

**Verified:** typecheck, production build, benchmark scope, audio trace, and floor gate—all passed. Perfect simulation cleared **97/97 counted targets**, with no damage or dead-air gaps.

Captured frames were inspected, but a human WebGPU playtest remains necessary—especially for rotation/audio synchronization, bloom-zero contrast, weakpoint timing, and the final barrage’s feel.