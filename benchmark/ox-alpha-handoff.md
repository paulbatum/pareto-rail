# Ox Alpha: ranked without a price

`stealth/ox-alpha` is a cloaked model on OpenRouter. OpenRouter publishes it at a zero price and bills nothing for it, and pi has no catalog entry for the id, so pi's session figure comes from a fallback rate card and describes no charge anyone incurred. The configuration `pi-openrouter-ox-alpha-high` therefore has no cost anyone can report.

## Current state

- Six runs record `cost.status: "unavailable"`. They keep their token counts and carry no dollar figure.

  | Run | Level | Theme |
  | --- | --- | --- |
  | `run-v31izg5mbm` | `vespers-1izg` | vespers |
  | `run-v3gnffufye` | `tinker-ball-gnff` | tinker-ball |
  | `run-iz2agir3l4` | `thermal-ink-v1d2` | thermal-ink |
  | `run-y5zd577spu` | `broadside-7hin` | broadside |
  | `run-aoefz3t98p` | `strandline-o848` | strandline |
  | `run-a7pqr4gm2o` | `speedsolve-nfof` | speedsolve |
- Every entrant publishes without a `generationCost`. They are scheduled, voted on, and rated like every other entrant, and their votes count toward the fit.
- The configuration's point has no mean cost, so the quality-vs-cost chart leaves it out and prints a note naming it, while the quality-vs-output-tokens chart plots it.
- The configuration is featured, so it takes part in the pairs a first-time visitor's opening comparison is drawn from.
- The levels page files its levels under the `stealth` category: shown by default, playable, badged "Stealth", and priced as "Not priced".
- The model id sits in `UNPRICED_MODELS` in `scripts/benchmark/run.mjs`, so a further run on it also records an unavailable cost.
- The home page names Ox Alpha in its "Featuring" list. Nothing else on that page singles the model out.

## When the model is named and priced

Follow "Pricing a model that could not be priced" in [`README.md`](README.md#cost). It covers dropping the id from `UNPRICED_MODELS`, restating every run above from its retained token counts on a `rate-card` basis, renaming the model wherever it is displayed, and the exports and checks to run afterwards. Pricing the model puts its point on the cost chart; it does not change its ranking, because the entrants are already ranked.

Two things that do not change: the configuration id `pi-openrouter-ox-alpha-high` and the six level ids above. Production votes reference them, and `docs/compat.md` holds them immutable. The model's real name reaches the site through the display label alone.
