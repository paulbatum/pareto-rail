---
name: level-content-images
description: "Create or refresh a Pareto Rail level's three public content images: an eight-frame review sheet, a selected full-resolution hero frame, a four-frame unlabeled overview, and a start-screen capture. Use when adding or updating level showcase images."
---

# Level content images

Use this workflow for a built-in level or an integrated benchmark level that needs public showcase imagery. The deliverable is exactly three AVIFs:

- `overview.avif` — four gameplay moments, with no labels or gutters;
- `start.avif` — the attract screen before the run begins;
- `hero.avif` — the strongest single gameplay composition.

Store them at `public/level-content/<level-id>/`. Connect the paths through `contentImages`: use `src/levels/index.ts` for a built-in level, or that level's `src/benchmark-levels/<level-id>/level.json` descriptor for a benchmark level.

## Images an entrant shipped

A benchmark entrant may ship its own images, which arrive with the promoted level. Replace all three by running the workflow below.

The entrant sandbox sets `PARETO_RENDER_MODE=software`, so an entrant renders on SwiftShader through three.js's WebGL2 backend. That backend runs neither the bloom nor the emissive passes the game ships, and it can drop emissive geometry from the frame entirely, so an entrant's images can show a darker and emptier level than a player sees.

View the entrant's three images before you replace them, and report where your renders differ from them. That difference tells the operator what the software path lost.

## Workflow

1. Read `docs/visual-tools.md` and confirm the level id and run duration or named markers.
2. Make one eight-frame **review sheet**. Keep the default labels and gutters so each candidate's time is visible:

   ```sh
   npm run snapshot:gameplay -- --level <level-id> --thumbnails 8 --thumb-width 480 --columns 4 --out /tmp/<level-id>-content-review --fidelity full --seed 424242
   ```

   If the level has named moments that the even sampling misses, use one explicit eight-time sheet instead:

   ```sh
   npm run snapshot:gameplay -- --level <level-id> --sheet --times <eight comma-separated seconds> --thumb-width 480 --columns 4 --out /tmp/<level-id>-content-review --fidelity full --seed 424242
   ```

   The snapshot runtime never fires at targets, so a level whose world changes only when the player destroys something renders the same scene at every timestamp. When the eight candidates look alike, search the level module for a `debugValue` branch: a level that provides one plays its run under `--debug-value <value>`, and the sheet then shows an arc.

3. Inspect that single sheet. Rank all eight frames by composition, readability, distinctive level identity, and lack of blown-out or empty space. Do **not** render full-size candidates before making this choice.
4. Take the top-ranked timestamp as the hero. Take the next best four *distinct* moments as the overview. A hero timestamp may also appear in the overview if it remains one of the four strongest moments.
5. Render only the selected hero at full resolution:

   ```sh
   npm run snapshot:gameplay -- --level <level-id> --time <hero-seconds> --width 1920 --height 1080 --out /tmp/<level-id>-content-final --fidelity full --seed 424242
   ```

6. Render the selected four as the public overview, without labels or borders:

   ```sh
   npm run snapshot:gameplay -- --level <level-id> --sheet --times <four comma-separated seconds> --thumb-width 480 --columns 2 --no-labels --no-borders --out /tmp/<level-id>-content-final --fidelity full --seed 424242
   ```

7. Capture the start screen. This must use `--start-screen`, which leaves the runtime in attract mode:

   ```sh
   npm run snapshot:gameplay -- --level <level-id> --start-screen --time 0.8 --width 1920 --height 1080 --out /tmp/<level-id>-content-final --fidelity full --seed 424242
   ```

8. Convert the three selected PNG renders to AVIF before copying them into the public asset tree. Snapshot intermediates in `/tmp` remain PNG:

   ```sh
   find /tmp/<level-id>-content-final -maxdepth 1 -type f -name '*.png' -print0 | xargs -0 node scripts/png-to-avif.mjs
   ```

9. Copy the three AVIF results to `public/level-content/<level-id>/` as `hero.avif`, `overview.avif`, and `start.avif`. Inspect those final three files. Do not use files from ignored `snapshots/` as product assets.
10. Add or update `contentImages` metadata. Validate with:

   ```sh
   npm run typecheck
   npm run build
   ```

   For a benchmark level, also confirm you wrote nothing outside that level's own directories:

   ```sh
   npm run check:benchmark-scope -- --level <level-id> --base HEAD --content-only
   ```

   Pass `--content-only` because this workflow can change the content directory alone. Without it the check demands a change under `src/benchmark-levels/<level-id>/`, which an images-only pass never touches, and fails with "contains no assigned output directory". Never add a source edit to satisfy that message.

   Commit the assets, metadata, and any tool or documentation changes together.

## Selection rules

- A hero must be legible at a glance and identify the level without explanatory text.
- Favor a clear focal point, depth, and the level's signature enemy, set piece, or environment.
- Judge the hero at gallery-card size as well as full size: downscale it to roughly 480x270 and confirm it still identifies the level and holds a focal point. A level meant to be dark stays dark — choose the frame that survives the downscale rather than a brighter moment that misrepresents the level.
- Reject frames dominated by HUD-free dead space, clipped geometry, motion-transition artifacts, or large blown-out regions.
- The overview should tell the run's visual arc. Choose different encounters or environments rather than four minor variants of one fight.
- Re-run the review sheet with better explicit times only when none of its eight candidates are publishable. Do not browse a sequence of full-screen captures to search for a hero.
- Snapshot output is best-effort fallback rendering. A real WebGPU playtest remains the authority for final visual quality.
