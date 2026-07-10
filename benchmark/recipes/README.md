# Agent recipes

Store one verbatim recipe per benchmark configuration at a stable path, such as `fable-solo.md` or `delegation.md`. Start from `template.md`.

A recipe states the exact model snapshot, harness and version, prompts and supplied files, session boundaries, allowed stages, time limits, review and revision rules, hidden harness defaults, controller-usage treatment, and token and wall-time capture. `benchmark/controller/runbook.md` executes these declarations without adding workflow decisions. The recipe is the intervention being measured.

Recipes may change while the protocol is being designed and rehearsed. At freeze, the release record hashes the final files and Git preserves their exact content. After the first eligible run, a behavior-changing edit at the stable path requires a new benchmark release; do not create parallel `-v1` and `-v2` recipe files.
