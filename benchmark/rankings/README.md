# Blind rankings

Prefer one timestamped ranked-set record per theme and snapshot. Records name only the theme and anonymous slots, plus presentation order, play counts, best-to-worst tiers, and permitted notes. Slots in one tier are tied. Validate them against `benchmark/schemas/ranked-set.schema.json` and the generated set schedule.

Binary records under `ranking.schema.json` remain valid for targeted comparisons and historical snapshots; an exhaustive round robin is not required. A complete ranking contains implied pair preferences, but it is one correlated judgment rather than many independent observations.

Lock each snapshot with `ranking-snapshot.schema.json` before opening its slot mapping. Later configurations create a new set schedule and snapshot; never rewrite an earlier record with new slots or configuration names. Join configuration identity only in derived analysis.
