# Refactor brief: spine/leaf retrofits

**Status: hold — do not execute until the scaffold/convention work (authoring-scaffold brief) has landed. Run each level as its own task and commit.**

## Goal

Bring the three largest levels in line with the spine/leaf module convention in `docs/level-authoring.md`, so that an agent calibrating against them can read the decisions (timelines, tuning, arrangement, palette, event choreography) without wading through construction code (mesh building, synth patch plumbing).

These are **timeline- and audio-preserving refactors**. No gameplay, visual, or musical behavior change is intended anywhere in this brief.

## Tasks (independent; do in this order)

1. **Helios audio split.** `src/levels/helios/audio.ts` (~1,325 lines) mixes the arrangement — sections, harmony, lead sets, the per-bar structure — with instrument construction (`kick`, `snare`, `hat`, `bass`, `choir`, `arp`, `stab`, `lead`, …). Split into a score module (the decisions) and a voices module (the instruments). Helios also predates full `audio-kit` adoption (raw Web Audio node calls remain); migrating those to the kit is in scope **only** where it provably preserves output.
2. **Crystal audio split.** Same split for `src/levels/crystal/audio.ts` (~1,000 lines). Crystal is the flagship landing level: be conservative, and prefer a smaller split over a risky one.
3. **Deluge decomposition.** `src/levels/deluge/visuals.ts` (~74 KB) and `src/levels/deluge/audio.ts` (~21 KB) are monoliths. Decompose along the convention: decisions (palette, event choreography, tuning) in the spine files; mesh construction and voice construction in leaf files.

## Verification per task

- `npm run trace:audio -- --level <id> --compare` characterizes the audio refactors; `npm run trace:spawns -- --level <id> --compare` guards the timeline where gameplay files move.
- `npm run snapshot:gameplay -- --level <id> --thumbnails 8` before and after; the sheets must match.
- `npm run typecheck`, `npm run build`, `npm run check:scope -- <id>`.
- Update the level's `level.md` "what to read" pointers to the new spine files.

## Out of scope

- **Deluge's known bugs.** Deluge needs a quality pass, but fixing behavior inside a refactor makes the compare tools useless. Bug fixes are a separate follow-up task after its decomposition lands.
- Rezdle and prism: rezdle is word-game-shaped and decomposes differently; prism is small enough that the convention adds nothing. Leave both alone.
