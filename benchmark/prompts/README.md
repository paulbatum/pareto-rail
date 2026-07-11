# Shared prompts

`level-assignment.md` is the stable authoring path for the benchmark-wide level task. Edit it freely until a release is frozen; do not create `level-assignment-v1.md` or similar copies.

The controller renders exactly three placeholders for each run:

- `{{LEVEL_ID}}` — the run's globally unique implementation id, conventionally `<theme-id>-<opaque-slot-id>`;
- `{{LEVEL_TITLE}}` — the theme's player-facing title, taken from the theme file's first level-one heading; and
- `{{THEME}}` — the complete eligible theme Markdown.

Apart from the preassigned opaque level id, every configuration for a given theme must receive equivalent rendered assignment text. The release record stores the template's path and SHA-256 hash; each private run record also stores the hash of the rendered prompt actually sent to every stage that receives it.

Stage-specific instructions and delegation artifacts do not belong in the shared assignment. Recipes define how the shared prompt is presented to planners, implementers, reviewers, and solo agents.

## Delegation addendum

`flexible-delegation.md` is the delegation addendum. For a delegation configuration the controller renders it and appends it to the shared assignment body, and the combined text is what the primary agent receives as stdin; solo configurations send the shared assignment unchanged. It carries exactly two placeholders:

- `{{DELEGATE_MODEL}}` — the same-provider model the primary is asked to delegate implementation to (a harness model alias such as `opus`, or a catalog slug such as `gpt-5.6-terra`); and
- `{{DELEGATE_EFFORT}}` — the requested reasoning level for the delegated subagent (`low`/`medium`/`high`/…).

Every occurrence of each placeholder is substituted; no other placeholder is allowed. Delegation is driven entirely by this injected prose — no harness flag sets the delegate model — so one shared addendum serves both harnesses. The private run record stores the rendered addendum's SHA-256 alongside the rendered assignment hash. This file is maintained by hand; edit it to tune delegation wording.
