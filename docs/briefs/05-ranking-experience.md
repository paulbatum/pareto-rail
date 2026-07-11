# 05 — Build local and public pair ranking

## Objective

As promoted runs accumulate, automatically offer blind pair comparisons for themes with at least two playable benchmark levels. Each participant plays anonymously, commits a judgment, and only then sees entrant identities and evidence.

## Blinding model

Blinding is a presentation policy, not a security boundary. The repository and deployed JavaScript may contain identities. The interface must avoid presenting identity before judgment, but it does not need to resist a participant deliberately inspecting source or network data.

State this policy clearly in user-facing ranking instructions.

## Catalog model

Create a benchmark ranking catalog that distinguishes:

- public level identity and title;
- opaque slot and theme membership;
- run and payload provenance;
- playable/promotion status;
- reveal metadata such as configuration, model, cost, source, manifest, and rollout links; and
- ranking-snapshot membership.

Do not infer theme membership from the level id when authoritative manifest data exists.

## Pair availability

1. Read promoted playable benchmark entries only.
2. Group them by theme.
3. Make a theme rankable as soon as it has at least two entries.
4. Generate stable pair or ranked-set identifiers and randomized presentation order.
5. Preserve existing judgments as later runs add new pairs.
6. Avoid presenting the same unordered pair repeatedly to one participant unless replay is explicitly requested.

Use existing ranking schedule and validation machinery where it fits; extend it rather than creating an incompatible second record format.

## Participant flow

For each comparison:

1. Explain that identities remain hidden until judgment.
2. Present anonymous A/B levels in randomized order.
3. Require or strongly guide the participant to play both.
4. Accept preference or tie, plus the existing required play-count evidence.
5. Persist and lock the judgment before reveal.
6. Reveal model, configuration, cost, source, manifest, and sanitized rollout links for that pair.
7. Continue to the next available comparison.

Persist progress locally for local use. Design the storage boundary so a public deployment can later use a server-side participant/session store without rewriting ranking logic.

## Ordinary browsing

The regular level browser may show all built-in and benchmark levels openly. Ranking anonymity applies only inside the ranking flow. Clearly label benchmark outputs and keep built-in levels out of pair generation.

## Constraints

- Never reveal one side before the judgment is durably recorded.
- Do not count navigation or a partial comparison as a ranking.
- Do not change old judgments when new entrants arrive.
- Do not expose private credentials, operator paths, or unpublished schedule information in reveal metadata.
- Preserve opaque presentation order in ranking records.

## Verification

- Zero or one promoted level for a theme produces no comparison.
- A second playable promoted level makes a comparison available without a code edit.
- Built-in levels never enter ranking sets.
- Refreshing mid-pair preserves safe progress without recording a verdict.
- Refreshing after judgment shows the reveal and does not permit silent verdict replacement.
- Adding a third level preserves prior judgments and adds only newly possible comparisons.
- Validate generated ranking records with benchmark ranking tooling.
- Test local and production builds.

## Done when

A participant can work through automatically available benchmark comparisons, remain presentation-blind until each judgment, and inspect full entrant evidence immediately after committing it.
