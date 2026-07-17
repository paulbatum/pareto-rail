# Rollout analysis packages

Each `benchmark/analysis/<level-id>/` directory is a self-contained analysis of one benchmark run: the full agent rollout normalized into structured data, an editorial layer of sections and annotations, and reconstructed screenshots of what the agent saw while building. The packages are designed to drive a rich interactive "watch the agent build the level" view on the website.

Packages are derived from the private run artifacts under `benchmark/private/runs/<run-id>/` — the mechanical layers by `scripts/analysis/extract-trace.mjs`, the editorial layers by model analysis of the transcripts. Package directories are keyed by opaque level id and reveal identity only inside their file contents, so the blindness rule is one of timing: build and read a level's package only after you have finished voting on pairs involving that level. On the site, analysis is shown only behind the post-vote reveal.

## Package contents

Every file uses stable event ids (`ev-NNNN` for the main session, `<agent-id>-ev-NNNN` for subagents) and gives timestamps both absolute (ISO) and relative (`tSeconds` from run start). Annotations, sections, and snapshots all reference events by id, so the timeline is the join key for the whole package.

### Mechanical layer (script-generated, deterministic)

- `run.json` — run identity and outcome: configuration, models, timing, per-model cost and tokens, gate results, headline counts.
- `trace.json` — the main-session timeline. One entry per event (assistant text, thinking, tool call, tool result, subagent spawn/result), each with a compact human-readable summary line; bulky tool payloads are truncated with original sizes recorded.
- `subagents/agent-<id>.json` — one timeline per subagent in the same event schema, with the spawning prompt, final result, duration, usage, and a link back to the parent trace event.
- `files.json` — per-file edit history: every create/edit with event id, acting agent, time, and delta size, plus which files reached the final payload.
- `snapshot-moments.json` — every snapshot command the agent ran, ordered across all agents, with the files changed since the previous moment.

### Visual layer

- `snapshots/moment-<n>/*.png` — the images the agent rendered of its own work, reconstructed by replaying the recorded file operations to the exact tree state at each moment and re-running the agent's exact command in the same renderer.
- `snapshots.json` — index tying each image to its event, command, and the files changed since the previous moment, with per-moment reconstruction provenance and a final-state verification that the full replay reproduces the evaluated payload.

### Editorial layer (model-authored)

- `sections.json` — the run segmented into titled chapters (with subsections) covering the full duration; parallel subagent work overlaps honestly, with agent attribution.
- `annotations.json` — pointwise timeline callouts typed as decision, insight, mistake, recovery, delegation, verification, screenshot, milestone, budget, quality-flag, fix, or polish.
- `narrative.json` — headline, verdict, a section-tagged chronological story, delegation analysis, stat callouts, and open questions for a human reviewer.

## Extractor coverage

`extract-trace.mjs` reads both current flat run definitions and historical wrapped ones. Transcript parsing currently understands the Claude Code harness layout (`harness-home/projects/`, `stages/solo/claude/`); pi and Codex rollouts need their own parsers before those runs are extractable.

## Format lineage

The event-transcript shape follows the concepts that recur across rollout tooling — typed event timelines, parent-child spans for subagents, attachments, and an annotation overlay — and is closest in spirit to Inspect AI's eval-log format. Two parts are deliberately bespoke because no surveyed format models them: first-class file-edit history, and screenshots bound to the edit state that produced them. `benchmark/analysis/rollout-tooling-research.md` records the survey and the reasoning.
