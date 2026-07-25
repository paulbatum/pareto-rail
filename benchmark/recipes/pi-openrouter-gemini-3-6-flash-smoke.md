# Recipe: pi-openrouter-gemini-3-6-flash-smoke

Status: permanently ineligible controller smoke recipe.

This configuration exercises the sandboxed pi CLI boundary against `google/gemini-3.6-flash` on OpenRouter and the complete benchmark controller lifecycle, on the bounded Prism Bloom palette-swap theme. It must never be registered in an eligible schedule, promoted as an entrant, or included in benchmark analysis.

It exists to establish whether this model is worth an eligible configuration at all: confirming the controller-driven (not ad hoc) request shape, session capture, sandbox compatibility, and usage/cost measurement, at the `high` effort tier an eligible recipe would intend.

Serving path note: Google's own subscription tier is not reachable by an automatable supported client — the Gemini CLI rejects an individual subscription with `IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals`, directing the account to Antigravity. This recipe therefore reaches the model through metered OpenRouter serving. A subscription-backed configuration would use Antigravity through an unofficial pi provider extension and is a separate serving path, hence a separate configuration id, on the same split as `pi-openrouter-kimi-k3-max` versus `pi-kimi-k3-max`.

## Identity

- Configuration id: `pi-openrouter-gemini-3-6-flash-smoke`
- Stage: one unattended solo stage
- Provider: `openrouter`
- Model: `google/gemini-3.6-flash`. Present in pi's bundled `--list-models` catalog at `0.80.10`; the adapter's catalog capture is audit-only either way.
- Thinking level: `high`, passed as pi's ordinary named tier (`--thinking high` / the adapter's `--effort high`). Manually confirmed against a live call: the model accepts the named tier directly and produces nonzero reasoning tokens (132 on a trivial arithmetic prompt), so no numeric thinking-budget suffix (pi's `provider/id:<thinking>` pattern) is needed.
- pi CLI: `0.80.10`
- Stage timeout: 1800 seconds
- Task budget: none
- Continuations: none

## Inputs and execution

`scripts/benchmark/run.mjs` always renders the real `benchmark/prompts/level-assignment.md` template — it has no branch for an alternate smoke template — so this recipe runs the genuine standing-brief assignment against the plan row's theme, `benchmark/examples/prism-warm-palette.md`. What keeps it cheap is the 1800-second stage timeout, which simply cuts the process off; a run that hits it is expected to be an incomplete or interrupted stage, not a clean submission, and its cost is bounded by wall-clock rather than by task scope. The entrant receives the normal isolated worktree and repository instructions. The controller adds no feedback, repair prompt, or continuation.

The harness invocation is equivalent to:

```sh
npm run benchmark:pi -- \
  --worktree /tmp/pareto-rail-<opaque-run-id> \
  --prompt benchmark/private/runs/<opaque-run-id>/rendered-assignment.md \
  --out benchmark/private/runs/<opaque-run-id>/stages/solo/pi \
  --model google/gemini-3.6-flash \
  --provider openrouter \
  --effort high \
  --sandbox true \
  --timeout-seconds 1800
```

The adapter uses its normal isolated `PI_CODING_AGENT_DIR`, credential resolution, model-catalog capture, JSON event capture, native session capture, and ccusage cost measurement, with the same `--offline --no-extensions` stage settings as the other pi recipes. Because this row activates the entrant sandbox, the adapter loads the controller-owned sandbox extension over Anthropic's `sandbox-runtime`: every bash command is wrapped, and pi's native `read`/`write`/`edit` tools are held to the same boundary. The worktree is the only writable tree, the primary repository and host `/tmp` are unreadable, external network egress is denied while loopback stays reachable, and Puppeteer is steered to `chrome-headless-shell`. The sandbox policy comes from the controller, not from any file the entrant can write.

## Credential

The `openrouter` provider reads `OPENROUTER_API_KEY`. The adapter resolves it from the process environment first, then from the repository's ignored `.env`, and passes the resolved key to pi for this invocation only; the resolved source is recorded in the stage's `credential-source.json` and the key itself never reaches a run artifact. With no key on either path the adapter falls back to pi's own stored credential, which changes which account is billed — so a run whose `credential-source.json` reports `pi-stored-credential` for this configuration did not use the project key and its cost is attributed elsewhere.

Cost for this configuration is real metered API spend rather than subscription usage, so its measured figures are directly comparable to a published price list.

## Usage and timing capture

Usage source is pi's JSON event stream, as for the other pi recipes: each `message_end` event carries only that one API call's usage and the adapter sums assistant messages within the invocation, while `message_update` events are dropped as they stream and the dropped count is recorded alongside the retained log. A manual `--mode json` call confirmed the shape for this model: `message_end.message.usage` carries `input`, `output`, `cacheRead`, `cacheWrite`, `reasoning`, and `totalTokens`, plus a `cost` object with `input`/`output`/`cacheRead`/`cacheWrite`/`total` in USD. The pinned ccusage pi view priced that call as `[pi] google/gemini-3.6-flash` with a per-model cost matching the session's own recorded total exactly.

## Completion

After the real model stage exits, the normal controller seals the evaluated worktree, runs typecheck, build, directory-only scope, and floor gates, derives a payload for a passing run, and writes the private manifest. The output remains rehearsal-only and is not integrated into the application.
