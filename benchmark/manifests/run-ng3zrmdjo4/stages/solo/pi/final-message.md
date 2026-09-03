**Broadside (`broadside-amr2`) is complete and verified.** A 60.0s fleet-engagement rail shooter at 112 BPM (28 bars), built to the standing brief + assigned theme.

## What was built
- **Rail**: launch off the flagship deck → corkscrew through cruiser gaps → long flank run under a friendly broadside → under an enemy warship's belly → two flagship passes → trench dive → camera pull-out past the breaking flagship (finale FOV widen + rise in `updateCameraEffects`).
- **Enemies** (7 kinds): weaving `dart`s, lumbering twin-hull `gunship`s, corkscrewing `weaver`s (3 distinct motions), homing point-defense `bolt`s (3-point hull), plus the flagship fight — 3× 2-HP `shield-gen`s wheeling around a locked 2-stage `flag-core` (volleys at core/trench are eaten by the shield plate until they fall, with `shielded` feedback), escort waves on the turn, then 3× 2-HP trench `power-node`s and the core kill → `flagshipBreaking` fires, victory pull-out.
- **Visuals**: magenta-and-gold nebula dome + camera-riding glow planes + starfield; ice-white friendlies with cyan drives vs. obsidian enemies with molten edges and crimson fire; pooled cyan/crimson broadside beams whose rate follows arrangement intensity; gold gunner reticle; ice-plate START glyphs (verified legible in attract capture).
- **Audio**: D-minor space-opera score (brass/strings/timpani/snare/ostinato) across 7 arrangement sections with a near-silent strings-and-lone-horn eye (bars 13–17); hidden 32-step kill lane per act, D-minor lock climb, pitched fire, ship's-bell core chips that grow with damage, ducked D-major victory peal on the kill, reject/hull-hit/miss/volley-flourish all in the mix.

## Verification (all passing)
- `typecheck` ✓, `build` ✓, `check:benchmark-scope` ✓ (16 paths), `check:floor` → **ACCEPT** (0 occlusion warnings, 0 perf failures, 0 audio failures, full event coverage).
- `simulate`: perfect 79/87 S (13.5k), imperfect seeds clear S/A; pressure peak 12, on par with crystal; no dead-air gaps except a 4s perfect-only lull in the finale.
- Self-reviewed via SwiftShader snapshots (start screen, 8-frame sheet, hero/overview/start content images in `public/level-content/broadside-amr2/`, wired through `level.json`); fixed real issues found there (ships too close/bright, clipped nebula, wash-out, sprite raycast crash).

## Needs human eyes (no WebGPU in WSL2 headless)
1. **Playtest feel**: lock sweep weight, volley punch, boss pacing (are 3×2HP shields + 8-HP core the right 60s budget?), bolt pressure fairness.
2. **Mix**: orchestral balance, kill-lane audibility in the flagship section, victory-peal landing.
3. **Visuals**: bloom-on richness of hull rim light, nebula saturation, finale pull-out framing.
4. Non-failing center-clustering warning (42.7%) — I widened boss orbits; pushing wave edges further broke perfect-play survivability, so I stopped.