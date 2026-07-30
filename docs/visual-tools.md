# Visual tools

These tools inspect procedural visuals without a human playtest. They render through the same WebGPU pipeline the game ships, so what they capture is what a player sees.

For performance gates and the `?perf=1` real-hardware overlay, see `docs/perf-tools.md`.

Video recording is a separate concern documented in `docs/playthrough-videos.md`. It exists to produce promotional footage of finished levels and plays no part in building, checking, or reviewing one — a level never needs a video.

## Requirements

Rendering needs a real GPU, which rules out headless Chrome inside WSL: it exposes no render device and no WebGPU at all. The tools therefore drive Chrome (or Edge) on the Windows side over its remote debugging port, exactly as the playthrough recorder does. That needs:

- a Windows Chrome or Edge — point `PARETO_CAPTURE_BROWSER` at the executable if it is installed somewhere unusual;
- WSL's mirrored networking mode (`networkingMode=mirrored` in `.wslconfig`), so WSL reaches the browser and the browser reaches the dev server;
- a registered `WSLInterop` binfmt handler, so WSL can start a Windows program at all. A qemu or docker binfmt installer can flush it; `wsl --shutdown` from Windows restores it.

Each tool names the missing piece when one of these is absent rather than falling back quietly, because a silent fallback returns an image that is not the game.

`--software` takes the fallback deliberately: Chrome inside WSL on SwiftShader, where three.js can only use its WebGL2 backend. It approximates the composition and gets the colours roughly right, but node materials and postprocessing are not what ships. Environments with no Windows browser to reach — the benchmark entrant sandboxes — set `PARETO_RENDER_MODE=software` so their tools take that path by default. `--gpu` forces the real pipeline back on.

## Procedural model snapshots

Use model snapshots for isolated enemies, props, glyphs, or environment pieces that can be returned from a factory as a Three `Object3D`:

```sh
npm run snapshot -- --module src/levels/crystal/visuals/crystal.ts --export createCrystal --args '["drifter"]'
```

Useful options:

```sh
--args '["drifter"]'   # JSON array passed to the exported factory
--angles 8             # number of orbit views
--size 1024            # square PNG size
--bloom 0              # disable shared bloom for inspection
--software             # SwiftShader fallback instead of the real pipeline
--out snapshots/foo
```

Outputs are written under `snapshots/` by default. The tool normalizes and frames the returned object, captures orbit angles, and reports average luminance to catch black frames.

## Gameplay snapshots

Use gameplay snapshots to inspect the actual level runtime from the rail camera:

```sh
npm run snapshot:gameplay -- --level helios --time 12
# Discovered benchmark levels use their descriptor id; no registry edit is needed.
npm run snapshot:gameplay -- --level <benchmark-level-id> --time 12
```

Defaults are chosen for visual review:

- immortal player mode is enabled;
- projectiles are hidden, because volleys can cover the composition;
- fidelity is `auto`, which tries `full`, then `postless`, then `flat`;
- render size is `1280x720`.

Useful options:

```sh
--width 1920 --height 1080  # raw gameplay render size for still captures
--fidelity full             # or postless, flat, auto
--mortal                    # allow the player to die normally
--projectiles               # include homing shot meshes
--debug-value <value>        # pass a level debug selector value
--software                  # SwiftShader fallback instead of the real pipeline
--out snapshots/gameplay
```

### Musical addressing

Inspect the level at specific musical times instead of raw seconds:

```sh
npm run snapshot:gameplay -- --level crystal --at 8       # bar 8 (beat 0)
npm run snapshot:gameplay -- --level crystal --at 8:2     # bar 8, beat 2
npm run snapshot:gameplay -- --level crystal --at warden  # named marker (e.g. boss entrance)
npm run snapshot:gameplay -- --level crystal --at 4 --at 8 # repeatable --at flag
npm run snapshot:gameplay -- --level crystal --ats 4,8:2,warden # comma-separated list
npm run snapshot:gameplay -- --level crystal --sections   # contact sheet at each section boundary
```

* `--at <bar[:beat] | marker>` — converts a musical position to seconds using the level's BPM (assuming a default 4 beats/bar) or looks up a named marker. Can be repeated.
* `--ats <list>` — a comma-separated list of musical positions or named markers.
* `--sections` — captures a thumbnail sheet at each arrangement section boundary, sourced from per-level marker and section metadata.

Single-frame outputs are named with the level, timestamp, resolved musical position (if applicable), fidelity, and any non-default modes. Capture the attract/start screen without beginning a run with `npm run snapshot:gameplay -- --level crystal --start-screen --time 0.8`; `--start-screen` defaults to an 0.8-second attract capture when no time is supplied.

## Gameplay thumbnail sheets

Use thumbnail sheets to scan an entire run quickly:

```sh
npm run snapshot:gameplay -- --level helios --thumbnails 8
```

When no times are specified, `--thumbnails <count>` reads the level run duration and samples evenly through the playthrough. The sample points are centered in each interval, so 8 thumbnails on a 120-second level capture 7.5s, 22.5s, 37.5s, and so on.

Use exact timings when you want to inspect known beats or boss moments:

```sh
npm run snapshot:gameplay -- --level helios --sheet --times 4,12,24,48
```

Sheet resolution is controlled by the thumbnail layout, not by the raw render size alone:

```sh
--thumb-width 480  # width of each thumbnail in the contact sheet
--columns 4        # fixed column count; default is roughly square
--width 1920 --height 1080  # aspect ratio and source render size
```

For example, the default 4-thumbnail sheet is `664x432`: two 320-pixel-wide thumbnails per row, 180-pixel thumbnail height from the 16:9 render aspect, a 24-pixel label strip, and 8-pixel gutters.

### Deterministic benchmark cards

Benchmark comparison cards use a fixed four-frame policy rather than a visual
reviewer's ad-hoc capture:

```sh
npm run benchmark:thumbnails -- \
  --level mass-driver-wo4m --entrant entrant-a --dry-run
```

Remove `--dry-run` to render. The command delegates to `gameplay-snapshot` with
seed `424242`, four evenly spaced run-time centers, immortal mode, hidden
projectiles, `1280x720` source frames, `320px` thumbnails, four columns, and
the `auto` fidelity policy (falling back through `full`, `postless`, then
`flat`). It records the actually resolved fidelity for each frame, the
aggregate fidelity, and the render backend the frames came from. The command
writes `<opaque-entrant-id>.png` plus a JSON manifest containing the resolved
times, output dimensions, SHA-256, and the snapshot-script hash. The filename
intentionally contains no model or workflow identity.

## Target occlusion check

Use the target occlusion check to catch scenery or other large meshes blocking lockable target centers during an automated run:

```sh
npm run check:occlusion -- --all
npm run check:occlusion -- --level deluge --no-fail
```

By default the tool drives a simple perfect lock-on policy, then warns when a target center is blocked for more than 5% of its on-screen lifetime. It raycasts the scene graph and never renders a frame, so it always takes the software path and needs no GPU browser. `npm run check:floor -- --level <level-id>` runs this default occlusion pass for the selected level; use `check:occlusion` directly when you need all levels, JSON, alternate thresholds, or a non-failing diagnostic run. The tool ignores projectiles, the reticle, letters, other targets, non-depth-writing effects, and objects with `userData.raildIgnoreOcclusion = true` on themselves or an ancestor. Useful options:

```sh
--threshold 0.05                # maximum occluded ratio
--sample-step 0.1               # seconds between occlusion samples
--include-targets-as-occluders  # count enemy-on-enemy overlap too
--policy none                   # sample without auto-locking targets
--json                          # machine-readable report
--no-fail                       # print warnings without a failing exit code
```

## Reference comparison kit

`npm run refcompare -- <subcommand>` compares a render against a reference image. It is pure image processing — it never renders, so it needs no GPU browser. Feed it captures from `snapshot:gameplay`. Outputs default under `tmp/ref-compare/`; `--out` overrides. `npm run refcompare` alone lists every subcommand, and `-- <subcommand> --help` prints one.

Reach for `grid` + `compare` when matching composition, `sample` when matching palette, and `flicker` when hunting z-fighting.

`grid` overlays a labelled 100-pixel measurement grid, so a feature can be named by its pixel coordinates and looked for at the same numbers on the other image. `--horizon` and `--center` draw red reference lines.

```sh
npm run refcompare -- grid tmp/inspiration/reference.png --horizon 781
```

`stack` puts both full frames one above the other at a matched width — the fastest read on framing, horizon height, and overall massing.

```sh
npm run refcompare -- stack tmp/inspiration/reference.png snapshots/gameplay/pyre-5s-full.png
```

`blend` ghosts the reference over the render at 50%. Anything misaligned shows as doubled edges, which locates a drift that stacked panels hide.

```sh
npm run refcompare -- blend tmp/inspiration/reference.png snapshots/gameplay/pyre-5s-full.png
```

`compare` stacks the *same region* from both images, reference on top, enlarged. This is the working loop for one feature at a time. Both frames are scaled to the reference resolution first, so one region rectangle reads the same on each.

```sh
npm run refcompare -- compare tmp/inspiration/reference.png snapshots/gameplay/pyre-5s-full.png --region gate:600,760,800,320 --grid
```

`crop` cuts named regions out of one image and enlarges them, for close reading without a counterpart.

```sh
npm run refcompare -- crop tmp/inspiration/reference.png --region trench:600,760,800,320 --region pyramids:350,380,900,480
```

`sample` prints the hex colour and luminance at named pixels, across any number of images; with two it also prints the luminance delta. Later images are scaled to the first one's resolution. Sample the raw captures, not `grid` output — a grid line lands on every hundredth pixel and poisons the reading. `--points <file.json>` takes a reusable `{ "name": [x, y] }` list.

```sh
npm run refcompare -- sample tmp/inspiration/reference.png snapshots/gameplay/pyre-5s-full.png --at "trench hot=980,900" --at 400,1040
```

`flicker` finds z-fighting and shimmer, which are temporal and so invisible in a single still. Capture two frames a small time-step apart yourself, then diff them:

```sh
npm run snapshot:gameplay -- --level pyre --time 5 --seed 424242 --out tmp/ref-compare/frames
npm run snapshot:gameplay -- --level pyre --time 5.05 --seed 424242 --out tmp/ref-compare/frames
npm run refcompare -- flicker tmp/ref-compare/frames/pyre-5s-full.png tmp/ref-compare/frames/pyre-5p05s-full.png --ignore 0,940,1920,140
```

Keep the step small — a fifth of a second already moves the rail camera far enough that parallax dominates the diff. The report clusters changed pixels into regions and labels each one by how densely it is filled: `speckle` is sparse high-contrast change spread over a wide box, the signature of coplanar surfaces flipping; `solid` is a dense coherent blob, which is ordinary animation. Pass `--ignore <l,t,w,h>` for regions that are meant to move (enemies, effects, HUD), repeatable. `--threshold` sets the per-pixel channel delta that counts as change, `--json` emits the report machine-readably, and the heatmap image draws every changed pixel over a dimmed frame with the reported regions boxed.

## Level content image sets

A public level showcase can carry three optional images: `overview` is a four-frame contact sheet, `start` is the attract screen, and `hero` is the strongest single gameplay frame. Store them under `public/level-content/<level-id>/` and expose their paths through `contentImages` on the level catalog metadata (or the benchmark `level.json` descriptor). For an image-only contact sheet, add `--no-labels`; add `--no-borders` as well to remove the gutters between and around thumbnails. The default keeps timing, fidelity labels, and gutters for inspection. For Crystal Corridor, the checked-in set is `public/level-content/crystal-corridor/`.

A reproducible Crystal set can be regenerated with:

```sh
npm run snapshot:gameplay -- --level crystal --sheet --times 4,8,18,36 --thumb-width 480 --columns 2 --no-labels --no-borders --out /tmp/crystal-content --fidelity full --seed 424242
npm run snapshot:gameplay -- --level crystal --start-screen --time 0.8 --out /tmp/crystal-content --fidelity full --seed 424242
npm run snapshot:gameplay -- --level crystal --time 36 --out /tmp/crystal-content --fidelity full --seed 424242
```

The `/dev` enemy gallery is specifically for `crystal-corridor`; it reads and writes `src/levels/crystal/visuals/crystal-template.json`.
