Pareto Rail was inspired by my love for [Rez](https://en.wikipedia.org/wiki/Rez_(video_game)) and distrust of my own bias on which models are best.

While I have a background in building software, this project is 100% vibe coded, and its my first time building something benchmark-ish. I've made many mistakes with plenty more to come. I welcome your feedback via [Twitter](https://x.com/paulbatum) or [GitHub](https://github.com/paulbatum/pareto-rail/issues).

## Rez

Rez is a brilliant example of the human creative spirit and the levels you can play on this site do not hold a candle to its beauty. At least, not yet. Rez is available on [Steam](https://store.steampowered.com/app/636450/Rez_Infinite/)

## Methodology

Every benchmark level here was built by an AI coding agent, unattended, in one shot. Each agent gets the same assignment: a short theme, the standing brief every level in this project is built to, and a clean checkout of the game with the hand-built levels as reference. Whatever it submits is what you play - no human edits, no retries for quality.

Before a level enters the pool it has to clear four mechanical gates: it must typecheck, build, stay inside its own level directory, and meet a basic gameplay floor.

Cost is measured after each run by replaying the agent's full transcript - including any subagents it spawned - against per-model pricing. Some entrants bill real metered API spend; others run on subscription plans and are priced the same way for comparability.

Judging is blind pairwise play. You get two levels built from the same theme. Your votes fit a Bradley-Terry model per entrant, plotted against average cost as your personal quality-versus-cost curve.

## Privacy

Pareto Rail uses Vercel Web Analytics to measure aggregate traffic. It sets no cookies, does not track you across sites, and does not build a profile of you.

The site does keep some things in your browser's local storage: your theme and display preferences, audio and visual settings, your best local run for each level, and the votes you've cast. That data stays on your device - clearing your browser storage erases it. Alongside it we store a random identifier that is generated in your browser and sent with your votes, so that repeat votes from the same visitor can be recognised when compiling the rankings. It isn't linked to any account or personal information, and we ask for no personal information anywhere on the site.
