# Shared prompts

`level-assignment.md` is the stable authoring path for the benchmark-wide level task. Edit it freely until a release is frozen; do not create `level-assignment-v1.md` or similar copies.

The controller renders exactly three placeholders for each run:

- `{{LEVEL_ID}}` — the run's globally unique implementation id, conventionally `<theme-id>-<opaque-slot-id>`;
- `{{LEVEL_TITLE}}` — the theme's player-facing title, taken from the theme file's first level-one heading; and
- `{{THEME}}` — the complete eligible theme Markdown.

Apart from the preassigned opaque level id, every configuration for a given theme must receive equivalent rendered assignment text. The release record stores the template's path and SHA-256 hash; each private run record also stores the hash of the rendered prompt actually sent to every stage that receives it.

Stage-specific instructions and delegation artifacts do not belong in the shared assignment. Recipes define how the shared prompt is presented to planners, implementers, reviewers, and solo agents.
