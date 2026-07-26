I have built and verified the complete **Thermal Ink** (`thermal-ink-t6nv`) benchmark level in `src/benchmark-levels/thermal-ink-t6nv/`.

### Summary of Implementation

- **Identity & Scope**:
  - Level ID: `thermal-ink-t6nv`
  - Display Title: `Thermal Ink`
  - Directory: `src/benchmark-levels/thermal-ink-t6nv/` (directory-only protocol, `src/levels/index.ts` left untouched).
- **Run Length & Timing**:
  - Playable Duration: Exactly **60.0 seconds** (29 bars at 116 BPM).
- **Boss Battle & Mechanics**:
  - Continuous boss battle against a giant mutant octopus in a drowned industrial harbor.
  - **Dynamic Vision Modes (TSL Post-Processing)**:
    - **Normal Vision**: Sodium-harbor murk, tobacco brown water, dirty cream pipes, rust metal ship hulls, snapped cables, and glowing sodium industrial lamps.
    - **Ink Cloud Blackouts**: Dense clouds of oil-black ink swallow normal vision during authored fight phases.
    - **Infrared Vision Mode**: Snaps the frame into a stark charcoal display (`#0b0d10`). The giant octopus and scavenger spawn blaze as **white-hot silhouettes**, vulnerable points burn as **blazing red signal cores**, and drifting ink remains **cold black**. Supports automatic engagement during ink blackouts and manual toggle (`Space` / `Right-Click`).
  - **5 Distinct Enemy Kinds**:
    1. `arm_outer`: Outer tentacle targets (multi-stage hit points).
    2. `arm_inner`: Inner tentacle targets (multi-stage hit points).
    3. `scavenger`: Fast, twitchy scavenger drones made from mutant flesh and harbor scrap.
    4. `harbor_mine`: Bio-electric cable mine hazards.
    5. `boss_core`: Exposed central core target (unlocked in Phase 5 for the final blackout strike).
    6. `letter`: Legible 5×7 procedural START! and REPLAY glyphs in dark rusty steel with glowing sodium/thermal edges.
- **Audio & Sound Design**:
  - Procedural Web Audio soundtrack at 116 BPM with a slow industrial pulse, heavy bouncing synth bass, sparse metallic percussion, and a haunting minor-key synth melody.
  - **Infrared Audio Filter Sync**: When Infrared vision is engaged, industrial noise and sub-bass drop back while the lead synth melody filter opens up into a bright, crystalline, razor-sharp focus.
  - Quantized action audio for lock-on chimes, fire impulses, hit crunches, and melodic kill notes.

---

### Verification Results

All required verification gates passed cleanly:

1. **`npm run typecheck`**: Passed with 0 errors.
2. **`npm run build`**: Passed with 0 errors (built `dist/assets/thermal-ink-t6nv-*.js`).
3. **`npm run check:benchmark-scope -- --level thermal-ink-t6nv --base HEAD`**: Passed (`benchmark scope valid`).
4. **`npm run check:floor -- --level thermal-ink-t6nv`**: Passed (`All floor checks passed`, 0 occlusion warnings, 0 centerness warnings, 0 perf failures).
5. **`npm run simulate -- --level thermal-ink-t6nv`**: Passed (60.0s duration, 33 total targets, 0 impossible moments).
6. **`npm run trace:spawns -- --level thermal-ink-t6nv`**: Verified 38 entries spanning 2.1s–58.9s.

> [!NOTE]
> WebGPU rendering cannot be executed in headless Linux/WSL environments lacking WebGPU hardware acceleration. Final visual color depth, TSL post-processing transitions, and AudioContext playback should be evaluated in a human WebGPU playtest.
