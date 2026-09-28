# Strandline

A sixty-second climb up the trailing tentacles of a colossal jellyfish, in sunlit water gone wrong: violet parasites clamp its glowing strands, and every one you free lets a little more of the animal's green-gold light back in. The rail threads a forest of strands, swings wide under the bell — a glowing green moon filling the frame — dives back in, and ends at the crown, where the parent organism sits behind a lattice of its own webbing.

## Visual language
Clear blue-green water shading to deep blue with distance, surface light falling in shafts, and the jelly's own bioluminescence — green strands with gold beads of light climbing toward a translucent, canal-veined bell. The parasites are the only sour note: one bruise-violet family (clamper stars, S-waving leeches, plated brood sacs, homing spores, comma-shaped larvae). The player's fire is the only warm thing in the water: a sun-gold drop, sun-gold lock rings that warm toward coral, cleansing bursts that leave green motes rising up the strands. START and REPLAY are beads on a thread. The crown is dark and violet-tinged until its webbing dies back; when the parent lets go the camera pulls back and back until the whole clean animal hangs in frame.

## Musical language
96 BPM, 24 bars, D major (Dmaj9 · Bm9 · G · A). It begins with nothing but the jelly's heart — a slow lub-dub — and a low pad, then adds bells, bass, surf, a wooden knock, a groove, and a bloom chord as the bell fills the sky. The crown adds a violet undertow (a semitone and tritone against the tonic) that thins as the webbing dies back; when the parent lets go the pulse resolves into slow, serene D major. Locks climb the live chord, fire falls from its root, and kills read a hidden per-act melody lane, so a chained volley plays a written phrase.

## Mechanical signature
A three-point hull and four parasite grammars — clampers that latch on a strand then peel off and pounce in a sweeping arc, S-waving leech schools that cross the whole frame, two-stage plated brooders that spit interceptable homing spores as you close, and brood larvae — plus the parent: its webbing is untargetable until each veil's brood is killed and the veil dies back, then the bare parent takes a four-lock stage and a six-lock finishing volley. If the parent is still there at 52.5 s the bell's own pulse throws it off so the ending always plays.

## What to read
- `src/benchmark-levels/strandline-2nqi/index.ts`
- `src/benchmark-levels/strandline-2nqi/gameplay.ts`
- `src/benchmark-levels/strandline-2nqi/parent.ts`
- `src/benchmark-levels/strandline-2nqi/audio.ts`
- `src/benchmark-levels/strandline-2nqi/camera.ts`
- `src/benchmark-levels/strandline-2nqi/visuals/index.ts`

## Status & notes
Showcase build. Inspection markers: `swing` (bar 6), `moon` (bar 7.75), `bloom` (bar 8), `dive` (bar 9.5), `tide` (bar 10), `crown` (bar 12). Dev-only `?debugBoss=exposed|freed` starts the parent bare or has it let go at once, for inspecting the ending without playing the fight. WebGPU visuals and the final mix still require a human playtest; the headless snapshots use a WebGL fallback.
