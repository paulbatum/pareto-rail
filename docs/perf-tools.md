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
- JavaScript heap retained after a forced collection, through Chrome DevTools Protocol when available;
- wall-clock milliseconds spent per stepped frame inside that second.

The default gates are intentionally aimed at growth and absurd budgets, not absolute SwiftShader frame time:

- late-run means are compared with seconds 2–5, with a default failure threshold of `1.35×` for draw calls, scene objects, visible objects, geometries, and textures;
- growth also has small absolute allowances so normal bounded warm-up does not fail when a level first reaches later enemy types: `64` draw calls, `128` objects, `512` geometries, and `8` textures;
- retained heap has a default `16 MB` allowance, measured as the late-window mean minus the seconds 2–5 mean;
- draw calls fail above `500` in any sampled frame;
- total scene objects fail above `5000` in any sample;
- stepped frame-time growth above `1.5×` is a warning, not a failure, because SwiftShader absolute timing is not representative of real WebGPU hardware.

### Retained heap

The heap column is read after a forced collection at every sample, so it is what the run is still holding rather than wherever the allocation sawtooth happened to be. This matters more than it sounds: sampling the raw heap measures uncollected garbage as much as retention, and whether a collection fires near a sample depends on how busy that stretch of the level is. A level that goes quiet in its final seconds gives the collector no reason to run, ends its last sample at the top of a sawtooth, and reads as though it leaked tens of megabytes when it retained a fraction of that. Collecting first removes the question, and makes the reading repeatable to a tenth of a megabyte across runs.

Some retention across a run is normal and sometimes deliberate — a level whose premise is accumulation keeps what it accumulates. The allowance is set well above what the built-in levels use, so the gate catches an unbounded climb rather than a level that holds onto its own content.

### Authoring budget and gate margin

Every allowance above is the budget a level is **authored** to. A gate that decides a benchmark run allows `1.5×` that before it fails. A level between the two is reported as a warning, `⚠`, and passes:

- `✓` — inside the authoring budget.
- `⚠` — over the authoring budget, inside the margin a gate reserves. Worth fixing; it will not fail a run.
- `✗` — past the margin as well.

The two-tier bar exists because a single threshold makes an author's local check and the benchmark gate the same coin flip: a level parked just under the line passes locally and fails the gate, or the reverse, on nothing the author changed. Reserving the margin means the number an author is asked to meet is strictly tighter than the number that can end a run, so landing near the budget costs a warning instead of a result.

Useful overrides:

```sh
--growth-ratio 1.5
--heap-retention-mb 32
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
