# Visual tools

These tools help inspect procedural visuals when a full WebGPU playtest is not available. They use headless Chrome with SwiftShader/WebGL fallbacks where possible. Do not constrain level design around these fallbacks: the game remains WebGPU-only, and the tools own any reduced-fidelity rendering.

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

Single-frame outputs are named with the level, timestamp, fidelity, and any non-default modes such as `-projectiles` or `-mortal`.

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

## Crystal enemy tuning gallery

The `/dev` enemy gallery is specifically for `crystal-corridor`; it reads and writes `src/levels/crystal/visuals/crystal-template.json`.
