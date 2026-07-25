# Recipe: codex-sol-max

Status: draft; authored for the v3 roster. Not part of any eligible schedule until the v3 roster is frozen.

This is the maximum-effort Sol configuration: the same unattended Codex CLI mechanism as `codex-luna-high`, pointed at `gpt-5.6-sol` with `model_reasoning_effort="max"`. Reasoning effort is the intervention being measured against `codex-sol-high`, so nothing else about the configuration differs. It is one unattended solo stage, not a controller-agent conversation. The deterministic controller starts a fresh `codex exec` process in the opaque entrant worktree, captures its JSONL event stream, then runs the normal administrative seal and gates. Like the other v3 Codex recipes and unlike v2's `codex-sol-high`, this recipe is written for scrubbed plans, so its network policy is loopback-only isolation rather than v2's open network.

`gpt-5.6-sol` is one of the two catalog slugs offering an effort above `max` (`ultra`); this recipe deliberately stops at `max`. A separate `ultra` configuration would be a separate configuration id, never a silent substitution here.

## Identity

- Configuration id: `codex-sol-max`
- Stages: `solo`

## Shared inputs

- Entrant baseline: the run's declared baseline commit — a scrubbed baseline under this recipe's intended policy
- Shared assignment template: `benchmark/prompts/level-assignment.md`
- Rendered assignment: private controller artifact; supplied to the CLI as stdin byte-for-byte
- Standing brief: `docs/level-brief.md`
- Assigned theme: the frozen theme inserted into the rendered assignment
- Other supplied files: none
- Entrant checkout: the whole opaque worktree. The agent may read ordinary tracked repository material required by the standing brief. It must not receive `benchmark/private/`, other entrant worktrees, or any controller record; on a scrubbed baseline the `benchmark/` tree and promoted levels are absent from the checkout by construction.

## Runtime policy

- Overall timeout: 43,200 seconds, measured from process launch to exit.
- Operator interaction after launch: none.
- Network access: isolated. On a scrubbed plan the row's `networkAccess` defaults to `false`: the adapter runs Codex under its permission profile with managed `network_proxy` mode and `allow_local_binding=true`, so external egress is denied while loopback keeps working for the entrant's dev-server-backed self-checks (`npm run check:floor`). Puppeteer is steered to `chrome-headless-shell` and `DISPLAY` is unset, per `benchmark/controller/README.md` ("Entrant sandbox"). No `--search`.
- Working tree access: the entrant worktree is the only writable tree; the primary repository and the host `/tmp` are outside the sandbox boundary.
- Harness continuation behavior: none. The controller starts one fresh local `codex exec` process per stage and never issues `codex exec resume`, `fork`, or any continuation command.
- Failure behavior: a nonzero exit, timeout, missing JSONL session id, missing `turn.completed` usage, or unsupported model/effort stops the run for controller-failure classification. At an eligible freeze, the controller must additionally compare the captured CLI/catalog artifacts to their frozen identities before classifying the run.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree and records its command, version, exit code, timing, and complete log as unmeasured deterministic setup. This is not a model stage.
- Commit behavior: the agent may use the normal repository workflow. After it exits, the controller seals permitted changes, then derives the payload.
- Controller usage treatment: deterministic/no model usage. The controller is a process runner, not a Codex agent.

## Stage: solo

- Role: `solo`
- Model provider: OpenAI Codex subscription
- Exact model selection: `gpt-5.6-sol` with `model_reasoning_effort="max"`. The CLI does not expose a dated Sol snapshot; capture `codex --version`, the complete bundled model catalog, and the selected catalog entry. Do not describe this alias-like catalog slug as a weight-pinned snapshot. The adapter refuses to launch if the bundled catalog entry for the slug does not list `max` among its supported reasoning levels.
- Harness and version: Codex CLI `0.145.0` is pinned for this configuration, matching the other v3 Codex recipes. The adapter records the installed version at launch; a version other than the pinned one is a controller failure rather than a silent substitution.
- Session: fresh process following the continuation policy above. Native session persistence remains enabled for rollout capture.
- Working tree access: write access only to the entrant worktree through the adapter's sandbox profile (see Runtime policy).
- Input artifacts from earlier stages: none.
- Required output artifact: code changes in the entrant worktree plus `final-message.md` and the `--json` event stream in private controller storage. The controller also copies the CLI's native session rollout when available.
- Stage timeout: 43,200 seconds.
- Completion condition: `codex exec` exits zero, reports one session id, and reports non-negative integer `input_tokens` and `output_tokens` in its final `turn.completed` JSONL event.

### Verbatim prompt

```text
The controller supplies the rendered benchmark assignment as the complete stdin prompt, byte-for-byte. No controller preface, progress note, or extra handoff text is added.
```

### Harness invocation

```sh
npm run benchmark:codex -- \
  --worktree /tmp/pareto-rail-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/codex \
  --model gpt-5.6-sol \
  --effort max \
  --network-access false \
  --timeout-seconds 43200
```

The exact effective Codex arguments — the permission profile, `features.network_proxy=true`, `--ignore-user-config`, `--ignore-rules`, `--strict-config` — are constructed by the adapter (`scripts/benchmark/codex-cli.mjs`) and recorded verbatim in the run's `command.json`. Session rollout capture, isolation of `CODEX_HOME`, and credential copy match `codex-sol-high.md`.

### Usage and timing capture

Identical to `codex-sol-high.md`: usage from the `--json` stdout preserved as `events.jsonl`, tokens from `turn.completed.usage`, session id from `thread.started.thread_id`, wall-time boundaries around process spawn and exit in `command.json`, raw records under `benchmark/private/runs/<opaque-run-id>/stages/solo/codex/`.

## Review and revision limits

This is a solo configuration. There are no plan, review, revision, continuation, retry, or operator-feedback stages.

## Mechanical gates

The controller runs only the four standard gates specified in `benchmark/controller/README.md` after sealing. No additional eligibility gate is declared by this recipe.

## Cost

Measured by [ccusage](https://github.com/ccusage/ccusage) (pinned in the repository's `package.json`) against this run's isolated `CODEX_HOME`, exactly as described in `codex-sol-high.md`: ccusage prices the persisted rollouts with its own rate database; the manifest records `cost.totalUsd` and provenance in `cost.costSource`. ccusage attributes per-model tokens but not per-model cost for Codex, so a Sol run at `max` and one at `high` are indistinguishable in the per-model breakdown and are told apart by the run's configuration id. The run bills the operator's subscription; the subscription fee is reported separately, never allocated across runs.

## Known harness defaults

- Codex CLI is run non-interactively with `codex exec`; no TUI, resume, cloud task, or approval prompt is involved.
- The bundled model catalog and binary version are captured at every run because the Sol slug is not a dated model snapshot, and because the set of reasoning levels a slug offers is a property of the bundled catalog rather than of the recipe.
- Codex receives the tracked repository instructions, including `AGENTS.md`; the controller injects no additional system prompt.
- Personal user configuration and exec-policy rules are ignored; web search is not enabled.
- Network isolation is loopback-only via managed `network_proxy`; the browser used by self-checks is `chrome-headless-shell` (full Chrome cannot start under the sandbox).
- Reasoning effort is a harness-level knob with no prompt counterpart: nothing in the rendered assignment tells the entrant which effort it is running at.
