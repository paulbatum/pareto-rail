# 04 — Make future benchmark outputs directory-only

## Objective

Update the next benchmark protocol so entrants author directly under `src/benchmark-levels/<id>/` and never modify shared registry code. Simplify entrant-baseline contamination checks around the separate benchmark source domain.

## Protocol boundary

Historical releases and manifests are immutable. Existing versions continue to validate against their frozen paths and hashes. Introduce the new source-root contract only through a new protocol/configuration version with appropriately frozen runner, admin, prompt, schema, and documentation artifacts.

## Work

1. Extend scaffolding with a benchmark mode that creates:
   - `src/benchmark-levels/<id>/index.ts`;
   - the lightweight descriptor from the assigned id and title;
   - the normal spine/leaf files and `level.md`; and
   - no central registry edit.
2. Update benchmark assignment text and level-authoring guidance to use the benchmark root.
3. Parameterize scope checking and sealing around the declared output root. A benchmark entrant should be limited to its own directory and explicitly permitted derived artifacts only.
4. Update payload derivation and verification to extract `src/benchmark-levels/<id>/` for the new protocol.
5. Update floor, simulation, snapshot, audio-trace, and gameplay tooling to resolve benchmark-discovered levels.
6. Replace the mixed-registry allowlist control with baseline checks that:
   - verify the intended built-in tree and registry;
   - require the entrant baseline's benchmark output area to be empty except for permanent discovery infrastructure; and
   - fail on any previously promoted benchmark directory.
7. Keep generated application promotion outside the measured entrant stage.
8. Update release records and schemas where the output root or descriptor contract must be explicit.
9. Add compatibility dispatch based on benchmark version rather than probing whichever directory happens to exist.
10. Update synthetic controller tests for old and new protocol versions.

## Baseline preparation

Provide one deterministic command that constructs or validates a clean entrant baseline. It should print only a concise pass/fail report and should not require manually maintaining a list of every acceptable level id.

The command must distinguish permanent benchmark discovery infrastructure from promoted output directories.

## Constraints

- Do not modify frozen historical records.
- Do not make existing v1 run recovery depend on the new path.
- Do not let the descriptor become an unvalidated second source of gameplay identity.
- Do not weaken the directory-only payload guarantee.

## Verification

- Scaffold a synthetic new-protocol benchmark level without changing any shared registry.
- Confirm the level appears in development, simulation, snapshot, and floor tooling.
- Confirm scope accepts only the assigned benchmark directory and permitted generated files.
- Confirm a previously promoted benchmark directory makes baseline validation fail.
- Confirm historical definitions and manifests still parse and validate under their original contract.
- `npm run test:benchmark-controller`
- `npm run typecheck`
- `npm run build`

## Done when

A future entrant can create a complete, discoverable, gateable benchmark level while touching only its assigned directory, and baseline preparation no longer depends on a mixed level allowlist.
