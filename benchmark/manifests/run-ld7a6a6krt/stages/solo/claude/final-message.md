**Thermal Ink** is built and every gate passes. It lives in `src/benchmark-levels/thermal-ink-mv8r/`, with gallery images in `public/level-content/thermal-ink-mv8r/`. This environment can't run WebGPU, so I haven't seen it in the real renderer or heard any of the audio. All visual checks were done on SwiftShader snapshots.

**What's built**
- **The fight:** exactly 60 s (96 BPM, 24 bars) against one octopus wrapped on a capsized freighter. The rail approaches, dives low through the first ink, circles the creature past a crane that collapses across the path, then ends face to face. The octopus turns to track you the whole time. Four arms rise out of the water to reach for the rail; each has a two-stage node, and an arm you don't sever slams the rail. Then it rears up to show its core. After you break the core's first layer it seals itself until the final blackout, so the killing volley always lands in the dark. When it dies, its heat outline greys out and slumps, and the lamps relight from the creature outward.
- **Thermal sight:** holding the trigger inside ink switches it on, and it stays on while your shots are in the air. Every material has a normal look and a heat look, switched on the GPU, so enemies you couldn't see appear white-hot with red weak points and steel turns dark grey. On top of that is a grainy display with a scan-line wipe on switch-on, a refresh line on each beat, and ink that stays as cold black wisps. Inside ink without it, enemies are black and lamps are dim smudges.
- **Enemies:** crab-like crawlers that hop in from the edges on the beat, eel-like creatures swimming S-curves, bell buoys that pulse upward and spit ink barbs, the arm nodes, and the core. The octopus also spits barbs from its beak late in the fight.
- **Score:** D minor with a heavy kick, a bass that ducks under it, sparse metal clanks and chain rattles, and a hum from the sodium lamps. One melody always plays in two voices, hazy and bright, and the thermal sight picks which you hear; it also pulls the noisy percussion back. Blind in ink, the whole score goes muffled. Locks, shots and kills are notes in the live chord, with written melody lines for kills. Big moments (arms surfacing, ink jets, the crane, the blackout) are timed to the music, and the ending resolves to D major as the lamps return.

**Verified**
- `npm run typecheck` and `npm run build` pass.
- `npm run check:floor` passes everything: 6 enemy kinds, beat events, reject, spawn spread, no hidden targets across 72, performance, and the audio config. Along the way I fixed a real memory leak (a new material per enemy spawn) by sharing materials, so memory now stays flat.
- The simulator: a player who never fires dies at 28 s, and the perfect-play simulation clears 60 of 64 and gets rank S. The only gap is the intended ~6 s after the kill.
- The audio timing check confirms beats, sections and the timed cues. Correct timing isn't the same as a good mix, though.

**Things to know**
- `npm run check:benchmark-scope` can't run here because `scripts/benchmark/protocol.mjs` is missing from this baseline. I checked scope with git instead: only the two level directories are new, and no tracked file is modified.
- Dotfiles such as `.bashrc` and `.claude/*` appeared untracked in the repo root. The sandbox environment created them, not me, so I left them alone.
- Early on, one of my commands ran from the wrong directory and created a new `index.ts` inside `node_modules/three`. Nothing was overwritten, and I moved the file to the level folder.
- I added dev-only inspection flags for snapshots (`--debug-value thermal`, `finale`, `clean`); they're documented in `level.md`.
- Nothing is committed.

**What to check first in a WebGPU playtest**
1. **First ink (0:15):** does holding make the switch feel sharp, and is being blind until you hold clear enough from the "HOLD FOR THERMAL" message?
2. **The mix:** does the melody's switch between voices come through, is the kick/bass too pumping, and are the kill notes loud enough to feel like you're soloing?
3. **Unsevered arm slam (~0:14):** I toned down the node's glow, but check it's not too bright up close.
4. **Final blackout (0:50–0:60):** the kill, the silhouette cooling, and the lamps relighting.
5. **Frame rate on real GPUs:** the tentacles are rebuilt every frame, and there are about 250 draw calls at peak.