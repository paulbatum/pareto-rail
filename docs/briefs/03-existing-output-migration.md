# 03 — Migrate existing benchmark output

## Objective

Move existing generated benchmark content out of the built-in level domain by using the verified promotion path. Remove manual testing copies and leave one reproducible source of truth for each promoted result.

## Inventory

Build the migration inventory mechanically from private and published manifests. Do not classify levels as benchmark output based on names, visual style, or directory history.

For each candidate, record:

- benchmark version, run id, slot, theme, and level id;
- disposition and gate status;
- evaluated and payload commits;
- whether source is already present in the primary worktree;
- whether its bytes agree with the recorded payload; and
- whether public manifest or rollout evidence already exists.

Stop on duplicate ids, conflicting payloads, missing commits, or source that differs from its claimed payload.

## Work

1. Add an inventory/report mode to promotion tooling if brief 02 does not already provide it.
2. Identify all playable generated levels eligible for local promotion.
3. For manually copied source, compare every file against the payload commit before removing or replacing anything.
4. Promote each candidate through the same checkpoints used for future runs.
5. Remove benchmark entries from the built-in registry and move their source to `src/benchmark-levels/`.
6. Regenerate built-in and benchmark gallery/catalog outputs.
7. Verify ordinary browsing still exposes all promoted levels under the benchmark group.
8. Verify ranking eligibility contains benchmark levels only.
9. Preserve evaluated branches, payload branches, recovery refs, private records, and benchmark dispositions.
10. Produce a machine-readable migration record linking each promoted application commit to its source payload.

## Compatibility

Existing benchmark versions may have evaluated source at `src/levels/<id>/`. Treat relocation as post-run administration. Never rewrite historical evaluated or payload commits to pretend they used the new path.

Relative imports should remain valid because the new root retains the same directory depth, but verify this rather than assuming it. Any required source edit makes the promoted copy a derivative and must be recorded explicitly instead of silently changing payload bytes.

## Constraints

- Never guess which directories are generated output.
- Never delete a source copy until its payload and durable refs have been verified.
- Do not unblind unpublished schedule mappings as part of migration.
- Do not collapse rehearsal, eligible-run, and built-in provenance.

## Verification

- The migration report accounts for every manifest-classified playable output.
- Promoted source hashes agree with payload source hashes.
- Built-in discovery contains no migrated benchmark entry.
- Benchmark discovery contains every migrated playable entry exactly once.
- `npm run typecheck`
- `npm run build`
- Run the floor check for every migrated level.
- Run benchmark controller, catalog, and promotion tests.

## Done when

There are no manual benchmark copies or generated benchmark entries left in the built-in domain, and every promoted level has a verifiable path back to one successful payload.
