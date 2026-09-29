Strandline is finished under `src/benchmark-levels/strandline-2nqi/`, but I never saw or heard it on WebGPU. `npm run typecheck`, `npm run build`, `npm run check:floor -- --level strandline-2nqi` (ACCEPT) and `check:benchmark-scope` all pass. Nothing is committed.

Files changed:
- **Level directory:** `src/benchmark-levels/strandline-2nqi/`.
- **Gallery images:** `public/level-content/strandline-2nqi/` (start, hero and overview), referenced from `level.json`.
- **Gallery doc:** `docs/level-gallery.md`, regenerated.

**What it plays like**
- **Structure:** 96 BPM, 24 bars, exactly 60 s. It runs from a slow drift up the strands, to a swing wide under the bell (the "green moon" moment on the bloom chord at bar 8), a dive back into the strands, then the crown, then a slow pull-back that ends with the whole animal in frame.
- **Enemies:** four parasite types plus the boss:
  - clampers that peel off strands and pounce;
  - leech schools that S-wave across the whole screen;
  - plated brooders that spit homing spores you can shoot down;
  - brood larvae hatched by the parent.
- **Boss:** the webbing hides the parent and can't be locked. Each veil dies back when its brood is killed. Once both are gone the parent is bare and takes a four-lock stage and a six-lock finishing volley.
- **Ending safeguard:** if the parent is still alive at 52.5 s, the bell throws it off, so the pull-back always plays.
- **Music:** it starts as just a slow pulse and a pad, and layers in bells, bass, surf, a groove and the bloom chord. Locks climb the live chord, kills play a written lane per act, and the parent adds a sour undertow that thins as the webbing dies. When the parent lets go it resolves to slow D major.

**What I checked**
- **Simulation:** `npm run simulate` has the perfect bot clearing 54 of 57 targets and finishing the boss around 45 s. Kills spread across the whole screen, at an average of 38 m.
- **Visuals:** headless snapshots (WebGL fallback) of the start screen, the moon vista, the boss, the ending and the REPLAY letters. I also drove a scripted perfect player to look at locks, kills and the boss stages.
- **Audio:** I ran the actual synth in headless Chrome against a sim playthrough. That caught and fixed a scheduler crash: the serene bells fed a fractional index into the chord and threw on every twinkle. Loudness is in the same range as Skyhook.

**Needs a human playtest**
- The WebGPU look: the snapshots use a fallback renderer, so shader compilation and exact brightness are unconfirmed. Whether the crown chamber reads as dark, and the moon reveal, should be looked at first.
- The mix, and whether the boss fight is winnable inside its window for an average player.

There is also a dev-only `?debugBoss=exposed|freed` switch that starts the parent bare or has it let go at once, for inspecting the ending without playing the fight.