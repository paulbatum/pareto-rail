# Recipe: <configuration id>

Status: draft

A recipe is the complete intervention for one configuration. Replace every placeholder and preserve the final text verbatim after the freeze. If a harness adds hidden system instructions or default tools, identify them here or attach a captured artifact and hash it.

## Identity

- Configuration id: `<stable-id>`
- Stages: `<ordered stage ids>`

## Shared inputs

List every file or generated artifact available to this configuration. At freeze time, record paths and SHA-256 hashes. State whether the agent may browse the rest of the entrant checkout.

- Entrant baseline: `<freeze record reference>`
- Shared assignment template: `benchmark/prompts/level-assignment.md`
- Rendered assignment: `<private artifact path and hash>`
- Standing brief: `docs/level-brief.md`
- Assigned theme: `<theme path injected into the rendered assignment>`
- Other supplied files: `<paths or none>`
- Files not deliberately supplied: other themes, other recipes, the private run schedule and configuration mapping, private benchmark records, and other entrants. Worktree access follows `benchmark/controller/README.md`.

## Runtime policy

- Overall timeout: `<duration or none>`
- Operator interaction after launch: none
- Network access: `<policy>`
- Harness continuation behavior: `<policy>`
- Failure behavior: `<which failures stop the run>`
- Commit behavior: `<agent may follow the repository workflow; the controller commits permitted uncommitted changes while sealing the evaluated commit, then derives the payload>`
- Controller usage treatment: `<separate orchestrate stage, included elsewhere, unavailable, or deterministic/no model usage>`

Repeat the following section for every stage in execution order.

## Stage: <stage id>

- Role: `<orchestrate | plan | implement | review | revise | solo>`
- Model provider: `<provider>`
- Exact model snapshot: `<snapshot id; never an alias in the frozen recipe>`
- Harness and version: `<name and version>`
- Session: `<fresh session or continuation of stage id>`
- Working tree access: `<read/write boundaries>`
- Input artifacts from earlier stages: `<artifacts or none>`
- Required output artifact: `<artifact, code change, or review>`
- Stage timeout: `<duration or none>`
- Completion condition: `<mechanical condition; no operator judgment>`

### Verbatim prompt

```text
<exact prompt, including how the standing brief and theme are presented>
```

### Usage and timing capture

- Usage source: `<harness log, API response, or vendor dashboard>`
- Input-token field: `<field>`
- Output-token field: `<field>`
- Cache-read field: `<field or unavailable>`
- Cache-write field: `<field or unavailable>`
- Reasoning-token treatment: `<field and whether already included in output>`
- Session identifier source: `<field>`
- Wall-time boundaries: `<start and stop events>`
- Raw record path: `<private path convention>`

## Review and revision limits

State the exact number of review and revision stages, what a reviewer receives, whether the implementer continues an existing session, and what happens if a review artifact is empty or a revision fails. For a solo recipe, state explicitly that this section does not apply.

## Mechanical gates

The controller, not the agent, runs these after the final stage:

```sh
npm run typecheck
npm run build
npm run check:scope -- <level-id> <entrant-baseline-ref>
npm run check:floor -- --level <level-id>
```

Define whether any additional controller checks exist. They may record diagnostics but must not become undeclared eligibility gates.

The gates run against the exact evaluated working tree, including the agent's normal temporary registry and generated-gallery changes. After recording those results, the controller mechanically creates a separate payload commit from the frozen materials commit containing only `src/levels/<level-id>/`. Payload creation is benchmark administration, not an agent revision stage.

## Cost

Cost is measured by ccusage (pinned in the repository's `package.json`; the controller records the exact version in the manifest), invoked with the repository's own Node against this run's isolated harness home (`ccusage <claude|codex|pi> session --json`; pi also receives its isolated sessions path through `--pi-path`). State that here. Do not include a dated rate table: ccusage prices the persisted rollouts (parent plus any delegated subagents) with its own maintained rate database, and the manifest records ccusage's computed USD as `cost.totalUsd`, per-model detail in `cost.models`, and the tool/version provenance in `cost.costSource`. Note whether per-model cost is available (Claude and pi) or only per-model tokens (Codex), and that subscription expenditure is reported separately.

## Known harness defaults

Record behavior not expressed by the prompt but capable of affecting the result: system prompt, tool set, context compaction, retry policy, effort setting, permission mode, and automatic verification or review.
