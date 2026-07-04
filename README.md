# raild

A procedural WebGPU rail shooter for the browser. Hold the mouse button and sweep across targets to lock up to six, then release to fire a homing volley. Lock all six START! targets to begin.

Use the level picker in the lower-left corner, or open `?level=crystal-corridor` or `?level=prism-bloom` directly.

## Run it

```sh
npm install
npm run dev
```

Requires a WebGPU-capable browser (recent Chrome/Edge). Esc pauses and opens volume/glow/fullscreen settings. On iPhone/iPad Safari, use Share → Add to Home Screen for the closest fullscreen experience.

## Tools

```sh
npm run snapshot -- --module src/levels/crystal/visuals/crystal.ts --export createCrystalNode
npm run snapshot:gameplay -- --level crystal-corridor --time 12 --immortal
```
