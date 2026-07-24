# Recipe: pi-luna-high

Status: draft; authored for the v3 infrastructure shakeout. Not part of any eligible schedule until the v3 roster is frozen.

This configuration reaches `gpt-5.6-luna` through the pi CLI's `openai-codex` provider — the same model `codex-luna-high` reaches through the Codex CLI, in a different harness. Harness is part of the intervention, so the two are separate configuration ids. It is one unattended solo stage, not a controller-agent conversation: the deterministic controller starts a fresh pi CLI process in the opaque entrant worktree, captures its JSON event stream, then runs the normal administrative seal and gates. Unlike the v2 pi configurations, this recipe is written for scrubbed plans, so the stage runs under the entrant sandbox.

## Identity

- Configuration id: `pi-luna-high`
- Stages: `solo`
- Provider: `openai-codex` (pi's built-in provider; subscription-billed through the operator's stored credential)
- Model: `gpt-5.6-luna`
- Thinking level: `high`
- pi CLI: `0.80.10` or later
- Stage timeout: 43,200 seconds, matching the other solo configurations
- Task budget: none
- Continuations: none

## Shared inputs

- Entrant baseline: the run's declared baseline commit — a scrubbed baseline under this recipe's intended policy
- Shared assignment template: `benchmark/prompts/level-assignment.md`
- Rendered assignment: private controller artifact; supplied to the CLI as stdin byte-for-byte
- Standing brief: `docs/level-brief.md`
- Assigned theme: the frozen theme inserted into the rendered assignment
- Other supplied files: none
- Entrant checkout: the whole opaque worktree. The agent may read ordinary tracked repository material required by the standing brief. It must not receive `benchmark/private/`, other entrant worktrees, or any controller record; on a scrubbed baseline the `benchmark/` tree and promoted levels are absent from the checkout by construction.

## Runtime policy

- Operator interaction after launch: none.
- Working tree and network access: the entrant sandbox (`benchmark/controller/README.md`, "Entrant sandbox"). pi has no native sandbox, so the adapter loads the controller-owned sandbox extension (`scripts/benchmark/pi-sandbox-extension.js`, over Anthropic's `sandbox-runtime`): every bash command is wrapped, and pi's native `read`/`write`/`edit` tools are held to the same boundary. The entrant worktree is the only writable tree; the primary repository and the host `/tmp` are unreadable; external network egress is denied while loopback stays reachable for the floor and snapshot self-checks. Puppeteer is steered to `chrome-headless-shell` and `DISPLAY` is unset. The policy comes from the controller, not from any file the entrant can write.
- Harness continuation behavior: none. One fresh pi process and session per stage; no quota-wait extension is loaded for this provider.
- Failure behavior: a nonzero exit, timeout, missing session id, missing usage on the final assistant message, or unsupported effort stops the run for controller-failure classification. If the stage process dies through a timeout or reboot, the operator can resume the same session with `--continue-stage`, which writes per-round artifacts.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree and records its command, version, exit code, timing, and complete log as unmeasured deterministic setup. This is not a model stage.
- Commit behavior: the agent may use the normal repository workflow. After it exits, the controller seals permitted changes, then derives the payload.
- Controller usage treatment: deterministic/no model usage. The controller is a process runner, not a pi agent.

## Stage: solo

- Role: `solo`
- Model provider: `openai-codex` through pi, subscription billing — not metered API spend.
- Exact model selection: `gpt-5.6-luna` at `high` reasoning effort. The provider does not expose a dated Luna snapshot; the adapter's model-catalog capture is the audit record.
- Harness and version: pi CLI `0.80.10` or later; the adapter records the installed version at launch.
- Session: fresh process; the adapter's normal isolated `PI_CODING_AGENT_DIR` and native session capture apply.
- Working tree access: the entrant sandbox (see Runtime policy above).
- Input artifacts from earlier stages: none.
- Required output artifact: code changes in the entrant worktree plus `final-message.md` and the captured event stream in private controller storage. The controller also copies the CLI's native session transcript when available.
- Stage timeout: 43,200 seconds.
- Completion condition: pi exits zero, reports one session id, and its final assistant message reports usage.

### Verbatim prompt

```text
The controller supplies the rendered benchmark assignment as the complete stdin prompt, byte-for-byte. No controller preface, progress note, or extra handoff text is added.
```

### Harness invocation

```sh
npm run benchmark:pi -- \
  --worktree /tmp/pareto-rail-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/pi \
  --model gpt-5.6-luna \
  --provider openai-codex \
  --effort high \
  --sandbox true \
  --timeout-seconds 43200
```

The stage runs `--offline --no-extensions` plus the controller-owned sandbox extension, so startup version checks and operator-installed extensions cannot vary between runs. pi's `message_update` events are dropped as they stream (each is superseded by its `message_end`; the dropped count is recorded), per `benchmark/README.md`.

### Credential

The `openai-codex` provider authenticates with pi's stored credential, not an API key: the controller copies the operator's `~/.pi/agent/auth.json` into the isolated per-run home, the same mechanism the Claude and Codex stages use for their subscription credentials. `credential-source.json` records `pi-stored-credential` — the expected value for this configuration.

## Review and revision limits

This is a solo configuration. There are no plan, review, revision, retry, or operator-feedback stages.

## Mechanical gates

The controller runs only the four standard gates specified in `benchmark/controller/README.md` after sealing. No additional eligibility gate is declared by this recipe.

## Cost

Measured by [ccusage](https://github.com/ccusage/ccusage), pinned in the repository's `package.json` and invoked with the repository's own Node, using its pi view (`--pi-path` scoped to this run's isolated sessions directory) as described in `benchmark/README.md`. pi reports per-call usage in each `message_end`; the adapter sums assistant messages within the invocation and the controller applies the standard ccusage cross-check. The manifest records `cost.totalUsd`, per-model detail in `cost.models`, and provenance in `cost.costSource`. Because this configuration bills through a subscription, measured figures are rate-priced usage rather than metered spend; the subscription fee is reported separately, never allocated across runs.

## Known harness defaults

- pi has no OS-level sandbox of its own; the enforced boundary comes entirely from the controller-owned sandbox extension described above. Unattended operation still runs `--approve` inside that boundary.
- The stage runs `--offline --no-extensions` plus the explicit controller-owned extension, so no operator-installed extension can vary between runs.
- The browser used by self-checks is `chrome-headless-shell` (full Chrome cannot start under the sandbox).
