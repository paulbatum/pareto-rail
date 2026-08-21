**Strandline is complete.** A 60-second (exactly 28 bars @ 112 BPM) showcase level at `src/benchmark-levels/strandline-sk9q/`, built directory-only per the benchmark contract.

## What was built

**World** — You fly the trailing tentacle forest of a gigantic jellyfish. The rail banks between 14 hero strands trailing back from the crown plus recycled near-field wild filaments, through sunlit blue-green water (god rays, marine snow, atmosphere ramp). Two authored wide swings lift the fog and pan the view across the bell — first "much more of the animal", then the green moon itself. Strands cleanse from sickly dim to jade-gold as the run progresses, with violet parasite clumps shrinking away. The bell is a translucent dome with gold organs, rim, and canals, self-lit (fog-free additive surfaces after a whiteout bug was found and fixed).

**Mechanics** — 4 hull, 5 enemy grammars: latched tick latchers (center-lane ones detach and strike), dashing sea-spider skitters, armored husks (`[2,1]` shell/core stages), tube-worm spitters lobbing interceptable homing spores, and tetra-pod broodlings. The parent is a 3-stage boss (`[2,3,4]`) dug into the crown behind 3 web fans: kill a brood → its web shrivels and brood sac deflates → that stage is bare. The web blocks the *shot*, not the lock — `validateRelease` filters a shielded parent out of volleys with visible absorb feedback (this also keeps the sim's perfect policy honest). Escaped broodlings are re-brooded until the bar-25.5 deadline; kill it and the whole rig recedes into the blue while strands stream past — the whole animal in frame, serene A-major swell. Miss the deadline and it burrows, unresolved.

**Music** — The jelly's pulse is the kick, slow at first, gaining layers (bass, bells, shimmer, sour B♭ drone under the boss) as it revives. Locks are harmony-pitched droplets, kills walk authored per-section bell lanes, web deaths tear a wail answered by a clean bell, and the killing blow ducks the mix into the serene swell.

**Docs/assets** — filled `level.md`, regenerated gallery, and hero/overview/start content images in `public/level-content/strandline-sk9q/` wired through `level.json`.

## Verified headless
- `typecheck`, `build`, `check:benchmark-scope` (19 paths), `check:floor` — simulation (perfect 80/80 RADIANT, imperfect survives, full event coverage), occlusion 0, perf gates, audio config, gallery freshness.
- `trace:audio` — 7 sections, 112 beats, expected instrument census.
- SwiftShader gameplay snapshots across the whole run: reveal framing, boss legibility, coda pull-back, bloom-off legibility (postless), START/RETURN glyph legibility.

## Needs human eyes (WSL2 can't render WebGPU)
Final visual and audio quality is unconfirmed on real hardware. First things to check: (1) the music mix — kill-bell lanes vs the pulse/bass balance; (2) the aggro-latcher detach telegraph reads before it strikes; (3) the two reveals actually feel like "a green moon"; (4) the web-denied absorb feedback is understood; (5) coda pull-back framing and the REPLAY screen at 60 fps.