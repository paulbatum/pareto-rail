# Record schemas

- `freeze.schema.json` describes the immutable record that defines one benchmark release.
- `run-schedule.schema.json` describes the confidential preassigned execution order and slot-to-configuration mapping.
- `run-manifest.schema.json` describes the complete private run record and the redacted manifest published after unblinding.
- `ranking.schema.json` describes a slot-only blind pair judgment.

These are working drafts until the first release freeze. Adapt token and harness fields using real rehearsal output rather than guessing that providers report usage identically. Manifest schema version 2 supports both measured pricing and an explicitly `unavailable` price when no honest list-price input exists; it never treats unavailable as zero. The current Terra rehearsal uses measured pricing from `benchmark/pricing/gpt-5.6-terra-standard-short.json`. In addition to JSON Schema validation, the runner should enforce cross-field rules such as a complete configuration × theme schedule, unique run/slot/level ids, `<theme-id>-<slot-id>` level naming, winner membership in the compared pair, matching slot sets, required gate ids, stage-cost totals when pricing is measured, and payload-directory isolation.

`run-schedule.json` itself belongs under ignored `benchmark/private/`; only its hash enters the public freeze record until rankings are locked. Do not commit an example populated with realistic configuration and slot values because it could be mistaken for the live key.
