# Record schemas

- `run-manifest.schema.json` describes the complete private run record and the redacted manifest published after unblinding.
- `ranking.schema.json` describes a slot-only blind pair judgment.

These are working drafts until the v1 freeze. Adapt token and harness fields using real rehearsal output rather than guessing that providers report usage identically. In addition to JSON Schema validation, the runner should enforce cross-field rules such as winner membership in the compared pair, matching slot sets, required gate ids, stage-cost totals, and unique run and ranking ids.
