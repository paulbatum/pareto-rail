# Agent recipes

Store one versioned, verbatim recipe per benchmark configuration. Start from `template.md`.

A recipe states the exact model snapshot, harness and version, prompts and supplied files, session boundaries, allowed stages, time limits, review and revision rules, hidden harness defaults, and token and wall-time capture. The recipe is the intervention being measured.

Recipes may change while the protocol is being designed and rehearsed. At the v1 freeze, hash the final files. After the first eligible run, never revise a recipe in place; a behavior-changing edit requires a new benchmark version.
