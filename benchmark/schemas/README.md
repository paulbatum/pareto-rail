# Record schemas

- `freeze.schema.json` describes the immutable shared-protocol record, including `controller-admin` components but excluding configuration-scoped runners and executors.
- `run-schedule.schema.json` describes the confidential preassigned execution order and slot-to-configuration mapping.
- `run-manifest.schema.json` describes the complete private run record and the redacted manifest published after unblinding.
- `ranked-set.schema.json` describes the preferred slot-only, best-to-worst tier ranking for all currently playable entrants from one theme.
- `ranking.schema.json` retains the legacy/targeted binary pair format.
- `ranking-snapshot.schema.json` locks a set of judgments without preventing later configurations from entering a later snapshot.

These are working drafts until the first release freeze. Adapt token and harness fields using real rehearsal output rather than guessing that providers report usage identically. Manifest schema version 2 supports both measured pricing and an explicitly `unavailable` price when no honest list-price input exists; it never treats unavailable as zero. The current Terra rehearsal uses measured pricing from `benchmark/pricing/gpt-5.6-terra-standard-short.json`. In addition to JSON Schema validation, the runner should enforce cross-field rules such as complete registered-configuration × theme coverage for each schedule revision, runner/executor/recipe/pricing hashes at each configuration commit, append-only preservation of earlier assignments, unique run/slot/level ids, `<theme-id>-<slot-id>` level naming, exact tier coverage, required gate ids, stage-cost totals when pricing is measured, and payload-directory isolation.

`run-schedule.json` itself belongs under ignored `benchmark/private/`. Each eligible run records the hash of the append-only schedule revision that authorized it; a ranking snapshot records only slot ids until unblinding. Do not commit an example populated with realistic configuration and slot values because it could be mistaken for the live key.
