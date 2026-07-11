# Pareto Rail

Pareto Rail is a procedural WebGPU rail shooter and a public benchmark experience for one-shot model-built levels. Visitors can play the polished Crystal Corridor reference, compare development entrants blind, and inspect quality-versus-cost results without launching WebGPU gameplay.

The main routes are `/play`, `/rank`, `/leaderboard`, and `/about`. Existing links such as `?level=crystal-corridor` remain supported.

## Run it

```sh
npm install
npm run dev
```

Requires a WebGPU-capable browser (recent Chrome/Edge). Esc pauses and opens volume/glow/fullscreen settings. On iPhone/iPad Safari, use Share → Add to Home Screen for the closest fullscreen experience.

Development mode exposes the five passing Downpour rehearsal entrants through the real local comparison flow. Production builds exclude that fixture and show a provisional Rank page until an eligible public catalog and backend are connected.

## Tools

```sh
npm run snapshot -- --module src/levels/crystal/visuals/crystal.ts --export createCrystalNode
npm run snapshot:gameplay -- --level crystal-corridor --time 12
npm run snapshot:gameplay -- --level helios --thumbnails 8
npm run snapshot:gameplay -- --level helios --sheet --times 4,12,24,48
npm run snapshot:gameplay -- --level helios --time 12 --projectiles
npm run benchmark:catalog -- validate --source benchmark/public/fixtures/downpour-rehearsal.json --mode development --fixture
npm run benchmark:thumbnails -- --level downpour-hlht --entrant entrant-a --dry-run
```
