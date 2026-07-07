# Performance tools

Use these when a level slows down over a run or when handing off a level that may create too many objects, geometries, or draw calls.

## Headless performance gate

```sh
npm run check:perf -- --level <level-id>
npm run check:perf -- --level rush --json snapshots/perf/rush.json
```

The tool boots the level through the gameplay snapshot harness with seeded randomness, immortal player mode, a fixed simulation step, a 640×360 default viewport, and the SwiftShader/WebGL fallback used by the other headless visual tools. It advances the real runtime loop for the full run and samples once per simulated second:

- renderer draw calls and triangles;
- renderer geometry, texture, and exposed program or pipeline counts;
- total scene object count and `visible === true` object count;
- JavaScript heap used through Chrome DevTools Protocol when available;
- wall-clock milliseconds spent per stepped frame inside that second.

The default gates are intentionally aimed at growth and absurd budgets, not absolute SwiftShader frame time:

- late-run means are compared with seconds 2–5, with a default failure threshold of `1.35×` for draw calls, scene objects, visible objects, geometries, textures, and heap;
- non-heap growth also has small absolute allowances so normal bounded warm-up does not fail when a level first reaches later enemy types: `64` draw calls, `128` objects, `512` geometries, and `8` textures;
- heap has a default `32 MB` absolute growth allowance, plus a monotonic-slope gate of `0.35 MB/s` to avoid failing on normal garbage-collection noise;
- draw calls fail above `500` in any sampled frame;
- total scene objects fail above `5000` in any sample;
- stepped frame-time growth above `1.5×` is a warning, not a failure, because SwiftShader absolute timing is not representative of real WebGPU hardware.

Useful overrides:

```sh
--growth-ratio 1.5
--heap-allowance-mb 64
--heap-slope-mb-per-second 0.5
--max-calls 800
--max-objects 8000
--frame-growth-warn-ratio 2
--draw-call-growth-allowance 96
--object-growth-allowance 192
--geometry-growth-allowance 768
--texture-growth-allowance 16
--dt 0.0166667
--seed 123
--no-fail
```

`npm run check:floor -- --level <level-id>` runs `check:perf` as a mandatory stage after the simulation and occlusion gates.

## Real-hardware playtest overlay

In dev builds (`npm run dev`) the overlay is on by default, in the top-left corner; pass `perf=0` to turn it off. In production builds it is off unless requested with `perf=1`:

```text
http://localhost:5173/?level=rush&perf=0
https://<deployed>/?level=rush&perf=1
```

Outside dev builds, no recorder or overlay is created without `perf=1`.

The overlay records frame delta times into preallocated buffers and samples counters once per second. It displays current frames per second, the worst frame in the current second, a five-second sparkline, and current draw calls. Press the `perf json` button to download a JSON report at any time; on `runend` the overlay only logs the summary, it never downloads on its own.

The JSON report contains per-second frame buckets with average, p95, p99, and max frame milliseconds, plus the renderer and scene counters, level id, run duration, user agent, and timestamp. The overlay also prints a compact `console.table` summary for quick comparison during playtests.
