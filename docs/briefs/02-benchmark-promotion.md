# 02 — Add verified, resumable benchmark promotion

## Objective

Turn a successful benchmark payload into locally playable application content without manual copying or registry editing. Promotion is deterministic post-run administration and must remain separate from the benchmark result.

## Command shape

Provide a command with an interface similar to:

```bash
npm run benchmark:promote -- --run <run-id>
```

It should be safe to invoke repeatedly. The benchmark controller may invoke it after finalizing a playable manifest, but an operator must also be able to resume it independently.

## Preconditions

Before modifying application source, verify mechanically that:

- the run manifest is complete and has playable disposition;
- every required gate passed;
- `evaluated.json`, `payload.json`, and the manifest agree;
- evaluated and payload commits resolve and match their recorded refs;
- the payload diff is non-empty and contains only the assigned level directory;
- the source directory does not collide with a built-in or promoted benchmark level; and
- run, slot, theme, level, and title metadata agree with the run definition.

## Work

1. Add a promotion state record with atomic checkpoints for validation, extraction, descriptor creation, application verification, catalog update, and commit.
2. Support existing payloads whose source is `src/levels/<id>/` by relocating the directory mechanically to `src/benchmark-levels/<id>/`.
3. Preserve every payload file byte-for-byte during relocation.
4. Create the benchmark descriptor from controller-owned assignment data, not from guessed names or prose.
5. Do not hand-edit a benchmark registry; discovery from brief 01 must make the directory available.
6. Regenerate any derived gallery or catalog artifacts.
7. Run typecheck, build, scope-equivalent checks, and the promoted level's full floor check.
8. Commit promotion as a separate administrative commit. Record the promotion commit and source payload commit privately.
9. Make repeated invocation validate and reuse completed checkpoints rather than duplicate source or commits.
10. Treat promotion failure as its own resumable failure. Never rewrite the run manifest or change playable disposition.
11. Serialize promotion operations so simultaneous completed runs cannot race while updating derived artifacts or Git state.

## Local completion behavior

A playable run should enter the local application automatically after successful promotion. If automatic invocation fails, status tooling must report “run completed, promotion pending/failed” and provide the resume command.

## Constraints

- Do not merge the evaluated branch into the application branch.
- Do not copy registry or gallery changes from an entrant's evaluated commit.
- Only the verified directory payload and controller-owned descriptor cross the promotion boundary.
- Do not expose private configuration identity through public level descriptors.
- Keep Git operations recoverable and refuse to overwrite unrelated local changes.

## Verification

- Promote a synthetic successful run into a temporary repository.
- Interrupt promotion at every checkpoint and verify successful resumption.
- Invoke promotion twice and verify no second source copy or commit is created.
- Tamper independently with the manifest, payload ref, payload contents, and descriptor destination; each must be rejected.
- `npm run typecheck`
- `npm run build`
- `npm run check:floor -- --level <promoted-level-id>`

## Done when

A finalized playable run becomes ordinary locally playable benchmark content through one verified command, and no manual source or index edit is required.
