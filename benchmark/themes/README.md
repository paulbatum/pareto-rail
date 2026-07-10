# Themes

At the first release freeze, this directory should contain three eligible Markdown themes. The controller inserts each theme unchanged into the `{{THEME}}` placeholder in `benchmark/prompts/level-assignment.md`, under `## Assigned theme`; it does not edit the standing brief. Every configuration for a theme receives the identical rendered text.

The filename without `.md` is the stable theme id. Its first level-one heading is the player-facing `levelTitle` placed in the private schedule. The title must be the same for every configuration of that theme and must not reveal a configuration, model, slot, or schedule position.

Aim for roughly 120–200 words. Direct the desired world, visual language, dramatic arc, musical character, and signature player-facing moments without repeating the shared rail-shooter contract or prescribing source-level implementation. Compare the set for similar detail, ambition, and distance from aesthetics already rewarded by the hand-built gallery. Do not select an eligible theme that is already present in supplied entrant material or represented by a hand-built gallery level.

Themes may be revised or replaced before the freeze. At freeze, record each theme's id, path, player-facing title, and SHA-256 hash. Do not use an eligible theme to test the runner.
