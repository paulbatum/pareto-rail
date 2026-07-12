# Visual tools

These tools help inspect procedural visuals when a full WebGPU playtest is not available. They use headless Chrome with SwiftShader/WebGL fallbacks where possible. Do not constrain level design around these fallbacks: the game remains WebGPU-only, and the tools own any reduced-fidelity rendering.

For performance gates and the `?perf=1` real-hardware overlay, see `docs/perf-tools.md`.

## Procedural model snapshots

Use model snapshots for isolated enemies, props, glyphs, or environment pieces that can be returned from a factory as a Three `Object3D`:

```sh
npm run snapshot -- --module src/levels/crystal/visuals/crystal.ts --export createCrystalNode
```

Useful options:

```sh
--args '["drifter"]'   # JSON array passed to the exported factory
--angles 8             # number of orbit views
--size 1024            # square PNG size
--bloom 0              # disable shared bloom for inspection
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

Single-frame outputs are named with the level, timestamp, resolved musical position (if applicable), fidelity, and any non-default modes.

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
  --level downpour-hlht --entrant entrant-a --dry-run
```

Remove `--dry-run` to render. The command delegates to `gameplay-snapshot` with
seed `424242`, four evenly spaced run-time centers, immortal mode, hidden
projectiles, `1280x720` source frames, `320px` thumbnails, four columns, and
the `auto` fidelity policy (falling back through `full`, `postless`, then
`flat`). It records the actually resolved fidelity for each frame and the
aggregate fidelity. The command writes `<opaque-entrant-id>.png` plus a JSON
manifest containing the resolved times, output dimensions, SHA-256, and the
snapshot-script hash. The filename intentionally contains no model or
workflow identity. If Chrome/WebGPU is unavailable, keep a development
fixture's thumbnail status as `placeholder`; never claim a placeholder is an
actual production asset.

Catalog projections and hard production checks are built separately:

```sh
npm run benchmark:catalog -- build --source benchmark/public/fixtures/downpour-rehearsal.json \
  --out /tmp/raild-catalog --mode development --fixture
```

See `benchmark/public/README.md` for the pre-vote/reveal boundary and the
production rejection rules.

## Target occlusion check

Use the target occlusion check to catch scenery or other large meshes blocking lockable target centers during an automated run:

```sh
npm run check:occlusion -- --all
npm run check:occlusion -- --level deluge --no-fail
```

By default the tool drives a simple perfect lock-on policy, then warns when a target center is blocked for more than 5% of its on-screen lifetime. `npm run check:floor -- --level <level-id>` runs this default occlusion pass for the selected level; use `check:occlusion` directly when you need all levels, JSON, alternate thresholds, or a non-failing diagnostic run. The tool ignores projectiles, the reticle, letters, other targets, non-depth-writing effects, and objects with `userData.raildIgnoreOcclusion = true` on themselves or an ancestor. Useful options:

```sh
--threshold 0.05                # maximum occluded ratio
--sample-step 0.1               # seconds between occlusion samples
--include-targets-as-occluders  # count enemy-on-enemy overlap too
--policy none                   # sample without auto-locking targets
--json                          # machine-readable report
--no-fail                       # print warnings without a failing exit code
```

## Crystal enemy tuning gallery

The `/dev` enemy gallery is specifically for `crystal-corridor`; it reads and writes `src/levels/crystal/visuals/crystal-template.json`.
