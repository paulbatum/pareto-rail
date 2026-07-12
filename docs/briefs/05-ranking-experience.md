# 05 — Build local pair ranking

## Objective

As promoted runs accumulate, automatically offer blind pair comparisons for any theme with at least two playable benchmark levels. A participant plays both levels anonymously, records a judgment, and then sees who made what.

## Blinding model

Blinding is a presentation courtesy, not a security boundary. Identities exist in the repo and the deployed JavaScript; the interface just doesn't show them before judgment. Say this plainly in the ranking instructions.

## Pair availability

1. Group promoted playable benchmark entries by theme, using manifest data (not level-id parsing).
2. A theme becomes rankable at two entries; new entries add new pairs without disturbing existing judgments.
3. Randomize A/B presentation order and record which order was shown.
4. Don't re-present a pair the participant has already judged unless they ask to replay it.

Reuse the existing ranking schedule/validation machinery where it fits rather than inventing a parallel record format.

## Participant flow

1. Tell the participant identities are hidden until they judge.
2. Present the pair as anonymous A/B; guide them to play both.
3. Accept a preference or a tie.
4. Save the judgment, then reveal model, configuration, cost, and evidence links for the pair.
5. Offer the next available comparison.

Persist progress in local storage or similar. Keep the storage access behind a small interface so a server-backed store could replace it later, but don't build the server side now.

Losing an in-progress (unjudged) comparison to a refresh is acceptable; losing recorded judgments is not. A recorded judgment stays recorded — don't offer silent replacement after reveal.

## Ordinary browsing

The regular level browser shows everything openly, benchmark outputs clearly labeled. Anonymity applies only inside the ranking flow. Built-in levels never enter pair generation.

## Verification

- A theme with fewer than two promoted levels produces no comparison; adding a second makes one available with no code edit.
- Adding a third level preserves prior judgments and adds only the new pairs.
- Judging then refreshing shows the reveal, not a fresh judgment prompt.
- Generated ranking records validate with the existing ranking tooling.
- `npm run typecheck` and `npm run build`

## Done when

A participant can work through the available comparisons blind, and inspect full entrant evidence right after each judgment.
