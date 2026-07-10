# Shared prompts

`level-assignment.md` is the stable authoring path for the benchmark-wide level task. Edit it freely until a release is frozen; do not create `level-assignment-v1.md` or similar copies.

The controller renders exactly three placeholders for each run:

- `{{LEVEL_ID}}` — the theme's stable implementation id;
- `{{LEVEL_TITLE}}` — the theme's player-facing title; and
- `{{THEME}}` — the complete eligible theme Markdown.

For a given theme, every configuration must receive byte-identical rendered assignment text. The release record stores the template's path and SHA-256 hash; each private run record also stores the hash of the rendered prompt actually sent to every stage that receives it.

Stage-specific instructions and delegation artifacts do not belong in the shared assignment. Recipes define how the shared prompt is presented to planners, implementers, reviewers, and solo agents.
