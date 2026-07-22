# Pareto Rail

Public site: [paretorail.com](https://paretorail.com/)

<!-- The region between these markers is also rendered on the site's About page.
     Keep the markers in place, and keep what's between them free of anything
     that only makes sense on GitHub. -->

<!-- site:start -->
Pareto Rail is inspired by my love for [Rez](https://en.wikipedia.org/wiki/Rez_(video_game)) and distrust of my own bias on which models are best. Its a procedural WebGPU rail shooter and a public benchmark for one-shot, model-built levels.

While I have a background in building software, this project is 100% vibe coded, and its my first time building something benchmark-ish. I've made many mistakes with plenty more to come. I welcome your feedback via [Twitter](https://x.com/paulbatum) or [GitHub](https://github.com/paulbatum/pareto-rail/issues).

## Rez

Rez is a brilliant example of the human creative spirit and the levels you can play on this site do not hold a candle to its beauty. At least, not yet. Rez is available on [Steam](https://store.steampowered.com/app/636450/Rez_Infinite/).

## Methodology

Every benchmark level here was built by an AI coding agent, unattended, in one shot. Each agent gets the same assignment: a short theme, the standing brief every level in this project is built to, and a clean checkout of the game with the hand-built levels as reference. Whatever it submits is what you play - no human edits, no retries for quality.

Before a level enters the pool it has to clear four mechanical gates: it must typecheck, build, stay inside its own level directory, and meet a basic gameplay floor.

Cost is measured after each run by replaying the agent's full transcript - including any subagents it spawned - against per-model pricing. Some entrants bill real metered API spend; others run on subscription plans and are priced the same way for comparability.

Some entrants run under a budget, shown in their label as an amount, for example "$20 budget". Those agents are told a budget exists and are informed of their spend as they work. If one submits a level having used less than 75% of the budget, it is sent back into the same session to keep improving what it built. The point is to see what a model does when it is pushed to use the room it has, so the budget is guidance rather than a cap - going over it doesn't end a run. Entrants without a budget label were left to decide on their own when the level was done.

Judging is blind pairwise play. You get two levels built from the same theme. I use Bradley-Terry for scoring, plotted against what each level cost to build.

The full agent transcript of every published run is available in the [pareto-rail-rollouts](https://huggingface.co/datasets/paulbatum/pareto-rail-rollouts) dataset on Hugging Face, and each run's provenance record is [checked into the repository](https://github.com/paulbatum/pareto-rail/tree/main/benchmark/manifests).

More details are available in the [benchmark readme](https://github.com/paulbatum/pareto-rail/blob/main/benchmark/README.md).
<!-- site:end -->

## Run it

I suggest you use a coding agent for repo setup, but this should get you started:

```sh
npm install
npm run dev
```

## License

Pareto Rail is available under the [MIT License](LICENSE). Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
