# Ox Alpha: held out of ranking until it can be priced

`stealth/ox-alpha` is a cloaked model on OpenRouter. OpenRouter publishes it at a zero price and bills nothing for it, and pi has no catalog entry for the id, so pi's session figure comes from a fallback rate card and describes no charge anyone incurred. The configuration `pi-openrouter-ox-alpha-high` therefore has no cost anyone can report.

## Current state

- Runs `run-v31izg5mbm` (`vespers-1izg`) and `run-v3gnffufye` (`tinker-ball-gnff`) record `cost.status: "unavailable"`. They keep their token counts and carry no dollar figure.
- Both entrants are flagged `retired` in `benchmark/private/publication.json`, so they stay playable in the gallery and take no ranked comparisons.
- Both publish without a `generationCost`, which keeps them out of the scheduling pool independently of the flag.
- The model id sits in `UNPRICED_MODELS` in `scripts/benchmark/run.mjs`, so a further run on it also records an unavailable cost.
- The home page names Ox Alpha with a note that it is unranked. Each catalog export warns that a named model publishes no live level; that warning is expected while this holds.

## When the model is named and priced

Follow "Pricing a model that could not be priced" in [`README.md`](README.md#cost). It covers dropping the id from `UNPRICED_MODELS`, restating both runs from their retained token counts on a `rate-card` basis, renaming the model wherever it is displayed, clearing the `retired` flags, and the exports and checks to run afterwards.

Two things that do not change: the configuration id `pi-openrouter-ox-alpha-high` and the level ids `vespers-1izg` and `tinker-ball-gnff`. Production votes reference them, and `docs/compat.md` holds them immutable. The model's real name reaches the site through the display label alone.

Votes cast on these entrants while they are unpriced are kept but excluded from the curve fit, and pricing the model brings them back into it.
