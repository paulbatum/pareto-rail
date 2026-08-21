# Vespers

You fly the nave of a night cathedral while something is eating the light out of it. Every enemy is a flat black shape with a stolen pane's colour burning in its chest; kill one and the window it stripped comes back burning behind you, and every window you win back stays lit for the rest of the run — so the deeper you fly, the more of the cathedral you have lit yourself. At the west end, nested in the dead rose window, is the thing doing the eating. The music is the building's own organ: a held pedal in D minor, voices entering one at a time in real counterpoint, no percussion anywhere — the player's locks, shots, and kills are organ voices inside the polyphony, and the final bar turns the minor major.

## Visual language

Black stone and jewel glass, nothing else. The architecture is a dim gothic skeleton — pointed arcade arches, string courses, vault diagonals, a candle floor far below, slow dust — kept deliberately near-invisible so the four stained-glass colours (deep cobalt, blood red, bottle green, gold) are the only saturated things in the frame. Enemies are matte-black silhouettes (a winged shade, a swinging thurible, a ring-eyed watcher) readable only by the ember they stole and a faint cold rim. Lit glass throws its colour onto the stone as a soft halo, and relighting a window pulses that colour across the whole frame. The rose window is a twelve-pane stone eye at the end of the rail, dead until the heart breaks.

## Musical language

84 BPM, common time, D minor, no drums. The run opens on a single held pedal note; the tenor flute enters at bar 2, the alto principal at bar 4, the tune at bar 6 — each voice arrival is choreographed with a wave. The feast (bars 8–13) adds choir swells and bell weight on the two-bar phrases. The silence (bars 14–16) strips to pedal plus one lone flute while three shades cross a dark span. The rose section doubles the harmonic rhythm over a tolling bell and a two-bar riser, and the tutti at bar 21 lands on D major — the picardy the whole run was holding back. Kills play written per-section lane notes (chant arch, octave zig-zags, gentle descent, tolling peals), locks climb a D-minor pentatonic chiff, and breaking the heart ducks the music and blooms the full organ through a falling bell peal.

## Mechanical signature

Windows as persistent score: every non-boss enemy carries one specific pane (assigned by rail position at build time), the pane relights exactly where the thief dies, and the end-screen reports "Windows relit n/28" — a replayable visual ledger of the run. The Devourer layers the boss as the theme's climax: six stolen-light spokes, then four petal panes that must be taken in a single linked sweep (`validateRelease` denies partial rings and flashes the stragglers), then the ten-lock heart. Watchers telegraph with an iris flare before spitting homing gloom that must be shot down.

## What to study here

- Persistent world-state as scoring: `lightstate.ts` bridges gameplay (which assigns windows) and visuals (which relights them), because runner events carry ids, not spawn data.
- Counterpoint authored as degree contours: every voice is a pattern of chord-relative degrees (`audio.ts`), so lines stay consonant while the harmony moves and the kill lanes are just one more voice.
- A boss whose release rules *are* its read: the linked petal ring teaches "take it in one sweep" through denial feedback, not UI.
- Restraint as a section: the silence drops the arrangement to two voices and the spawn timeline to three enemies, so the finale breaks against something.

## What to read

- `src/benchmark-levels/vespers-1izg/gameplay.ts`
- `src/benchmark-levels/vespers-1izg/audio.ts`
- `src/benchmark-levels/vespers-1izg/devourer.ts`
- `src/benchmark-levels/vespers-1izg/visuals/index.ts`
- `src/benchmark-levels/vespers-1izg/visuals/windows.ts`

## Status & notes

Built as a benchmark entrant against the standing brief. Verified headless: typecheck, build, floor check (simulation, occlusion, perf — all gates pass), audio trace, spawn trace, and gameplay/model snapshots. One soft warning remains: perfect-policy kill concentration in screen center is 33.9% (warning threshold 25%, failure 70%) — mostly the Devourer itself, which legitimately owns the center of the frame; the wave timeline sweeps the full width and height. `check:benchmark-scope` could not run in this checkout (`scripts/benchmark/protocol.mjs` is absent from the scrubbed baseline), so scope was verified by hand: the working tree contains exactly `src/benchmark-levels/vespers-1izg/` and nothing else.

Headless Chrome cannot render WebGPU, and the snapshot tools auto-expose, so final colour balance, bloom weight, and the organ mix need a human WebGPU playtest. Playtest priorities: (1) kill the first shade and watch its window come back burning behind you; (2) the silence at ~40s — one flute, three shades, nothing else; (3) the Devourer's linked petal ring — try releasing a partial ring and read the denial; (4) the ignition — the rose should be the biggest single event in the level, with the full organ and the major turn under it.
