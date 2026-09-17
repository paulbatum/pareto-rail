Implemented **Thermal Ink** in `src/benchmark-levels/thermal-ink-184u/`.

- 60-second continuous octopus boss encounter
- Eight severable arms, three distinct spawn types, and a six-hit core
- Infrared toggle via **I** or an on-screen button
- Procedural industrial soundtrack, gameplay effects, and gallery images

**Verified:** typecheck, build, and all floor checks pass. Simulation achieves **57/63 kills, S rank**, with no dead-air gaps. Occlusion and performance checks pass.

**Scope caveat:** the official scope command cannot load the missing repository file `scripts/benchmark/protocol.mjs`. A direct Git path check confirms all 11 added files are within the two permitted directories.

Inspected gameplay, infrared, blackout, and START snapshots. A human WebGPU playtest is still needed for sensor-switch feel, the final volley, and audio balance.