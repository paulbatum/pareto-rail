# Level-author API wishlist — remainder

This began as a full wishlist written by an agent before reading any level or engine code (see git history for the original). Most of it turned out to already exist or has since been built. What remains here is only what is deliberately not covered elsewhere.

## Deferred by decision

- **Offline audio render + analysis** (WAV render, waveform/spectrogram images, loudness stats). Deferred: humans verify audio by playing the game, and the coding agents can't meaningfully process rendered audio anyway. `trace:audio` covers structural verification. Revisit only if an agent workflow appears that can actually consume the output.

## Worth considering, not yet planned

- **Rail shape upgrades** — authored roll/banking along the rail, a parallel-transport frame (the current `sampleRailFrame` uses a fixed world-up cross product, which flips or degenerates on steep/vertical segments), and per-span camera look-target overrides. No retrofit value for existing levels (it would change their look), so this waits for a future level whose design wants a barrel roll or a vertical dive — build it then, in the engine, driven by that level's needs.
- **Voice audition page** — a dev page like the enemy gallery but for a level's instruments: play each voice/action sound in isolation so a human can give precise feedback ("the kill sound, third one") instead of "the audio feels off." Cheap once brief 02's voice specs exist, since specs are enumerable. Decide after 02 lands whether feedback quality justifies it.

## Considered and rejected

Recorded so a future session doesn't re-propose them: shared motion-combinator or geometry libraries, shared palettes/material presets, named voice presets, and any parameterized level factory. All trade distinctiveness — the top judged criterion — for line count, and the engine's existing philosophy (visual-kit owns no look; glyphs ship data, not rendering) already draws this line correctly.
