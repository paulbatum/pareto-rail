# Recipe: pi-kimi-k3-max

Status: verified for launch. This is the Moonshot-subscription sibling of `pi-openrouter-kimi-k3-max`: the same model at the same thinking level, reached through Moonshot's own `kimi-coding` provider on a paid subscription instead of metered OpenRouter serving. Serving path and billing both differ from the OpenRouter configuration, so this is its own configuration id rather than a continuation of that one; the two are separate entrants in the catalog.

This configuration is one unattended solo stage, not a controller-agent conversation. The deterministic controller starts a fresh pi CLI process against Moonshot's `kimi-coding` provider, in the opaque entrant worktree, captures its JSON event stream, then runs the normal administrative seal and gates.

## Identity

- Configuration id: `pi-kimi-k3-max`
- Stages: `solo`
- Provider: `kimi-coding` (Moonshot's own endpoint, subscription-billed). This provider is not built into pi: it is registered by the `pi-provider-kimi-code` extension package installed in the operator's pi home (`0.6.7` at verification). Because the stage runs `--no-extensions`, the adapter loads the package's entry explicitly via `--extension` (explicit paths stay active under that flag) through its per-provider extension map; a missing package fails the stage before launch with an install hint.
- Model: `k3`. This id is absent from the provider's model catalog, so pi warns `Model "k3" not found for provider "kimi-coding". Using custom model id.` and passes it through; the warning is expected and harmless, and the adapter's catalog capture is audit-only. The upstream model is the same Kimi K3 the OpenRouter configuration reaches as `moonshotai/kimi-k3`.
- Thinking level: `max`, the model's only supported reasoning tier — see `pi-openrouter-kimi-k3-max.md` for why this stands in for the `high` tier the other solo configurations use.
- pi CLI: `0.80.10` or later, matching the OpenRouter recipe's pin.
- Stage timeout: 43,200 seconds, matching the other solo configurations.
- Task budget: none.
- Continuations: quota-window waits are handled inside this one pi process and session; there are no separate controller continuation turns.

## Shared inputs

Identical to `pi-openrouter-kimi-k3-max`: the rendered assignment on stdin byte-for-byte, the standing brief, the assigned theme, and the whole opaque entrant checkout with the same exclusions (`benchmark/private/`, other entrant worktrees, other controller records).

## Runtime policy

- Operator interaction after launch: none.
- Network access: unrestricted. pi has no OS-level sandbox; unattended operation relies on `--approve` trusting the entrant worktree, the same material harness difference documented in `pi-luna-low-smoke.md`.
- Harness continuation behavior: the controller-owned quota-wait extension is active for this `kimi-coding` stage. On `agent_end`, it examines the last assistant message and recognizes a case-insensitive `access_terminated_error` signature or an error containing both `403` and `usage limit`. It records the interruption in `quota-wait/quota-waits.jsonl`, waits 900,000 milliseconds, and queues this exact same-session continuation message:

  > `You were interrupted by a provider usage limit and have been resumed in the same session. Continue the assignment from where you left off and finish it per the original instructions.`

  It can ride out up to 50 quota waits before allowing the provider error to end the run. Every detected wait and resumed attempt is recorded in `quota-wait/quota-waits.jsonl`. This deliberately differs from the other solo configurations, whose stages run in one uninterrupted window.
- Failure behavior: quota interruptions are ridden out in-process. A nonzero exit, a quota-wait cap, a stage timeout, missing session id, missing usage on the final assistant message, unsupported effort, or a missing provider extension package stops the run for controller-failure classification. If the stage process dies through a timeout or reboot, the operator can resume the same session with `--continue-stage`, which writes per-round artifacts.
- Dependency provisioning: before this stage, the controller runs `npm ci` in the fresh worktree and records its command, version, exit code, timing, and complete log as unmeasured deterministic setup. This is not a model stage.
- Commit behavior: the agent may use the normal repository workflow. After it exits, the controller seals permitted changes, then derives the payload.
- Controller usage treatment: deterministic/no model usage. The controller is a process runner, not a pi agent.

## Stage: solo

- Role: `solo`
- Model provider: Moonshot `kimi-coding`, subscription billing — not metered API spend.
- Exact model selection: `k3` at `max` reasoning effort (see Identity above).
- Harness and version: pi CLI `0.80.10` or later.
- Session: fresh process; the adapter's normal isolated `PI_CODING_AGENT_DIR` and native session capture apply.
- Working tree access: no OS sandbox (see Runtime policy above).
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
  --model k3 \
  --provider kimi-coding \
  --effort max \
  --timeout-seconds 43200
```

The adapter appends `--extension <operator-home>/.pi/agent/npm/node_modules/pi-provider-kimi-code/index.ts` from its per-provider extension map (see Identity). Isolation, capture, and failure handling otherwise match `pi-openrouter-kimi-k3-max.md`, including the same `--offline --no-extensions` stage settings.

### Credential

The `kimi-coding` provider authenticates with pi's stored OAuth credential, not an API key: the controller copies the operator's `~/.pi/agent/auth.json` (which holds the `kimi-coding` OAuth tokens) into the isolated per-run home, the same mechanism the Claude and Codex stages use for their subscription credentials. The adapter's key resolution has no entry for this provider, so `credential-source.json` records `pi-stored-credential` — for this configuration that is the expected value, not the attribution warning it is for the OpenRouter configuration.

## Review and revision limits

This is a solo configuration. There are no plan, review, revision, retry, or operator-feedback stages; quota-window recovery is an internal wait within the one session, not a separate continuation stage.

## Mechanical gates

The controller runs only the four standard gates specified in `benchmark/controller/README.md` after sealing. No additional eligibility gate is declared by this recipe.

## Cost

Cost is measured by [ccusage](https://github.com/ccusage/ccusage), pinned in the repository's `package.json` (`20.0.17`) and invoked with the repository's own Node, using its pi view (`--pi-path` scoped to this run's isolated sessions directory) as described in `benchmark/README.md`. The manifest records ccusage's computed USD as `cost.totalUsd` and the tool/version provenance in `cost.costSource`. Because this configuration bills through a subscription, its measured figures are rate-priced usage rather than real metered spend — the same subscription caveat that applies to the Claude and Codex solo configurations, and the key cost-basis difference from `pi-openrouter-kimi-k3-max`. The subscription fee itself is reported separately as actual expenditure, never allocated across runs. Measurement remains one session and one pi invocation; wall-clock time includes quota waits, while active time can be recovered by subtracting the recorded wait intervals in `quota-wait/quota-waits.jsonl`.

## Known harness defaults

- pi has no OS-level sandbox; unattended operation relies on `--approve` trusting the entrant worktree, not an enforced boundary.
- The stage runs `--offline --no-extensions` plus the explicit provider extension, so startup version checks and other operator-installed extensions cannot vary between runs.
- **Verified (2026-07-19):** the exact stage condition — an isolated `PI_CODING_AGENT_DIR` holding only the copied `auth.json`, the stage flags, and the explicit provider extension — was exercised with a live trivial call: exit 0, `message_end.message.usage` carried the full expected shape (`input`, `output`, `cacheRead`, `reasoning`, `totalTokens`, and a `cost` object), and the pinned ccusage pi view priced the resulting session as `[pi] k3` with a per-model cost matching the session's own recorded total exactly. Without the explicit extension the same call fails at startup with `No credentials found for kimi-coding`, which is the failure signature to look for if the package is ever missing or moved. Sustained-load behavior of the model itself under a real assignment is evidenced by the completed full-scale OpenRouter run of the same model (`pi-openrouter-kimi-k3-max` on strandline); this recipe's serving path has not yet been observed over a multi-hour stage.
