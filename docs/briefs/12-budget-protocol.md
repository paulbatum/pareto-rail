# Brief 12 — Budget protocol: mid-session spend notices and under-budget continuation

## Motivation

Different agents calibrate effort very differently on the level-building assignment:
Claude Fable overshoots (happily spending far past any reasonable budget) while Codex
models undershoot (submitting early with budget unspent). To make configurations
comparable, the benchmark gains a **budget protocol**: each run is given a soft USD
budget, the agent receives relative spend notices as it works, and a run that finishes
well under budget is resumed and told to keep improving.

The budget is a **guide, not a hard cap**. Nothing kills a run for exceeding it; the
protocol only informs (on the way up) and nudges (past 100%) — and pulls back agents that
stop too early.

Models cannot calibrate against absolute dollar amounts, only against the work they have
already done. Every message the agent sees is therefore framed in **percent of budget**,
never dollars, and the initial assignment mentions only that a budget exists.

## Validated mechanisms (do not re-research these)

An experiment suite validated everything below on Claude Code CLI 2.1.207 and Codex CLI
0.144.1 (the pinned benchmark harnesses). Full auditable results:
`/tmp/claude-1000/-home-pbatum-vibes-raild/2a09165b-6f27-4c35-9a6d-171c45520f68/scratchpad/budget-exp/RESULTS.md`
(read it if you need more detail; the essentials are inlined here).

### Mid-turn context injection — PostToolUse hooks, both harnesses

Both CLIs support a `PostToolUse` hook whose stdout can inject context the model sees on
its next step. The working payload is **identical for both** and `hookEventName` is
**mandatory** (Codex silently drops the context without it):

```json
{"hookSpecificOutput":{"additionalContext":"<notice text>","hookEventName":"PostToolUse"}}
```

Hook config delivery that works without touching the entrant worktree:

- **Claude**: pass `--settings <file>` (an extra settings file containing only the
  `hooks` block) alongside the existing `--setting-sources project` flags. Confirmed to
  compose. Do NOT use `<worktree>/.claude/settings.json` — it does not load headlessly.
  Hook config shape:

  ```json
  {"hooks":{"PostToolUse":[{"matcher":"","hooks":[{"type":"command","command":"node <abs-path-to-hook> <abs-path-to-budget-dir>"}]}]}}
  ```

- **Codex**: write the same shape (without `matcher`) to `$CODEX_HOME/hooks.json` — it
  loads despite `--ignore-user-config` — and add `--dangerously-bypass-hook-trust` to the
  command line. `--strict-config` does not object. The `--json` stream gains two
  non-fatal `item.completed` warning items from the trust bypass; the terminal
  `turn.completed` with usage is unaffected.

Hook processes inherit the parent CLI's environment, and both receive the event JSON on
stdin (`hook_event_name`, `tool_name`, `session_id`, `cwd`, …), but prefer passing the
budget state directory as an **argv argument** baked into the command string.

### Under-budget continuation — headless resume, both harnesses

- **Claude**: `claude --print --output-format stream-json --verbose --resume <session-id>
  <same flags as the first turn, including --settings, but WITHOUT --session-id>` with
  the follow-up message on stdin. The terminal `result.session_id` is the ORIGINAL
  session id, the original rollout file is appended (no new file), and ccusage aggregates
  all turns under the one session.
- **Codex**: `codex exec resume <thread-id> --json --color never --ignore-user-config
  --ignore-rules --strict-config -m <model> -c model_reasoning_effort=... -c
  approval_policy="never" -c sandbox_mode="workspace-write" -c
  sandbox_workspace_write.network_access=true --dangerously-bypass-hook-trust
  --output-last-message <turn-specific-file> -` **launched with cwd = the worktree**.
  Critical: `exec resume` has no `-C`/`-s` flags and does NOT persist the original
  session's model, effort, or sandbox — it uses the launch cwd and defaults back to the
  default model and read-only sandbox unless every override is re-passed. The
  `thread.started.thread_id` stays the original and the original rollout file is
  appended. `$CODEX_HOME/hooks.json` keeps applying on resume.

### Mid-run cost measurement

`measureRunCost` (scripts/benchmark/ccusage-cost.mjs) works against a **live** per-run
home: ~0.16–0.22s per invocation, monotonic totals, no crashes on partially written
rollouts. One caveat: before the harness writes its first rollout (~10–25s in), ccusage
exits nonzero ("no valid data directories" / zero sessions) and `assertMeasurable`
fails — the poller must treat that as "spend $0 so far", not an error.

Note: `summarizeCost`/`assertMeasurable` currently `fail()` (process exit) on bad input —
the poller needs a non-fatal path (e.g. call the underlying pieces with try/catch, or add
a `{ tolerateEmpty: true }` mode). Never let a poller hiccup kill a multi-hour run.

### Wording hazard

Claude's system context already contains a `<budget:token_budget>` annotation. All
protocol text must say **"task budget"** and never "token budget", so the two cannot be
confused.

## Design

### Configuration surface

- Run definitions (`schedule.mjs` validation, consumed by `run.mjs`) gain an optional
  `stage.budget` object: `{ "usd": 20 }`. `usd` must be a positive finite number. Absent
  budget block → zero behavior change anywhere.
- `run.mjs` passes it to the adapter as `--budget-usd <n>`.
- Both adapters (`claude-cli.mjs`, `codex-cli.mjs`) accept optional `--budget-usd`.
  Without it they behave exactly as today (byte-for-byte identical artifacts).
- Protocol constants live in one new module (see below), not in recipes or definitions:
  notice step 25 percentage points, minimum submit fraction 0.75, max resume rounds 3,
  poll interval 30s.

### New module: `scripts/benchmark/budget.mjs`

Pure, unit-testable logic plus the state-file contract:

- Threshold schedule: notices at every 25% multiple (25, 50, 75, 100, 125, …) with no
  upper bound. When a poll jumps across several thresholds at once, announce only the
  **highest** newly crossed one and mark the skipped ones as announced.
- Notice text selection (exact strings, `{pct}` substituted):
  - below 100%: `Task budget status: approximately {pct}% of the task budget has been used.`
  - at 100%: `Task budget status: approximately 100% of the task budget has been used. The budget is a guide rather than a hard cap, but you should now be working toward finalizing your submission.`
  - above 100%: `Task budget status: approximately {pct}% of the task budget has been used. You are over budget — bring the work to a close and finalize your submission.`
- Resume decision: resume when `finalFraction < 0.75` and `roundsUsed < 3` and enough
  wall-clock remains (see timeout handling). Resume message (exact string):
  `Budget check: you have used approximately {pct}% of the task budget, so meaningful budget remains. This is an opportunity to keep improving your level: raise the polish, depth, and quality wherever it falls short of your own standards. Continue working now; you will keep receiving task budget updates as you go.`
- State files (all writes atomic: temp file + rename), kept in a `budget/` directory
  under the adapter's stage output directory:
  - `spend.json` — written by the poller: `{ budgetUsd, spentUsd, fraction, measuredAt }`.
  - `announced.json` — written by the hook: `{ announcedPct: <highest announced>, history: [{pct, spentUsd, at}] }`.

### New hook script: `scripts/benchmark/budget-hook.mjs`

Invoked by both harnesses as `node <abs path> <abs budget-dir>`. It must be fast,
dependency-free, and **never fail**: on any error or missing file it exits 0 printing
nothing. Happy path: read `spend.json` and `announced.json`, compute the highest newly
crossed threshold; if there is one, print the injection payload (shape above, with
`hookEventName: "PostToolUse"`) and update `announced.json`. Concurrent duplicate
invocations are tolerable (worst case a duplicate notice); atomic rename keeps the state
file itself consistent.

### Adapter changes (both `claude-cli.mjs` and `codex-cli.mjs`)

When `--budget-usd` is present:

1. Create `<out>/budget/` and seed `spend.json` with zero spend.
2. Install the hook:
   - Claude: write `<out>/budget/hook-settings.json` and add `--settings <that path>` to
     the args.
   - Codex: write `$CODEX_HOME/hooks.json` (the adapter already runs with the per-run
     home in `CODEX_HOME`) and add `--dangerously-bypass-hook-trust`.
3. Start an in-process poller (setInterval, 30s): call the cost measurement against the
   per-run home (`CLAUDE_CONFIG_DIR`/`CODEX_HOME` env, exactly like run.mjs does after
   the stage), tolerant of the empty-home window, and rewrite `spend.json`. Unref/clear
   the timer so it can never keep the process alive.
4. Run the first turn exactly as today.
5. After a zero-exit turn: take a final cost measurement, then apply the resume decision.
   To resume, run the harness-specific resume invocation above with the resume message on
   stdin, then repeat step 5 (bounded by max rounds / remaining time). A nonzero exit or
   timeout in any turn stops the loop and is recorded like today's failure path.
6. Timeout handling: `--timeout-seconds` remains the budget for the WHOLE stage. Track a
   deadline from the first spawn; give each subsequent turn only the remaining time, and
   skip the resume if fewer than 10 minutes remain.

Artifacts (auditability first, backward compatibility second — run.mjs and results.mjs
must keep working for both budget and non-budget runs):

- First-turn artifacts keep their current names (`events.jsonl`, `command.json`,
  `raw-usage.json`, …). Resume turns write suffixed siblings (`events-resume-1.jsonl`,
  `command-resume-1.json`, `raw-usage-resume-1.json`, …).
- `final-message.md` must end up holding the LAST turn's final message.
- New `<out>/budget.json` summary: budgetUsd, protocol constants used, notice history
  (from `announced.json`), per-round resume records (round, spentUsd, fraction,
  startedAt/finishedAt, exitCode), final spend and fraction.
- `result.json` gains a `budget` field referencing that summary (null/absent when the
  protocol is off). Session-id validation: Claude resume turns must report the ORIGINAL
  session id (hard-fail otherwise, matching the existing strictness); Codex resume turns
  must report the original thread id.
- Rollout capture: unchanged paths — both harnesses append the original rollout file, so
  the existing capture logic runs once after the last turn and picks up everything.

### Assignment prompt line

When (and only when) the run definition carries a budget, the rendered assignment gains
one appended paragraph (check `render-assignment.mjs` and the template in
`benchmark/prompts/level-assignment.md` for where rendering happens; keep the mechanism
consistent with how other conditional content is rendered, or append in run.mjs before
writing the rendered artifact if that is cleaner):

> There is a cost budget for this task. You will receive task budget status updates as
> you work.

Nothing else — no dollar amount, no protocol description.

### run.mjs / schedule.mjs / manifest

- `schedule.mjs`: accept and validate the optional `budget` key on stage objects (update
  the allowed-key sets and validation, with tests).
- `run.mjs`: pass `--budget-usd` through to the adapter; surface the `budget.json`
  summary in the manifest (a `budget` section on the stage record). Check
  `results.mjs`'s `manifestErrors` and any schema under `benchmark/schemas/` and extend
  them so budget manifests validate; keep non-budget manifests valid unchanged.
- `manage-run.mjs` status output: if trivial to do, show current spend fraction for an
  active budget run (read `spend.json`); skip if invasive.

### Recipes and docs

- Add two new recipe files modeled closely on the existing ones:
  - `benchmark/recipes/claude-fable-5-high-b20.md` (from `claude-fable-5-high.md`)
  - `benchmark/recipes/codex-sol-high-b20.md` (from `codex-sol-high.md`)
  Each declares `budget.usd: 20` in its identity/stage description and REPLACES the
  "Harness continuation behavior: none" language with an accurate description of the
  budget protocol: the hook injection channel (including the exact `--settings` /
  `hooks.json` + trust-bypass delivery), the notice schedule and exact notice strings,
  the resume gate (min fraction 0.75, max 3 rounds, deadline-bounded), the exact resume
  invocations, the artifact layout for multi-turn stages, and the fact that ccusage
  measures the whole home so all turns and the protocol itself are included in run cost.
  Keep every other section (gates, cost, rollout capture, known defaults) accurate for
  the multi-turn reality.
- `docs/benchmark-plan.md`: add a short "Budget protocol" subsection (a paragraph or
  two) describing intent (effort calibration across differently-calibrated agents), the
  soft-cap semantics, and pointing at the recipes for mechanics.

## Tests and verification

- New `scripts/benchmark/test-budget.mjs` (+ `test:benchmark-budget` npm script wired
  like the existing test scripts): unit-test the pure logic — threshold crossing
  including multi-threshold jumps and no-upper-bound behavior, notice text selection at
  75/100/125, resume decision boundaries (fraction, rounds, deadline), state round-trip
  and atomicity contract, hook payload shape (must contain `hookEventName`).
- Hook script test: run `node budget-hook.mjs <dir>` against fixture state dirs
  (fresh crossing → payload on stdout + announced.json updated; nothing new → empty
  stdout; missing/corrupt files → empty stdout, exit 0).
- Extend the existing controller tests (`npm run test:benchmark-controller`) for the new
  definition validation and any manifest changes.
- Everything must pass: `npm run test:benchmark-controller`, `npm run
  test:benchmark-budget`, `npm run typecheck`, `npm run build`.

### Live smoke test (do this; it is the point of the exercise)

Replicate the experiment setup in a throwaway directory OUTSIDE the repo (e.g. under
/tmp): a tiny scratch git repo as the worktree, isolated homes seeded with the operator
credentials (`cp ~/.claude/.credentials.json <home>/.credentials.json`;
`cp ~/.codex/auth.json <home>/auth.json`; chmod 600), and drive the REAL adapters:

```
CLAUDE_CONFIG_DIR=<home> node scripts/benchmark/claude-cli.mjs \
  --worktree <scratch> --prompt <toy-prompt-file> --out <fresh-out-dir> \
  --model claude-haiku-4-5-20251001 --effort low --budget-usd 0.03 --timeout-seconds 600
```

and the codex equivalent with `--model gpt-5.6-luna --effort low --budget-usd 0.05`.
Use a toy prompt that forces ~8 sequential small file-creation commands and says nothing
about budgets. With budgets that tiny, notices WILL fire mid-run, and a quick first turn
will land under 75% at least once, so the resume loop exercises for real. Verify from the
artifacts: notice(s) present in `budget.json` and visible in the rollout as injected
context; at least one resume round with the original session/thread id; `final-message.md`
from the last turn; ccusage-measured spend recorded; `result.json` well-formed. Also run
one control per adapter WITHOUT `--budget-usd` and confirm artifacts are shaped exactly
as before (no budget/ dir, no extra flags in command.json). Keep total smoke spend under
$1. Summarize smoke evidence (paths + what was checked) in your final report.

## Constraints

- Do not commit. Report verification results honestly and precisely.
- Do not modify entrant-facing material beyond the single assignment paragraph.
- Do not add configuration knobs beyond `budget.usd`; the other constants are code.
- Keep the no-budget path byte-identical in behavior and artifacts.
- Never let poller/hook failures kill or corrupt a run; degrade to "no notices".
- Comment style: match the existing benchmark scripts — explain constraints and
  non-obvious contracts, not narration.
