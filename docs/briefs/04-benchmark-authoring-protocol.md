# 04 — Make future benchmark outputs directory-only

## Objective

Update the next benchmark protocol version so entrants author directly under `src/benchmark-levels/<id>/` and never edit shared registry code. This simplifies scope checking and baseline preparation.

## Protocol boundary

Historical releases and manifests stay as they are and keep validating against their original paths. Introduce the new source-root contract as a new protocol version; dispatch on the recorded benchmark version rather than probing which directory exists.

## Work

1. Add a benchmark mode to the scaffolder that creates `src/benchmark-levels/<id>/` with `index.ts`, the descriptor (from the assigned id and title), the usual spine/leaf files, and `level.md` — no registry edit.
2. Update the benchmark assignment text and level-authoring guidance to use the benchmark root.
3. Point scope checking and payload extraction at the declared output root: an entrant touches only its own directory plus explicitly permitted derived artifacts.
4. Make floor, simulation, snapshot, and gameplay tooling resolve benchmark-discovered levels.
5. Replace the mixed-registry allowlist with a baseline check: the built-in tree matches expectations and the benchmark output area is empty apart from permanent discovery infrastructure. One command, concise pass/fail output.
6. Update controller tests to cover both the old and new protocol versions.

## Constraints

- Don't modify frozen historical records, and don't make v1 run recovery depend on the new path.
- The descriptor must not become a second, unvalidated source of gameplay identity.

## Verification

- Scaffold a synthetic new-protocol level and confirm it appears in dev, simulation, snapshot, and floor tooling with no registry edit.
- Confirm scope checking rejects edits outside the assigned directory.
- Confirm baseline validation fails when a previously promoted benchmark directory is present.
- `npm run test:benchmark-controller`, `npm run typecheck`, `npm run build`

## Done when

A future entrant can build a complete, discoverable, gateable benchmark level while touching only its assigned directory.
