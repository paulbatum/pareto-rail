# Heap gate collection timing

## Record

`run-v3q1cid4ze` was recorded as a DNF on a failing floor gate. The failing gate was `heap monotonic slope` inside the headless performance check, reported as `34.2 MB net, 0.6 MB/s slope, 83% non-decreasing steps`.

That gate failed only when three conditions held at once: slope above `0.35 MB/s`, net growth above `32 MB`, and at least 70% of samples non-decreasing. The level was over the slope and monotonicity terms throughout its construction, and the `32 MB` net-growth term was the only one holding the verdict green.

Net growth was measured as the last sample minus the first, from a heap sampled once per simulated second without collecting first. A sampled heap sawtooths: it climbs between collections and drops when one fires. The measurement therefore captured uncollected garbage as much as retention, and its value depended on whether a collection happened to fire near the final sample. This level's last fifteen seconds are quiet — its simulation reports a spawn gap from 53.5s to 59.5s — so nothing prompted a collection in the tail and the run ended at the top of a sawtooth.

## Measurement

Re-running the unmodified gate against the sealed commit `287bf2c94940a906f76bf7c3c1a4b0c5c2598865` produced a bimodal result on identical code, commit and command: about `34 MB` (fail) or about `23–26 MB` (pass), with nothing in between.

Which mode a run lands in tracks host load. Eight runs on an idle host all failed at about `34 MB`. Fifteen runs with the host loaded passed six times. The mechanism is consistent with the sawtooth: load stretches the wall-clock time of a fixed-step run, which gives the collector more real time to fire during the level's quiet tail, and a collection there drops the final sample by the ten megabytes that separate the two modes.

That also accounts for the original divergence. The entrant's floor checks ran on a host busy with its own agent harness and landed in the passing mode three times. The gate ran minutes later, after the stage process had exited, and landed in the failing mode.

The entrant ran the floor check four times. Its first run failed on a different and genuine problem — geometry growth of `5.13×`, from defeated models not releasing their unique geometries — which it diagnosed and fixed. That run is also the only one whose heap numbers it ever saw, and they read as a pass: `30.3 MB net, 0.5 MB/s, 85% non-decreasing`, which is `1.7 MB` of margin on a `32 MB` threshold. After the fix, `check:floor` printed the performance table only in its failure branch, so its remaining three runs reported `performance gate failures: 0` and nothing further. The entrant could not see that it was inside 5% of a limit.

Measuring the same commit with a forced collection before each heap read gives `7.7 MB` retained, identical across three consecutive floor checks. Across the whole corpus on that measure — 55 promoted benchmark levels and the 5 built-ins — the highest promoted level retains `6.6 MB` and the built-in helios retains `8.6 MB`. The level sits between them. Its accumulation is bounded and deliberate: the premise is a ball that collects what it destroys, and it attaches at most 116 pieces.

With the corrected tooling the sealed commit passes every floor gate with no warnings, three runs out of three.

## Actions

The heap measurement now forces a collection before every read, so the column is retention rather than sawtooth position. The two heap gates are replaced by one `heap retention` gate — late-window mean minus the seconds 2–5 mean, allowance `16 MB` — which does not turn on collection timing at either endpoint.

Every performance gate now carries a two-tier verdict. The allowances are the budget a level is authored to; a gate allows `1.5×` that before failing, and a level in between is reported as a warning that does not fail a run. A single threshold made an author's local check and the benchmark gate the same coin flip, which is what happened here.

`check:floor` prints its performance gates on every run rather than only on failure, and surfaces a gate over the authoring budget as a floor warning. A bare pass hid the one number the entrant needed.

The floor check runs from the entrant checkout, so these changes reach runs cut from the next baseline rather than runs already sealed against an earlier one. `run-v3q1cid4ze` is therefore reclassified by the failure policy rather than by a regate: its DNF was a defect in the gate, not a failure of the entrant's output.
