# 03 — Migrate existing benchmark output

## Objective

Move the existing generated benchmark levels out of `src/levels/` and the built-in registry into `src/benchmark-levels/`, using the promotion tooling. Afterward there should be one source of truth per promoted level and no benchmark entries left in the built-in domain.

## Approach

Build the candidate list from the benchmark manifests, not from level names or directory guesses. For each candidate, confirm its source bytes match the recorded payload commit before removing or replacing anything. If something doesn't match — duplicate ids, missing commits, source that differs from its payload — stop and report it rather than improvising.

The whole migration must be safe to re-run: if a run is interrupted (session limit, timeout, crash), running the command again should either finish the job or report clearly what state it found. Idempotence is the mechanism — skip work that is already done, redo work that is incomplete. No checkpoint files or resume state are needed.

## Work

1. Promote each eligible playable level via the promotion path from brief 02.
2. Remove migrated entries from the built-in registry and delete the old source copies once their payload commits are verified.
3. Regenerate gallery/catalog outputs.
4. Check that the level picker shows migrated levels under the benchmark group and that ranking eligibility sees benchmark levels only.
5. Write a short migration record (machine-readable is fine, a committed JSON file is enough) mapping each promoted level to its source run and payload commit.

## Constraints

- Never delete a source copy before its payload commit is verified to contain the same bytes.
- Don't rewrite historical evaluated or payload commits; relocation is post-run administration.
- Don't change any completed run's disposition.

## Verification

- `npm run typecheck` and `npm run build`
- Floor check each migrated level.
- Every manifest-classified playable output is either migrated or listed in the report with a reason.

## Done when

No generated benchmark levels remain in `src/levels/` or the built-in registry, every promoted level traces back to its payload commit, and re-running the migration is a no-op.
