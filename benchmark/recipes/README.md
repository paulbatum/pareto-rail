# Agent recipes

Store one verbatim recipe per benchmark configuration at a stable path, such as `fable-solo.md` or `delegation.md`. Start from `template.md`.

A recipe states the exact model snapshot, harness and version, prompts and supplied files, session boundaries, allowed stages, time limits, review and revision rules, hidden harness defaults, controller-usage treatment, and token and wall-time capture. `benchmark/controller/runbook.md` executes these declarations without adding workflow decisions. The recipe is the intervention being measured.

Recipes may change while the protocol is being designed and rehearsed. At freeze, the release record hashes the final files and Git preserves their exact content. After the first eligible run, a behavior-changing edit at the stable path requires a new benchmark release; do not create parallel `-v1` and `-v2` recipe files.

`codex-terra-high.md` is the current first-trial draft. It demonstrates a one-stage non-interactive `codex exec` recipe with captured JSONL usage, the dated Terra standard-price input, and the draft failure taxonomy. It remains rehearsal-only until the full release protocol is frozen. `codex-sol-high.md` declares the matching Sol configuration and must be rehearsed before it becomes eligible.

`claude-fable-5-high.md` is the first Claude Code configuration trial, using the same one-stage non-interactive pattern against `claude --print --output-format stream-json`. It documents a material difference from the Codex configurations: Claude Code CLI has no OS-level sandbox, so unattended operation relies on `--permission-mode bypassPermissions` rather than an enforced filesystem/network boundary. It remains rehearsal-only.
