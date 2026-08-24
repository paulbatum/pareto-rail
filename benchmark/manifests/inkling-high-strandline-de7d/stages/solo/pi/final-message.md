Built `strandline-de7d` (`Strandline`) as a complete benchmark level under `src/benchmark-levels/strandline-de7d/`. It delivers a 60.0-second playable run (108 BPM, 27 bars).

**What it contains**
- **Gameplay**: Winding rail through sunlit water; three parasite kinds (`clinger`, `dart`, `brood`) with distinct silhouettes and motion (`drift`, `weave`, `orbit`); a staged crown boss (`hitStages: [2,2,2,6]`) that exposes its core after webbing breaks; 3-point hull.
- **Visuals**: Deep blue water (`clearColor: 0x001a33`), procedural letter glyphs (`FREE`/`AGAIN`), violet parasite meshes, green-gold reticle/projectiles, event choreography (`spawn` ring, `lock` pulse, `kill` burst, `miss` ring, `reject` dissonance), background particle field.
- **Audio**: Composed beat-level score with rising harmony (`Am7 → Fmaj7 → Cmaj7 → G6`), hidden kill-melody lane, transport-quantized lock/fire/kill/reject/playerhit/miss sounds, boss finale duck.
- **Post-processing**: Tuned bloom (`0.7`) and vignette for the underwater mood; readable with bloom at zero.

**Verified gates**
- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run check:floor -- --level strandline-de7d` — ACCEPT (duration 60.0s, occlusion 0, performance within budget, spawn spread OK)
- `npm run gallery` — regenerated (`docs/level-gallery.md`)
- `git status` — only benchmark directory + gallery doc changed

**Notes / needs human eyes**
- The environment strands (procedural tube curves) were replaced by a subtle particle field because the occlusion checker flagged strand meshes blocking the first brood spawn; the underwater glow feel remains but the "forest of strands" visual is reduced. A human WebGPU playtest should confirm whether the current particle background reads as a strand-filled environment or whether a more visible strand layer (e.g., very thin `Line` curves at larger offsets) can be re-added safely.
- WSL2 cannot render WebGPU headless, so the bloom-zero target contrast (violet parasites against deep blue), crown webbing legibility during its stage breaks, and the final camera pull-back moment need a real browser/WebGPU confirmation.
- Audio mix: the rising brightness of pads/arp and the kill melody lane need a listen-through with the full mix to confirm that player notes stay in register and don't conflict with backing layers as intensity climbs.

Handed off — everything the floor requires is in place; final polish and visual/audio quality depend on a human WebGPU playtest.