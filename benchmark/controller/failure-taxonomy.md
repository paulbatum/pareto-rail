# Benchmark failure taxonomy

Status: draft. Freeze this artifact before an eligible run and include its hash in every private run definition.

## Controller failure

A controller failure is an administrative or harness condition that prevents the declared intervention from being executed or evaluated as written. It includes an unavailable or mismatched frozen artifact, a worktree that is not at its declared baseline, failed deterministic dependency provisioning, entrant-harness CLI startup or model-identity validation failure (e.g. Codex's model-catalog check, or Claude Code reporting a session id that does not match the pre-assigned one), absent or malformed required JSONL usage, failure to persist controller records, a gate that changes the sealed tree, or an invalid payload extraction.

Do not classify a controller failure as an entrant DNF. Preserve its records and spend. A rerun is allowed only if the frozen release explicitly permits reruns for that exact controller-failure code; the first rehearsal does not rerun automatically.

## Entrant DNF

An entrant DNF is a completed declared agent stage whose sealed evaluated result fails a required mechanical gate, including level scope, typecheck, build, or floor. It also includes a cleanly returned agent stage that leaves no permitted level result to seal. Preserve the evaluated commit, gate logs, raw usage, and spend; do not derive a playable payload or launch it for blind ranking.

## Unclassified failure

If the controller cannot mechanically distinguish these cases, stop and record an unclassified failure. Do not retry, repair, add a continuation, or choose a favorable classification during the run. Resolve the taxonomy at the protocol level before a later run.
