# Mechanism: soft task budget

A configuration that sets `budget.usd` in its plan row calibrates effort with a soft USD budget. The entrant is told a budget exists, receives relative spend notices as it works, and is resumed in the same harness session while it keeps submitting well under budget.

The budget is guidance, not a cap. Exceeding it never kills a run.

This is a mechanism, not a knob, because it changes what the entrant sees: notice text arrives mid-run and follow-up text arrives on resume. The budget *amount* is the knob.

## Where the authority lives

The exact wording the entrant receives is in `scripts/benchmark/budget.mjs` — `noticeText()` and `RESUME_MESSAGE_TEMPLATE` — and the stopping rule is `shouldResume()` in the same file. That source is pinned by the plan's materials commit, so the words any run delivered are recoverable from that commit. Do not transcribe them here: a prose copy can drift from the code, and the code is what ran.

Per run, `budget.json` records the protocol constants in force, the `noticeHistory` with each threshold's percentage, measured spend, and timestamp, the resume rounds taken, and the final measured spend and fraction.

## Shape of the protocol

The controller polls the run's isolated harness home with ccusage and publishes spend state atomically. Notices fire at every 25% multiple with no upper bound; a poll that crosses several multiples announces only the highest and marks the lower ones covered. The notice text changes character at 100% and again above it, moving from a bare status line to an instruction to finalize.

After a successful turn the controller resumes whenever measured spend is below the minimum submit fraction and enough wall-clock time remains before the stage deadline. Resumes are not capped at a small fixed count — the submit fraction is the stopping condition, bounded by the deadline and by a defensive round backstop no honest run should reach. The resume message tells the entrant that leaving most of the budget unused will keep getting it resumed, and asks it to raise the quality of its level.

## How each harness delivers it

Claude and Codex deliver notices through command hooks written into the run's isolated harness home, which inject the notice without modifying the entrant worktree. Because both adapters also ignore user configuration, they explicitly bypass hook trust for these controller-written hooks. pi loads only the controller-owned extension, which steers the same notice after a tool finishes.

Continuation is same-session on every harness. Codex resumes the original thread and every resumed event stream must report the original thread id; Claude and pi likewise continue the established session. Resume rounds write round-suffixed artifacts alongside the first turn's files, and the final message is replaced by the last turn's answer. The whole-stage deadline is shared by all turns — no continuation gets a fresh timeout.

For how the per-round usage counters are summed or not summed into a run total, which differs between pi and the others, see `benchmark/README.md`, "Cost", and each harness document.

## Rehearsal

The protocol itself was rehearsed cheaply against a small budget before being used on expensive configurations: 14 resume rounds, notice text matching across harnesses, and correct stopping once spend crossed the submit gate. A configuration reaching this protocol through a new billing path — metered API spend rather than a subscription credential — is worth rehearsing again on that path, since what is being confirmed is the spend polling rather than the notice delivery.

### Under the entrant sandbox

Rehearsed once per sandboxed harness, because the hook reads its state from under `benchmark/private/` — a path the sandbox hides — and discards every error, so a blocked read would have produced a green run whose entrant was never told anything.

Delivery is confirmed on all three: the notice wording appears verbatim in each entrant's own transcript, which is the evidence to check, not the notice history alone. The history is written by `claimBudgetNotice` running inside the hook, so it is better than a controller-side record, but the transcript is what proves the text reached the model's context.

One artifact of rehearsing cheaply is worth knowing before reading these runs as a full pass. Against a $2 budget, the two runs on inexpensive models exhausted the 20-round defensive backstop while still at 35% and 46% of budget, so they ended on the round limit rather than by crossing the submit fraction — they exercised delivery and resumption but never the intended stopping condition. Only the run whose spend actually reached the budget exercised the natural stop, and it did so correctly, resuming once and halting past the threshold. A cheap smoke therefore cannot confirm the stopping rule; a configuration whose spend approaches its budget is what does that.
