# Pareto Rail

Pareto Rail is a procedural WebGPU rail shooter and a public benchmark experience for one-shot model-built levels. Visitors can play the polished Crystal Corridor reference, compare development entrants blind, and inspect quality-versus-cost results without launching WebGPU gameplay.

The production site is [paretorail.vercel.app](https://paretorail.vercel.app/).

The main routes are `/levels`, `/play/<id>`, `/rank`, `/leaderboard`, and `/about`. Older links such as `/play` and `?level=crystal-corridor` remain supported.

## Run it

```sh
npm install
npm run dev
```

Requires a WebGPU-capable browser (recent Chrome/Edge). Esc pauses and opens volume/glow/fullscreen settings. Shift+D toggles the play UI for a clean view. On iPhone/iPad Safari, use Share → Add to Home Screen for the closest fullscreen experience.

The Rank page stays provisional until an eligible public catalog and backend are connected; rehearsal levels are retained only in ignored benchmark records and are not playable or rankable in the app. Built-in levels live under `src/levels/`; promoted benchmark outputs are discovered from self-contained directories under `src/benchmark-levels/`.

## Tools

```sh
npm run snapshot -- --module src/levels/crystal/visuals/crystal.ts --export createCrystalNode
npm run snapshot:gameplay -- --level crystal-corridor --time 12
npm run snapshot:gameplay -- --level helios --thumbnails 8
npm run snapshot:gameplay -- --level helios --sheet --times 4,12,24,48
npm run snapshot:gameplay -- --level helios --time 12 --projectiles
npm run benchmark:catalog -- validate --source path/to/catalog.json --mode production
```
