# Themes

This directory holds the eligible Markdown themes. The controller inserts each theme unchanged into the `{{THEME}}` placeholder in `benchmark/prompts/level-assignment.md`, under `## Assigned theme`; it does not edit the standing brief. Every configuration for a theme receives the identical rendered text.

The filename without `.md` is the stable theme id. Its first level-one heading is the player-facing `levelTitle` placed in the private schedule. The title must be the same for every configuration of that theme and must not reveal a configuration, model, slot, or schedule position.

Most themes land between 150 and 400 words. Direct the desired world, visual language, dramatic arc, musical character, and signature player-facing moments without repeating the shared rail-shooter contract or prescribing source-level implementation.

Length is not what spoils a theme; resolution is. Extra words are well spent on world, stakes, character, and dramatic structure, and badly spent on enemy rosters, tuning numbers, bar-by-bar arrangements, or HUD copy — the moment a theme enumerates those, entrants transcribe instead of design and the ranking measures compliance rather than capability. The complementary trap is a theme that is narrow in image-space: a concept with one canonical rendering converges independently built levels no matter how short the text is. Aim for a theme that is narrow in what it demands the player should *feel* and wide in how that could look. Every theme should stake out its own palette and musical register in a line or two; left unstated, independently built levels converge on the same dark-world, neon-accent, driving-electronic default. Compare the set for similar detail, ambition, distance from aesthetics already rewarded by the hand-built gallery, and distinctness of palette and sound across the set. Do not select an eligible theme that is already present in supplied entrant material or represented by a hand-built gallery level.

Themes may be revised or replaced before the freeze. At freeze, record each theme's id, path, player-facing title, and SHA-256 hash. Do not use an eligible theme to test the runner.
