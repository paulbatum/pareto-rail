# Brief: Enemy gallery + template tweaker at /dev

## Goal

A dev-only page at `/dev` for tuning the crystal enemy generator visually: a grid of generated enemies, a control panel for every tunable parameter (including the min/max *ranges* the RNG draws from), a larger inspect view with camera controls, and a Save button that writes the tuned values to disk so both the game and future sessions use them.

## Current state

- `src/visuals/crystal.ts` — `createCrystal(kind)` builds a crystal enemy from a glowing core, concentric hex frames + radial spokes, a disk of tetrahedral shards, and mirrored blade fins. All tuning values are hardcoded: per-kind values in `KIND_PARAMS` (weights, shardPairs, finPairs, shellRadius, elongation), everything else as literals in the function body (hex ring radii/intensities/z offsets, spoke dimensions, shard scale/distance/flatten/jitter ranges, fin angle spread/length/width/base distance, fill/edge intensities, core/glow sizes and intensities).
- Seeding: a module-global `nextSeed` counter feeds `mulberry32(seedBase + nextSeed * 7919)`, so every crystal is a distinct sibling.
- `src/visuals/post.ts` — bloom pipeline (`createPost`); the in-game look depends on it, so the gallery must render through the same pipeline.
- No `vite.config.ts` exists yet — the project runs on Vite defaults.
- There is a single enemy template today (the crystal generator) with three kind presets: `node`, `drifter`, `orbiter`. Letter targets are separate and out of scope.
- Renderer is **WebGPU only** (`WebGPURenderer` from `three/webgpu`), everything procedural — no textures/models/fonts.

## Part 1 — Extract the template

Create a `CrystalTemplate` type and move every aesthetic tuning value out of `crystal.ts` literals into it. Structure it as:

- `shared` — everything that applies to all kinds: hex rings (array of `{ radius, zOffset, intensity, colorRole: 'accent' | 'contrast', spinOffset }` — the current build has three), spokes (`count`, `radius`, `length`, `centerDistance`, `fillIntensity`, `edgeIntensity`), shards (`scale` ranges, `distanceMult` range, `flatten`, `tiltJitter`, `fillIntensity`, `edgeIntensity`), fins (`angleSpread`, `zTilt`, `lengthMult` range, `baseWidth` range, `tipWidth`, `baseDistanceMult` range, `fillIntensity`, `edgeIntensity`), core (`coreRadius`, `glowRadius`, `coreIntensity`, `glowIntensity`, `glowOpacity`).
- `kinds` — per-kind: `weights` (cyan/magenta/amber), `shardPairs`, `finPairs`, `shellRadius`, `elongation`.

Values the RNG draws from a span (shard scale, shard distance, fin length, fin base width, fin base distance) are represented as `[min, max]` pairs — these are the "ranges" the user tunes.

Store the defaults (the current hardcoded values, unchanged) in `src/visuals/crystal-template.json`; this file is the source of truth the game imports (enable `resolveJsonModule` in tsconfig if needed). `seedBase` per kind stays in code — it's identity, not aesthetics.

Change the signature to `createCrystal(kind, opts?: { seed?: number; template?: CrystalTemplate })`. Default behavior (no opts) must be identical to today: global seed counter, template from the JSON. The game's call sites don't change. Since core/glow geometry sizes become tunable, they can no longer be module-level shared constants — build them per crystal (or cache by size); enemy counts are small, either is fine.

Verify the refactor is lossless: with the JSON defaults, a given (kind, seed) must produce the same crystal as before the refactor.

## Part 2 — The /dev page

New entry: `dev/index.html` + a TypeScript entry (e.g. `dev/main.ts`) that imports from `src/visuals/`. Vite serves it during `npm run dev`; the production build stays untouched (root `index.html` only — the page is dev-only, since Save needs the dev server). Make sure `http://localhost:5173/dev/` resolves — if Vite's SPA fallback swallows it, add a tiny middleware redirect in the vite config from `/dev` and `/dev/` to `/dev/index.html`.

Layout (one page, dark, in the game's neon style but keep it simple — this is a tool):

1. **Template picker** — a dropdown with one entry, "crystal", plus a kind selector (`node` / `drifter` / `orbiter`). Structure the code so a second template could be added later without rework.
2. **Control panel** — grouped, collapsible sections mirroring the template structure (Hex frames / Spokes / Shards / Fins / Core / Kind). Every scalar gets a slider with a live numeric readout; every `[min, max]` range gets a paired min/max slider (two thumbs or two sliders — either is fine, but min must never exceed max). Sensible slider bounds ~0 to ~3× the default value. Kind section edits the currently selected kind. Include a "Reset to saved" button that reloads the last-saved JSON.
3. **Gallery grid** — a single WebGPU canvas showing ~12 crystals of the selected kind laid out in a grid, each generated with a **stable seed** (e.g. its grid index) so individuals morph in place rather than reshuffling as sliders move. Slowly rotate them in unison. On any slider input, regenerate all grid crystals from the edited template (dispose old geometries/materials). Render through the same bloom pipeline as the game so what you tune is what you get; render at full close-range energy (no distance falloff).
4. **Inspect view** — clicking a crystal in the grid (raycast) highlights it and shows the same (kind, seed, template) crystal in a larger second canvas with `OrbitControls` (from `three/addons`), also bloomed. It regenerates live with the sliders too.
5. **Save button** — POSTs the edited template JSON to a dev-server endpoint which pretty-prints it into `src/visuals/crystal-template.json`. Because the game imports that JSON, a running game tab hot-reloads with the new look, and the values persist on disk. Show a clear saved/error status in the UI.

## Part 3 — Save endpoint

Create `vite.config.ts` with a small inline plugin: `configureServer` middleware handling `POST /dev/api/template`. It parses the body, validates it's shaped like a `CrystalTemplate` (reject anything else; never write any other path), and writes `src/visuals/crystal-template.json` with 2-space indent + trailing newline. Respond with JSON status.

## Docs

Add a short note to `AGENTS.md` (one or two lines): the enemy tuning gallery lives at `/dev` during `npm run dev`, and `src/visuals/crystal-template.json` is the source of truth for crystal tuning.

## Verification

- `npm run typecheck` and `npm run build` pass.
- Start the dev server; `curl` confirms `/dev/` returns the gallery HTML and the game page still loads.
- `curl -X POST` the save endpoint with a valid template body → file written correctly; with garbage → rejected, file untouched. Restore the file to defaults afterwards (git checkout) unless the test wrote identical content.
- Headless Chrome in this WSL2 environment **cannot render WebGPU** — do not attempt visual verification; the human will playtest.
