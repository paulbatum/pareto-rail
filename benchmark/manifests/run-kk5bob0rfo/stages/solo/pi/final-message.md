Implemented **Strandline** in `src/benchmark-levels/strandline-u4wm/`.

- 60-second run through procedural jellyfish tentacles
- Three parasite motion types, nine brood anchors, and a staged parent boss
- Brood-dependent web removal and a full-animal pullback reveal
- Procedural score, harmony-aware player sounds, glyphs, and event effects
- Completed level card and regenerated gallery

**Verified:** typecheck, production build, benchmark scope, simulation, and floor check all pass.

Reviewed gameplay snapshots. The floor reports one non-blocking warning about slightly center-heavy kills. Final WebGPU motion, bloom-zero readability, and audio balance still need a human playtest.