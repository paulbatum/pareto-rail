# Benchmark publishing and ranking briefs

Work through these briefs in order. Each brief should leave the repository committed and its verification commands passing before starting the next.

1. `01-benchmark-level-domain.md` — separate built-in and benchmark level source, then add automatic benchmark discovery.
2. `02-benchmark-promotion.md` — promote successful payloads into the application through a verified, resumable operation.
3. `03-existing-output-migration.md` — migrate existing benchmark-generated content through the promotion path.
4. `04-benchmark-authoring-protocol.md` — make future entrants author directory-only benchmark levels without registry edits.
5. `05-ranking-experience.md` — make eligible local comparisons appear automatically and implement per-user play, judgment, and reveal.
6. `06-publication-and-evidence.md` — publish levels, manifests, sanitized rollouts, and ranking evidence safely.

The benchmark runner's generation result and later application promotion are separate records. A promotion or publication failure must never change a completed run's disposition.

Resilience philosophy: this is a fun project, not a hardened pipeline. Interruptions (session limits, timeouts, crashes) are expected, and the recovery story is "run the command again" — commands should be idempotent and verify before destroying, not maintain checkpoint/resume state machines.
